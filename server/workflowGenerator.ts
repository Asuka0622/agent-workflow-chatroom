import type {
  ConnectedAgent,
  LaneId,
  NodeKind,
  ProviderConfig,
  WorkflowDefinition,
  WorkflowEdgeConfig,
  WorkflowNodeConfig,
} from '../shared/types.js';
import { agentHub } from './agentHub.js';
import { isApiProvider, runProviderApi } from './apiRunner.js';
import { loadProviders } from './store.js';

const VALID_KINDS = new Set<NodeKind>([
  'human_input',
  'llm',
  'human_gate',
  'review_loop',
  'shell',
  'condition',
  'file_read',
  'file_write',
  'http',
  'delay',
]);

const VALID_LANES = new Set<LaneId>(['human', 'claude', 'gemini', 'codex', 'release']);

function slugId(raw: string, idx: number): string {
  const clean = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || `step_${idx + 1}`;
}

function autoLayoutNodes(nodes: WorkflowNodeConfig[]): WorkflowNodeConfig[] {
  const depthMap = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const computeDepth = (id: string, stack = new Set<string>()): number => {
    if (depthMap.has(id)) return depthMap.get(id)!;
    if (stack.has(id)) return 0;
    const node = byId.get(id);
    if (!node || !node.dependsOn || node.dependsOn.length === 0) {
      depthMap.set(id, 0);
      return 0;
    }
    stack.add(id);
    let maxParent = 0;
    for (const dep of node.dependsOn) {
      if (byId.has(dep)) {
        maxParent = Math.max(maxParent, computeDepth(dep, stack) + 1);
      }
    }
    stack.delete(id);
    depthMap.set(id, maxParent);
    return maxParent;
  };

  for (const n of nodes) computeDepth(n.id);

  const rowBuckets = new Map<number, WorkflowNodeConfig[]>();
  for (const n of nodes) {
    const d = depthMap.get(n.id) ?? 0;
    const list = rowBuckets.get(d) || [];
    list.push(n);
    rowBuckets.set(d, list);
  }

  return nodes.map((n) => {
    const y = depthMap.get(n.id) ?? 0;
    const siblings = rowBuckets.get(y) || [n];
    const x = Math.max(0, siblings.findIndex((s) => s.id === n.id));
    return { ...n, position: { x, y } };
  });
}

function assignOnlineModels(
  nodes: WorkflowNodeConfig[],
  onlineMemberIds: string[],
): WorkflowNodeConfig[] {
  if (!onlineMemberIds.length) return nodes;
  let cursor = 0;
  return nodes.map((n) => {
    if (n.kind === 'llm') {
      if (n.providerId && onlineMemberIds.includes(n.providerId)) return n;
      const picked = onlineMemberIds[cursor % onlineMemberIds.length];
      cursor += 1;
      return { ...n, providerId: picked };
    }
    if (n.kind === 'review_loop') {
      const reviewer =
        n.providerId && onlineMemberIds.includes(n.providerId)
          ? n.providerId
          : onlineMemberIds[cursor++ % onlineMemberIds.length];
      const fixer =
        n.fixProviderId && onlineMemberIds.includes(n.fixProviderId)
          ? n.fixProviderId
          : onlineMemberIds.length > 1
            ? onlineMemberIds.find((id) => id !== reviewer) || reviewer
            : reviewer;
      return { ...n, providerId: reviewer, fixProviderId: fixer };
    }
    return n;
  });
}

