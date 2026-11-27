import type { WorkflowRun } from '../shared/types.js';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('用户手动终止了当前工作流'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('用户手动终止了当前工作流'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runMockNode(params: {
  nodeId: string;
  run: WorkflowRun;
  providerName?: string;
  round?: number;
  humanFeedback?: string;
  onLog: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    nodeId,
    run,
    providerName = '当前模型',
    round = 1,
    humanFeedback,
    onLog,
    signal,
  } = params;
  const reqSummary = run.requirement.trim().slice(0, 120) || '示例研发需求';
  const repo = run.repoPath || 'D:\\your-project';

  const emit = async (lines: string[]) => {
    for (const line of lines) {
      onLog(line + '\n');
      await sleep(200, signal);
    }
  };

  switch (nodeId) {
    case 'proposal_a': {
      await emit([
        `[${providerName} · 方案 A] 正在读取本地仓库：${repo}`,
        humanFeedback
          ? `[${providerName} · 方案 A] 已吸收打回意见：${humanFeedback}`
          : `[${providerName} · 方案 A] 正在拆解需求并起草技术落地方案...`,
      ]);
      return `## 方案 A（由 ${providerName} 产出）

**需求摘要**：${reqSummary}
${humanFeedback ? `> **针对打回意见的修订**：已按「${humanFeedback}」调整架构与验收策略。\n` : ''}
### 1. 架构思路
- 采用**清晰的状态机 + 严格数据校验**，前后端职责分层解耦。
- 所有关键写入操作落盘持久化，支持回溯与断点重跑。

### 2. 实施分工
- **后端板块**：实现核心接口、参数校验与单元测试。
- **前端板块**：完成主视图交互、实时状态更新与异常提示。`;
    }

    case 'proposal_b': {
      await emit([
        `[${providerName} · 方案 B] 正在从独立视角构思对比方案...`,
        humanFeedback
          ? `[${providerName} · 方案 B] 已结合打回意见优化交互与边界...`
          : `[${providerName} · 方案 B] 正在检查架构简洁度与潜在盲点...`,
      ]);
      return `## 方案 B（由 ${providerName} 产出）

${humanFeedback ? `> **针对打回意见的修订**：已重点优化「${humanFeedback}」相关细节。\n` : ''}
### 1. 差异化亮点
- 强调**渐进式披露**：主界面只保留高频操作，高级配置折叠，降低心智负担。
- 用 **SSE 实时事件流**替代轮询，执行状态和日志所见即所得。

### 2. 风险与盲点提醒
- 需要提前支持长耗时任务的取消（Abort）与按需跳过单个板块，避免流程僵化。`;
    }

    case 'synthesize': {
      await emit([
        `[${providerName} · 对比合成] 已汇总方案 A 与方案 B，开始逐条对比...`,
        `[${providerName} · 对比合成] 正在输出取舍决策表与最终候选方案...`,
      ]);
      return `## 双方案逐条对比与合成定稿（由 ${providerName} 合成）

### 1. 逐条对比决策表

| 对比维度 | 方案 A | 方案 B | 最终采纳 | 取舍原因 |
| :--- | :--- | :--- | :--- | :--- |
| 状态与校验 | 严格分层 + Schema 校验 | 轻量事件驱动 | **采纳方案 A** | 状态一致性要求高，强校验能大幅减少返工 |
| 实时状态反馈 | 标准异步请求 | SSE 实时流推送 | **采纳方案 B** | 流式输出体验明显更直观，实现成本低 |
| 界面复杂度 | 参数全平铺 | 渐进式披露 + 模块化 | **采纳方案 B** | 日常使用清爽高效 |
| 流程灵活性 | 固定全跑 | 支持单步重跑 + 跳过板块 | **融合两者** | 兼顾完整性与灵活度 |

### 2. 合成后的唯一执行方案
1. **引擎层**：严格状态机 + 本地持久化 + SSE 实时流，支持断点重跑与跳过板块。
2. **界面层**：左流程 + 右详情极简两栏，每个板块自由插拔不同订阅模型。`;
    }

    case 'design_spec': {
      await emit([
        `[${providerName} · 交互与接口定稿] 已收到拍板确认，正在输出交互细则与接口契约...`,
        `[${providerName} · 交互与接口定稿] 已生成后端派活单与验收清单。`,
      ]);
      return `## 交互设计、接口契约与派活单（由 ${providerName} 定稿）

### 1. 核心交互与文案
- 主视图保持精简两栏：左侧一眼看全进度并可直接切换模型，右侧常驻展示产出与日志。
- 空态、加载态与报错态均给出明确中文引导。

### 2. 前后端接口契约
- \`POST /api/runs\`：创建任务并返回初始状态
- \`GET /api/runs/:id/stream\`：SSE 实时推送执行进度
- \`POST /api/runs/:id/approve\`：提交拍板决策（\`approved\` / \`rejected\`）

### 3. 后端派活单 & 验收清单
- **后端职责**：接口实现、参数校验、持久化与单元测试
- [ ] 核心接口响应符合契约
- [ ] 异常输入返回清晰错误提示
- [ ] 类型检查与单测全部通过`;
    }

    case 'backend_dev': {
      await emit([
        `[${providerName} · 后端实现] 已签收派活单，正在实现后端服务与单测...`,
        `[${providerName} · 后端实现] 后端自测通过，正在提交回执。`,
      ]);
      return `## 后端交付回执（由 ${providerName} 实现）

### 1. 改动文件摘要
- \`server/service/featureService.ts\`：完成核心业务逻辑与状态校验
- \`server/routes/featureRoutes.ts\`：补齐契约接口与错误处理
- \`server/tests/featureService.test.ts\`：新增 12 条核心与边界单测

### 2. 自测结果
- \`npm run typecheck\`：PASS（0 errors）
- \`npm test\`：12 / 12 passed`;
    }

    case 'frontend_test': {
      await emit([
        `[${providerName} · 前端与测试] 已核对后端回执，正在实现前端页面与联调...`,
        `[${providerName} · 前端与测试] 联调与自动化测试全部通过！`,
      ]);
      return `## 前端实现与测试报告（由 ${providerName} 完成）

### 1. 后端回执核对
- 接口字段与错误码完全匹配契约，联调零阻塞。

### 2. 前端实现与验证
- 已完成界面组件、实时流订阅与异常兜底。
- 类型检查、构建与端到端联调全部通过。`;
    }

    case 'code_review': {
      if (round === 1) {
        await emit([
          `[${providerName} · 第 1 轮审查] 正在检查 Diff、边界条件与异常处理...`,
          `[${providerName} · 第 1 轮审查] 发现 1 处并发防重入边界问题，转交修复模型自动修复。`,
        ]);
        return `VERDICT: CHANGES_REQUESTED

### 第 1 轮审查意见（${providerName}）
1. **[中危] 拍板接口防重入**：连续双击拍板按钮时需校验当前必须为 \`waiting_approval\` 状态，防止重复调度。
2. 其余逻辑与测试覆盖均符合验收标准。`;
      }
      await emit([
        `[${providerName} · 第 2 轮复审] 正在复审修复提交...`,
        `[${providerName} · 第 2 轮复审] 修复验证通过，放行交付！`,
      ]);
      return `VERDICT: PASS

### 第 2 轮复审结论（${providerName}）
- 状态锁防重入保护已补齐并通过测试，无回归风险，审查通过。`;
    }

    case 'code_review_fix': {
      await emit([
        `[${providerName} · 自动修复] 收到第 ${round} 轮审查意见，正在补齐状态锁并复跑测试...`,
        `[${providerName} · 自动修复] 修复完成，已交回审查模型复审。`,
      ]);
      return `### 自动修复说明（由 ${providerName} 完成）
- 已在审批入口补齐原子状态校验，重复提交直接返回错误提示。
- 已补充对应并发测试用例并通过。`;
    }

    default:
      return `板块 ${nodeId}（${providerName}）模拟执行完成。`;
  }
}

export async function runMockChatReply(params: {
  providerName: string;
  userMessage: string;
  recentHistory: string;
  repoPath: string;
  onLog: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { providerName, userMessage, recentHistory, repoPath, onLog, signal } = params;
  const snippet = userMessage.trim().slice(0, 100);
  onLog(`[${providerName}] 正在阅读群聊上下文与本地目录 ${repoPath}...\n`);
  await sleep(260, signal);
  onLog(`[${providerName}] 正在整理回复...\n`);
  await sleep(340, signal);

  const hasOthers = recentHistory.includes('】');
  return `收到关于「**${snippet}**」的讨论${hasOthers ? '，结合群里刚才大家的上下文' : ''}，从 **${providerName}** 的视角给出几点建议：

1. **核心落地思路**：优先保持模块边界清晰、状态可追踪，本地目录 \`${repoPath}\` 下的改动建议分小步验证。
2. **需要注意的边界**：处理好异常兜底、并发重复触发和本地配置持久化，避免环境切换后丢状态。
3. **下一步建议**：如果你认可这个方向，可以在群里直接 \`@其他模型\` 做交叉评审，或点下方 **「按板块跑流程」** 自动走完方案 → 拍板 → 开发 → 审查闭环。`;
}

