import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ApprovalPayload,
  ChatMessage,
  ChatSendPayload,
  CreateRunPayload,
  NodeExecutionState,
  ProviderConfig,
  RunEvent,
  TaskMaterial,
  WorkflowDefinition,
  WorkflowNodeConfig,
  WorkflowRun,
} from '../shared/types.js';
import { isApiProvider, runProviderApi } from './apiRunner.js';
import {
  collectGitSummary,
  collectRepoContext,
  runProviderCli,
  runShellCommand,
} from './cliRunner.js';
import { agentHub } from './agentHub.js';
import { runMockChatReply, runMockNode } from './mockRunner.js';
import { buildGlobalWorkbenchContext } from './workbench.js';
import {
  loadProviders,
  loadRun,
  loadWorkflow,
  loadWorkflowTemplates,
  saveArtifact,
  saveRun,
  saveWorkflow,
} from './store.js';

export class WorkflowEngine extends EventEmitter {
  private runs = new Map<string, WorkflowRun>();
  private aborters = new Map<string, AbortController>();
  private activePromises = new Set<string>();

  getRun(runId: string): WorkflowRun | null {
    const cached = this.runs.get(runId);
    if (cached) {
      if (!Array.isArray(cached.messages)) cached.messages = [];
      if (!Array.isArray(cached.materials)) cached.materials = [];
      return cached;
    }
    const disk = loadRun(runId);
    if (disk) {
      if (!Array.isArray(disk.messages)) disk.messages = [];
      if (!Array.isArray(disk.materials)) disk.materials = [];
      // Clean up orphaned streaming messages from before a server restart
      let cleaned = false;
      for (const m of disk.messages) {
        if (m.status === 'streaming') {
          m.status = 'error';
          m.wakePrompt = undefined;
          if (!m.content?.trim()) {
            m.content = '（服务重启前未完成，请重新发送）';
          }
          cleaned = true;
        }
      }
      if (disk.status === 'running' && !this.activePromises.has(runId)) {
        disk.status = 'idle';
        cleaned = true;
      }
      if (cleaned) saveRun(disk);
      this.runs.set(runId, disk);
    }
    return disk;
  }

