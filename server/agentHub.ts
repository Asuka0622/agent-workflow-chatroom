import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentTask,
  AgentTrigger,
  ConnectedAgent,
  ProviderConfig,
  ThinkingLevel,
  TokenUsage,
} from '../shared/types.js';
import { normalizeTokenUsage } from './tokenEstimator.js';
import { runProviderCli } from './cliRunner.js';
import { loadSavedAgents, saveAgentsList } from './store.js';

export function inferRelayName(raw?: {
  relay?: string;
  source?: string;
  clientPath?: string;
  baseUrl?: string;
}): string {
  const explicit = (raw?.relay || raw?.source || '').trim();
  const ignoreWorkbench =
    /^(none|null|direct|official|无|直连|官方|官方直连|antigravity|claude\s*code|codex\s*cli|gemini\s*cli|vscode)$/i;
  if (explicit && !ignoreWorkbench.test(explicit)) {
    return explicit.slice(0, 32);
  }

  const probe = `${raw?.clientPath || ''} ${raw?.baseUrl || ''}`.toLowerCase();
  if (!probe.trim()) return '';

  // Only infer genuine third-party relays, never official workbenches
  const patterns: Array<[RegExp, string]> = [
    [/workbuddy/, 'WorkBuddy'],
    [/openrouter/, 'OpenRouter'],
    [/siliconflow/, 'SiliconFlow'],
    [/one-?api|new-?api/, 'OneAPI'],
  ];
  for (const [re, label] of patterns) {
    if (re.test(probe)) return label;
  }
  return '';
}

export function formatDisplayName(modelName: string, relayName?: string): string {
  const base = modelName.trim();
  const relay = (relayName || '').trim();
  if (!relay) return base;
  if (base.includes(`(${relay})`) || base.includes(`（${relay}）`)) return base;
  return `${base} (${relay})`;
}

interface PendingDispatch {
  task: AgentTask;
  resolve: (content: string) => void;
  reject: (err: Error) => void;
  onLog?: (chunk: string) => void;
  onClaimed?: (via: 'wait' | 'pull' | 'progress' | 'bridge') => void;
  onUsage?: (usage: TokenUsage) => void;
  claimed?: boolean;
  timer: NodeJS.Timeout;
}

interface InternalAgent {
  info: ConnectedAgent;
  queue: AgentTask[];
  activeTask?: PendingDispatch;
  pendingDispatches: Map<string, PendingDispatch>;
}

const AGENT_COLORS = [
  '#d97706',
  '#2563eb',
  '#059669',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#ea580c',
];

export class AgentHub extends EventEmitter {
  private agents = new Map<string, InternalAgent>();
  private waiters = new Map<string, Set<(reason: 'task' | 'stop') => void>>();
  private colorCursor = 0;
  private hydrated = false;
  private bridgePollTimer: NodeJS.Timeout | null = null;

  getBridgeRootDir(): string {
    return path.resolve(
      process.env.CHATROOM_BRIDGE_DIR?.trim() || path.join(os.homedir(), 'chatroom-bridge'),
    );
  }

  getAgentBridgeDir(agentId: string): string {
    const safeId = agentId.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return path.join(this.getBridgeRootDir(), safeId);
  }

