import type { MemberQuotaConfig, TokenUsage } from '../shared/types.js';
import { agentHub } from './agentHub.js';
import { engine } from './engine.js';
import { listRuns, loadProviders, updateMemberQuota } from './store.js';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const MCP_TOOLS = [
  {
    name: 'chatroom_join',
    description:
      'Register or reconnect this AI agent into the local Multi-Agent Chatroom so the user can @mention it in group chat or workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Concrete model name (e.g., "Claude Opus 4.6", "GPT-5", "DeepSeek-V4").',
        },
        id: {
          type: 'string',
          description: 'Optional stable agentId (auto-generated from model if omitted).',
        },
        relay: {
          type: 'string',
          description: 'Optional third-party relay or host label (leave empty for official direct).',
        },
        role: {
          type: 'string',
          description: 'Short description of this agent specialty.',
        },
        avatar: {
          type: 'string',
          description: 'Optional emoji avatar (e.g., "🤖", "🧠", "✨").',
        },
        roomId: {
          type: 'string',
          description: 'Optional room ID to join (defaults to the active room).',
        },
      },
      required: ['model'],
    },
  },
  {
    name: 'chatroom_members',
    description: 'List all online chatroom members (external Agents & local CLI/API providers) and active rooms.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'chatroom_history',
    description: 'Read recent group chat messages from the active or specified room.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string', description: 'Optional room ID (defaults to active room).' },
        limit: { type: 'number', description: 'Max recent messages to return (default 15, max 50).' },
      },
    },
  },
  {
    name: 'chatroom_pull',
    description: 'Non-blocking instant check for any pending task assigned to agentId.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The registered agentId returned by chatroom_join.' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'chatroom_wait',
    description:
      'Zero-token blocking long-poll wait for the next task assigned to agentId. Returns action: "handle_task" | "continue_wait" | "stop".',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The registered agentId.' },
        timeoutSec: {
          type: 'number',
          description: 'Seconds to wait before returning continue_wait (default 120, max 600).',
        },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'chatroom_reply',
    description:
      'Submit a reply to a pending task (or post a proactive message to the chatroom). Optionally report exact token usage or remaining quota.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The registered agentId.' },
        content: { type: 'string', description: 'Markdown reply content.' },
        taskId: { type: 'string', description: 'Optional taskId from chatroom_pull / chatroom_wait.' },
        roomId: { type: 'string', description: 'Optional roomId when posting proactively.' },
        inputTokens: { type: 'number', description: 'Optional exact input token count.' },
        outputTokens: { type: 'number', description: 'Optional exact output token count.' },
        totalTokens: { type: 'number', description: 'Optional exact total token count.' },
        creditsUsed: { type: 'number', description: 'Optional credits consumed by this reply.' },
        usedPercent: { type: 'number', description: 'Optional official subscription used percentage (0-100).' },
        resetAtLabel: { type: 'string', description: 'Optional reset window label (e.g., "04:30重置").' },
        creditRemaining: { type: 'number', description: 'Optional official remaining credits.' },
        creditTotal: { type: 'number', description: 'Optional official total credits.' },
      },
      required: ['agentId', 'content'],
    },
  },
];

