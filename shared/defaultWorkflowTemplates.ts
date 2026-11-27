import { DEFAULT_WORKFLOW } from './defaultWorkflow.js';
import type { WorkflowPresetTemplate } from './types.js';

const NOW = new Date().toISOString();

// Helper: clone a workflow with empty providerId on LLM nodes so users explicitly decide each node's model
function withOpenModels(wf: typeof DEFAULT_WORKFLOW): typeof DEFAULT_WORKFLOW {
  const copy = structuredClone(wf);
  for (const n of copy.nodes) {
    if (n.kind === 'llm' || n.kind === 'review_loop') {
      n.providerId = '';
      if (n.fixProviderId) n.fixProviderId = '';
    }
  }
  return copy;
}

export const BUILTIN_WORKFLOW_TEMPLATES: WorkflowPresetTemplate[] = [
  {
    id: 'tpl_fullstack',
    name: '完整全栈研发流',
    description: '需求 → 双方案对比 → 人工拍板 → 交互接口定稿 → 前后端实现 → 自动审查',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      ...withOpenModels(DEFAULT_WORKFLOW),
      id: 'tpl_fullstack',
      name: '完整全栈研发流',
    },
  },
  {
    id: 'tpl_dual_review',
    name: '轻量双模型方案评审流',
    description: '双模型并行给方案 → 对比合成 → 人工拍板，步数少、省额度、快速定方向',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_dual_review',
      name: '轻量双模型方案评审流',
      description: '双模型独立视角并行输出方案，再由综合节点对比汇总供人工拍板。',
      nodes: [
        {
          id: 'user_requirement',
          title: '需求输入',
          subtitle: '描述目标与约束条件',
          lane: 'human',
          kind: 'human_input',
          providerId: 'human',
          enabled: true,
          dependsOn: [],
          position: { x: 0, y: 0 },
        },
        {
          id: 'proposal_a',
          title: '视角 A（稳健架构）',
          subtitle: '偏重可靠性、工程规范与低风险落地',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: `你是「视角 A（稳健架构）」评审专家（当前模型：{{providerName}}）。请结合仓库上下文，给出一套稳健、低风险、可直接落地的技术方案。

【任务需求】
{{requirement}}

【仓库快照】
{{repoContext}}

{{#humanFeedback}}
【用户补充/打回意见】
{{humanFeedback}}
{{/humanFeedback}}`,
        },
        {
          id: 'proposal_b',
          title: '视角 B（创新与体验）',
          subtitle: '偏重简洁体验、扩展性与盲点补充',
          lane: 'gemini',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 1, y: 1 },
          promptTemplate: `你是「视角 B（创新与体验）」评审专家（当前模型：{{providerName}}）。请独立给出差异化方案，重点指出常见设计盲点与更简洁的实现路径。

【任务需求】
{{requirement}}

【仓库快照】
{{repoContext}}

{{#humanFeedback}}
【用户补充/打回意见】
{{humanFeedback}}
{{/humanFeedback}}`,
        },
        {
          id: 'synthesize',
          title: '对比汇总与推荐结论',
          subtitle: '表格对比两份方案并给出唯一推荐方案',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['proposal_a', 'proposal_b'],
          position: { x: 0, y: 2 },
          promptTemplate: `请作为汇总架构师（当前模型：{{providerName}}），逐条对比以下两份独立方案，输出对比表与最终推荐结论。

【原始需求】
{{requirement}}

【前序方案汇总】
{{previousOutput}}`,
        },
        {
          id: 'user_approve',
          title: '人工拍板',
          subtitle: '确认采纳或打回补充意见',
          lane: 'human',
          kind: 'human_gate',
          providerId: 'human',
          enabled: true,
          dependsOn: ['synthesize'],
          position: { x: 0, y: 3 },
        },
      ],
      edges: [
        { id: 'dr1', source: 'user_requirement', target: 'proposal_a' },
        { id: 'dr2', source: 'user_requirement', target: 'proposal_b' },
        { id: 'dr3', source: 'proposal_a', target: 'synthesize' },
        { id: 'dr4', source: 'proposal_b', target: 'synthesize' },
        { id: 'dr5', source: 'synthesize', target: 'user_approve' },
      ],
    },
  },
  {
    id: 'tpl_code_review',
    name: '代码审查与自动修复流',
    description: '深度审查找问题 → 工程师修复改动 → 二次复核验收',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_code_review',
      name: '代码审查与自动修复流',
      description: '由不同模型分别承担审查与修复角色，交叉把关代码质量。',
      nodes: [
        {
          id: 'user_requirement',
          title: '审查目标输入',
          subtitle: '说明要审查的模块、改动或 PR 范围',
          lane: 'human',
          kind: 'human_input',
          providerId: 'human',
          enabled: true,
          dependsOn: [],
          position: { x: 0, y: 0 },
        },
        {
          id: 'deep_audit',
          title: '安全与质量审查',
          subtitle: '分级列出 P0/P1/P2 问题与定位文件',
          lane: 'codex',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: `你是严格的代码审查专家（当前模型：{{providerName}}）。请检查当前仓库改动与目标范围，按「P0 阻塞缺陷 / P1 安全与边界风险 / P2 性能与可维护性」逐条列出问题及修复建议。

【审查目标】
{{requirement}}

【Git 变更摘要】
{{gitSummary}}

【仓库快照】
{{repoContext}}`,
        },
        {
          id: 'apply_fixes',
          title: '修复实现',
          subtitle: '按审查清单逐项修复并说明改动',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['deep_audit'],
          position: { x: 0, y: 2 },
          promptTemplate: `你是修复工程师（当前模型：{{providerName}}）。请针对以下审查清单逐项给出修复实现与验证方法。

【审查目标】
{{requirement}}

【审查清单】
{{previousOutput}}`,
        },
        {
          id: 'final_verify',
          title: '复核验收',
          subtitle: '检查是否遗漏边界并给出最终结论',
          lane: 'gemini',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['apply_fixes'],
          position: { x: 0, y: 3 },
          promptTemplate: `请作为最终验收专家（当前模型：{{providerName}}），复核修复方案是否完全解决前述问题、是否引入回归风险，并给出明确验收结论（PASS / 需补充）。

【原始审查目标】
{{requirement}}

【修复回执】
{{previousOutput}}`,
        },
      ],
      edges: [
        { id: 'cr1', source: 'user_requirement', target: 'deep_audit' },
        { id: 'cr2', source: 'deep_audit', target: 'apply_fixes' },
        { id: 'cr3', source: 'apply_fixes', target: 'final_verify' },
      ],
    },
  },
  {
    id: 'tpl_bug_hunt',
    name: 'Bug 定位与根因修复流',
    description: '日志与现象分析 → 根因定位 → 修复方案与实现 → 回归检查',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_bug_hunt',
      name: 'Bug 定位与根因修复流',
      description: '针对复杂疑难 Bug，分步完成定位、根因验证与防回归修复。',
      nodes: [
        {
          id: 'user_requirement',
          title: 'Bug 现象与日志',
          subtitle: '粘贴报错堆栈、复现步骤或截图说明',
          lane: 'human',
          kind: 'human_input',
          providerId: 'human',
          enabled: true,
          dependsOn: [],
          position: { x: 0, y: 0 },
        },
        {
          id: 'root_cause',
          title: '根因定位分析',
          subtitle: '排查调用链路并给出最可能根因与证据',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: `你是资深调试专家（当前模型：{{providerName}}）。请根据用户提供的 Bug 现象、日志和仓库状态，分析调用链并定位最可能的根因。

【Bug 描述】
{{requirement}}

【Git 变更与仓库快照】
{{gitSummary}}
{{repoContext}}`,
        },
        {
          id: 'bug_fix',
          title: '修复实现',
          subtitle: '产出最小化安全补丁并说明修改点',
          lane: 'codex',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['root_cause'],
          position: { x: 0, y: 2 },
          promptTemplate: `你是修复工程师（当前模型：{{providerName}}）。请基于根因分析给出清晰、最小化的修复实现。

【Bug 描述】
{{requirement}}

【根因分析】
{{previousOutput}}`,
        },
        {
          id: 'regression_check',
          title: '回归与边界验证',
          subtitle: '列出测试用例、边界场景与潜在副作用',
          lane: 'gemini',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['bug_fix'],
          position: { x: 0, y: 3 },
          promptTemplate: `你是测试验收专家（当前模型：{{providerName}}）。请检查以下修复方案是否会引入副作用，并给出需要验证的关键回归用例清单。

【原始 Bug】
{{requirement}}

【修复内容】
{{previousOutput}}`,
        },
      ],
      edges: [
        { id: 'bh1', source: 'user_requirement', target: 'root_cause' },
        { id: 'bh2', source: 'root_cause', target: 'bug_fix' },
        { id: 'bh3', source: 'bug_fix', target: 'regression_check' },
      ],
    },
  },
  {
    id: 'tpl_research_doc',
    name: '多模型调研与报告流',
    description: '并行多维调研与批判补充 → 精炼整合输出结构化 Markdown 报告',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_research_doc',
      name: '多模型调研与报告流',
      description: '适合技术选型、竞品分析、产品文档撰写等需要多视角整合的任务。',
      nodes: [
        {
          id: 'user_requirement',
          title: '调研主题与要求',
          subtitle: '写清主题、受众和关注重点',
          lane: 'human',
          kind: 'human_input',
          providerId: 'human',
          enabled: true,
          dependsOn: [],
          position: { x: 0, y: 0 },
        },
        {
          id: 'research_a',
          title: '主线调研与资料梳理',
          subtitle: '系统梳理核心事实、方案与关键论据',
          lane: 'gemini',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: `请作为主线研究员（当前模型：{{providerName}}），围绕以下主题系统梳理核心事实、主流方案、优缺点与关键数据。

【调研主题】
{{requirement}}`,
        },
        {
          id: 'research_b',
          title: '批判性补充与反面视角',
          subtitle: '挑战常规假设、补充风险与冷门洞见',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 1, y: 1 },
          promptTemplate: `请作为批判性评审员（当前模型：{{providerName}}），从反面视角、潜在风险、隐形成本和容易被忽略的边界出发，为以下主题提供深度补充。

【调研主题】
{{requirement}}`,
        },
        {
          id: 'doc_final',
          title: '整合输出最终报告',
          subtitle: '融合两份观点，输出逻辑清晰的可交付文档',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['research_a', 'research_b'],
          position: { x: 0, y: 2 },
          promptTemplate: `请作为首席编辑（当前模型：{{providerName}}），将以下两份独立调研内容融合、去重、结构化，输出一份可直接交付的 Markdown 报告。

【调研主题】
{{requirement}}

【前序调研素材】
{{previousOutput}}`,
        },
      ],
      edges: [
        { id: 'rd1', source: 'user_requirement', target: 'research_a' },
        { id: 'rd2', source: 'user_requirement', target: 'research_b' },
        { id: 'rd3', source: 'research_a', target: 'doc_final' },
        { id: 'rd4', source: 'research_b', target: 'doc_final' },
      ],
    },
  },
];
