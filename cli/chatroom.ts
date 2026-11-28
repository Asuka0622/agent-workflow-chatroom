import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AgentTask,
  AgentTrigger,
  ChatAttachment,
  ConnectedAgent,
  ProviderConfig,
  ProviderHealth,
  ThinkingLevel,
  WorkbenchConfig,
  WorkflowRun,
} from '../shared/types.js';

interface CliSessionState {
  lastAgentId?: string;
  lastRoomId?: string;
  baseUrl?: string;
}

const SESSION_FILE = path.join(os.homedir(), '.chatroom-cli.json');

function loadSession(): CliSessionState {
  try {
    if (!fs.existsSync(SESSION_FILE)) return {};
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as CliSessionState;
  } catch {
    return {};
  }
}

function saveSession(patch: Partial<CliSessionState>): void {
  const next = { ...loadSession(), ...patch };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(next, null, 2), 'utf8');
}

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq >= 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (token === '-h') {
      flags.help = true;
    } else if (token === '-j') {
      flags.json = true;
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

function strFlag(flags: Record<string, string | boolean>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function boolFlag(flags: Record<string, string | boolean>, ...names: string[]): boolean {
  for (const n of names) {
    if (flags[n] === true || flags[n] === 'true') return true;
  }
  return false;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function apiReq<T>(baseUrl: string, apiPath: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${apiPath}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      ...init,
    });
  } catch (err) {
    throw new Error(
      `无法连接本地聊天室服务 (${baseUrl})，请确认桌面端「多模型协作室」已启动。(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { text };
  }
  if (!res.ok) {
    const msg = (parsed as { error?: string })?.error || `HTTP ${res.status}: ${text.slice(0, 200)}`;
    throw new Error(msg);
  }
  return parsed as T;
}

function printOutput(data: unknown, asJson: boolean, humanPrinter: () => void): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    humanPrinter();
  }
}

function printHelp(): void {
  console.log(`chatroom — 本地多模型协作聊天室 CLI Harness (CLI-Anything 风格)

用法:
  chatroom <command> [options]

核心命令:
  status                         查看服务健康度、当前房间与全员在线/空闲/工作状态
  members                        列出所有已接入成员（外部 Agent 与本地订阅/API 模型）
  rooms                          列出所有协作会话房间
  room new <title>               新建协作会话 [--cwd <dir>] [--mode mock|real]
  history [--limit 15]           查看最近群聊记录 [--room <roomId>]

Agent 零轮询协作命令:
  join --model <name>            一次性注册入群并自动尝试绑定本机 CLI
                                 [--id <id>] [--relay <name>] [--avatar <emoji>]
                                 [--color <hex>] [--cli <cmd>] [--args "..."]
                                 [--webhook <url>] [--thinking <level>]
  pull [agentId]                 立即拉取当前待办任务（非阻塞、零轮询；省略 ID 使用上次入群 ID）
  wait [agentId] [--timeout 240] 零 token 长连接待命（默认每 25s 发保活心跳防终端断连，--heartbeat <s>）
  stop-wait [agentId]            远程通知正在待命的 Agent 立即退出等待
  reply [content]                提交任务回复 [--agent <id>] [--task <taskId>] [--file <path>] [--stdin]
  detect-cli <agentId>           探测并自动绑定该成员对应的本机官方 CLI
  mcp                            以标准 Stdio MCP Server 桥接模式运行（供 Claude Desktop / Cursor 挂载）

发消息与成员管理:
  send <message>                 发送群聊消息或启动板块流程
                                 [--to <id1,id2>] [--room <id>] [--workflow]
                                 [--mode mock|real] [--attach <path1,path2>]
  rename <memberId>              修改成员昵称、头像、思考深度或上下线状态
                                 [--name <n>] [--avatar <a|clear>] [--color <hex>]
                                 [--thinking <level>] [--online | --offline]

工作台扩展 (Skills / MCP / 资料库):
  workbench                      查看工作台全部扩展概览
  skill list                     列出所有技能 Skills
  skill add <name> --prompt <p>  新建技能 [--trigger /cmd] [--auto]
  plugin list                    列出所有插件 / MCP
  plugin test <pluginId>         测试或运行指定插件 / MCP
  kb list                        列出全局资料库
  kb add <title> --file <path>   将本地文件或文本添加到全局资料库 [--content <text>]
  export [--out <file.md>]       导出当前会话完整 Markdown 报告
  skill-doc                      输出给 AI Agent 阅读的 SKILL.md 文档

全局选项:
  --json, -j                     输出严格结构化 JSON（供 AI Agent 解析）
  --url <http://127.0.0.1:4310>  指定聊天室地址（默认读取 CHATROOM_URL）
  --help, -h                     显示帮助信息
`);
}

async function resolveActiveRoomId(baseUrl: string, explicitRoom?: string): Promise<string> {
  if (explicitRoom) return explicitRoom;
  const { runs } = await apiReq<{ runs: WorkflowRun[] }>(baseUrl, '/api/runs');
  if (runs.length === 0) throw new Error('当前没有任何聊天室会话，请先运行 chatroom room new "新会话"');
  return runs[0].id;
}

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const asJson = boolFlag(flags, 'json');
  const session = loadSession();
  const baseUrl =
    strFlag(flags, 'url') ||
    process.env.CHATROOM_URL ||
    session.baseUrl ||
    'http://127.0.0.1:4310';

  const cmd = positionals[0];
  if (!cmd || cmd === 'help' || boolFlag(flags, 'help')) {
    printHelp();
    return;
  }

  // 1. status
  if (cmd === 'status') {
    const [health, agentsRes, provRes, healthRes, runsRes] = await Promise.all([
      apiReq<{ ok: boolean; host: string; port: number; cwd: string; dataDir: string }>(baseUrl, '/api/health'),
      apiReq<{ agents: ConnectedAgent[] }>(baseUrl, '/api/agents'),
      apiReq<{ providers: ProviderConfig[] }>(baseUrl, '/api/providers'),
      apiReq<{ health: ProviderHealth[] }>(baseUrl, '/api/providers/check', { method: 'POST' }),
      apiReq<{ runs: WorkflowRun[] }>(baseUrl, '/api/runs'),
    ]);

    const healthMap = new Map(healthRes.health.map((h) => [h.id, h]));
    const readyProviders = provRes.providers.filter((p) => {
      if (p.connectionType && p.connectionType !== 'cli') {
        return Boolean(p.apiKey?.trim() && p.model?.trim());
      }
      if (p.id === 'custom' && p.command.toLowerCase() === 'powershell') return false;
      return Boolean(healthMap.get(p.id)?.installed);
    });

    const activeRoom = runsRes.runs[0] || null;
    const busyIds = new Set<string>();
    for (const a of agentsRes.agents) {
      if (a.online && a.busy) busyIds.add(a.id);
    }
    for (const m of activeRoom?.messages || []) {
      if (m.role === 'assistant' && m.status === 'streaming') busyIds.add(m.senderId);
    }

    const members = [
      ...agentsRes.agents.map((a) => ({
        id: a.id,
        name: a.name,
        avatar: a.avatar || '',
        kind: 'agent' as const,
        status: !a.online ? 'offline' : busyIds.has(a.id) ? 'working' : 'idle',
        thinkingLevel: a.thinkingLevel || 'default',
        trigger: a.trigger?.type || 'manual',
      })),
      ...readyProviders.map((p) => ({
        id: p.id,
        name: p.shortName,
        avatar: p.avatar || '',
        kind: 'provider' as const,
        status: p.offline ? 'offline' : busyIds.has(p.id) ? 'working' : 'idle',
        thinkingLevel: p.thinkingLevel || 'default',
        trigger: p.connectionType && p.connectionType !== 'cli' ? p.connectionType : `cli:${p.command}`,
      })),
    ];

    const summary = {
      ok: health.ok,
      baseUrl,
      dataDir: health.dataDir,
      activeRoom: activeRoom
        ? { id: activeRoom.id, title: activeRoom.title, status: activeRoom.status, messages: activeRoom.messages?.length || 0 }
        : null,
      counts: {
        online: members.filter((m) => m.status !== 'offline').length,
        working: members.filter((m) => m.status === 'working').length,
        idle: members.filter((m) => m.status === 'idle').length,
        offline: members.filter((m) => m.status === 'offline').length,
      },
      members,
    };

    printOutput(summary, asJson, () => {
      console.log(`聊天室服务: ${baseUrl} (在线)`);
      if (summary.activeRoom) {
        console.log(`当前会话:   ${summary.activeRoom.title} [${summary.activeRoom.id}] (${summary.activeRoom.messages} 条消息)`);
      }
      console.log(
        `成员状态:   ${summary.counts.online} 在线 (${summary.counts.working} 工作中 / ${summary.counts.idle} 空闲) · ${summary.counts.offline} 离线\n`,
      );
      for (const m of members) {
        const icon = m.status === 'working' ? '🔵 工作中' : m.status === 'idle' ? '🟢 空闲  ' : '⚪ 离线  ';
        const av = m.avatar ? `${m.avatar} ` : '';
        console.log(`  ${icon}  ${av}${m.name}  (${m.id})  [思考:${m.thinkingLevel}] [${m.trigger}]`);
      }
    });
    return;
  }

  // 2. members
  if (cmd === 'members') {
    const [agentsRes, provRes, healthRes] = await Promise.all([
      apiReq<{ agents: ConnectedAgent[] }>(baseUrl, '/api/agents'),
      apiReq<{ providers: ProviderConfig[] }>(baseUrl, '/api/providers'),
      apiReq<{ health: ProviderHealth[] }>(baseUrl, '/api/providers/check', { method: 'POST' }),
    ]);
    const healthMap = new Map(healthRes.health.map((h) => [h.id, h]));
    const providers = provRes.providers.filter((p) => {
      if (p.connectionType && p.connectionType !== 'cli') return Boolean(p.apiKey?.trim() && p.model?.trim());
      if (p.id === 'custom' && p.command.toLowerCase() === 'powershell') return false;
      return Boolean(healthMap.get(p.id)?.installed);
    });
    const payload = { agents: agentsRes.agents, providers };
    printOutput(payload, asJson, () => {
      console.log('外部接入成员:');
      for (const a of agentsRes.agents) {
        console.log(`  - ${a.avatar ? `${a.avatar} ` : ''}${a.name} (${a.id}) · ${!a.online ? '离线' : a.busy ? '工作中' : '空闲'} · trigger=${a.trigger?.type || 'manual'}`);
      }
      console.log('\n本机订阅 / API 模型:');
      for (const p of providers) {
        console.log(`  - ${p.avatar ? `${p.avatar} ` : ''}${p.shortName} (${p.id}) · ${p.offline ? '离线' : '空闲'} · ${p.command}${p.model ? ` (${p.model})` : ''}`);
      }
    });
    return;
  }

  // 3. rooms / room new
  if (cmd === 'rooms') {
    const { runs } = await apiReq<{ runs: WorkflowRun[] }>(baseUrl, '/api/runs');
    const items = runs.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      repoPath: r.repoPath,
      messages: r.messages?.length || 0,
      updatedAt: r.updatedAt,
    }));
    printOutput({ rooms: items }, asJson, () => {
      for (const r of items) {
        console.log(`  - ${r.id}  ${r.title}  [${r.status}]  (${r.messages} 条消息)  ${r.repoPath}`);
      }
    });
    return;
  }

  if (cmd === 'room' && positionals[1] === 'new') {
    const title = positionals.slice(2).join(' ').trim() || strFlag(flags, 'title') || '新协作会话';
    const cwd = strFlag(flags, 'cwd') || process.cwd();
    const executionMode = strFlag(flags, 'mode') === 'real' ? 'real' : 'mock';
    const res = await apiReq<{ run: WorkflowRun }>(baseUrl, '/api/runs', {
      method: 'POST',
      body: JSON.stringify({ title, repoPath: cwd, executionMode, startWorkflow: false }),
    });
    saveSession({ lastRoomId: res.run.id, baseUrl });
    printOutput(res, asJson, () => {
      console.log(`已新建会话: ${res.run.title} (${res.run.id})`);
    });
    return;
  }

  // 4. join
  if (cmd === 'join') {
    const model = strFlag(flags, 'model', 'name') || positionals[1];
    if (!model) throw new Error('请指定 --model <模型名>，例如：chatroom join --model "DeepSeek-V4.1-Flash"');
    const id = strFlag(flags, 'id');
    const relay = strFlag(flags, 'relay');
    const role = strFlag(flags, 'role');
    const color = strFlag(flags, 'color');
    const roomId = strFlag(flags, 'room');
    const cliCmd = strFlag(flags, 'cli');
    const cliArgs = strFlag(flags, 'args');
    const webhookUrl = strFlag(flags, 'webhook');

    let trigger: AgentTrigger | undefined;
    if (cliCmd) {
      trigger = {
        type: 'cli',
        command: cliCmd,
        args: cliArgs ? cliArgs.split(/\s+/).filter(Boolean) : [],
        inputMode: 'stdin',
      };
    } else if (webhookUrl) {
      trigger = { type: 'webhook', url: webhookUrl };
    }

    const res = await apiReq<{
      ok: boolean;
      agent: ConnectedAgent;
      roomId: string;
      autoCliDetected?: boolean;
      note?: string;
    }>(baseUrl, '/api/agent/join', {
      method: 'POST',
      body: JSON.stringify({
        id,
        model,
        relay: relay ?? '',
        role,
        color,
        roomId,
        trigger,
      }),
    });

    const avatar = strFlag(flags, 'avatar');
    const thinking = strFlag(flags, 'thinking') as ThinkingLevel | undefined;
    let finalAgent = res.agent;
    if (avatar || thinking) {
      const patched = await apiReq<{ agent: ConnectedAgent }>(
        baseUrl,
        `/api/agents/${encodeURIComponent(res.agent.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ avatar, thinkingLevel: thinking }),
        },
      );
      finalAgent = patched.agent;
    }

    saveSession({ lastAgentId: finalAgent.id, lastRoomId: res.roomId || session.lastRoomId, baseUrl });

    printOutput({ ...res, agent: finalAgent }, asJson, () => {
      console.log(`已入群: ${finalAgent.avatar ? `${finalAgent.avatar} ` : ''}${finalAgent.name} (${finalAgent.id})`);
      console.log(`启动方式: ${finalAgent.trigger?.type === 'cli' ? `⚡ 自动拉起 CLI (${finalAgent.trigger.command})` : finalAgent.trigger?.type === 'webhook' ? '⚡ Webhook' : '按需唤醒（零轮询）'}`);
      if (res.note) console.log(res.note);
    });
    return;
  }

  // 5. pull (zero-polling instant pull)
  if (cmd === 'pull') {
    const agentId = positionals[1] || strFlag(flags, 'agent', 'id') || session.lastAgentId;
    if (!agentId) throw new Error('请指定 agentId（或先运行 chatroom join 自动记住当前 ID）');
    const res = await apiReq<{ task: AgentTask | null }>(
      baseUrl,
      `/api/agent/${encodeURIComponent(agentId)}/pull`,
    );
    printOutput(res, asJson, () => {
      if (!res.task) {
        console.log(`(${agentId}) 当前暂无待办任务（零轮询，请直接结束本轮）。`);
        return;
      }
      console.log(`Task ID:  ${res.task.taskId}`);
      console.log(`Room ID:  ${res.task.roomId}`);
      console.log(`目录:     ${res.task.repoPath}`);
      if (res.task.thinkingLevel && res.task.thinkingLevel !== 'default') {
        console.log(`思考深度: ${res.task.thinkingLevel}`);
      }
      if (res.task.recentHistory) {
        console.log(`\n--- 最近群聊上下文 ---\n${res.task.recentHistory}`);
      }
      console.log(`\n--- 当前任务 ---\n${res.task.prompt}`);
    });
    return;
  }

  // 5b. wait (zero-token blocking long-poll with periodic stderr heartbeat keep-alive + auto-reconnect on server restart!)
  if (cmd === 'wait') {
    const agentId = positionals[1] || strFlag(flags, 'agent', 'id') || session.lastAgentId;
    if (!agentId) throw new Error('请指定 agentId（例如：chatroom wait agent_deepseek-v4-1-flash --timeout 240 --json）');
    const timeoutSec = Math.min(3600, Math.max(5, Number(strFlag(flags, 'timeout')) || 1800));
    const heartbeatSec = Math.min(120, Math.max(2, Number(strFlag(flags, 'heartbeat')) || 15));
    const quiet = boolFlag(flags, 'quiet');
    const startWallMs = Date.now();
    const deadlineMs = startWallMs + timeoutSec * 1000;

    let finalPayload: {
      task: AgentTask | null;
      timeout: boolean;
      stopped?: boolean;
      keepStandby?: boolean;
      action?: string;
    } = { task: null, timeout: true, keepStandby: true, action: 'continue_wait' };

    let gotDone = false;
    let announcedReady = false;

    while (!gotDone && Date.now() < deadlineMs) {
      const remainingSec = Math.max(5, Math.ceil((deadlineMs - Date.now()) / 1000));
      const url = `${baseUrl.replace(/\/+$/, '')}/api/agent/${encodeURIComponent(agentId)}/wait?timeout=${remainingSec}&stream=1&heartbeat=${heartbeatSec}`;

      try {
        const res = await fetch(url);
        if (!res.ok || !res.body) {
          const errText = (await res.text().catch(() => '')).slice(0, 200);
          if (res.status === 404) {
            throw new Error(`等待失败 (HTTP 404): ${errText}`);
          }
          throw new Error(`TRANSIENT: HTTP ${res.status}: ${errText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf('\n');
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) {
              try {
                const evt = JSON.parse(line) as {
                  type?: string;
                  elapsedSec?: number;
                  error?: string;
                  task?: AgentTask | null;
                  timeout?: boolean;
                  stopped?: boolean;
                  keepStandby?: boolean;
                  action?: string;
                };
                if (evt.type === 'ready' && !quiet) {
                  if (!announcedReady) {
                    process.stderr.write(`[chatroom wait] 已连接保活监听 (${agentId} · 每 ${heartbeatSec}s 心跳 / 0 token)...\n`);
                    announcedReady = true;
                  } else {
                    process.stderr.write(`[chatroom wait] 已自动重连，恢复保活监听 (${agentId})...\n`);
                  }
                } else if (evt.type === 'heartbeat' && !quiet) {
                  const totalElapsed = Math.round((Date.now() - startWallMs) / 1000);
                  process.stderr.write(`[chatroom wait] 保活心跳 (${totalElapsed}s / 0 token)...\n`);
                } else if (evt.type === 'error') {
                  throw new Error(evt.error || 'wait 错误');
                } else if (evt.type === 'done') {
                  finalPayload = {
                    task: evt.task ?? null,
                    timeout: Boolean(evt.timeout),
                    stopped: Boolean(evt.stopped),
                    keepStandby: evt.keepStandby,
                    action: evt.action,
                  };
                  gotDone = true;
                }
              } catch (parseErr) {
                if (parseErr instanceof Error && line.includes('"type":"error"')) {
                  throw parseErr;
                }
              }
            }
            nl = buf.indexOf('\n');
          }
        }

        // Stream closed cleanly without a `done` event -> likely server restart; auto-reconnect
        if (!gotDone && Date.now() + 2200 < deadlineMs) {
          if (!quiet) {
            process.stderr.write('[chatroom wait] 检测到聊天室重启或连接中断，2 秒后自动重连...\n');
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('等待失败 (HTTP 404)') || msg.includes('未找到')) {
          throw err;
        }
        if (Date.now() + 2200 >= deadlineMs) {
          break;
        }
        if (!quiet) {
          process.stderr.write('[chatroom wait] 聊天室服务重连中（2 秒后重试，保活不中断）...\n');
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    printOutput(finalPayload, asJson, () => {
      if (finalPayload.stopped) {
        console.log(`(${agentId}) 聊天室已停止待命模式，安全退出。`);
        return;
      }
      if (!finalPayload.task) {
        console.log(`(${agentId}) 等待 ${timeoutSec}s 暂无新任务（本次等待消耗 0 模型额度，可继续 wait）。`);
        return;
      }
      console.log(`Task ID:  ${finalPayload.task.taskId}`);
      console.log(`Room ID:  ${finalPayload.task.roomId}`);
      console.log(`目录:     ${finalPayload.task.repoPath}`);
      if (finalPayload.task.thinkingLevel && finalPayload.task.thinkingLevel !== 'default') {
        console.log(`思考深度: ${finalPayload.task.thinkingLevel}`);
      }
      if (finalPayload.task.recentHistory) {
        console.log(`\n--- 最近群聊上下文 ---\n${finalPayload.task.recentHistory}`);
      }
      console.log(`\n--- 当前任务 ---\n${finalPayload.task.prompt}`);
    });
    return;
  }

  if (cmd === 'stop-wait') {
    const agentId = positionals[1] || strFlag(flags, 'agent', 'id') || session.lastAgentId;
    if (!agentId) throw new Error('请指定 agentId');
    const res = await apiReq<{ ok: boolean; stopped: boolean }>(
      baseUrl,
      `/api/agents/${encodeURIComponent(agentId)}/stop-standby`,
      { method: 'POST', body: '{}' },
    );
    printOutput(res, asJson, () => {
      console.log(res.stopped ? `已通知 ${agentId} 退出待命模式` : `${agentId} 当前未处于待命监听中`);
    });
    return;
  }

  // 6. reply
  if (cmd === 'reply') {
    const agentId = strFlag(flags, 'agent', 'id') || session.lastAgentId;
    if (!agentId) throw new Error('请指定 --agent <agentId>（或先运行 chatroom join）');
    const taskId = strFlag(flags, 'task');
    const roomId = strFlag(flags, 'room');
    const filePath = strFlag(flags, 'file');
    let content = positionals.slice(1).join(' ').trim();
    if (filePath) {
      content = fs.readFileSync(path.resolve(filePath), 'utf8');
    } else if (boolFlag(flags, 'stdin') || !content) {
      const piped = await readStdin();
      if (piped.trim()) content = piped.trim();
    }
    if (!content) throw new Error('请提供回复内容，例如：chatroom reply "已完成" 或通过 --stdin / --file 传入');

    const inputTokensRaw = strFlag(flags, 'input-tokens');
    const outputTokensRaw = strFlag(flags, 'output-tokens');
    const totalTokensRaw = strFlag(flags, 'total-tokens');
    const creditsUsedRaw = strFlag(flags, 'credits-used');
    const remainingLabel = strFlag(flags, 'remaining');
    const usedPctRaw = strFlag(flags, 'used-pct');
    const resetAtLabel = strFlag(flags, 'reset-at');
    const creditRemainingRaw = strFlag(flags, 'credits-remaining');
    const creditTotalRaw = strFlag(flags, 'credits-total');
    const usage =
      inputTokensRaw || outputTokensRaw || totalTokensRaw || creditsUsedRaw
        ? {
            inputTokens: inputTokensRaw ? Number(inputTokensRaw) : undefined,
            outputTokens: outputTokensRaw ? Number(outputTokensRaw) : undefined,
            totalTokens: totalTokensRaw ? Number(totalTokensRaw) : undefined,
            creditsUsed: creditsUsedRaw ? Number(creditsUsedRaw) : undefined,
          }
        : undefined;

    const res = await apiReq<{ ok: boolean; resolvedTask: boolean }>(
      baseUrl,
      `/api/agent/${encodeURIComponent(agentId)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify({
          taskId,
          roomId,
          content,
          usage,
          remainingLabel,
          usedPercent: usedPctRaw !== undefined ? Number(usedPctRaw) : undefined,
          resetAtLabel,
          creditRemaining: creditRemainingRaw !== undefined ? Number(creditRemainingRaw) : undefined,
          creditTotal: creditTotalRaw !== undefined ? Number(creditTotalRaw) : undefined,
        }),
      },
    );
    printOutput(res, asJson, () => {
      console.log(res.resolvedTask ? `已提交回复并完成任务 (${agentId})` : `已作为主动发言发送到聊天室 (${agentId})`);
    });
    return;
  }

  // 7. send
  if (cmd === 'send') {
    let content = positionals.slice(1).join(' ').trim();
    if (boolFlag(flags, 'stdin') || !content) {
      const piped = await readStdin();
      if (piped.trim()) content = piped.trim();
    }
    const attachRaw = strFlag(flags, 'attach');
    if (!content && !attachRaw) {
      throw new Error('请提供消息内容或 --attach <文件路径>');
    }
    const roomId = await resolveActiveRoomId(baseUrl, strFlag(flags, 'room'));
    const toRaw = strFlag(flags, 'to');
    const targetProviderIds = toRaw ? toRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const mode = boolFlag(flags, 'workflow') ? 'workflow' : 'chat';
    const executionMode = strFlag(flags, 'mode') as 'mock' | 'real' | undefined;

    const attachments: ChatAttachment[] = [];
    if (attachRaw) {
      for (const rawFile of attachRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
        const absPath = path.resolve(rawFile);
        const up = await apiReq<{ attachment: ChatAttachment }>(
          baseUrl,
          `/api/runs/${encodeURIComponent(roomId)}/attach-local`,
          {
            method: 'POST',
            body: JSON.stringify({ absPath }),
          },
        );
        attachments.push(up.attachment);
      }
    }

    const res = await apiReq<{ run: WorkflowRun }>(
      baseUrl,
      `/api/runs/${encodeURIComponent(roomId)}/chat`,
      {
        method: 'POST',
        body: JSON.stringify({
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
          targetProviderIds,
          mode,
          executionMode,
        }),
      },
    );
    printOutput({ ok: true, roomId: res.run.id, status: res.run.status, attachments: attachments.length }, asJson, () => {
      console.log(`已发送到会话 ${res.run.title} (${res.run.id})${attachments.length ? `，附带 ${attachments.length} 个文件` : ''}`);
    });
    return;
  }

  // 8. history
  if (cmd === 'history') {
    const roomId = await resolveActiveRoomId(baseUrl, strFlag(flags, 'room'));
    const limit = Math.max(1, Number(strFlag(flags, 'limit')) || 15);
    const { run } = await apiReq<{ run: WorkflowRun }>(baseUrl, `/api/runs/${encodeURIComponent(roomId)}`);
    const msgs = (run.messages || []).slice(-limit);
    printOutput({ roomId: run.id, title: run.title, messages: msgs }, asJson, () => {
      console.log(`=== ${run.title} (${run.id}) 最近 ${msgs.length} 条消息 ===`);
      for (const m of msgs) {
        const time = new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        console.log(`\n[${time}] ${m.senderName}${m.stageTitle ? ` · ${m.stageTitle}` : ''} (${m.status})`);
        console.log(m.content || '(等待回复中...)');
      }
    });
    return;
  }

  // 9. rename / profile / thinking / presence
  if (cmd === 'rename') {
    const memberId = positionals[1];
    if (!memberId) throw new Error('请指定成员 ID，例如：chatroom rename claude --name "Claude 主架构" --avatar 🧠');
    const name = strFlag(flags, 'name');
    const avatarRaw = strFlag(flags, 'avatar');
    const avatar = avatarRaw === 'clear' ? '' : avatarRaw;
    const accentColor = strFlag(flags, 'color');
    const thinkingLevel = strFlag(flags, 'thinking') as ThinkingLevel | undefined;
    const setOnline = boolFlag(flags, 'online');
    const setOffline = boolFlag(flags, 'offline');

    // External agents may use custom IDs (join --id <id>), so look the ID up instead of relying on the agent_ prefix
    const { agents: knownAgents } = await apiReq<{ agents: ConnectedAgent[] }>(baseUrl, '/api/agents');
    const isAgent = knownAgents.some((a) => a.id === memberId);
    if (isAgent) {
      const res = await apiReq<{ agent: ConnectedAgent }>(
        baseUrl,
        `/api/agents/${encodeURIComponent(memberId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: name,
            avatar,
            accentColor,
            thinkingLevel,
            online: setOnline ? true : setOffline ? false : undefined,
          }),
        },
      );
      printOutput(res, asJson, () => {
        console.log(`已更新成员: ${res.agent.avatar ? `${res.agent.avatar} ` : ''}${res.agent.name} (${res.agent.id})`);
      });
    } else {
      const res = await apiReq<{ provider: ProviderConfig }>(
        baseUrl,
        `/api/providers/${encodeURIComponent(memberId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            shortName: name,
            avatar,
            accentColor,
            thinkingLevel,
            offline: setOffline ? true : setOnline ? false : undefined,
          }),
        },
      );
      printOutput(res, asJson, () => {
        console.log(`已更新模型: ${res.provider.avatar ? `${res.provider.avatar} ` : ''}${res.provider.shortName} (${res.provider.id})`);
      });
    }
    return;
  }

  // 10. detect-cli
  if (cmd === 'detect-cli') {
    const agentId = positionals[1] || session.lastAgentId;
    if (!agentId) throw new Error('请指定 agentId，例如：chatroom detect-cli agent_gemini-4-hydrogen');
    const res = await apiReq<{ ok: boolean; found: boolean; message: string; agent: ConnectedAgent }>(
      baseUrl,
      `/api/agents/${encodeURIComponent(agentId)}/detect-cli`,
      { method: 'POST', body: '{}' },
    );
    printOutput(res, asJson, () => {
      console.log(res.found ? `✅ ${res.message}` : `ℹ️ ${res.message}`);
    });
    return;
  }

  // 11. workbench / skill / plugin / kb
  if (cmd === 'workbench') {
    const { workbench } = await apiReq<{ workbench: WorkbenchConfig }>(baseUrl, '/api/workbench');
    printOutput(workbench, asJson, () => {
      console.log(`技能 Skills: ${workbench.skills.length} (${workbench.skills.filter((s) => s.enabled).length} 启用)`);
      console.log(`插件 / MCP:  ${workbench.plugins.length} (${workbench.plugins.filter((p) => p.enabled).length} 启用)`);
      console.log(`全局资料库:  ${workbench.knowledge.length} (${workbench.knowledge.filter((k) => k.pinned).length} 全局注入)`);
      console.log(`模板与定时:  ${workbench.templates.length} 模板 · ${workbench.schedules.filter((s) => s.enabled).length}/${workbench.schedules.length} 定时开启`);
    });
    return;
  }

  if (cmd === 'skill') {
    const sub = positionals[1] || 'list';
    const { workbench } = await apiReq<{ workbench: WorkbenchConfig }>(baseUrl, '/api/workbench');
    if (sub === 'list') {
      printOutput({ skills: workbench.skills }, asJson, () => {
        for (const s of workbench.skills) {
          console.log(`  - [${s.enabled ? 'ON ' : 'OFF'}] ${s.name}${s.trigger ? ` (${s.trigger})` : ''}${s.autoInject ? ' [自动注入]' : ''} — ${s.description}`);
        }
      });
      return;
    }
    if (sub === 'add') {
      const name = positionals[2] || strFlag(flags, 'name');
      const prompt = strFlag(flags, 'prompt');
      if (!name || !prompt) throw new Error('用法：chatroom skill add <名称> --prompt "<指令>" [--trigger /cmd] [--auto]');
      const next: WorkbenchConfig = {
        ...workbench,
        skills: [
          {
            id: `skill_${Date.now().toString(36)}`,
            name,
            trigger: strFlag(flags, 'trigger') || '',
            description: strFlag(flags, 'desc') || 'CLI 添加的技能',
            prompt,
            autoInject: boolFlag(flags, 'auto'),
            enabled: true,
            updatedAt: new Date().toISOString(),
          },
          ...workbench.skills,
        ],
      };
      const saved = await apiReq<{ workbench: WorkbenchConfig }>(baseUrl, '/api/workbench', {
        method: 'PUT',
        body: JSON.stringify({ workbench: next }),
      });
      printOutput(saved.workbench.skills[0], asJson, () => {
        console.log(`已添加技能: ${name}`);
      });
      return;
    }
  }

  if (cmd === 'plugin') {
    const sub = positionals[1] || 'list';
    if (sub === 'list') {
      const { workbench } = await apiReq<{ workbench: WorkbenchConfig }>(baseUrl, '/api/workbench');
      printOutput({ plugins: workbench.plugins }, asJson, () => {
        for (const p of workbench.plugins) {
          console.log(`  - [${p.enabled ? 'ON ' : 'OFF'}] ${p.name} (${p.id}) · ${p.kind}`);
        }
      });
      return;
    }
    if (sub === 'test') {
      const pluginId = positionals[2];
      if (!pluginId) throw new Error('请指定插件 ID，例如：chatroom plugin test plugin_git_status');
      const res = await apiReq<{ result: { ok: boolean; latencyMs: number; message: string } }>(
        baseUrl,
        `/api/workbench/plugins/${encodeURIComponent(pluginId)}/test`,
        { method: 'POST', body: JSON.stringify({ cwd: strFlag(flags, 'cwd') || process.cwd() }) },
      );
      printOutput(res.result, asJson, () => {
        console.log(`${res.result.ok ? '✅' : '❌'} (${res.result.latencyMs}ms) ${res.result.message}`);
      });
      return;
    }
  }

  if (cmd === 'kb') {
    const sub = positionals[1] || 'list';
    const { workbench } = await apiReq<{ workbench: WorkbenchConfig }>(baseUrl, '/api/workbench');
    if (sub === 'list') {
      printOutput({ knowledge: workbench.knowledge }, asJson, () => {
        for (const k of workbench.knowledge) {
          console.log(`  - [${k.pinned ? 'PIN' : 'OFF'}] ${k.title} (${k.content.length} 字)`);
        }
      });
      return;
    }
    if (sub === 'add') {
      const title = positionals[2] || strFlag(flags, 'title');
      const filePath = strFlag(flags, 'file');
      const content = filePath
        ? fs.readFileSync(path.resolve(filePath), 'utf8').slice(0, 20000)
        : strFlag(flags, 'content') || (await readStdin());
      if (!title || !content.trim()) throw new Error('用法：chatroom kb add <标题> --file <文件路径> 或 --content "<内容>"');
      const next: WorkbenchConfig = {
        ...workbench,
        knowledge: [
          {
            id: `kb_${Date.now().toString(36)}`,
            title,
            content: content.trim(),
            pinned: true,
            source: filePath ? 'file' : 'manual',
            updatedAt: new Date().toISOString(),
          },
          ...workbench.knowledge,
        ],
      };
      await apiReq(baseUrl, '/api/workbench', {
        method: 'PUT',
        body: JSON.stringify({ workbench: next }),
      });
      printOutput({ ok: true, title, length: content.length }, asJson, () => {
        console.log(`已存入全局资料库并开启全局注入: ${title}`);
      });
      return;
    }
  }

  // 12. export
  if (cmd === 'export') {
    const roomId = await resolveActiveRoomId(baseUrl, strFlag(flags, 'room'));
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/runs/${encodeURIComponent(roomId)}/export`);
    if (!res.ok) throw new Error(`导出失败 (HTTP ${res.status})`);
    const md = await res.text();
    const out = strFlag(flags, 'out');
    if (out) {
      fs.writeFileSync(path.resolve(out), md, 'utf8');
      printOutput({ ok: true, out: path.resolve(out), bytes: Buffer.byteLength(md) }, asJson, () => {
        console.log(`已导出到: ${path.resolve(out)}`);
      });
    } else {
      process.stdout.write(md);
    }
    return;
  }

  // 13. skill-doc
  if (cmd === 'skill-doc') {
    const skillPath = path.resolve(__dirname, '../../cli/SKILL.md');
    if (fs.existsSync(skillPath)) {
      process.stdout.write(fs.readFileSync(skillPath, 'utf8'));
    } else {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/agent/skill`);
      process.stdout.write(await res.text());
    }
    return;
  }

  // 14. mcp — Stdio JSON-RPC 2.0 MCP Server bridge forwarding to local POST /mcp
  if (cmd === 'mcp') {
    const mcpUrl = `${baseUrl.replace(/\/+$/, '')}/mcp`;
    let buffer = '';
    process.stdin.setEncoding('utf8');
    const processLine = async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: { id?: string | number | null; method?: string } | null = null;
      try {
        parsed = JSON.parse(trimmed) as { id?: string | number | null; method?: string };
      } catch {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          })}\n`,
        );
        return;
      }
      try {
        const res = await fetch(mcpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: trimmed,
        });
        if (res.status === 202 || res.status === 204) return;
        const text = (await res.text()).trim();
        if (text) {
          process.stdout.write(`${text}\n`);
        }
      } catch (err) {
        if (parsed && parsed.id !== undefined) {
          process.stdout.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              error: {
                code: -32000,
                message: `无法连接本地聊天室 MCP 服务 (${mcpUrl}): ${err instanceof Error ? err.message : String(err)}`,
              },
            })}\n`,
          );
        }
      }
    };

    await new Promise<void>((resolve) => {
      let pending = Promise.resolve();
      process.stdin.on('data', (chunk: string) => {
        buffer += chunk;
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          pending = pending.then(() => processLine(line));
          nl = buffer.indexOf('\n');
        }
      });
      process.stdin.on('end', () => {
        if (buffer.trim()) {
          const rest = buffer;
          buffer = '';
          pending = pending.then(() => processLine(rest));
        }
        void pending.finally(resolve);
      });
    });
    return;
  }

  throw new Error(`未知子命令：${cmd}（运行 chatroom --help 查看全部命令）`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (process.argv.includes('--json') || process.argv.includes('-j')) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
  } else {
    process.stderr.write(`错误: ${msg}\n`);
  }
  process.exit(1);
});