  addMaterial(
    runId: string,
    params: { title: string; content: string; source?: 'manual' | 'file' },
  ): WorkflowRun {
    const run = this.getRun(runId);
    if (!run) throw new Error('找不到对应的聊天室');
    const title = params.title.trim().slice(0, 80) || '未命名资料';
    const content = params.content.trim();
    if (!content) throw new Error('资料内容不能为空');
    if (!Array.isArray(run.materials)) run.materials = [];

    const item: TaskMaterial = {
      id: `mat_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      title,
      content,
      source: params.source || 'manual',
      createdAt: new Date().toISOString(),
    };
    run.materials.unshift(item);

    const safeFile = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '_').slice(0, 48);
    saveArtifact(run.id, `material-${safeFile || item.id}.md`, `# ${title}\n\n${content}`);
    this.emitUpdate(run);
    return run;
  }

  deleteMaterial(runId: string, materialId: string): WorkflowRun {
    const run = this.getRun(runId);
    if (!run) throw new Error('找不到对应的聊天室');
    run.materials = (run.materials || []).filter((m) => m.id !== materialId);
    this.emitUpdate(run);
    return run;
  }

  private buildMaterialsContext(run: WorkflowRun): string {
    const items = run.materials || [];
    const roomPart =
      items.length === 0
        ? ''
        : '\n\n【本任务共享参考资料】\n' +
          items
            .slice(0, 8)
            .map((m) => `### ${m.title}\n${m.content.slice(0, 2000)}`)
            .join('\n\n');
    const globalPart = buildGlobalWorkbenchContext();
    return `${globalPart}${roomPart}`;
  }

  exportMarkdown(runId: string): string {
    const run = this.getRun(runId);
    if (!run) throw new Error('找不到对应的聊天室');
    const workflow = loadWorkflow();
    const lines: string[] = [
      `# ${run.title}`,
      '',
      `- **房间 ID**：\`${run.id}\``,
      `- **本地代码目录**：\`${run.repoPath}\``,
      `- **当前状态**：${run.status}`,
      `- **更新时间**：${run.updatedAt}`,
      '',
    ];

    if (run.requirement) {
      lines.push('## 原始需求', '', run.requirement, '');
    }

    if (run.materials && run.materials.length > 0) {
      lines.push('## 共享参考资料', '');
      for (const m of run.materials) {
        lines.push(`### ${m.title}`, '', m.content, '');
      }
    }

    lines.push('## 各板块进度与产出', '');
    for (const node of workflow.nodes) {
      const st = run.nodes[node.id];
      const statusText = st?.status || 'idle';
      const who = st?.providerUsed ? `（${st.providerUsed}）` : '';
      lines.push(`### ${node.title}${who} — [${statusText}]`, '');
      if (st?.output?.trim()) {
        lines.push(st.output.trim(), '');
      } else {
        lines.push('_（暂无产出）_', '');
      }
    }
    return lines.join('\n');
  }

  private pushMessage(run: WorkflowRun, msg: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
    if (!Array.isArray(run.messages)) run.messages = [];
    const created: ChatMessage = {
      id: `msg_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      createdAt: new Date().toISOString(),
      ...msg,
    };
    run.messages.push(created);
    if (run.messages.length > 200) {
      run.messages = run.messages.slice(-200);
    }
    return created;
  }

  private buildRecentHistory(run: WorkflowRun, limit = 12): string {
    const msgs = (run.messages || [])
      .filter((m) => m.status === 'done' && m.content.trim())
      .slice(-limit);
    if (msgs.length === 0) return '（暂无历史群聊消息）';
    return msgs
      .map((m) => {
        const tag = m.stageTitle ? `${m.senderName} · ${m.stageTitle}` : m.senderName;
        return `【${tag}】\n${m.content.slice(0, 1500)}`;
      })
      .join('\n\n---\n\n');
  }

  private emitUpdate(run: WorkflowRun, event?: Omit<RunEvent, 'id' | 'timestamp'>): void {
    run.updatedAt = new Date().toISOString();
    if (event) {
      run.events.push({
        id: crypto.randomUUID().slice(0, 8),
        timestamp: run.updatedAt,
        ...event,
      });
      if (run.events.length > 250) {
        run.events = run.events.slice(-250);
      }
    }
    saveRun(run);
    this.emit(`run:${run.id}`, run);
  }

  private appendNodeLog(run: WorkflowRun, nodeId: string, chunk: string): void {
    const state = run.nodes[nodeId];
    if (!state) return;
    const lines = chunk.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      state.logs.push(line);
    }
    if (state.logs.length > 400) {
      state.logs = state.logs.slice(-400);
    }
    run.updatedAt = new Date().toISOString();
    this.emit(`run:${run.id}`, run);
  }

  createAndStartRun(payload: CreateRunPayload): WorkflowRun {
    const workflow = loadWorkflow();
    const id = `room_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const now = new Date().toISOString();

    const nodes: Record<string, NodeExecutionState> = {};
    for (const node of workflow.nodes) {
      nodes[node.id] = {
        nodeId: node.id,
        status: 'idle',
        output: '',
        logs: [],
      };
    }

    const reqText = (payload.requirement || '').trim();
    const shouldStart = payload.startWorkflow !== false && Boolean(reqText);

    if (shouldStart) {
      nodes.user_requirement = {
        nodeId: 'user_requirement',
        status: 'completed',
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        output: reqText,
        logs: [`需求已提交：${reqText.slice(0, 120)}`],
        providerUsed: '我',
      };
    }

    const run: WorkflowRun = {
      id,
      title:
        payload.title?.trim() ||
        (reqText ? reqText.split(/\r?\n/)[0].slice(0, 28) : `协作群聊 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`),
      requirement: reqText,
      repoPath: payload.repoPath?.trim() || process.cwd(),
      branchName:
        payload.branchName?.trim() ||
        `feat/${id.replace('room_', '')}`,
      executionMode: payload.executionMode || 'mock',
      autoMergeEnabled: Boolean(payload.autoMergeEnabled),
      autoDeployEnabled: Boolean(payload.autoDeployEnabled),
      checkCommand: payload.checkCommand?.trim() || 'npm run typecheck',
      deployCommand: payload.deployCommand?.trim() || '',
      status: shouldStart ? 'running' : 'idle',
      createdAt: now,
      updatedAt: now,
      nodes,
      messages: [],
      events: [],
    };

    this.runs.set(id, run);

    if (shouldStart) {
      this.pushMessage(run, {
        role: 'user',
        senderId: 'human',
        senderName: '我',
        accentColor: '#0284c7',
        stageId: 'user_requirement',
        stageTitle: '发起协作流程',
        content: reqText,
        logs: [],
        status: 'done',
      });
      saveArtifact(id, '00-requirement.md', reqText);
      this.emitUpdate(run, {
        type: 'run_started',
        message: `工作流已启动（${run.executionMode === 'mock' ? '模拟演练' : '真实订阅 CLI'}）`,
      });
      void this.scheduleLoop(run.id);
    } else {
      this.pushMessage(run, {
        role: 'system',
        senderId: 'system',
        senderName: '群助手',
        accentColor: '#64748b',
        content:
          '欢迎来到多模型本地协作聊天室！你可以在下方直接选择 `@Claude` / `@Gemini` / `@Codex` 等模型自由群聊，也可以输入需求点击 **「按板块跑流程」** 让各模型接力完成方案、拍板、研发与审查。',
        logs: [],
        status: 'done',
      });
      this.emitUpdate(run);
    }

    return run;
  }

  postSystemNotice(roomId: string, content: string): WorkflowRun | null {
    const run = this.getRun(roomId);
    if (!run) return null;
    this.pushMessage(run, {
      role: 'system',
      senderId: 'system',
      senderName: '群助手',
      accentColor: '#16a34a',
      content,
      logs: [],
      status: 'done',
    });
    this.emitUpdate(run);
    return run;
  }

  postAgentMessage(roomId: string, agentId: string, content: string): WorkflowRun | null {
    const run = this.getRun(roomId);
    const agent = agentHub.getAgent(agentId);
    if (!run || !agent) return null;
    this.pushMessage(run, {
      role: 'assistant',
      senderId: agent.id,
      senderName: agent.name,
      avatar: agent.avatar,
      accentColor: agent.accentColor,
      stageTitle: '主动发言',
      content: content.trim(),
      logs: [],
      status: 'done',
    });
    this.emitUpdate(run);
    return run;
  }

  private resolveActor(
    providers: ProviderConfig[],
    id: string,
  ): {
    id: string;
    shortName: string;
    avatar?: string;
    accentColor: string;
    isConnectedAgent: boolean;
    provider?: ProviderConfig;
  } {
    if (id) {
      const connected = agentHub.getAgent(id);
      if (connected) {
        return {
          id: connected.id,
          shortName: connected.name,
          avatar: connected.avatar,
          accentColor: connected.accentColor,
          isConnectedAgent: true,
        };
      }
      const exactProv = providers.find((p) => p.id === id);
      if (exactProv) {
        return {
          id: exactProv.id,
          shortName: exactProv.shortName,
          avatar: exactProv.avatar,
          accentColor: exactProv.accentColor,
          isConnectedAgent: false,
          provider: exactProv,
        };
      }
    }
    // If stage node left providerId open ('') or model unavailable, fall back to first online agent or first provider
    const firstOnline = agentHub.listAgents().find((a) => a.online);
    if (firstOnline && !id) {
      return {
        id: firstOnline.id,
        shortName: firstOnline.name,
        avatar: firstOnline.avatar,
        accentColor: firstOnline.accentColor,
        isConnectedAgent: true,
      };
    }
    const found = providers[0];
    return {
      id: found.id,
      shortName: found.shortName,
      avatar: found.avatar,
      accentColor: found.accentColor,
      isConnectedAgent: false,
      provider: found,
    };
  }

  async sendChatMessage(runId: string, payload: ChatSendPayload): Promise<WorkflowRun> {
    const run = this.getRun(runId);
    if (!run) throw new Error('找不到对应的聊天室');

    const rawAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const content = (payload.content || '').trim();
    if (!content && rawAttachments.length === 0) throw new Error('请输入消息内容或上传文件');

    const displayAttachments = rawAttachments.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
      savedPath: a.savedPath,
      url: a.url,
    }));

    const attachmentsPromptBlock =
      rawAttachments.length === 0
        ? ''
        : '\n\n【用户随消息上传的文件附件】\n' +
          rawAttachments
            .map((a, idx) => {
              const header = `${idx + 1}. 文件名：${a.name}（${a.mimeType || 'file'}, ${Math.max(1, Math.round(a.size / 1024))} KB）${a.savedPath ? `\n   本地路径：${a.savedPath}` : ''}`;
              if (a.textContent?.trim()) {
                return `${header}\n   文件内容：\n\`\`\`\n${a.textContent.slice(0, 12000)}\n\`\`\``;
              }
              return `${header}\n   （二进制/图片文件已保存在上述本地路径，如需解析可直接读取该路径）`;
            })
            .join('\n\n');

    const effectiveContent = content || `请查看我上传的 ${rawAttachments.length} 个文件：${rawAttachments.map((a) => a.name).join('、')}`;
    const contentWithAttachments = attachmentsPromptBlock
      ? `${effectiveContent}${attachmentsPromptBlock}`
      : effectiveContent;

    if (payload.executionMode) run.executionMode = payload.executionMode;
    if (payload.repoPath?.trim()) run.repoPath = payload.repoPath.trim();

    if (run.title.startsWith('协作群聊') || run.title === '公共协作群聊' || run.title === '新协作会话') {
      run.title = effectiveContent.split(/\r?\n/)[0].slice(0, 28);
    }