function sanitizeWorkflow(
  raw: Partial<WorkflowDefinition>,
  fallbackName: string,
  onlineMemberIds: string[],
): WorkflowDefinition {
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const usedIds = new Set<string>();
  const idRemap = new Map<string, string>();

  const nodes: WorkflowNodeConfig[] = [];
  for (let i = 0; i < rawNodes.length; i += 1) {
    const item = rawNodes[i] as Partial<WorkflowNodeConfig>;
    if (!item || typeof item !== 'object') continue;
    let id = slugId(item.id || '', i);
    while (usedIds.has(id)) id = `${id}_${i + 1}`;
    usedIds.add(id);
    if (item.id) idRemap.set(String(item.id), id);

    const kind: NodeKind = VALID_KINDS.has(item.kind as NodeKind)
      ? (item.kind as NodeKind)
      : i === 0
        ? 'human_input'
        : 'llm';
    const lane: LaneId = VALID_LANES.has(item.lane as LaneId)
      ? (item.lane as LaneId)
      : kind === 'human_input' || kind === 'human_gate'
        ? 'human'
        : kind === 'shell' || kind === 'review_loop'
          ? 'release'
          : i % 3 === 1
            ? 'claude'
            : i % 3 === 2
              ? 'gemini'
              : 'codex';

    nodes.push({
      id,
      title: String(item.title || `步骤 ${i + 1}`).trim().slice(0, 40),
      subtitle: String(item.subtitle || '').trim().slice(0, 80),
      lane,
      kind,
      providerId:
        kind === 'human_input' || kind === 'human_gate'
          ? 'human'
          : kind === 'shell'
            ? 'shell'
            : String(item.providerId || '').trim(),
      fixProviderId: kind === 'review_loop' ? String(item.fixProviderId || '').trim() : undefined,
      maxRounds: kind === 'review_loop' ? Math.min(5, Math.max(1, Number(item.maxRounds) || 2)) : undefined,
      shellCommand:
        kind === 'shell' ? String(item.shellCommand || 'npm run typecheck').trim() : undefined,
      conditionMode: kind === 'condition' ? item.conditionMode || 'contains' : undefined,
      conditionPattern:
        kind === 'condition' ? String(item.conditionPattern || 'PASS').trim() : undefined,
      enabled: item.enabled !== false,
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map((d) => String(d)) : [],
      promptTemplate:
        kind === 'llm' || kind === 'review_loop'
          ? String(
              item.promptTemplate ||
                `你是「${item.title || `步骤 ${i + 1}`}」负责专家（当前模型：{{providerName}}）。请结合任务需求与前序产出完成本步工作。\n\n【任务需求】\n{{requirement}}\n\n【前序产出】\n{{previousOutput}}`,
            ).trim()
          : undefined,
      fixPromptTemplate:
        kind === 'review_loop'
          ? String(
              item.fixPromptTemplate ||
                '请根据以下审查意见完成修复并说明改动：\n\n【审查意见】\n{{reviewFeedback}}',
            ).trim()
          : undefined,
      position: { x: 0, y: i },
    });
  }

  // Ensure there is a root human_input node
  if (nodes.length === 0 || nodes[0].kind !== 'human_input') {
    const inputId = usedIds.has('user_requirement') ? 'task_input' : 'user_requirement';
    const firstNonInput = nodes[0];
    nodes.unshift({
      id: inputId,
      title: '任务输入',
      subtitle: '输入核心目标与背景材料',
      lane: 'human',
      kind: 'human_input',
      providerId: 'human',
      enabled: true,
      dependsOn: [],
      position: { x: 0, y: 0 },
    });
    if (firstNonInput && firstNonInput.dependsOn.length === 0) {
      firstNonInput.dependsOn = [inputId];
    }
  }

  const validIdSet = new Set(nodes.map((n) => n.id));
  const rootId = nodes[0].id;
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (i === 0) {
      n.dependsOn = [];
      continue;
    }
    const mapped = n.dependsOn
      .map((d) => idRemap.get(d) || d)
      .filter((d) => validIdSet.has(d) && d !== n.id);
    n.dependsOn = mapped.length > 0 ? Array.from(new Set(mapped)) : [nodes[i - 1].id || rootId];
  }

  const laidOut = autoLayoutNodes(assignOnlineModels(nodes, onlineMemberIds));

  // Build consistent edges from dependsOn
  const edges: WorkflowEdgeConfig[] = [];
  let edgeIdx = 1;
  for (const n of laidOut) {
    for (const dep of n.dependsOn) {
      edges.push({
        id: `ge_${edgeIdx++}`,
        source: dep,
        target: n.id,
      });
    }
  }

  return {
    id: `wf_ai_${Date.now().toString(36)}`,
    name: String(raw.name || fallbackName || '自定义协作工作流').trim().slice(0, 32),
    description: String(raw.description || fallbackName || '由自然语言需求自动编排生成').trim().slice(0, 120),
    nodes: laidOut,
    edges,
  };
}