async function executeMcpTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const wrap = (payload: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  });

  try {
    if (name === 'chatroom_join') {
      const model = String(args.model || '').trim();
      if (!model) return wrap({ error: 'model is required' }, true);
      const targetRoom =
        (typeof args.roomId === 'string' && args.roomId.trim()) || listRuns()[0]?.id;
      const { agent, isReconnect } = agentHub.join({
        id: typeof args.id === 'string' ? args.id.trim() || undefined : undefined,
        model,
        relay: typeof args.relay === 'string' ? args.relay.trim() || undefined : undefined,
        role: typeof args.role === 'string' ? args.role.trim() || undefined : undefined,
        roomId: targetRoom,
        trigger: { type: 'manual' },
      });
      if (typeof args.avatar === 'string' && args.avatar.trim()) {
        agentHub.updateAgent(agent.id, { avatar: args.avatar.trim() });
      }
      if (targetRoom && !isReconnect) {
        engine.postSystemNotice(
          targetRoom,
          `🔌 **${agent.name}** 已通过内置 MCP Server 接入聊天室`,
        );
      }
      return wrap({
        ok: true,
        isReconnect,
        agent: agentHub.getAgent(agent.id) || agent,
        roomId: targetRoom || null,
      });
    }

    if (name === 'chatroom_members') {
      const agents = agentHub.listAgents().map((a) => ({
        id: a.id,
        name: a.name,
        online: a.online,
        busy: a.busy,
        listening: Boolean(a.listening),
        bridgeActive: Boolean(a.lastBridgeAt),
        trigger: a.trigger?.type || 'manual',
      }));
      const providers = loadProviders()
        .filter((p) => !p.offline)
        .map((p) => ({
          id: p.id,
          name: p.shortName,
          connectionType: p.connectionType || 'cli',
          model: p.model || '',
        }));
      const rooms = listRuns()
        .slice(0, 10)
        .map((r) => ({ id: r.id, title: r.title, status: r.status }));
      return wrap({ agents, providers, rooms });
    }

    if (name === 'chatroom_history') {
      const roomId =
        (typeof args.roomId === 'string' && args.roomId.trim()) || listRuns()[0]?.id;
      if (!roomId) return wrap({ roomId: null, messages: [] });
      const run = engine.getRun(roomId);
      if (!run) return wrap({ error: `Room not found: ${roomId}` }, true);
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 15));
      const messages = (run.messages || []).slice(-limit).map((m) => ({
        id: m.id,
        role: m.role,
        senderId: m.senderId,
        senderName: m.senderName,
        stageTitle: m.stageTitle,
        content: m.content,
        createdAt: m.createdAt,
      }));
      return wrap({ roomId: run.id, title: run.title, messages });
    }

    if (name === 'chatroom_pull') {
      const agentId = String(args.agentId || '').trim();
      if (!agentId) return wrap({ error: 'agentId is required' }, true);
      const task = agentHub.pullPendingTask(agentId);
      return wrap({ task });
    }

    if (name === 'chatroom_wait') {
      const agentId = String(args.agentId || '').trim();
      if (!agentId) return wrap({ error: 'agentId is required' }, true);
      const rawTimeout = Number(args.timeoutSec);
      const timeoutSec =
        Number.isFinite(rawTimeout) && rawTimeout > 0
          ? Math.min(600, Math.max(5, Math.round(rawTimeout)))
          : 120;
      const result = await agentHub.waitForTask(agentId, timeoutSec, signal);
      const action = result.stopped
        ? 'stop'
        : result.task
          ? 'handle_task'
          : 'continue_wait';
      return wrap({ ...result, action, keepStandby: !result.stopped });
    }

    if (name === 'chatroom_reply') {
      const agentId = String(args.agentId || '').trim();
      const content = String(args.content || '').trim();
      if (!agentId || !content) {
        return wrap({ error: 'agentId and content are required' }, true);
      }
      const taskId = typeof args.taskId === 'string' ? args.taskId.trim() || undefined : undefined;
      const roomId = typeof args.roomId === 'string' ? args.roomId.trim() || undefined : undefined;

      const quotaUpdate: Partial<MemberQuotaConfig> = {};
      if (typeof args.usedPercent === 'number' && Number.isFinite(args.usedPercent)) {
        quotaUpdate.mode = 'subscription';
        quotaUpdate.usedPercent = args.usedPercent;
        if (typeof args.resetAtLabel === 'string' && args.resetAtLabel.trim()) {
          quotaUpdate.resetAtLabel = args.resetAtLabel.trim().slice(0, 32);
        }
        quotaUpdate.balanceCheckedAt = new Date().toISOString();
      }
      if (typeof args.creditRemaining === 'number' && Number.isFinite(args.creditRemaining)) {
        quotaUpdate.mode = 'credits';
        quotaUpdate.creditRemaining = args.creditRemaining;
        if (typeof args.creditTotal === 'number' && Number.isFinite(args.creditTotal) && args.creditTotal > 0) {
          quotaUpdate.creditTotal = args.creditTotal;
        }
        quotaUpdate.balanceCheckedAt = new Date().toISOString();
      }
      if (Object.keys(quotaUpdate).length > 0) {
        updateMemberQuota(agentId, quotaUpdate);
      }

      const usage: Partial<TokenUsage> | undefined =
        typeof args.inputTokens === 'number' ||
        typeof args.outputTokens === 'number' ||
        typeof args.totalTokens === 'number' ||
        typeof args.creditsUsed === 'number'
          ? {
              inputTokens: typeof args.inputTokens === 'number' ? args.inputTokens : undefined,
              outputTokens: typeof args.outputTokens === 'number' ? args.outputTokens : undefined,
              totalTokens: typeof args.totalTokens === 'number' ? args.totalTokens : undefined,
              creditsUsed: typeof args.creditsUsed === 'number' ? args.creditsUsed : undefined,
            }
          : undefined;

      const resolved = agentHub.submitReply(agentId, { taskId, content, usage });
      if (!resolved) {
        const fallbackRoom =
          roomId || agentHub.getAgent(agentId)?.roomId || listRuns()[0]?.id;
        if (fallbackRoom) {
          engine.postAgentMessage(fallbackRoom, agentId, content);
        }
      }
      return wrap({ ok: true, resolvedTask: resolved });
    }

    return wrap({ error: `Unknown MCP tool: ${name}` }, true);
  } catch (err) {
    return wrap({ error: err instanceof Error ? err.message : String(err) }, true);
  }
}

export async function handleMcpJsonRpc(
  req: JsonRpcRequest,
  signal?: AbortSignal,
): Promise<JsonRpcResponse | null> {
  const id = req.id !== undefined ? req.id : null;
  const method = req.method || '';

  // Notifications carry no id and expect no JSON-RPC response body
  if (method.startsWith('notifications/')) {
    return null;
  }

  if (method === 'initialize') {
    const requestedVersion =
      typeof req.params?.protocolVersion === 'string'
        ? req.params.protocolVersion
        : '2025-03-26';
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: requestedVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'multi-agent-chatroom',
          version: '1.0.0',
        },
        instructions:
          'Local Multi-Agent Chatroom MCP Server. Call chatroom_join once with your model name, then use chatroom_pull / chatroom_wait and chatroom_reply to collaborate in the group chatroom.',
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS },
    };
  }

  if (method === 'tools/call') {
    const toolName = String(req.params?.name || '');
    const toolArgs =
      req.params?.arguments && typeof req.params.arguments === 'object'
        ? (req.params.arguments as Record<string, unknown>)
        : {};
    const toolResult = await executeMcpTool(toolName, toolArgs, signal);
    return {
      jsonrpc: '2.0',
      id,
      result: toolResult,
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}