    // Mode 1: Launch full modular workflow right inside this chatroom
    if (payload.mode === 'workflow') {
      if (payload.workflowTemplateId) {
        const matchedTpl = loadWorkflowTemplates().find((t) => t.id === payload.workflowTemplateId);
        if (matchedTpl) {
          saveWorkflow(structuredClone(matchedTpl.workflow));
        }
      }
      const workflow = loadWorkflow();
      const now = new Date().toISOString();
      run.requirement = contentWithAttachments;
      run.nodes = {};
      for (const node of workflow.nodes) {
        run.nodes[node.id] = {
          nodeId: node.id,
          status: 'idle',
          output: '',
          logs: [],
        };
      }
      const inputNode = workflow.nodes.find((n) => n.kind === 'human_input') || workflow.nodes[0];
      if (inputNode) {
        run.nodes[inputNode.id] = {
          nodeId: inputNode.id,
          status: 'completed',
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          output: contentWithAttachments,
          logs: [`需求已提交：${effectiveContent.slice(0, 120)}`],
          providerUsed: '我',
        };
      }
      this.pushMessage(run, {
        role: 'user',
        senderId: 'human',
        senderName: '我',
        accentColor: '#0284c7',
        stageId: inputNode?.id || 'user_requirement',
        stageTitle: `启动工作流 · ${workflow.name}`,
        content: effectiveContent,
        attachments: displayAttachments.length > 0 ? displayAttachments : undefined,
        logs: [],
        status: 'done',
      });
      run.status = 'running';
      saveArtifact(run.id, '00-requirement.md', contentWithAttachments);
      this.emitUpdate(run, {
        type: 'run_started',
        message: `已在当前聊天室启动工作流「${workflow.name}」`,
      });
      void this.scheduleLoop(run.id);
      return run;
    }

    // Mode 2: Free-form group chat with 1 or more @mentioned models (CLI providers OR live self-joined Agents!)
    const providers = loadProviders();
    const targetIds =
      payload.targetProviderIds && payload.targetProviderIds.length > 0
        ? payload.targetProviderIds
        : [providers[0]?.id || 'claude'];

    const actors = targetIds.map((id) => this.resolveActor(providers, id));
    const uniqueActors = actors.filter(
      (a, idx) => actors.findIndex((x) => x.id === a.id) === idx,
    );

    const mentionPrefix = uniqueActors.map((t) => `@${t.shortName}`).join(' ');
    this.pushMessage(run, {
      role: 'user',
      senderId: 'human',
      senderName: '我',
      accentColor: '#0284c7',
      stageTitle: mentionPrefix,
      content: effectiveContent,
      attachments: displayAttachments.length > 0 ? displayAttachments : undefined,
      logs: [],
      status: 'done',
    });

    const recentHistory = this.buildRecentHistory(run, 10);
    const materialsContext = this.buildMaterialsContext(run);
    run.status = 'running';
    this.emitUpdate(run);

    const aborter = new AbortController();
    this.aborters.set(run.id, aborter);

    // Run all mentioned models in parallel and stream into the chatroom
    void (async () => {
      try {
        const [repoContext, gitSummary] = await Promise.all([
          collectRepoContext(run.repoPath),
          collectGitSummary(run.repoPath),
        ]);

        await Promise.all(
          uniqueActors.map(async (actor) => {
            const startMs = Date.now();
            const useMock =
              !actor.isConnectedAgent &&
              (run.executionMode === 'mock' || Boolean(actor.provider?.forceMock));
            const isApi = isApiProvider(actor.provider);
            const connectedInfo = actor.isConnectedAgent
              ? agentHub.getAgent(actor.id)
              : undefined;
            const isListeningAgent =
              actor.isConnectedAgent && agentHub.isListening(actor.id);
            const isManualAgent =
              actor.isConnectedAgent &&
              !isListeningAgent &&
              (!connectedInfo?.trigger || connectedInfo.trigger.type === 'manual');
            const msg = this.pushMessage(run, {
              role: 'assistant',
              senderId: actor.id,
              senderName: actor.shortName,
              avatar: actor.avatar,
              accentColor: actor.accentColor,
              stageTitle: actor.isConnectedAgent
                ? isListeningAgent
                  ? '实时待命 · 自动响应'
                  : isManualAgent
                    ? '按需唤醒'
                    : '自动拉起'
                : useMock
                  ? '群聊 · 模拟'
                  : isApi
                    ? '群聊 · API'
                    : '群聊 · 订阅 CLI',
              content: '',
              logs: [],
              wakePrompt: isManualAgent
                ? agentHub.buildWakePrompt(actor.id)
                : undefined,
              status: 'streaming',
            });
            this.emitUpdate(run);

            const onLog = (chunk: string) => {
              const lines = chunk.replace(/\r?\n/g, '\n').split('\n').filter((l) => l.trim());
              if (lines.length === 0) return;
              msg.logs.push(...lines);
              if (msg.logs.length > 200) msg.logs = msg.logs.slice(-200);
              this.emit(`run:${run.id}`, run);
            };

            try {
              if (actor.isConnectedAgent) {
                msg.commandPreview = `Agent 长轮询派单 → ${actor.shortName} (${actor.id})`;
                msg.content = await agentHub.dispatchTask(
                  actor.id,
                  {
                    roomId: run.id,
                    kind: 'chat',
                    stageTitle: '群聊 @回复',
                    repoPath: run.repoPath,
                    prompt: materialsContext
                      ? `${contentWithAttachments}${materialsContext}`
                      : contentWithAttachments,
                    recentHistory,
                  },
                  { signal: aborter.signal, onLog },
                );
              } else if (useMock) {
                msg.commandPreview = isApi
                  ? `[模拟演练] API ${actor.provider!.model || actor.shortName}`
                  : `[模拟演练] ${actor.provider!.command} ${actor.provider!.args.join(' ')}`;
                msg.content = await runMockChatReply({
                  providerName: actor.shortName,
                  userMessage: contentWithAttachments,
                  recentHistory,
                  repoPath: run.repoPath,
                  onLog,
                  signal: aborter.signal,
                });
              } else {
                const prompt = `你正在一个多模型本地协作公共聊天室中，当前你的身份是「${actor.shortName}」。你可以看到用户和群里其他模型刚才的发言，请直接、简洁、有针对性地回复用户（支持 Markdown）。

【目标本地代码目录】
${run.repoPath}

【目录快照】
${repoContext}

【Git 状态】
${gitSummary}${materialsContext}

【最近群聊记录】
${recentHistory}

【用户刚刚 @你 的消息】
${contentWithAttachments}`;
                const res = isApi
                  ? await runProviderApi(actor.provider!, prompt, {
                      signal: aborter.signal,
                      onLog,
                    })
                  : await runProviderCli(actor.provider!, prompt, {
                      cwd: run.repoPath,
                      signal: aborter.signal,
                      onLog,
                    });
                msg.commandPreview = res.commandPreview;
                msg.content = res.output;
              }
              msg.status = 'done';
              msg.durationMs = Date.now() - startMs;
              this.emitUpdate(run);
            } catch (err) {
              msg.status = 'error';
              msg.durationMs = Date.now() - startMs;
              msg.content = `回复失败：${err instanceof Error ? err.message : String(err)}`;
              this.emitUpdate(run);
            }
          }),
        );
      } finally {
        if (this.aborters.get(run.id) === aborter) {
          this.aborters.delete(run.id);
        }
        if (run.status === 'running' && !this.activePromises.has(run.id)) {
          run.status = 'idle';
          this.emitUpdate(run);
        }
      }
    })();