function synthesizeWorkflowLocally(
  prompt: string,
  currentWorkflow: WorkflowDefinition | undefined,
  onlineMemberIds: string[],
): WorkflowDefinition {
  const text = prompt.trim();
  const isModify =
    Boolean(currentWorkflow && currentWorkflow.nodes.length >= 2) &&
    /(当前|现有|再加|新增|插入|去掉|删除|改成|修改|加上)/.test(text);

  // Quick modification mode on existing workflow
  if (isModify && currentWorkflow) {
    const copy = structuredClone(currentWorkflow);
    const tailNode = copy.nodes[copy.nodes.length - 1];
    const extraNodes: WorkflowNodeConfig[] = [];

    if (/(拍板|审批|人工确认|审核通过)/.test(text)) {
      extraNodes.push({
        id: `gate_${Date.now().toString(36).slice(-4)}`,
        title: '人工拍板确认',
        subtitle: '人工复核前序产出后决定是否继续',
        lane: 'human',
        kind: 'human_gate',
        providerId: 'human',
        enabled: true,
        dependsOn: [tailNode.id],
        position: { x: 0, y: copy.nodes.length },
      });
    }
    if (/(命令|测试|构建|typecheck|lint|自检|脚本)/.test(text)) {
      const parentId = extraNodes.length > 0 ? extraNodes[extraNodes.length - 1].id : tailNode.id;
      extraNodes.push({
        id: `shell_${Date.now().toString(36).slice(-4)}`,
        title: '自动命令自检',
        subtitle: '执行构建 / 类型检查 / 单元测试',
        lane: 'release',
        kind: 'shell',
        providerId: 'shell',
        shellCommand: 'npm run typecheck',
        enabled: true,
        dependsOn: [parentId],
        position: { x: 0, y: copy.nodes.length + extraNodes.length },
      });
    }
    if (/(安全|审查|review|挑刺|校对|润色|总结|汇总)/.test(text) || extraNodes.length === 0) {
      const parentId = extraNodes.length > 0 ? extraNodes[extraNodes.length - 1].id : tailNode.id;
      const title = /(安全)/.test(text)
        ? '安全专项审查'
        : /(润色|校对)/.test(text)
          ? '终稿校对润色'
          : /(总结|汇总)/.test(text)
            ? '最终汇总收尾'
            : '补充增强节点';
      extraNodes.push({
        id: `step_${Date.now().toString(36).slice(-4)}`,
        title,
        subtitle: text.slice(0, 36),
        lane: 'claude',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: [parentId],
        position: { x: 0, y: copy.nodes.length + extraNodes.length },
        promptTemplate: `请作为「${title}」负责专家（当前模型：{{providerName}}），按用户要求完成本步骤：${text}\n\n【原始需求】\n{{requirement}}\n\n【前序产出】\n{{previousOutput}}`,
      });
    }

    copy.nodes.push(...extraNodes);
    return sanitizeWorkflow(
      { ...copy, name: `${copy.name} · 优化版` },
      copy.name,
      onlineMemberIds,
    );
  }

  // Fresh workflow generation based on user intent
  const wantsGate = /(拍板|审批|确认|把关)/.test(text);
  const wantsShell = /(测试|构建|命令|typecheck|编译|自检)/.test(text);
  const wantsParallel3 = /(3个|三个|三模型|圆桌|辩论|头脑风暴|脑暴|多视角)/.test(text);
  const wantsWriting = /(脚本|短视频|文章|公众号|文案|报告|文档|PRD|方案书|润色|策划)/i.test(text);
  const wantsReviewLoop = /(多轮|循环|反复|审查并修复|自动修复)/.test(text);

  const shortTitle = text.replace(/^(请|帮我)?(生成|创建|建|做|设计)(一个|一套)?/, '').slice(0, 18) || '智能定制工作流';
  const nodes: WorkflowNodeConfig[] = [
    {
      id: 'user_requirement',
      title: '任务输入',
      subtitle: '输入主题、目标与约束条件',
      lane: 'human',
      kind: 'human_input',
      providerId: 'human',
      enabled: true,
      dependsOn: [],
      position: { x: 0, y: 0 },
    },
  ];

  let lastIds = ['user_requirement'];

  if (wantsParallel3) {
    nodes.push(
      {
        id: 'view_a',
        title: '视角 A · 创意突破',
        subtitle: '提供高上限与差异化创意',
        lane: 'gemini',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: ['user_requirement'],
        position: { x: 0, y: 1 },
        promptTemplate: `你是「视角 A · 创意突破」专家（当前模型：{{providerName}}），聚焦创意与亮点完成任务：\n\n【需求】\n{{requirement}}`,
      },
      {
        id: 'view_b',
        title: '视角 B · 稳健落地',
        subtitle: '提供可执行、低风险的结构方案',
        lane: 'claude',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: ['user_requirement'],
        position: { x: 1, y: 1 },
        promptTemplate: `你是「视角 B · 稳健落地」专家（当前模型：{{providerName}}），聚焦结构清晰与可执行性完成任务：\n\n【需求】\n{{requirement}}`,
      },
      {
        id: 'view_c',
        title: '视角 C · 批判挑刺',
        subtitle: '专找漏洞、受众盲区与潜在风险',
        lane: 'codex',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: ['user_requirement'],
        position: { x: 2, y: 1 },
        promptTemplate: `你是「视角 C · 批判挑刺」专家（当前模型：{{providerName}}），从反面视角指出风险与遗漏：\n\n【需求】\n{{requirement}}`,
      },
    );
    lastIds = ['view_a', 'view_b', 'view_c'];
  } else if (wantsWriting) {
    nodes.push(
      {
        id: 'outline_plan',
        title: '结构策划与大纲',
        subtitle: '明确受众痛点、节奏与核心框架',
        lane: 'gemini',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: ['user_requirement'],
        position: { x: 0, y: 1 },
        promptTemplate: `你是策划专家（当前模型：{{providerName}}），请围绕需求设计吸睛结构与核心大纲：\n\n【需求】\n{{requirement}}`,
      },
      {
        id: 'draft_write',
        title: '正文撰写',
        subtitle: '按大纲输出完整初稿',
        lane: 'claude',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: ['outline_plan'],
        position: { x: 0, y: 2 },
        promptTemplate: `你是撰稿专家（当前模型：{{providerName}}），请基于大纲写出高质量完整正文：\n\n【需求】\n{{requirement}}\n\n【策划大纲】\n{{previousOutput}}`,
      },
    );
    lastIds = ['draft_write'];
  } else {
    nodes.push(
      {
        id: 'plan_a',
        title: '主方案设计',
        subtitle: '结合项目上下文产出核心方案',
        lane: 'claude',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: ['user_requirement'],
        position: { x: 0, y: 1 },
        promptTemplate: `你是主控架构师（当前模型：{{providerName}}），请结合上下文给出清晰落地方案：\n\n【需求】\n{{requirement}}\n\n【仓库快照】\n{{repoContext}}`,
      },
      {
        id: 'plan_b',
        title: '独立补充视角',
        subtitle: '交叉验证并补充边界与体验细节',
        lane: 'gemini',
        kind: 'llm',
        providerId: '',
        enabled: true,
        dependsOn: ['user_requirement'],
        position: { x: 1, y: 1 },
        promptTemplate: `你是独立评审专家（当前模型：{{providerName}}），请从另一视角补充更优做法与潜在盲点：\n\n【需求】\n{{requirement}}\n\n【仓库快照】\n{{repoContext}}`,
      },
    );
    lastIds = ['plan_a', 'plan_b'];
  }

  // Convergence / synthesis node
  nodes.push({
    id: 'final_merge',
    title: wantsWriting ? '审校润色与定稿' : '综合收敛与交付',
    subtitle: '融合前序结果，输出最终可交付方案',
    lane: 'claude',
    kind: 'llm',
    providerId: '',
    enabled: true,
    dependsOn: lastIds,
    position: { x: 0, y: 3 },
    promptTemplate: `你是首席收口专家（当前模型：{{providerName}}），请融合并精修前序产出，输出结构清晰、可直接使用的最终结果。\n\n【原始需求】\n{{requirement}}\n\n【前序产出】\n{{previousOutput}}`,
  });
  lastIds = ['final_merge'];

  if (wantsShell) {
    nodes.push({
      id: 'shell_check',
      title: '本地命令校验',
      subtitle: '执行构建 / 类型检查命令验证结果',
      lane: 'release',
      kind: 'shell',
      providerId: 'shell',
      shellCommand: 'npm run typecheck',
      enabled: true,
      dependsOn: lastIds,
      position: { x: 0, y: 4 },
    });
    lastIds = ['shell_check'];
  }

  if (wantsReviewLoop) {
    nodes.push({
      id: 'auto_review',
      title: '多轮审查与修复',
      subtitle: '自动挑错并修复直到通过',
      lane: 'release',
      kind: 'review_loop',
      providerId: '',
      fixProviderId: '',
      maxRounds: 2,
      enabled: true,
      dependsOn: lastIds,
      position: { x: 0, y: 5 },
      promptTemplate: `你是严格审查员（当前模型：{{providerName}}），第一行写 VERDICT: PASS 或 VERDICT: CHANGES_REQUESTED，并给出具体意见。\n\n【待审产出】\n{{previousOutput}}`,
      fixPromptTemplate: `请根据以下审查意见完成修复：\n\n{{reviewFeedback}}`,
    });
    lastIds = ['auto_review'];
  }

  if (wantsGate) {
    nodes.push({
      id: 'user_approve',
      title: '人工拍板',
      subtitle: '人工最终审核通过或打回重做',
      lane: 'human',
      kind: 'human_gate',
      providerId: 'human',
      enabled: true,
      dependsOn: lastIds,
      position: { x: 0, y: 6 },
    });
  }

  return sanitizeWorkflow(
    {
      name: shortTitle,
      description: `按需求「${text.slice(0, 60)}」生成的多模型协作流`,
      nodes,
    },
    shortTitle,
    onlineMemberIds,
  );
}

