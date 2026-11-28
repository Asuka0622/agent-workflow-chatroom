import { DEFAULT_WORKFLOW } from './defaultWorkflow.js';
import type { WorkflowPresetTemplate } from './types.js';

const NOW = new Date().toISOString();

// Helper: clone a workflow with empty providerId on LLM nodes so users or smart auto-assign pick online models
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
    id: 'tpl_dual_review',
    name: '轻量双模型方案评审',
    description: '双模型并行给方案 → 对比汇总 → 人工拍板，步数少、省额度、快速定方向',
    category: 'review',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_dual_review',
      name: '轻量双模型方案评审',
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
    id: 'tpl_roundtable',
    name: '多模型圆桌辩论与决策',
    description: '3 视角并行碰撞（创新破局 / 务实落地 / 风险挑刺）→ 主持人收敛给出行动方案',
    category: 'brainstorm',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_roundtable',
      name: '多模型圆桌辩论与决策',
      description: '适合产品创意、业务决策、架构选型等需要多视角头脑风暴的场景。',
      nodes: [
        {
          id: 'user_requirement',
          title: '议题与背景',
          subtitle: '抛出问题、目标受众或待决策选项',
          lane: 'human',
          kind: 'human_input',
          providerId: 'human',
          enabled: true,
          dependsOn: [],
          position: { x: 1, y: 0 },
        },
        {
          id: 'angle_innovate',
          title: '激进创新派',
          subtitle: '跳出惯性，提出高上限的差异化创意',
          lane: 'gemini',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: `你是圆桌中的「激进创新派」（当前模型：{{providerName}}）。请围绕议题跳出常规思维，给出 2~3 个最具差异化、高上限的破局点子，说明核心亮点与预期收益。

【议题】
{{requirement}}`,
        },
        {
          id: 'angle_pragmatic',
          title: '务实落地派',
          subtitle: '关注成本、周期与最小可行路径',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 1, y: 1 },
          promptTemplate: `你是圆桌中的「务实落地派」（当前模型：{{providerName}}）。请从投入产出比、执行难度和最快验证路径出发，给出最容易落地、短期见效的方案。

【议题】
{{requirement}}`,
        },
        {
          id: 'angle_critic',
          title: '冷静挑刺派',
          subtitle: '专找漏洞、反例、隐形成本与失败风险',
          lane: 'codex',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 2, y: 1 },
          promptTemplate: `你是圆桌中的「冷静挑刺派」（当前模型：{{providerName}}）。请假设这件事最终失败了，反推最致命的 3~5 个风险、认知盲区、隐形成本及规避条件。

【议题】
{{requirement}}`,
        },
        {
          id: 'moderator_decision',
          title: '主持人收敛决策',
          subtitle: '整合三方观点，输出清晰结论与下一步清单',
          lane: 'release',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['angle_innovate', 'angle_pragmatic', 'angle_critic'],
          position: { x: 1, y: 2 },
          promptTemplate: `你是圆桌主持人（当前模型：{{providerName}}）。请吸收「激进创新」「务实落地」「冷静挑刺」三方发言，输出：
1. 核心共识与关键分歧对照
2. 唯一推荐行动方案（兼顾创新与可控风险）
3. 立即可执行的 3 步验证清单

【原始议题】
{{requirement}}

【三方发言记录】
{{previousOutput}}`,
        },
      ],
      edges: [
        { id: 'rt1', source: 'user_requirement', target: 'angle_innovate' },
        { id: 'rt2', source: 'user_requirement', target: 'angle_pragmatic' },
        { id: 'rt3', source: 'user_requirement', target: 'angle_critic' },
        { id: 'rt4', source: 'angle_innovate', target: 'moderator_decision' },
        { id: 'rt5', source: 'angle_pragmatic', target: 'moderator_decision' },
        { id: 'rt6', source: 'angle_critic', target: 'moderator_decision' },
      ],
    },
  },
  {
    id: 'tpl_doc_polish',
    name: '文档 / 脚本精修与润色',
    description: '初稿起草 → 毒舌审校与结构挑刺 → 吸收意见精修终稿（适合 PRD / 汇报 / 视频脚本）',
    category: 'writing',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_doc_polish',
      name: '文档 / 脚本精修与润色',
      description: '通过「写手起草 + 严厉编辑审校 + 终稿打磨」三步产出高质量文稿或脚本。',
      nodes: [
        {
          id: 'user_requirement',
          title: '主题与素材',
          subtitle: '说明文体、受众、核心要点或原始草稿',
          lane: 'human',
          kind: 'human_input',
          providerId: 'human',
          enabled: true,
          dependsOn: [],
          position: { x: 0, y: 0 },
        },
        {
          id: 'draft_writer',
          title: '初稿起草',
          subtitle: '搭建清晰结构并输出完整初稿',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: `你是资深内容策划与撰稿人（当前模型：{{providerName}}）。请根据用户要求直接产出一版结构完整、逻辑流畅、重点突出的初稿。

【写作需求与素材】
{{requirement}}`,
        },
        {
          id: 'harsh_editor',
          title: '毒舌审校与挑刺',
          subtitle: '指出啰嗦、逻辑断层、说服力不足与受众痛点',
          lane: 'gemini',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['draft_writer'],
          position: { x: 0, y: 2 },
          promptTemplate: `你是要求极高的主编（当前模型：{{providerName}}）。请不要客套，直接对以下初稿挑刺：指出开头是否抓人、结构哪里拖沓、哪些论点空洞，并给出具体可执行的修改建议。

【原始要求】
{{requirement}}

【待审初稿】
{{previousOutput}}`,
        },
        {
          id: 'final_polish',
          title: '终稿精修交付',
          subtitle: '逐条吸收审校意见，输出可直接发布的终稿',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['harsh_editor'],
          position: { x: 0, y: 3 },
          promptTemplate: `你是终稿打磨专家（当前模型：{{providerName}}）。请结合初稿与主编审校意见，逐项修正问题，输出一份精炼、有感染力、可直接交付使用的最终版本（末尾附 3 条核心改写说明）。

【原始要求】
{{requirement}}

【初稿】
{{outputs.draft_writer}}

【主编修改意见】
{{outputs.harsh_editor}}`,
        },
      ],
      edges: [
        { id: 'dp1', source: 'user_requirement', target: 'draft_writer' },
        { id: 'dp2', source: 'draft_writer', target: 'harsh_editor' },
        { id: 'dp3', source: 'harsh_editor', target: 'final_polish' },
      ],
    },
  },
  {
    id: 'tpl_code_verify',
    name: '代码实现 + 命令自检闭环',
    description: '开发实现 → 本地自动跑 typecheck / 测试命令 → 根据真实报错复盘收尾',
    category: 'dev',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_code_verify',
      name: '代码实现 + 命令自检闭环',
      description: '轻量化研发闭环：AI 写完后由本地终端真实跑校验命令，再交给审查模型复核。',
      nodes: [
        {
          id: 'user_requirement',
          title: '开发任务',
          subtitle: '描述要实现或修改的具体功能',
          lane: 'human',
          kind: 'human_input',
          providerId: 'human',
          enabled: true,
          dependsOn: [],
          position: { x: 0, y: 0 },
        },
        {
          id: 'dev_implement',
          title: '开发实现',
          subtitle: '结合仓库上下文完成代码改动与自查',
          lane: 'claude',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: `你是核心开发工程师（当前模型：{{providerName}}）。请结合本地仓库结构，完成用户需求的最小化、高质量实现，并列出改动文件与验证点。

【开发需求】
{{requirement}}

【仓库快照】
{{repoContext}}`,
        },
        {
          id: 'shell_verify',
          title: '自动构建 / 类型检查',
          subtitle: '在项目目录执行真实校验命令',
          lane: 'release',
          kind: 'shell',
          providerId: 'shell',
          shellCommand: 'npm run typecheck',
          enabled: true,
          dependsOn: ['dev_implement'],
          position: { x: 0, y: 2 },
        },
        {
          id: 'verify_review',
          title: '校验结果审查与收尾',
          subtitle: '核对命令输出与 Git 变更，给出验收或修复补丁',
          lane: 'codex',
          kind: 'llm',
          providerId: '',
          enabled: true,
          dependsOn: ['shell_verify'],
          position: { x: 0, y: 3 },
          promptTemplate: `你是质量验收工程师（当前模型：{{providerName}}）。请结合开发说明、终端校验输出和 Git 变更，确认是否可以交付；若校验失败或存在边界漏洞，请直接给出修复代码。

【开发需求】
{{requirement}}

【开发说明】
{{outputs.dev_implement}}

【终端校验输出】
{{outputs.shell_verify}}

【Git 变更】
{{gitSummary}}`,
        },
      ],
      edges: [
        { id: 'cv1', source: 'user_requirement', target: 'dev_implement' },
        { id: 'cv2', source: 'dev_implement', target: 'shell_verify' },
        { id: 'cv3', source: 'shell_verify', target: 'verify_review' },
      ],
    },
  },
  {
    id: 'tpl_code_review',
    name: '代码审查与自动修复',
    description: '深度审查找 P0/P1/P2 问题 → 工程师修复改动 → 二次复核验收',
    category: 'review',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_code_review',
      name: '代码审查与自动修复',
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
    name: 'Bug 定位与根因修复',
    description: '日志与现象分析 → 根因定位 → 最小补丁修复 → 回归边界清单',
    category: 'dev',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_bug_hunt',
      name: 'Bug 定位与根因修复',
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
    name: '多模型深度调研报告',
    description: '并行主线调研 + 批判补充 → 精炼整合输出可交付 Markdown 报告',
    category: 'writing',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      id: 'tpl_research_doc',
      name: '多模型深度调研报告',
      description: '适合技术选型、竞品分析、行业调研等需要多视角整合的任务。',
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
  {
    id: 'tpl_fullstack',
    name: '完整全栈研发流水线',
    description: '需求 → 双方案对比 → 人工拍板 → 交互接口定稿 → 前后端实现 → 多轮自动审查',
    category: 'dev',
    builtin: true,
    updatedAt: NOW,
    workflow: {
      ...withOpenModels(DEFAULT_WORKFLOW),
      id: 'tpl_fullstack',
      name: '完整全栈研发流水线',
    },
  },
];