    return run;
  }

  abortRun(runId: string): WorkflowRun | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const aborter = this.aborters.get(runId);
    if (aborter) {
      aborter.abort();
      this.aborters.delete(runId);
    }
    for (const state of Object.values(run.nodes)) {
      if (state.status === 'running' || state.status === 'queued') {
        state.status = 'failed';
        state.error = '已被用户手动终止';
        state.finishedAt = new Date().toISOString();
      }
    }
    run.status = 'aborted';
    this.emitUpdate(run, {
      type: 'run_aborted',
      message: '工作流已被手动终止',
    });
    return run;
  }

  submitApproval(runId: string, payload: ApprovalPayload): WorkflowRun {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error('找不到对应的运行记录');
    }
    const gate = Object.values(run.nodes).find((n) => n.status === 'waiting_approval');
    if (!gate) {
      throw new Error('当前不处于「拍板」等待状态');
    }
    const gateId = gate.nodeId;

    const now = new Date().toISOString();
    const feedback = payload.feedback?.trim() || '';

    if (payload.decision === 'approved') {
      if (payload.overrideSynthesis?.trim() && run.nodes.synthesize) {
        run.nodes.synthesize.output = payload.overrideSynthesis.trim();
        saveArtifact(run.id, 'synthesize.md', run.nodes.synthesize.output);
      }
      gate.status = 'completed';
      gate.decision = 'approved';
      gate.humanFeedback = feedback;
      gate.finishedAt = now;
      gate.output = feedback
        ? `**拍板通过**\n\n补充指示：${feedback}`
        : '**拍板通过**（按合成方案进入后续阶段）';
      gate.logs.push('用户已拍板通过，继续推进后续板块。');
      this.pushMessage(run, {
        role: 'user',
        senderId: 'human',
        senderName: '我',
        accentColor: '#16a34a',
        stageId: gateId,
        stageTitle: '拍板通过',
        content: feedback ? `拍板通过！补充指示：${feedback}` : '拍板通过，请按合成方案继续推进后续板块。',
        logs: [],
        status: 'done',
      });
      run.status = 'running';

      this.emitUpdate(run, {
        type: 'approval_submitted',
        nodeId: gateId,
        message: '已拍板通过，继续执行后续板块',
      });

      void this.scheduleLoop(run.id);
      return run;
    }

    // Rejected -> reset upstream non-input stages before this gate
    if (!feedback) {
      throw new Error('打回重议时请填写修改意见，以便前序板块针对性调整');
    }
    const wf = loadWorkflow();
    const gateIndex = wf.nodes.findIndex((n) => n.id === gateId);
    const resetIds = wf.nodes
      .slice(0, gateIndex >= 0 ? gateIndex + 1 : wf.nodes.length)
      .filter((n) => n.kind !== 'human_input')
      .map((n) => n.id);
    for (const nid of resetIds) {
      const prev = run.nodes[nid];
      run.nodes[nid] = {
        nodeId: nid,
        status: 'idle',
        output: '',
        logs: prev ? [...prev.logs.slice(-10), '--- 因拍板打回，准备重新生成 ---'] : [],
        humanFeedback: feedback,
      };
    }
    run.nodes[gateId].decision = 'rejected';
    run.nodes[gateId].humanFeedback = feedback;
    this.pushMessage(run, {
      role: 'user',
      senderId: 'human',
      senderName: '我',
      accentColor: '#d97706',
      stageId: gateId,
      stageTitle: '打回重议',
      content: `打回重议：${feedback}`,
      logs: [],
      status: 'done',
    });
    run.status = 'running';

    this.emitUpdate(run, {
      type: 'approval_submitted',
      nodeId: gateId,
      message: `已打回重议：${feedback.slice(0, 80)}`,
    });

    void this.scheduleLoop(run.id);
    return run;
  }

  rerunFromNode(runId: string, startNodeId: string): WorkflowRun {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error('找不到对应的运行记录');
    }
    const workflow = loadWorkflow();
    const target = workflow.nodes.find((n) => n.id === startNodeId);
    if (!target) {
      throw new Error(`不存在节点：${startNodeId}`);
    }
    if (startNodeId === 'user_requirement') {
      throw new Error('「说出需求」为起点节点，请新建任务或从「主控」节点重跑');
    }

    // Abort any running step first
    const existingAborter = this.aborters.get(runId);
    if (existingAborter) {
      existingAborter.abort();
      this.aborters.delete(runId);
    }

    // Find startNodeId + all downstream dependents via BFS
    const toReset = new Set<string>([startNodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of workflow.nodes) {
        if (toReset.has(n.id)) continue;
        if (n.dependsOn.some((dep) => toReset.has(dep))) {
          toReset.add(n.id);
          changed = true;
        }
      }
    }

    for (const nid of toReset) {
      run.nodes[nid] = {
        nodeId: nid,
        status: 'idle',
        output: '',
        logs: [`已重置节点，准备从「${target.title}」重新执行...`],
      };
    }

    run.status = 'running';
    this.emitUpdate(run, {
      type: 'run_started',
      nodeId: startNodeId,
      message: `从节点「${target.title}」起重新执行（共重置 ${toReset.size} 个节点）`,
    });

    void this.scheduleLoop(run.id);
    return run;
  }

  private async scheduleLoop(runId: string): Promise<void> {
    if (this.activePromises.has(runId)) return;
    this.activePromises.add(runId);

    const aborter = new AbortController();
    this.aborters.set(runId, aborter);

    try {
      const workflow = loadWorkflow();

      while (true) {
        const run = this.getRun(runId);
        if (!run || aborter.signal.aborted || run.status === 'aborted') {
          break;
        }

        const states = Object.values(run.nodes);
        if (states.some((s) => s.status === 'failed')) {
          run.status = 'failed';
          this.emitUpdate(run, {
            type: 'run_failed',
            message: '工作流因节点执行失败已暂停，可在右侧抽屉查看日志并单步重跑',
          });
          break;
        }

        // Find all idle nodes whose existing dependencies are ALL completed/skipped
        const readyNodes = workflow.nodes.filter((node) => {
          const st = run.nodes[node.id];
          if (!st || st.status !== 'idle') return false;
          const validDeps = (node.dependsOn || []).filter((depId) => Boolean(run.nodes[depId]));
          return validDeps.every((depId) => {
            const dep = run.nodes[depId];
            return dep && (dep.status === 'completed' || dep.status === 'skipped');
          });
        });

        if (readyNodes.length === 0) {
          const waiting = states.some((s) => s.status === 'waiting_approval');
          if (waiting) {
            run.status = 'waiting_approval';
            this.emitUpdate(run);
            break;
          }
          const allDone = states.every(
            (s) => s.status === 'completed' || s.status === 'skipped',
          );
          if (allDone) {
            run.status = 'completed';
            this.emitUpdate(run, {
              type: 'run_completed',
              message: '全流程执行完成！所有节点产物已保存在本地 data/runs 目录。',
            });
          }
          break;
        }

        // Handle disabled/skipped nodes OR condition-mismatched branch nodes immediately
        const autoSkipNodes = readyNodes.filter((n) => {
          if (n.enabled === false) return true;
          const validDeps = (n.dependsOn || []).filter((depId) => Boolean(run.nodes[depId]));
          if (validDeps.length === 0) return false;
          // Check incoming edges from condition nodes
          const incomingEdges = workflow.edges.filter((e) => e.target === n.id && validDeps.includes(e.source));
          const condEdges = incomingEdges.filter((e) => {
            const srcNode = workflow.nodes.find((x) => x.id === e.source);
            return srcNode?.kind === 'condition' && (e.sourceHandle === 'true' || e.sourceHandle === 'false');
          });
          if (condEdges.length > 0) {
            const anyMatched = condEdges.some((e) => run.nodes[e.source]?.branchResult === e.sourceHandle);
            if (!anyMatched) return true;
          }
          // If ALL parents were skipped due to conditional branching, propagate skip downstream
          const allParentsBranchSkipped = validDeps.every(
            (depId) => run.nodes[depId]?.status === 'skipped' && run.nodes[depId]?.output?.includes('条件分支未命中'),
          );
          return allParentsBranchSkipped;
        });
        if (autoSkipNodes.length > 0) {
          for (const dn of autoSkipNodes) {
            const st = run.nodes[dn.id];
            const isDisabled = dn.enabled === false;
            st.status = 'skipped';
            st.finishedAt = new Date().toISOString();
            st.output = isDisabled ? '（已设置为跳过此板块）' : '（条件分支未命中，自动跳过）';
            st.logs.push(
              isDisabled
                ? '用户已关闭此板块，自动跳过并继续下游。'
                : '上游条件分支未命中此路径，自动跳过。',
            );
            this.emitUpdate(run, {
              type: 'node_skipped',
              nodeId: dn.id,
              message: isDisabled ? `已跳过板块「${dn.title}」` : `条件分支未命中，跳过「${dn.title}」`,
            });
          }
          continue;
        }

        // Handle human gate nodes immediately (pause!)
        const gateNodes = readyNodes.filter((n) => n.kind === 'human_gate');
        if (gateNodes.length > 0) {
          for (const gate of gateNodes) {
            const st = run.nodes[gate.id];
            st.status = 'waiting_approval';
            st.startedAt = new Date().toISOString();
            st.logs.push('已暂停，等待你在界面中对比双方案并「拍板」...');
            this.emitUpdate(run, {
              type: 'node_waiting',
              nodeId: gate.id,
              message: `等待人工「${gate.title}」确认`,
            });
          }
          run.status = 'waiting_approval';
          this.emitUpdate(run);
          break;
        }

        // Execute all ready nodes in parallel (e.g., claude_proposal + gemini_proposal)
        await Promise.all(
          readyNodes.map((node) =>
            this.executeNode(run, workflow, node, aborter.signal),
          ),
        );
      }
    } finally {
      this.activePromises.delete(runId);
      if (this.aborters.get(runId) === aborter) {
        this.aborters.delete(runId);
      }
    }
  }

  private renderTemplate(
    template: string,
    vars: {
      run: WorkflowRun;
      repoContext: string;
      gitSummary: string;
      providerName?: string;
      previousOutput?: string;
      humanFeedback?: string;
      round?: number;
      maxRounds?: number;
      reviewFeedback?: string;
    },
  ): string {
    let text = template;

    // Optional conditional block {{#humanFeedback}}...{{/humanFeedback}}
    text = text.replace(
      /\{\{#humanFeedback\}\}([\s\S]*?)\{\{\/humanFeedback\}\}/g,
      (_, inner: string) => (vars.humanFeedback ? inner : ''),
    );

    text = text
      .replaceAll('{{requirement}}', vars.run.requirement)
      .replaceAll('{{repoPath}}', vars.run.repoPath)
      .replaceAll('{{branchName}}', vars.run.branchName)
      .replaceAll('{{repoContext}}', vars.repoContext)
      .replaceAll('{{gitSummary}}', vars.gitSummary)
      .replaceAll('{{providerName}}', vars.providerName || '当前模型')
      .replaceAll('{{previousOutput}}', vars.previousOutput || '（暂无前序阶段产出）')
      .replaceAll('{{checkCommand}}', vars.run.checkCommand)
      .replaceAll('{{deployCommand}}', vars.run.deployCommand)
      .replaceAll('{{humanFeedback}}', vars.humanFeedback || '')
      .replaceAll('{{round}}', String(vars.round ?? 1))
      .replaceAll('{{maxRounds}}', String(vars.maxRounds ?? 2))
      .replaceAll('{{reviewFeedback}}', vars.reviewFeedback || '');

    // Replace {{outputs.<nodeId>}}
    text = text.replace(/\{\{outputs\.([a-zA-Z0-9_-]+)\}\}/g, (_, refId: string) => {
      return vars.run.nodes[refId]?.output || '（前置节点暂无输出）';
    });

    return text;
  }

  private findProvider(providers: ProviderConfig[], providerId: string): ProviderConfig {
    return (
      providers.find((p) => p.id === providerId) ||
      providers[0]
    );
  }

  private async executeNode(
    run: WorkflowRun,
    _workflow: WorkflowDefinition,
    node: WorkflowNodeConfig,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const startMs = Date.now();
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    state.error = undefined;

    const providers = loadProviders();
    const isModelNode =
      node.kind === 'llm' ||
      node.kind === 'review_loop' ||
      node.kind === 'consensus' ||
      node.kind === 'debate';
    const actor = isModelNode ? this.resolveActor(providers, node.providerId) : undefined;

    const systemNodeLabel: Record<string, string> = {
      shell: 'Shell 命令',
      condition: '条件分支',
      file_read: '读取文件',
      file_write: '写入文件',
      http: 'HTTP / Webhook',
      delay: '延时等待',
      human: '人工',
    };

    const useMock =
      !actor?.isConnectedAgent &&
      (run.executionMode === 'mock' || Boolean(actor?.provider?.forceMock));
    state.providerUsed = actor ? actor.shortName : systemNodeLabel[node.kind] || node.providerId || '系统';
    state.usedMock = isModelNode ? useMock : false;

    const connectedInfo = actor?.isConnectedAgent
      ? agentHub.getAgent(actor.id)
      : undefined;
    const isListeningAgent =
      Boolean(actor?.isConnectedAgent) && agentHub.isListening(actor!.id);
    const isManualAgent =
      Boolean(actor?.isConnectedAgent) &&
      !isListeningAgent &&
      (!connectedInfo?.trigger || connectedInfo.trigger.type === 'manual');

    const chatMsg = this.pushMessage(run, {
      role: 'assistant',
      senderId: actor?.id || node.kind,
      senderName: actor?.shortName || state.providerUsed,
      avatar: actor?.avatar,
      accentColor: actor?.accentColor || '#475569',
      stageId: node.id,
      stageTitle: node.title,
      content: '',
      logs: [],
      wakePrompt: isManualAgent && actor
        ? agentHub.buildWakePrompt(actor.id)
        : undefined,
      status: 'streaming',
    });

    this.emitUpdate(run, {
      type: 'node_started',
      nodeId: node.id,
      message: `开始执行「${node.title}」（${state.providerUsed}）`,
    });

    try {
      if (node.kind === 'review_loop') {
        await this.executeReviewLoop(run, node, providers, useMock, signal);
      } else if (node.kind === 'debate') {
        await this.executeDebateNode(run, node, providers, useMock, signal);
      } else if (node.kind === 'consensus' && actor) {
        await this.executeConsensusNode(run, node, actor, useMock, signal);
      } else if (node.kind === 'shell') {
        await this.executeShellNode(run, node, useMock, signal);
      } else if (node.kind === 'condition') {
        await this.executeConditionNode(run, node);
      } else if (node.kind === 'file_read') {
        await this.executeFileReadNode(run, node);
      } else if (node.kind === 'file_write') {
        await this.executeFileWriteNode(run, node);
      } else if (node.kind === 'http') {
        await this.executeHttpNode(run, node, useMock, signal);
      } else if (node.kind === 'delay') {
        await this.executeDelayNode(run, node, useMock, signal);
      } else if (actor) {
        await this.executeLlmNode(run, node, actor, useMock, signal);
      }

      state.status = 'completed';
      state.finishedAt = new Date().toISOString();
      state.durationMs = Date.now() - startMs;
      chatMsg.status = 'done';
      chatMsg.content = state.output;
      chatMsg.logs = [...state.logs];
      chatMsg.commandPreview = state.commandPreview;
      chatMsg.durationMs = state.durationMs;
      saveArtifact(run.id, `${node.id}.md`, state.output);

      this.emitUpdate(run, {
        type: 'node_completed',
        nodeId: node.id,
        message: `完成「${node.title}」（耗时 ${(state.durationMs / 1000).toFixed(1)}s）`,
      });
    } catch (err) {
      if (signal.aborted) {
        chatMsg.status = 'error';
        chatMsg.content = '（已被手动终止）';
        return;
      }
      state.status = 'failed';
      state.finishedAt = new Date().toISOString();
      state.durationMs = Date.now() - startMs;
      state.error = err instanceof Error ? err.message : String(err);
      this.appendNodeLog(run, node.id, `[ERROR] ${state.error}`);
      chatMsg.status = 'error';
      chatMsg.content = `执行失败：${state.error}`;
      chatMsg.logs = [...state.logs];
      chatMsg.durationMs = state.durationMs;

      this.emitUpdate(run, {
        type: 'node_failed',
        nodeId: node.id,
        message: `「${node.title}」执行失败：${state.error.slice(0, 100)}`,
      });
    }
  }

  private async executeLlmNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    actor: {
      id: string;
      shortName: string;
      accentColor: string;
      isConnectedAgent: boolean;
      provider?: ProviderConfig;
    },
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const [repoContext, gitSummary] = await Promise.all([
      collectRepoContext(run.repoPath),
      collectGitSummary(run.repoPath),
    ]);

    const workflow = loadWorkflow();
    const previousOutput = (node.dependsOn || [])
      .map((depId) => {
        const depNode = workflow.nodes.find((n) => n.id === depId);
        const out = run.nodes[depId]?.output?.trim();
        if (!out) return '';
        return `### ${depNode?.title || depId}\n${out}`;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');

    const materialsContext = this.buildMaterialsContext(run);
    const renderedPrompt = this.renderTemplate(node.promptTemplate || '{{requirement}}\n\n【前序产出】\n{{previousOutput}}', {
      run,
      repoContext,
      gitSummary,
      providerName: actor.shortName,
      previousOutput,
      humanFeedback: state.humanFeedback || run.nodes.user_approve?.humanFeedback,
    });
    const prompt = materialsContext ? `${renderedPrompt}${materialsContext}` : renderedPrompt;

    saveArtifact(run.id, `${node.id}.prompt.txt`, prompt);

    if (actor.isConnectedAgent) {
      state.commandPreview = `Agent 长轮询派单 → ${actor.shortName} (${actor.id})`;
      state.output = await agentHub.dispatchTask(
        actor.id,
        {
          roomId: run.id,
          kind: 'workflow',
          stageId: node.id,
          stageTitle: node.title,
          repoPath: run.repoPath,
          prompt,
          recentHistory: this.buildRecentHistory(run, 8),
        },
        {
          signal,
          onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
        },
      );
      return;
    }

    if (useMock) {
      state.commandPreview = `[模拟演练] ${actor.provider!.command} ${actor.provider!.args.join(' ')}`;
      state.output = await runMockNode({
        nodeId: node.id,
        run,
        providerName: actor.shortName,
        humanFeedback: state.humanFeedback || run.nodes.user_approve?.humanFeedback,
        onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
        signal,
      });
      return;
    }

    const res = isApiProvider(actor.provider)
      ? await runProviderApi(actor.provider!, prompt, {
          signal,
          onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
        })
      : await runProviderCli(actor.provider!, prompt, {
          cwd: run.repoPath,
          signal,
          onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
        });
    state.commandPreview = res.commandPreview;
    state.output = res.output;
  }

  private async executeShellNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];

    // Safety guard for merge_pr and deploy when toggle is off
    if (node.id === 'merge_pr' && !run.autoMergeEnabled) {
      state.commandPreview = '[安全保护] 自动合并开关未开启';
      state.output = await runMockNode({
        nodeId: 'merge_pr',
        run,
        onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
        signal,
      });
      return;
    }

    if (node.id === 'deploy' && (!run.autoDeployEnabled || !run.deployCommand.trim())) {
      state.commandPreview = '[安全保护] 自动发布开关未开启或未配置发布命令';
      state.output = await runMockNode({
        nodeId: 'deploy',
        run,
        onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
        signal,
      });
      return;
    }

    if (useMock) {
      state.commandPreview = `[模拟演练] ${node.shellCommand || 'shell'}`;
      state.output = await runMockNode({
        nodeId: node.id,
        run,
        onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
        signal,
      });
      return;
    }

    const renderedCmd = this.renderTemplate(node.shellCommand || 'echo ok', {
      run,
      repoContext: '',
      gitSummary: '',
    }).trim();

    if (!renderedCmd) {
      state.output = '（未配置检查命令，已跳过）';
      return;
    }

    state.commandPreview = renderedCmd;
    const res = await runShellCommand(renderedCmd, run.repoPath, {
      signal,
      onLog: (chunk) => this.appendNodeLog(run, node.id, chunk),
    });
    state.output = res.output;
  }

  private async executeReviewLoop(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    providers: ProviderConfig[],
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const maxRounds = node.maxRounds ?? 2;
    const reviewer = this.resolveActor(providers, node.providerId);
    const fixer = this.resolveActor(providers, node.fixProviderId || 'claude');
    state.maxRounds = maxRounds;

    const transcript: string[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      state.round = round;
      this.appendNodeLog(
        run,
        node.id,
        `=== 开始第 ${round} / ${maxRounds} 轮代码审查（${reviewer.shortName}） ===`,
      );

      const [repoContext, gitSummary] = await Promise.all([
        collectRepoContext(run.repoPath),
        collectGitSummary(run.repoPath),
      ]);

      const prompt = this.renderTemplate(node.promptTemplate || '', {
        run,
        repoContext,
        gitSummary,
        providerName: reviewer.shortName,
        round,
        maxRounds,
      });

      let reviewOutput: string;
      if (reviewer.isConnectedAgent) {
        state.commandPreview = `Agent 审查派单 → ${reviewer.shortName} (轮次 ${round}/${maxRounds})`;
        reviewOutput = await agentHub.dispatchTask(
          reviewer.id,
          {
            roomId: run.id,
            kind: 'workflow',
            stageId: node.id,
            stageTitle: `${node.title} · 第${round}轮`,
            repoPath: run.repoPath,
            prompt,
          },
          { signal, onLog: (c) => this.appendNodeLog(run, node.id, c) },
        );
      } else if (useMock || reviewer.provider?.forceMock) {
        state.commandPreview = `[模拟演练] ${reviewer.provider!.command} ${reviewer.provider!.args.join(' ')} (轮次 ${round}/${maxRounds})`;
        reviewOutput = await runMockNode({
          nodeId: 'code_review',
          run,
          providerName: reviewer.shortName,
          round,
          onLog: (c) => this.appendNodeLog(run, node.id, c),
          signal,
        });
      } else {
        saveArtifact(run.id, `${node.id}.r${round}.prompt.txt`, prompt);
        const res = isApiProvider(reviewer.provider)
          ? await runProviderApi(reviewer.provider!, prompt, {
              signal,
              onLog: (c) => this.appendNodeLog(run, node.id, c),
            })
          : await runProviderCli(reviewer.provider!, prompt, {
              cwd: run.repoPath,
              signal,
              onLog: (c) => this.appendNodeLog(run, node.id, c),
            });
        state.commandPreview = res.commandPreview;
        reviewOutput = res.output;
      }

      transcript.push(`## 第 ${round} 轮审查（${reviewer.shortName}）\n\n${reviewOutput}`);

      const needsChanges =
        /VERDICT:\s*CHANGES_REQUESTED/i.test(reviewOutput) &&
        !/VERDICT:\s*PASS/i.test(reviewOutput);

      if (!needsChanges) {
        this.appendNodeLog(run, node.id, `第 ${round} 轮审查通过（PASS）。`);
        break;
      }

      if (round >= maxRounds) {
        this.appendNodeLog(
          run,
          node.id,
          `已达最大审查轮次（${maxRounds} 轮），将汇总当前审查意见继续。`,
        );
        break;
      }

      // Run fixer before next round
      this.appendNodeLog(
        run,
        node.id,
        `第 ${round} 轮审查要求修改，正在通知 ${fixer.shortName} 自动修复...`,
      );

      const fixPrompt = this.renderTemplate(node.fixPromptTemplate || '', {
        run,
        repoContext,
        gitSummary,
        providerName: fixer.shortName,
        round,
        maxRounds,
        reviewFeedback: reviewOutput,
      });

      let fixOutput: string;
      if (fixer.isConnectedAgent) {
        fixOutput = await agentHub.dispatchTask(
          fixer.id,
          {
            roomId: run.id,
            kind: 'workflow',
            stageId: node.id,
            stageTitle: `${node.title} · 第${round}轮修复`,
            repoPath: run.repoPath,
            prompt: fixPrompt,
          },
          { signal, onLog: (c) => this.appendNodeLog(run, node.id, c) },
        );
      } else if (useMock || fixer.provider?.forceMock) {
        fixOutput = await runMockNode({
          nodeId: 'code_review_fix',
          run,
          providerName: fixer.shortName,
          round,
          onLog: (c) => this.appendNodeLog(run, node.id, c),
          signal,
        });
      } else {
        const fixRes = isApiProvider(fixer.provider)
          ? await runProviderApi(fixer.provider!, fixPrompt, {
              signal,
              onLog: (c) => this.appendNodeLog(run, node.id, c),
            })
          : await runProviderCli(fixer.provider!, fixPrompt, {
              cwd: run.repoPath,
              signal,
              onLog: (c) => this.appendNodeLog(run, node.id, c),
            });
        fixOutput = fixRes.output;
      }

      transcript.push(`## 第 ${round} 轮自动修复（${fixer.shortName}）\n\n${fixOutput}`);
    }

    state.output = transcript.join('\n\n---\n\n');
  }

  private getUpstreamOutput(run: WorkflowRun, node: WorkflowNodeConfig): string {
    const workflow = loadWorkflow();
    return (node.dependsOn || [])
      .map((depId) => {
        const depNode = workflow.nodes.find((n) => n.id === depId);
        const out = run.nodes[depId]?.output?.trim();
        if (!out) return '';
        return `### ${depNode?.title || depId}\n${out}`;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  private async runActorOnce(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    actor: ReturnType<WorkflowEngine['resolveActor']>,
    prompt: string,
    stageLabel: string,
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    if (actor.isConnectedAgent) {
      return agentHub.dispatchTask(
        actor.id,
        {
          roomId: run.id,
          kind: 'workflow',
          stageId: node.id,
          stageTitle: stageLabel,
          repoPath: run.repoPath,
          prompt,
          recentHistory: this.buildRecentHistory(run, 8),
        },
        { signal, onLog: (c) => this.appendNodeLog(run, node.id, c) },
      );
    }
    if (useMock || actor.provider?.forceMock) {
      return runMockNode({
        nodeId: node.id,
        run,
        providerName: actor.shortName,
        onLog: (c) => this.appendNodeLog(run, node.id, c),
        signal,
      });
    }
    const res = isApiProvider(actor.provider)
      ? await runProviderApi(actor.provider!, prompt, {
          signal,
          onLog: (c) => this.appendNodeLog(run, node.id, c),
        })
      : await runProviderCli(actor.provider!, prompt, {
          cwd: run.repoPath,
          signal,
          onLog: (c) => this.appendNodeLog(run, node.id, c),
        });
    return res.output;
  }

  private async executeConsensusNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    actor: ReturnType<WorkflowEngine['resolveActor']>,
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const previousOutput = this.getUpstreamOutput(run, node);
    const defaultTpl = `你是多模型汇总与投票裁判（当前模型：{{providerName}}）。请对比上游各路模型的输出，按「共识点 / 分歧点 / 评分对比表 / 最终采纳结论」给出客观清晰的综合结论。\n\n【用户需求】\n{{requirement}}\n\n【上游各路方案】\n{{previousOutput}}`;
    const prompt = this.renderTemplate(node.promptTemplate || defaultTpl, {
      run,
      repoContext: '',
      gitSummary: '',
      providerName: actor.shortName,
      previousOutput,
    });
    this.appendNodeLog(run, node.id, `正在汇总 ${(node.dependsOn || []).length} 路输入并生成综合结论...`);
    state.output = await this.runActorOnce(run, node, actor, prompt, node.title, useMock, signal);
  }

  private async executeDebateNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    providers: ProviderConfig[],
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const maxRounds = Math.max(1, Math.min(4, node.maxRounds ?? 2));
    const proActor = this.resolveActor(providers, node.providerId);
    const conActor = this.resolveActor(providers, node.fixProviderId || '');
    const previousOutput = this.getUpstreamOutput(run, node);
    state.maxRounds = maxRounds;

    const transcript: string[] = [];
    for (let r = 1; r <= maxRounds; r++) {
      state.round = r;
      this.appendNodeLog(run, node.id, `=== 辩论第 ${r}/${maxRounds} 轮：${proActor.shortName} vs ${conActor.shortName} ===`);
      const historySoFar = transcript.join('\n\n') || previousOutput || '（首轮开场）';

      const proPrompt = `你是辩论正方/方案主推者（${proActor.shortName}），当前第 ${r}/${maxRounds} 轮。请围绕目标给出清晰主张，并回应上一轮反方质疑。\n\n【议题】\n${run.requirement}\n\n【已有上下文】\n${historySoFar}`;
      const proReply = await this.runActorOnce(
        run,
        node,
        proActor,
        proPrompt,
        `${node.title} · 第${r}轮正方`,
        useMock,
        signal,
      );
      transcript.push(`### 第 ${r} 轮 · 正方（${proActor.shortName}）\n\n${proReply}`);

      const conPrompt = `你是辩论反方/批判审查者（${conActor.shortName}），当前第 ${r}/${maxRounds} 轮。请专门挑刺、指出风险与盲点，或提出更简洁替代路径。\n\n【议题】\n${run.requirement}\n\n【正方刚刚发言】\n${proReply}`;
      const conReply = await this.runActorOnce(
        run,
        node,
        conActor,
        conPrompt,
        `${node.title} · 第${r}轮反方`,
        useMock,
        signal,
      );
      transcript.push(`### 第 ${r} 轮 · 反方（${conActor.shortName}）\n\n${conReply}`);
    }

    state.output = transcript.join('\n\n---\n\n');
  }

  private async executeConditionNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const mode = node.conditionMode || 'contains';
    const pattern = (node.conditionPattern || 'PASS').trim();
    const upstream = this.getUpstreamOutput(run, node) || run.requirement || '';

    let matched = false;
    if (mode === 'regex') {
      try {
        matched = new RegExp(pattern, 'i').test(upstream);
      } catch {
        matched = false;
      }
    } else if (mode === 'not_contains') {
      matched = !upstream.toLowerCase().includes(pattern.toLowerCase());
    } else {
      matched = upstream.toLowerCase().includes(pattern.toLowerCase());
    }

    state.branchResult = matched ? 'true' : 'false';
    const modeLabel = mode === 'regex' ? '正则匹配' : mode === 'not_contains' ? '不包含' : '包含';
    this.appendNodeLog(
      run,
      node.id,
      `条件判断（${modeLabel}「${pattern}」）=> ${matched ? '满足 (TRUE)' : '不满足 (FALSE)'}`,
    );
    state.output = `**条件判断结果**：${matched ? '✅ 满足（走 TRUE 分支）' : '🟠 不满足（走 FALSE 分支）'}\n\n- 规则：\`${modeLabel}\` \`${pattern}\`\n- 已评估上游文本长度：${upstream.length} 字`;
  }

  private async executeFileReadNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const rootDir = path.resolve(run.repoPath || process.cwd());
    const rawList = (node.filePaths || '')
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawList.length === 0) {
      state.output = '（未配置文件路径，请在节点属性中填写工作区相对路径）';
      return;
    }

    const sections: string[] = [];
    for (const rel of rawList.slice(0, 12)) {
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(rootDir, rel);
      const checkRel = path.relative(rootDir, abs);
      if (checkRel.startsWith('..') || path.isAbsolute(checkRel)) {
        sections.push(`### ${rel}\n> 跳过：路径超出当前工作区目录`);
        continue;
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        sections.push(`### ${rel}\n> 文件不存在`);
        continue;
      }
      const text = fs.readFileSync(abs, 'utf8').slice(0, 24000);
      const ext = path.extname(abs).replace(/^\./, '');
      this.appendNodeLog(run, node.id, `已读取 ${checkRel.replace(/\\/g, '/')} (${text.length} 字)`);
      sections.push(`### ${checkRel.replace(/\\/g, '/')}\n\`\`\`${ext}\n${text}\n\`\`\``);
    }

    state.output = sections.join('\n\n');
  }

  private async executeFileWriteNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const rootDir = path.resolve(run.repoPath || process.cwd());
    const relTarget = (node.targetFilePath || '').trim() || `workflow-output-${node.id}.md`;
    const abs = path.isAbsolute(relTarget) ? path.resolve(relTarget) : path.resolve(rootDir, relTarget);
    const checkRel = path.relative(rootDir, abs);
    if (checkRel.startsWith('..') || path.isAbsolute(checkRel)) {
      throw new Error(`写入路径超出当前工作区范围：${relTarget}`);
    }

    const previousOutput = this.getUpstreamOutput(run, node);
    const body = this.renderTemplate(node.promptTemplate?.trim() || '{{previousOutput}}', {
      run,
      repoContext: '',
      gitSummary: '',
      previousOutput,
    });

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    const cleanRel = checkRel.replace(/\\/g, '/');
    this.appendNodeLog(run, node.id, `已写入文件：${abs} (${body.length} 字)`);
    state.output = `已成功将上游产物写入工作区文件：\n\n- **相对路径**：\`${cleanRel}\`\n- **完整路径**：\`${abs}\`\n- **写入长度**：${body.length} 字`;
  }

  private async executeHttpNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const method = node.httpMethod || 'POST';
    const url = (node.httpUrl || '').trim();
    if (!url) {
      state.output = '（未配置请求 URL，已跳过）';
      return;
    }

    const previousOutput = this.getUpstreamOutput(run, node);
    const renderedBody = node.httpBody?.trim()
      ? this.renderTemplate(node.httpBody, { run, repoContext: '', gitSummary: '', previousOutput })
      : JSON.stringify({ requirement: run.requirement, output: previousOutput.slice(0, 4000) });

    state.commandPreview = `${method} ${url}`;
    if (useMock) {
      this.appendNodeLog(run, node.id, `[模拟模式] 跳过外部请求 ${method} ${url}`);
      state.output = `**模拟 HTTP 请求成功**\n\n- 请求：\`${method} ${url}\`\n- 负载预览：\`${renderedBody.slice(0, 300)}\``;
      return;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (node.httpHeaders?.trim()) {
      try {
        Object.assign(headers, JSON.parse(node.httpHeaders));
      } catch {
        for (const line of node.httpHeaders.split(/\r?\n/)) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        }
      }
    }

    this.appendNodeLog(run, node.id, `发送 ${method} ${url}...`);
    const resp = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : renderedBody,
      signal,
    });
    const text = await resp.text();
    this.appendNodeLog(run, node.id, `响应状态：HTTP ${resp.status} (${text.length} bytes)`);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
    state.output = `**HTTP ${resp.status} OK** (\`${method} ${url}\`)\n\n\`\`\`\n${text.slice(0, 6000)}\n\`\`\``;
  }

  private async executeDelayNode(
    run: WorkflowRun,
    node: WorkflowNodeConfig,
    useMock: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const state = run.nodes[node.id];
    const sec = Math.max(1, Math.min(300, Number(node.delaySeconds ?? 5) || 5));
    const actualMs = useMock ? Math.min(1200, sec * 200) : sec * 1000;
    this.appendNodeLog(run, node.id, `等待 ${sec} 秒${useMock ? '（模拟加速）' : ''}...`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, actualMs);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('延时等待已取消'));
        },
        { once: true },
      );
    });
    state.output = `已完成延时等待（${sec} 秒），继续执行下游节点。`;
  }
}

export const engine = new WorkflowEngine();