function pickGeneratorProvider(preferredId?: string): ProviderConfig | null {
  const providers = loadProviders();
  const isReadyApi = (p: ProviderConfig) =>
    isApiProvider(p) &&
    Boolean(p.model?.trim()) &&
    (Boolean(p.apiKey?.trim()) || /127\.0\.0\.1|localhost/i.test(p.apiBaseUrl || ''));

  if (preferredId && preferredId !== 'auto' && preferredId !== 'local') {
    const exact = providers.find((p) => p.id === preferredId && isReadyApi(p));
    if (exact) return exact;
    return null;
  }
  return providers.find((p) => isReadyApi(p)) || null;
}

function pickGeneratorAgent(preferredId?: string): ConnectedAgent | null {
  const agents = agentHub.listAgents();
  if (preferredId && preferredId !== 'auto' && preferredId !== 'local') {
    const exact = agents.find((a) => a.id === preferredId && a.online);
    return exact || null;
  }
  // Auto mode: prefer an idle online agent that can respond automatically (live listener / CLI / webhook)
  const autoReady = agents.find(
    (a) =>
      a.online &&
      !a.busy &&
      (a.listening || a.trigger?.type === 'cli' || a.trigger?.type === 'webhook'),
  );
  return autoReady || null;
}

function buildWorkflowDesignPrompt(userPrompt: string, currentWorkflow?: WorkflowDefinition): string {
  const currentBrief = currentWorkflow
    ? JSON.stringify(
        {
          name: currentWorkflow.name,
          description: currentWorkflow.description,
          nodes: currentWorkflow.nodes.map((n) => ({
            id: n.id,
            title: n.title,
            subtitle: n.subtitle,
            kind: n.kind,
            dependsOn: n.dependsOn,
            shellCommand: n.shellCommand,
          })),
        },
        null,
        2,
      )
    : '无（请全新设计）';

  return `你是多模型工作流编排架构师。请严格根据用户的自然语言需求，返回一个纯 JSON 对象（不要输出任何 Markdown 解释文字，只输出 JSON），描述完整的 WorkflowDefinition。

JSON 结构要求：
{
  "name": "简短工作流名称（<=14字）",
  "description": "一句话说明流程路径（如：A + B 并行 → 汇总 → 拍板）",
  "nodes": [
    {
      "id": "英文下划线唯一ID，如 user_requirement",
      "title": "节点中文标题（<=12字）",
      "subtitle": "节点职责简介（<=26字）",
      "kind": "human_input | llm | human_gate | review_loop | shell | condition",
      "dependsOn": ["上游节点id数组；第一个 human_input 为 []"],
      "shellCommand": "仅 kind=shell 时填，例如 npm run typecheck",
      "promptTemplate": "仅 llm/review_loop 时填，需包含 {{requirement}} 和（非首步时）{{previousOutput}}"
    }
  ]
}

规则：
1. 第一个节点必须是 kind="human_input" 且 dependsOn=[]；
2. 善用并行分支（多个 llm 节点共享同一个 dependsOn，再由下游汇总节点同时依赖它们）；
3. 节点总数控制在 3~8 个，精炼实用；
4. 若用户明确说「在当前流程基础上修改/添加/删除」，请基于【当前工作流】调整，否则全新设计。

【当前工作流】
${currentBrief}

【用户需求】
${userPrompt}`;
}

