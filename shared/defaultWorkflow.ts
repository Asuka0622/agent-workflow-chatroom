import type { WorkflowDefinition } from './types.js';

export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: 'multi-model-modular-v3',
  name: '多模型协作工作流（模块化可换模型）',
  description:
    '按研发职责划分核心板块，每个板块的模型均可自由切换，也可按需跳过任意板块。',
  nodes: [
    {
      id: 'user_requirement',
      title: '需求输入',
      subtitle: '目标描述与本地代码目录',
      lane: 'human',
      kind: 'human_input',
      providerId: 'human',
      enabled: true,
      dependsOn: [],
      position: { x: 0, y: 0 },
    },
    {
      id: 'proposal_a',
      title: '方案 A（主控视角）',
      subtitle: '结合代码库独立出技术方案',
      lane: 'claude',
      kind: 'llm',
      providerId: 'claude',
      enabled: true,
      dependsOn: ['user_requirement'],
      position: { x: 0, y: 1 },
      promptTemplate: `你是当前「方案 A（主控视角）」的负责架构师（当前模型：{{providerName}}）。请结合本地代码仓库快照，独立产出一份稳健、可执行的技术落地方案。

【用户需求】
{{requirement}}

【目标仓库路径】
{{repoPath}}

【自动采集的仓库快照】
{{repoContext}}

{{#humanFeedback}}
【用户打回意见（请重点修正）】
{{humanFeedback}}
{{/humanFeedback}}

请输出（Markdown）：
1. 需求拆解与现有代码现状
2. 核心架构、数据流与模块边界
3. 前后端职责划分与风险控制`,
    },
    {
      id: 'proposal_b',
      title: '方案 B（独立视角）',
      subtitle: '独立视角交叉验证，补充盲点',
      lane: 'gemini',
      kind: 'llm',
      providerId: 'gemini',
      enabled: true,
      dependsOn: ['user_requirement'],
      position: { x: 1, y: 1 },
      promptTemplate: `你是当前「方案 B（独立视角）」的负责专家（当前模型：{{providerName}}）。请基于用户需求和仓库快照，完全独立地提出你的方案，重点关注体验简洁性、扩展性与潜在盲点。

【用户需求】
{{requirement}}

【目标仓库路径】
{{repoPath}}

【自动采集的仓库快照】
{{repoContext}}

{{#humanFeedback}}
【用户打回意见（请重点修正）】
{{humanFeedback}}
{{/humanFeedback}}

请输出（Markdown）：
1. 核心设计思路与差异化亮点
2. 架构与交互体验建议
3. 潜在盲点与更优替代做法`,
    },
    {
      id: 'synthesize',
      title: '对比合成',
      subtitle: '逐条对比两份方案，标清采纳原因',
      lane: 'claude',
      kind: 'llm',
      providerId: 'claude',
      enabled: true,
      dependsOn: ['proposal_a', 'proposal_b'],
      position: { x: 0, y: 2 },
      promptTemplate: `你是当前「方案对比与合成」板块的负责架构师（当前模型：{{providerName}}）。请客观、逐条对比方案 A 与方案 B，合成为一份供用户「人工拍板」的最终候选方案。

【用户需求】
{{requirement}}

【方案 A】
{{outputs.proposal_a}}

【方案 B】
{{outputs.proposal_b}}

请输出：
1. **逐条对比表**：维度 | 方案 A | 方案 B | 最终采纳 | 取舍原因
2. **合成后的唯一执行方案**`,
    },
    {
      id: 'user_approve',
      title: '人工拍板',
      subtitle: '对比双方案后通过，或打回重议',
      lane: 'human',
      kind: 'human_gate',
      providerId: 'human',
      enabled: true,
      dependsOn: ['synthesize'],
      position: { x: 0, y: 3 },
    },
    {
      id: 'design_spec',
      title: '交互与接口定稿',
      subtitle: '审交互文案，明确接口契约与派活单',
      lane: 'gemini',
      kind: 'llm',
      providerId: 'gemini',
      enabled: true,
      dependsOn: ['user_approve'],
      position: { x: 0, y: 4 },
      promptTemplate: `用户已对方案「拍板通过」。请作为「交互与接口定稿」负责专家（当前模型：{{providerName}}），输出清晰的交互细节、关键文案、前后端接口契约，以及给后端板块的「派活单」和验收标准。

【用户需求】
{{requirement}}

【已拍板方案】
{{outputs.synthesize}}

【拍板补充说明】
{{outputs.user_approve}}

请输出：
1. 核心交互流程与关键文案（含空态/报错态）
2. 前后端接口契约（路径、请求/响应结构、错误码）
3. 后端派活单与验收检查清单`,
    },
    {
      id: 'backend_dev',
      title: '后端实现',
      subtitle: '按派活单完成后端开发并提交回执',
      lane: 'codex',
      kind: 'llm',
      providerId: 'codex',
      enabled: true,
      dependsOn: ['design_spec'],
      position: { x: 0, y: 5 },
      promptTemplate: `你是「后端实现」板块的负责工程师（当前模型：{{providerName}}）。请严格按照接口契约和派活单完成成块的后端代码实现与自测，并提交清晰「回执」。

【目标仓库路径】
{{repoPath}}

【接口契约与派活单】
{{outputs.design_spec}}

请输出标准「回执」：
1. 修改/新增文件与接口摘要
2. 自测命令与结果
3. 前端联调注意事项`,
    },
    {
      id: 'frontend_test',
      title: '前端与测试',
      subtitle: '读后端回执、写前端联调并跑测试',
      lane: 'claude',
      kind: 'llm',
      providerId: 'claude',
      enabled: true,
      dependsOn: ['backend_dev'],
      position: { x: 1, y: 5 },
      promptTemplate: `你是「前端与测试」板块的负责工程师（当前模型：{{providerName}}）。请核对后端回执、实现前端交互与联调代码，并运行本地构建与测试验证。

【接口契约与验收清单】
{{outputs.design_spec}}

【后端回执】
{{outputs.backend_dev}}

【当前仓库 Git 变更摘要】
{{gitSummary}}

请输出：
1. 后端回执核对结论
2. 前端实现与联调改动说明
3. 构建与测试结果`,
    },
    {
      id: 'code_review',
      title: '代码审查与检查',
      subtitle: '多轮自动审查（最多 2 轮）与验收',
      lane: 'release',
      kind: 'review_loop',
      providerId: 'codex',
      fixProviderId: 'claude',
      enabled: true,
      maxRounds: 2,
      dependsOn: ['frontend_test'],
      position: { x: 0, y: 6 },
      promptTemplate: `你是严格的代码审查员（当前模型：{{providerName}}），当前第 {{round}} / {{maxRounds}} 轮审查。请审查本次改动是否存在 Bug、边界遗漏或偏离验收标准。

【验收标准】
{{outputs.design_spec}}

【前端与测试报告】
{{outputs.frontend_test}}

【当前 Git 变更摘要】
{{gitSummary}}

要求：
- 第一行明确写：\`VERDICT: PASS\` 或 \`VERDICT: CHANGES_REQUESTED\`
- 随后列出具体问题与修复建议，或通过结论。`,
      fixPromptTemplate: `审查员在第 {{round}} 轮审查中提出了修改意见，请作为修复工程师（当前模型：{{providerName}}）完成修复并说明改动：

【审查意见】
{{reviewFeedback}}

【仓库状态】
{{gitSummary}}`,
    },
  ],
  edges: [
    { id: 'e1', source: 'user_requirement', target: 'proposal_a' },
    { id: 'e2', source: 'user_requirement', target: 'proposal_b' },
    { id: 'e3', source: 'proposal_a', target: 'synthesize' },
    { id: 'e4', source: 'proposal_b', target: 'synthesize' },
    { id: 'e5', source: 'synthesize', target: 'user_approve' },
    { id: 'e6', source: 'user_approve', target: 'design_spec' },
    { id: 'e7', source: 'design_spec', target: 'backend_dev' },
    { id: 'e8', source: 'backend_dev', target: 'frontend_test', label: '回执' },
    { id: 'e9', source: 'frontend_test', target: 'code_review' },
  ],
};