  private ensureAgentBridgeDirs(agentId: string): {
    baseDir: string;
    tasksDir: string;
    repliesDir: string;
    doneDir: string;
    stopFile: string;
  } {
    const baseDir = this.getAgentBridgeDir(agentId);
    const tasksDir = path.join(baseDir, 'tasks');
    const repliesDir = path.join(baseDir, 'replies');
    const doneDir = path.join(baseDir, 'done');
    const stopFile = path.join(baseDir, 'STOP');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(repliesDir, { recursive: true });
    fs.mkdirSync(doneDir, { recursive: true });

    const readmePath = path.join(baseDir, 'README.txt');
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(
        readmePath,
        [
          `Multi-Agent Chatroom File Bridge (${agentId})`,
          `==============================================`,
          `1. Read pending task JSON files in: tasks\\<taskId>.json`,
          `2. Write your answer to: replies\\<taskId>.json (format: {"taskId":"...","content":"Markdown"})`,
          `   or plain Markdown/text to: replies\\<taskId>.md`,
          `3. The chatroom watches replies\\ every <1s, submits your answer, and cleans up tasks\\<taskId>.json automatically.`,
          `4. If file STOP exists in this folder, stop standby/polling immediately.`,
        ].join('\r\n'),
        'utf8',
      );
    }
    return { baseDir, tasksDir, repliesDir, doneDir, stopFile };
  }

  private writeBridgeTaskFile(agentId: string, task: AgentTask): string {
    const { tasksDir, repliesDir, stopFile } = this.ensureAgentBridgeDirs(agentId);
    try {
      if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
    } catch {
      // ignore
    }
    const taskFile = path.join(tasksDir, `${task.taskId}.json`);
    const tmpFile = `${taskFile}.tmp`;
    const payload = {
      ...task,
      replyJsonPath: path.join(repliesDir, `${task.taskId}.json`),
      replyMdPath: path.join(repliesDir, `${task.taskId}.md`),
    };
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpFile, taskFile);
    this.ensureBridgePolling();
    return taskFile;
  }

  private removeBridgeTaskFile(agentId: string, taskId: string): void {
    try {
      const taskFile = path.join(this.getAgentBridgeDir(agentId), 'tasks', `${taskId}.json`);
      if (fs.existsSync(taskFile)) fs.unlinkSync(taskFile);
    } catch {
      // ignore
    }
  }

  private writeBridgeStopFlag(agentId: string): void {
    try {
      const { stopFile } = this.ensureAgentBridgeDirs(agentId);
      fs.writeFileSync(
        stopFile,
        JSON.stringify({ stopped: true, agentId, timestamp: new Date().toISOString() }, null, 2),
        'utf8',
      );
    } catch {
      // ignore
    }
  }

  private ensureBridgePolling(): void {
    if (this.bridgePollTimer) return;
    this.bridgePollTimer = setInterval(() => {
      this.scanBridgeReplies();
    }, 700);
    if (typeof this.bridgePollTimer.unref === 'function') {
      this.bridgePollTimer.unref();
    }
  }

  private scanBridgeReplies(): void {
    let anyActive = false;
    for (const [agentId, entry] of this.agents.entries()) {
      if (entry.pendingDispatches.size === 0) continue;
      anyActive = true;
      const { repliesDir, doneDir } = this.ensureAgentBridgeDirs(agentId);
      const latestJson = path.join(repliesDir, 'latest.json');
      const hasLatest = fs.existsSync(latestJson);

      for (const active of Array.from(entry.pendingDispatches.values())) {
        const taskId = active.task.taskId;
        const candidates = [
          path.join(repliesDir, `${taskId}.json`),
          path.join(repliesDir, `${taskId}.md`),
          path.join(repliesDir, `${taskId}.txt`),
        ];
        if (hasLatest) candidates.push(latestJson);

        for (const filePath of candidates) {
          if (!fs.existsSync(filePath)) continue;
          try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size === 0) continue;
            const raw = fs.readFileSync(filePath, 'utf8').trim();
            if (!raw) continue;

            let content = '';
            let parsedTaskId: string | undefined = taskId;
            let parsedUsage: Partial<TokenUsage> | undefined;
            if (filePath.endsWith('.json')) {
              try {
                const obj = JSON.parse(raw) as {
                  taskId?: string;
                  content?: string;
                  reply?: string;
                  message?: string;
                  text?: string;
                  usage?: Partial<TokenUsage>;
                };
                if (filePath === latestJson && obj.taskId && obj.taskId !== taskId) {
                  continue;
                }
                parsedTaskId = obj.taskId || taskId;
                content = (obj.content || obj.reply || obj.message || obj.text || '').trim();
                if (obj.usage && typeof obj.usage === 'object') {
                  parsedUsage = obj.usage;
                }
              } catch {
                continue;
              }
            } else {
              content = raw;
            }

            if (!content) continue;
            const archived = path.join(doneDir, `${taskId}-${Date.now()}${path.extname(filePath)}`);
            try {
              fs.renameSync(filePath, archived);
            } catch {
              try {
                fs.unlinkSync(filePath);
              } catch {
                // ignore
              }
            }
            entry.info.lastBridgeAt = new Date().toISOString();
            this.markClaimed(active, 'bridge');
            active.onLog?.(`[文件桥接回执] 已读取 ${path.basename(filePath)} 并自动提交到群聊。\n`);
            this.submitReply(agentId, { taskId: parsedTaskId, content, usage: parsedUsage });
            break;
          } catch {
            // ignore transient read lock
          }
        }
      }
    }

    if (!anyActive && this.bridgePollTimer) {
      clearInterval(this.bridgePollTimer);
      this.bridgePollTimer = null;
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const saved = loadSavedAgents();
    for (const item of saved) {
      if (!item?.id) continue;
      const { tasksDir } = this.ensureAgentBridgeDirs(item.id);
      // Clean stale task files left from prior server restarts so bridge agents don't waste tokens on dead tasks
      try {
        for (const f of fs.readdirSync(tasksDir)) {
          if (f.endsWith('.json')) fs.unlinkSync(path.join(tasksDir, f));
        }
      } catch {
        // ignore
      }
      const hasBridgeWatcher = fs.existsSync(path.join(this.getAgentBridgeDir(item.id), 'watch.py'));
      this.agents.set(item.id, {
        info: {
          ...item,
          trigger: item.trigger || { type: 'manual' },
          online: item.online !== false,
          busy: false,
          listening: false,
          lastBridgeAt: item.lastBridgeAt || (hasBridgeWatcher ? item.lastSeenAt : undefined),
          activeTaskId: undefined,
        },
        queue: [],
        pendingDispatches: new Map(),
      });
    }
  }

  private wakeWaiters(agentId: string, reason: 'task' | 'stop' = 'task'): void {
    const set = this.waiters.get(agentId);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      fn(reason);
    }
  }

  stopStandby(agentId: string): boolean {
    this.ensureHydrated();
    const has = this.isListening(agentId);
    this.writeBridgeStopFlag(agentId);
    this.wakeWaiters(agentId, 'stop');
    return has;
  }

  isListening(agentId: string): boolean {
    this.ensureHydrated();
    const set = this.waiters.get(agentId);
    return Boolean(set && set.size > 0);
  }

  getConnectionHint(agentId: string): 'listening' | 'reconnecting' | 'bridge' | 'auto' | 'manual' {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) return 'manual';
    if (this.isListening(agentId)) return 'listening';
    if (entry.info.trigger && entry.info.trigger.type !== 'manual') return 'auto';
    if (entry.info.lastListenAt) {
      const ageMs = Date.now() - new Date(entry.info.lastListenAt).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 120_000) {
        return 'reconnecting';
      }
    }
    if (entry.info.lastBridgeAt || fs.existsSync(path.join(this.getAgentBridgeDir(agentId), 'watch.py'))) {
      return 'bridge';
    }
    return 'manual';
  }

  private markClaimed(dispatch: PendingDispatch | undefined, via: 'wait' | 'pull' | 'progress' | 'bridge'): void {
    if (!dispatch || dispatch.claimed) return;
    dispatch.claimed = true;
    dispatch.onClaimed?.(via);
  }

  private persist(): void {
    saveAgentsList(Array.from(this.agents.values()).map((a) => ({ ...a.info })));
  }

  private slugifyId(name: string): string {
    const clean = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28);
    return `agent_${clean || crypto.randomBytes(3).toString('hex')}`;
  }

  private pickColor(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('claude')) return '#d97706';
    if (lower.includes('gemini')) return '#2563eb';
    if (lower.includes('codex') || lower.includes('gpt') || lower.includes('openai')) return '#059669';
    if (lower.includes('ollama') || lower.includes('qwen') || lower.includes('deepseek')) return '#7c3aed';
    const color = AGENT_COLORS[this.colorCursor % AGENT_COLORS.length];
    this.colorCursor++;
    return color;
  }

  private notify(): void {
    this.persist();
    this.emit('changed', this.listAgents());
  }

  listAgents(): ConnectedAgent[] {
    this.ensureHydrated();
    return Array.from(this.agents.values())
      .map((a) => ({ ...a.info }))
      .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  getAgent(agentId: string): ConnectedAgent | undefined {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    return entry ? { ...entry.info } : undefined;
  }

  isOnline(agentId: string): boolean {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    return Boolean(entry && entry.info.online);
  }

  join(params: {
    id?: string;
    name?: string;
    model?: string;
    relay?: string;
    source?: string;
    clientPath?: string;
    baseUrl?: string;
    trigger?: AgentTrigger;
    thinkingOptions?: ThinkingLevel[];
    role?: string;
    color?: string;
    roomId?: string;
  }): { agent: ConnectedAgent; isReconnect: boolean } {
    this.ensureHydrated();
    const rawModel = (params.model || params.name || '').trim().slice(0, 48) || '外部模型';
    const relayName = inferRelayName({
      relay: params.relay,
      source: params.source,
      clientPath: params.clientPath,
      baseUrl: params.baseUrl,
    });
    const displayName = formatDisplayName(rawModel, relayName);
    const id = params.id?.trim() || this.slugifyId(rawModel);
    const now = new Date().toISOString();
    const existing = this.agents.get(id);

    if (existing) {
      const effectiveModel = rawModel || existing.info.modelName || existing.info.name;
      const effectiveRelay = relayName || existing.info.relayName || '';
      existing.info.modelName = effectiveModel;
      existing.info.relayName = effectiveRelay || undefined;
      existing.info.name = formatDisplayName(effectiveModel, effectiveRelay);
      if (params.trigger) existing.info.trigger = params.trigger;
      if (params.thinkingOptions) existing.info.thinkingOptions = params.thinkingOptions;
      if (params.role !== undefined) existing.info.role = params.role.trim();
      if (params.color) existing.info.accentColor = params.color;
      if (params.roomId) existing.info.roomId = params.roomId;
      existing.info.online = true;
      existing.info.lastSeenAt = now;
      this.ensureAgentBridgeDirs(id);
      this.notify();
      return { agent: { ...existing.info }, isReconnect: true };
    }

    const info: ConnectedAgent = {
      id,
      name: displayName,
      modelName: rawModel,
      relayName: relayName || undefined,
      thinkingOptions: params.thinkingOptions,
      trigger: params.trigger || { type: 'manual' },
      role: params.role?.trim() || '按需协作模型',
      accentColor: params.color || this.pickColor(displayName),
      online: true,
      busy: false,
      roomId: params.roomId,
      joinedAt: now,
      lastSeenAt: now,
    };

    this.agents.set(id, {
      info,
      queue: [],
      pendingDispatches: new Map(),
    });
    this.ensureAgentBridgeDirs(id);
    this.notify();
    return { agent: { ...info }, isReconnect: false };
  }

  updateAgent(
    agentId: string,
    params: {
      displayName?: string;
      modelName?: string;
      relayName?: string;
      avatar?: string;
      accentColor?: string;
      online?: boolean;
      trigger?: AgentTrigger;
      thinkingLevel?: ThinkingLevel;
    },
  ): ConnectedAgent | null {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) return null;

    if (params.displayName !== undefined && params.displayName.trim()) {
      const customName = params.displayName.trim().slice(0, 48);
      entry.info.name = customName;
      if (params.modelName === undefined && params.relayName === undefined) {
        entry.info.modelName = customName;
        entry.info.relayName = undefined;
      }
    } else if (params.modelName !== undefined || params.relayName !== undefined) {
      const base =
        params.modelName?.trim() ||
        entry.info.modelName ||
        entry.info.name.replace(/\s*[（(][^）)]+[）)]\s*$/, '').trim();
      const relay = params.relayName !== undefined ? params.relayName.trim() : entry.info.relayName || '';
      entry.info.modelName = base;
      entry.info.relayName = relay || undefined;
      entry.info.name = formatDisplayName(base, relay);
    }

    if (params.avatar !== undefined) {
      entry.info.avatar = params.avatar.trim() || undefined;
    }
    if (params.accentColor !== undefined && params.accentColor.trim()) {
      entry.info.accentColor = params.accentColor.trim();
    }
    if (params.online !== undefined) {
      entry.info.online = params.online;
      if (!params.online) {
        this.rejectAllPending(entry, `成员「${entry.info.name}」已设为离线`);
      } else {
        entry.info.lastSeenAt = new Date().toISOString();
      }
    }
    if (params.trigger) {
      entry.info.trigger = params.trigger;
    }
    if (params.thinkingLevel !== undefined) {
      entry.info.thinkingLevel = params.thinkingLevel;
    }
    this.notify();
    return { ...entry.info };
  }

  leave(agentId: string): boolean {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    entry.info.online = false;
    this.rejectAllPending(entry, `成员「${entry.info.name}」已退出聊天室`);
    this.notify();
    return true;
  }

  // Reject every pending dispatch (not only the active one) so no task is left hanging until timeout
  private rejectAllPending(entry: InternalAgent, message: string): void {
    const pending = Array.from(entry.pendingDispatches.values());
    if (entry.activeTask && !entry.pendingDispatches.has(entry.activeTask.task.taskId)) {
      pending.push(entry.activeTask);
    }
    for (const dispatch of pending) {
      clearTimeout(dispatch.timer);
      dispatch.reject(new Error(message));
    }
    entry.pendingDispatches.clear();
    entry.activeTask = undefined;
    entry.queue = [];
    entry.info.busy = false;
    entry.info.activeTaskId = undefined;
  }

  remove(agentId: string): boolean {
    this.ensureHydrated();
    this.leave(agentId);
    const deleted = this.agents.delete(agentId);
    if (deleted) this.notify();
    return deleted;
  }

  buildWakePrompt(agentId: string, baseUrl = 'http://127.0.0.1:4310'): string {
    return `请到聊天室领取当前待办任务并完成回复（做完直接结束，不要轮询）：优先运行本机命令 \`chatroom pull ${agentId} --json\` 读取任务，完成后用 \`chatroom reply --agent ${agentId} --stdin\` 提交回复（若未安装 chatroom 命令则回退调用 GET ${baseUrl}/api/agent/${agentId}/pull 与 POST ${baseUrl}/api/agent/${agentId}/reply）。`;
  }

  async dispatchTask(
    agentId: string,
    payload: Omit<AgentTask, 'taskId' | 'agentId' | 'createdAt'>,
    options?: {
      timeoutSec?: number;
      signal?: AbortSignal;
      onLog?: (chunk: string) => void;
      onClaimed?: (via: 'wait' | 'pull' | 'progress' | 'bridge') => void;
      onUsage?: (usage: TokenUsage) => void;
    },
  ): Promise<string> {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) {
      throw new Error(`未找到已接入成员：${agentId}`);
    }

    const trigger = entry.info.trigger || { type: 'manual' };
    const thinkingLevel = entry.info.thinkingLevel || 'default';
    const thinkingHintMap: Record<ThinkingLevel, string> = {
      default: '',
      off: '\n\n【思考模式：关闭思考】请直接给出简洁结果，不要展开冗长推理。',
      on: '\n\n【思考模式：开启深度思考】请先充分推理分析再给出结论。',
      minimal: '\n\n【思考深度：Minimal】请极简快速直答。',
      low: '\n\n【思考深度：Low】请快速简洁作答，不做过多推演。',
      medium: '\n\n【思考深度：Medium】请保持平衡的推理深度与效率。',
      high: '\n\n【思考深度：High】请充分分析边界条件、潜在风险后再作答。',
      xhigh: '\n\n【思考深度：XHigh】请进行高强度多角度深度推演与校验。',
      max: '\n\n【思考深度：Max】请做最全面彻底的深度推理与严格验证。',
    };
    const promptWithThinking =
      thinkingHintMap[thinkingLevel]
        ? `${payload.prompt}${thinkingHintMap[thinkingLevel]}`
        : payload.prompt;

    const task: AgentTask = {
      taskId: `task_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      agentId,
      createdAt: new Date().toISOString(),
      ...payload,
      thinkingLevel,
      prompt: promptWithThinking,
    };

    // Mode 1: Auto-launch registered CLI command on demand (zero idle polling!)
    if (trigger.type === 'cli' && trigger.command) {
      entry.info.busy = true;
      entry.info.activeTaskId = task.taskId;
      this.notify();
      try {
        options?.onLog?.(`[按需启动] 正在拉起本地命令：${trigger.command}\n`);
        const fullPrompt = payload.recentHistory
          ? `【最近群聊上下文】\n${payload.recentHistory}\n\n【当前任务】\n${payload.prompt}`
          : payload.prompt;
        const fakeProvider: ProviderConfig = {
          id: entry.info.id,
          name: entry.info.name,
          shortName: entry.info.name,
          thinkingLevel,
          accentColor: entry.info.accentColor,
          subscriptionHint: '',
          command: trigger.command,
          args: trigger.args || [],
          inputMode: trigger.inputMode || 'stdin',
          installCmd: '',
          loginCmd: '',
          docsHint: '',
          timeoutSec: options?.timeoutSec ?? 360,
        };
        const res = await runProviderCli(fakeProvider, fullPrompt, {
          cwd: payload.repoPath,
          signal: options?.signal,
          onLog: options?.onLog,
        });
        entry.info.lastSeenAt = new Date().toISOString();
        return res.output;
      } finally {
        entry.info.busy = false;
        entry.info.activeTaskId = undefined;
        this.notify();
      }
    }

    // Mode 2: Auto-trigger registered local Webhook on demand (zero idle polling!)
    if (trigger.type === 'webhook' && trigger.url) {
      entry.info.busy = true;
      entry.info.activeTaskId = task.taskId;
      this.notify();
      try {
        options?.onLog?.(`[按需启动] 正在回调 Webhook：${trigger.url}\n`);
        const res = await fetch(trigger.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task),
          signal: options?.signal,
        });
        if (!res.ok) {
          throw new Error(`Webhook 返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
        }
        const data = (await res.json()) as { content?: string; reply?: string; output?: string };
        entry.info.lastSeenAt = new Date().toISOString();
        return (data.content || data.reply || data.output || '').trim() || '（Webhook 返回空内容）';
      } finally {
        entry.info.busy = false;
        entry.info.activeTaskId = undefined;
        this.notify();
      }
    }

    // Mode 3: On-demand manual wake (for GUI chat agents like WorkBuddy / Cursor / Antigravity)
    // Task is queued cleanly without requiring any background polling!
    const timeoutMs = Math.max(120, options?.timeoutSec ?? 1800) * 1000;

    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        entry.pendingDispatches.delete(task.taskId);
        entry.queue = entry.queue.filter((t) => t.taskId !== task.taskId);
        this.removeBridgeTaskFile(agentId, task.taskId);
        // FIFO: the oldest still-pending task becomes the active one (Map keeps insertion order)
        const nextRemaining = entry.pendingDispatches.values().next().value;
        entry.activeTask = nextRemaining;
        entry.info.busy = entry.pendingDispatches.size > 0;
        entry.info.activeTaskId = nextRemaining?.task.taskId;
        options?.signal?.removeEventListener('abort', onAbort);
        this.notify();
      };

      const timer = setTimeout(() => {
        cleanup();
        entry.queue = entry.queue.filter((t) => t.taskId !== task.taskId);
        reject(new Error(`任务已超时取消（等待按需唤醒超过 ${Math.round(timeoutMs / 60000)} 分钟）`));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        entry.queue = entry.queue.filter((t) => t.taskId !== task.taskId);
        reject(new Error('用户手动终止了当前任务'));
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const dispatch: PendingDispatch = {
        task,
        resolve: (content: string) => {
          clearTimeout(timer);
          cleanup();
          resolve(content);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          cleanup();
          reject(err);
        },
        onLog: options?.onLog,
        onClaimed: options?.onClaimed,
        onUsage: options?.onUsage,
        claimed: false,
        timer,
      };

      entry.pendingDispatches.set(task.taskId, dispatch);
      // FIFO: keep serving the oldest pending task first; a new task only becomes active when none is pending
      if (!entry.activeTask) entry.activeTask = dispatch;
      entry.queue.push(task);
      entry.info.busy = true;
      entry.info.activeTaskId = entry.activeTask.task.taskId;
      const taskFilePath = this.writeBridgeTaskFile(agentId, task);
      const hasListener = this.isListening(agentId);
      options?.onLog?.(
        hasListener
          ? `[实时监听直达] 任务 ${task.taskId} 已毫秒级推送给正在零耗待命的「${entry.info.name}」（同步写入桥接文件 ${taskFilePath}）。\n`
          : `[按需待唤醒] 任务 ${task.taskId} 已就绪（已同步写入文件桥接 ${taskFilePath}），支持 HTTP/CLI 或目录读写回执。\n`,
      );
      this.notify();
      this.wakeWaiters(agentId);
    });
  }

  // Zero-token, zero-CPU blocking long-poll: waits on EventEmitter until a task arrives, user stops standby, or timeout expires
  async waitForTask(
    agentId: string,
    timeoutSec = 240,
    signal?: AbortSignal,
  ): Promise<{ task: AgentTask | null; timeout: boolean; stopped?: boolean }> {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) {
      throw new Error('Agent 未注册，请先调用 chatroom join 或 POST /api/agent/join');
    }

    const nowIso = new Date().toISOString();
    entry.info.online = true;
    entry.info.lastSeenAt = nowIso;
    entry.info.lastListenAt = nowIso;

    const immediate = entry.activeTask?.task || entry.queue[0] || null;
    if (immediate) {
      const dispatch = entry.pendingDispatches.get(immediate.taskId) || entry.activeTask;
      this.markClaimed(dispatch, 'wait');
      this.notify();
      return { task: immediate, timeout: false, stopped: false };
    }

    const waitMs = Math.min(3600, Math.max(5, Math.round(timeoutSec))) * 1000;

    return new Promise((resolve) => {
      let settled = false;
      let set = this.waiters.get(agentId);
      if (!set) {
        set = new Set();
        this.waiters.set(agentId, set);
      }

      const finish = (task: AgentTask | null, timeout: boolean, stopped = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        set!.delete(onWake);
        if (set!.size === 0) {
          this.waiters.delete(agentId);
          entry.info.listening = false;
          this.notify();
        }
        resolve({ task, timeout, stopped });
      };

      const onWake = (reason: 'task' | 'stop') => {
        if (reason === 'stop') {
          finish(null, false, true);
          return;
        }
        const nextTask = entry.activeTask?.task || entry.queue[0] || null;
        if (nextTask) {
          const ts = new Date().toISOString();
          entry.info.lastSeenAt = ts;
          entry.info.lastListenAt = ts;
          const dispatch = entry.pendingDispatches.get(nextTask.taskId) || entry.activeTask;
          this.markClaimed(dispatch, 'wait');
          finish(nextTask, false, false);
        }
      };

      const onAbort = () => finish(null, true, false);
      const timer = setTimeout(() => {
        const ts = new Date().toISOString();
        entry.info.lastSeenAt = ts;
        entry.info.lastListenAt = ts;
        finish(null, true, false);
      }, waitMs);

      if (signal) {
        if (signal.aborted) {
          finish(null, true, false);
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      set.add(onWake);
      entry.info.listening = true;
      this.notify();
    });
  }

  // Instant non-blocking pull (ZERO waiting / ZERO polling!)
  pullPendingTask(agentId: string): AgentTask | null {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) {
      throw new Error('Agent 未注册，请先调用 POST /api/agent/join');
    }
    entry.info.online = true;
    entry.info.lastSeenAt = new Date().toISOString();
    this.notify();

    if (entry.activeTask) {
      this.markClaimed(entry.activeTask, 'pull');
      return entry.activeTask.task;
    }
    const next = entry.queue[0] || null;
    if (next) {
      this.markClaimed(entry.pendingDispatches.get(next.taskId), 'pull');
    }
    return next;
  }

  reportProgress(agentId: string, message: string): boolean {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    entry.info.online = true;
    entry.info.lastSeenAt = new Date().toISOString();
    if (entry.activeTask) {
      this.markClaimed(entry.activeTask, 'progress');
    }
    if (entry.activeTask?.onLog && message.trim()) {
      entry.activeTask.onLog(`[${entry.info.name}] ${message.trim()}\n`);
    }
    return true;
  }

  submitReply(
    agentId: string,
    params: {
      taskId?: string;
      content: string;
      usage?: Partial<TokenUsage> & {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      };
    },
  ): boolean {
    this.ensureHydrated();
    const entry = this.agents.get(agentId);
    if (!entry) {
      throw new Error(`未找到已接入成员：${agentId}`);
    }
    entry.info.online = true;
    entry.info.lastSeenAt = new Date().toISOString();

    const active = params.taskId
      ? entry.pendingDispatches.get(params.taskId) || (entry.activeTask?.task.taskId === params.taskId ? entry.activeTask : undefined)
      : entry.activeTask || Array.from(entry.pendingDispatches.values())[0];
    if (!active) {
      return false;
    }
    const finalContent = params.content.trim() || '（空回复）';
    if (params.usage && active.onUsage) {
      const normalized = normalizeTokenUsage(
        params.usage,
        {
          inputText: `${active.task.recentHistory || ''}\n${active.task.prompt || ''}`,
          outputText: finalContent,
        },
        'agent',
      );
      active.onUsage(normalized);
    }
    entry.queue = entry.queue.filter((t) => t.taskId !== active.task.taskId);
    this.removeBridgeTaskFile(agentId, active.task.taskId);
    active.resolve(finalContent);
    return true;
  }

  buildGuideText(baseUrl: string, roomId?: string): string {
    const roomHint = roomId || '';
    return `# 本地多模型公共聊天室 Agent 按需接入协议（零轮询）

聊天室本地地址：${baseUrl}
${roomHint ? `目标房间 ID：${roomHint}` : '（未指定房间时自动接入当前活跃房间）'}

## 推荐方式：直接使用本机 \`chatroom\` CLI（CLI-Anything 风格，极简无转义烦恼）
本机已提供 \`chatroom\` 命令行工具（运行 \`chatroom --help\` 或访问 \`GET ${baseUrl}/api/agent/skill\` 查看完整 \`SKILL.md\`）：
- 一次入群：\`chatroom join --model "<你的真实模型名>" --json\`（自动探测本机 CLI 并记住 ID）
- 按需拉取任务：\`chatroom pull --json\`
- 提交回复：\`chatroom reply --stdin --json\`（或 \`chatroom reply "回复内容" --json\`）

## 核心原则：严禁死循环轮询等待！
- 本聊天室采用 **「一次注册 → 立刻结束待命 → 需要时按需启动」** 模式。
- 完成注册后，请**立刻结束本轮对话**，不要写任何 while/sleep 轮询循环。

## 身份自动识别规则（优先具体模型名，不要用工作台名，严禁反问用户）
1. **\`model\`（必填）**：直接填你当前运行的**具体模型名**（如 \`Claude Opus 5.5\`、\`DeepSeek-V4.1-Flash\`、\`Gemini 4 Neon\`、\`GPT-5.2\`），不要填 \`Claude Code\`、\`Antigravity\` 这类工作台名。
2. **\`relay\`（仅走第三方中转时填写，官方直连或官方工作台留空 \`""\`）**：
   - 仅当通过第三方中转站/跨厂商中转接入时（如 \`WorkBuddy\`、\`OpenRouter\`、\`SiliconFlow\`、\`OneAPI\`）才填中转名；
   - 官方工作台（如 \`Antigravity\`、\`Claude Code\`、\`Codex CLI\`、\`Gemini CLI\`）留空 \`""\`，最终直接显示纯模型名；走中转时显示为 \`模型名 (中转名)\`。
3. **\`trigger\`（重点：先自检你有没有官方 CLI，再按聊天室启动规范绑定！）**：
   - 聊天室支持 3 种启动模式，按优先级依次自检并实测验证：
     - **优先 A（本机无头 CLI — 推荐，免手动唤醒）**：
       先运行 \`where\`（Windows）或 \`which\`（macOS/Linux）检测你对应的官方 CLI 或当前宿主自带的官方文档化无头 CLI（如 \`claude -p\`、\`gemini -p -\`、\`codex exec -\`、\`ollama run <model>\`、\`agy\` 等），并确认支持非交互标准输入（stdin）或命令行参数执行。
       验证通过后填：\`"trigger": { "type": "cli", "command": "<可执行命令或绝对路径>", "args": ["..."], "inputMode": "stdin" }\`
     - **优先 B（本地 Webhook / HTTP 回调）**：
       若你所在工作台有官方文档化的本地 HTTP 触发地址，则填：\`"trigger": { "type": "webhook", "url": "http://127.0.0.1:..." }\`
     - **兜底 C（纯对话框无入口）**：
       若你所在客户端确实没有官方 CLI 也没有本地 Webhook，如实填 \`"trigger": { "type": "manual" }\`，并在注册完成回复中明确告知用户原因（以及可选的官方 CLI 或 API 直连建议）。
   - **安全红线**：切勿编造不存在的命令，也切勿逆向/探测第三方软件未公开的私有接口或模拟键鼠点击。
   - **服务端兜底探测**：即使你传了 \`manual\` 或省略 \`trigger\`，\`POST ${baseUrl}/api/agent/join\` 也会自动在本机再探测一次与你模型系列匹配的官方 CLI 并自动绑定。

## 第 1 步：一次性注册入群并配置启动方式（POST ${baseUrl}/api/agent/join）
发送 JSON：
\`\`\`json
{
  "model": "<你的真实模型名>",
  "relay": "<若为中转/客户端则填名称，官方直连留空>",
  "clientPath": "<当前运行路径，便于自动识别中转>",
  "trigger": { "type": "cli", "command": "...", "args": ["..."], "inputMode": "stdin" },
  "roomId": "${roomHint}"
}
\`\`\`
（若确实无 CLI/Webhook，将 \`trigger\` 改为 \`{ "type": "manual" }\`。）
注册成功后记住返回的 \`agent.id\`（如 \`agent_xxx\`），然后**直接回复用户「已入群并配置好启动方式，待命中」并立刻结束本轮，严禁轮询！**

## 第 2 步：以后被按需唤醒时（仅在用户发唤醒指令时执行一次）
1. 请求一次 \`GET ${baseUrl}/api/agent/{AGENT_ID}/pull\` 立即获取当前待办任务（非阻塞，不等待）；
2. 结合 \`repoPath\`、\`recentHistory\` 与 \`prompt\` 完成任务；
3. 调用 \`POST ${baseUrl}/api/agent/{AGENT_ID}/reply\` 发送 \`{ "taskId": "...", "content": "Markdown回复" }\`；
4. 提交成功后**直接结束本轮，不要继续轮询**。
`;
  }
}

export const agentHub = new AgentHub();