function tryParseWorkflowJson(
  rawOut: string,
  userPrompt: string,
  onlineIds: string[],
): WorkflowDefinition | null {
  const trimmed = (rawOut || '').trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Partial<WorkflowDefinition>;
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length < 2) return null;
  return sanitizeWorkflow(parsed, userPrompt.slice(0, 18), onlineIds);
}

export async function generateWorkflowFromPrompt(params: {
  prompt: string;
  currentWorkflow?: WorkflowDefinition;
  onlineMemberIds?: string[];
  providerId?: string;
  signal?: AbortSignal;
}): Promise<{
  workflow: WorkflowDefinition;
  generatedBy: string;
  usedLlm: boolean;
  fallbackReason?: string;
}> {
  const userPrompt = (params.prompt || '').trim();
  if (!userPrompt) {
    throw new Error('请先输入你想要的工作流描述');
  }
  const onlineIds = Array.isArray(params.onlineMemberIds) ? params.onlineMemberIds : [];
  const preferredId = (params.providerId || '').trim();

  // Explicit fast zero-token local synthesis
  if (preferredId === 'local') {
    const workflow = synthesizeWorkflowLocally(userPrompt, params.currentWorkflow, onlineIds);
    return { workflow, generatedBy: '本地智能编排', usedLlm: false };
  }

  const sysPrompt = buildWorkflowDesignPrompt(userPrompt, params.currentWorkflow);
  let fallbackReason: string | undefined;

  // 1. Explicit connected online Agent chosen by the user
  const explicitAgent =
    preferredId && preferredId !== 'auto' ? pickGeneratorAgent(preferredId) : null;
  // 2. Explicit or auto ready API provider
  const apiProvider = explicitAgent ? null : pickGeneratorProvider(preferredId || undefined);
  // 3. Auto fallback to an idle listening/CLI/webhook online Agent when no API provider is configured
  const chosenAgent =
    explicitAgent || (!apiProvider && (!preferredId || preferredId === 'auto') ? pickGeneratorAgent('auto') : null);

  if (chosenAgent) {
    const ac = new AbortController();
    const timeoutMs = 45_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);
    const onExternalAbort = () => ac.abort();
    if (params.signal) {
      if (params.signal.aborted) {
        clearTimeout(timer);
        throw new Error('已取消工作流 AI 生成');
      }
      params.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const rawOut = await agentHub.dispatchTask(
        chosenAgent.id,
        {
          roomId: 'workflow_generator',
          kind: 'workflow',
          stageId: 'ai_generate_workflow',
          stageTitle: '工作流画布设计',
          repoPath: process.cwd(),
          prompt: sysPrompt,
        },
        {
          timeoutSec: Math.ceil(timeoutMs / 1000),
          signal: ac.signal,
        },
      );
      const workflow = tryParseWorkflowJson(rawOut, userPrompt, onlineIds);
      if (workflow) {
        return {
          workflow,
          generatedBy: chosenAgent.name,
          usedLlm: true,
        };
      }
      fallbackReason = `${chosenAgent.name} 返回的内容不是标准工作流 JSON，已自动由本地智能编排兜底`;
    } catch (err) {
      if (params.signal?.aborted) {
        throw new Error('已取消工作流 AI 生成');
      }
      const msg = err instanceof Error ? err.message : String(err);
      fallbackReason = timedOut
        ? `${chosenAgent.name} 超过 45 秒未回执（可能对方窗口弹出了确认框），已自动由本地智能编排兜底`
        : `${chosenAgent.name} 调用失败（${msg.slice(0, 48)}），已自动由本地智能编排兜底`;
    } finally {
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onExternalAbort);
    }
  } else if (apiProvider) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    const onExternalAbort = () => ac.abort();
    if (params.signal) {
      if (params.signal.aborted) {
        clearTimeout(timer);
        throw new Error('已取消工作流 AI 生成');
      }
      params.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const res = await runProviderApi(apiProvider, sysPrompt, { signal: ac.signal });
      const workflow = tryParseWorkflowJson(res.output || '', userPrompt, onlineIds);
      if (workflow) {
        return {
          workflow,
          generatedBy: apiProvider.shortName || apiProvider.name,
          usedLlm: true,
        };
      }
      fallbackReason = `${apiProvider.shortName || apiProvider.name} 返回格式未通过校验，已由本地智能编排兜底`;
    } catch (err) {
      if (params.signal?.aborted) {
        throw new Error('已取消工作流 AI 生成');
      }
      const msg = err instanceof Error ? err.message : String(err);
      fallbackReason = `${apiProvider.shortName || apiProvider.name} 请求失败（${msg.slice(0, 48)}），已由本地智能编排兜底`;
    } finally {
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onExternalAbort);
    }
  } else if (preferredId && preferredId !== 'auto') {
    fallbackReason = '所选生成成员当前不在线或未就绪，已由本地智能编排兜底';
  }

  const workflow = synthesizeWorkflowLocally(userPrompt, params.currentWorkflow, onlineIds);
  return {
    workflow,
    generatedBy: '本地智能编排',
    usedLlm: false,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
