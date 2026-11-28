import cors from 'cors';
import express from 'express';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type {
  ApprovalPayload,
  ChatSendPayload,
  ConnectedAgent,
  CreateRunPayload,
  MemberQuotaConfig,
  ProviderConfig,
  TokenUsage,
  WorkbenchConfig,
  WorkflowDefinition,
  WorkflowPresetTemplate,
  WorkflowRun,
} from '../shared/types.js';
import { agentHub } from './agentHub.js';
import { testProviderConnection } from './apiRunner.js';
import {
  autoDetectCliTriggerForModel,
  checkAllEnvironment,
  resolveCommandPath,
} from './cliRunner.js';
import { engine } from './engine.js';
import { MCP_TOOLS, handleMcpJsonRpc, type JsonRpcRequest } from './mcpServer.js';
import {
  deleteRun,
  getUploadsDir,
  listRuns,
  loadMemberUsage,
  loadProviders,
  loadWorkbench,
  loadWorkflow,
  loadWorkflowTemplates,
  resetMemberUsage,
  resetWorkflow,
  saveProviders,
  saveUploadedFile,
  saveWorkbench,
  saveWorkflow,
  saveWorkflowTemplates,
  updateMemberQuota,
} from './store.js';
import {
  discoverLocalSkills,
  importSkillsFromUrl,
  testWorkbenchPlugin,
  workbenchScheduler,
} from './workbench.js';
import { generateWorkflowFromPrompt } from './workflowGenerator.js';

export interface StartServerOptions {
  port?: number;
  host?: string;
  distDir?: string;
  dataDir?: string;
}

export interface StartedServer {
  port: number;
  host: string;
  server: Server;
  close: () => Promise<void>;
}

export function createApp(options?: { distDir?: string; portHint?: number; host?: string }) {
  const app = express();
  const host = options?.host || '127.0.0.1';

  app.use(cors({ origin: /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/ }));
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      host,
      port: options?.portHint ?? Number(process.env.PORT || 4310),
      cwd: process.cwd(),
      dataDir: process.env.AGENT_WORKFLOW_DATA_DIR || path.resolve(process.cwd(), 'data'),
      platform: process.platform,
    });
  });

  // ===== Built-in Standard MCP Server (Streamable HTTP JSON-RPC 2.0) =====
  app.get('/mcp', (_req, res) => {
    res.json({
      name: 'multi-agent-chatroom',
      version: '1.0.0',
      transport: 'streamable-http',
      endpoint: '/mcp',
      stdioCommand: 'chatroom mcp',
      tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    });
  });

  app.post('/mcp', async (req, res) => {
    const body = req.body;
    const ac = new AbortController();
    req.on('close', () => ac.abort());

    try {
      if (Array.isArray(body)) {
        const results = [];
        for (const item of body) {
          const out = await handleMcpJsonRpc(item as JsonRpcRequest, ac.signal);
          if (out) results.push(out);
        }
        if (results.length === 0) {
          res.status(202).end();
          return;
        }
        res.json(results);
        return;
      }
      const out = await handleMcpJsonRpc((body || {}) as JsonRpcRequest, ac.signal);
      if (!out) {
        res.status(202).end();
        return;
      }
      res.json(out);
    } catch (err) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: (body as JsonRpcRequest | undefined)?.id ?? null,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal MCP error',
        },
      });
    }
  });

  // ===== Self-Joining External Agent Protocol =====
  app.get('/api/agent/guide', (req, res) => {
    const proto = req.protocol || 'http';
    const reqHost = req.get('host') || `${host}:${options?.portHint ?? 4310}`;
    const baseUrl = `${proto}://${reqHost}`;
    const roomId = typeof req.query.room === 'string' ? req.query.room : '';
    res
      .type('text/plain; charset=utf-8')
      .send(agentHub.buildGuideText(baseUrl, roomId));
  });

  app.get('/api/agent/skill', (_req, res) => {
    const candidates = [
      path.resolve(process.cwd(), 'cli/SKILL.md'),
      path.resolve(__dirname, '../../cli/SKILL.md'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      res.type('text/markdown; charset=utf-8').send(fs.readFileSync(found, 'utf8'));
      return;
    }
    res.type('text/plain; charset=utf-8').send('chatroom CLI SKILL.md 未找到，请运行 chatroom --help');
  });

  app.get('/api/agents', (_req, res) => {
    res.json({ agents: agentHub.listAgents() });
  });

  app.get('/api/agents/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (agents: ReturnType<typeof agentHub.listAgents>) => {
      res.write(`data: ${JSON.stringify({ agents })}\n\n`);
    };
    send(agentHub.listAgents());
    const onChanged = (agents: ReturnType<typeof agentHub.listAgents>) => send(agents);
    agentHub.on('changed', onChanged);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      agentHub.off('changed', onChanged);
    });
  });

  app.post('/api/agent/join', async (req, res) => {
    const body = (req.body || {}) as {
      id?: string;
      name?: string;
      model?: string;
      relay?: string;
      source?: string;
      clientPath?: string;
      baseUrl?: string;
      trigger?: ConnectedAgent['trigger'];
      thinkingOptions?: ConnectedAgent['thinkingOptions'];
      role?: string;
      color?: string;
      roomId?: string;
    };
    if (!body.model?.trim() && !body.name?.trim()) {
      res.status(400).json({ error: '请提供模型名称 model 或 name' });
      return;
    }

    // Attempt automatic local CLI trigger binding on first join (or when caller passed manual/omitted)
    let resolvedTrigger = body.trigger;
    let autoCliDetection: Awaited<ReturnType<typeof autoDetectCliTriggerForModel>> | undefined;
    const rawModelForProbe = (body.model || body.name || '').trim();

    if (resolvedTrigger?.type === 'cli' && resolvedTrigger.command?.trim()) {
      const cmdPath = await resolveCommandPath(resolvedTrigger.command.trim());
      if (!cmdPath) {
        // Reported CLI command doesn't exist locally -> try auto-detecting official CLI
        autoCliDetection = await autoDetectCliTriggerForModel(rawModelForProbe);
        resolvedTrigger = autoCliDetection.found && autoCliDetection.trigger
          ? autoCliDetection.trigger
          : { type: 'manual' };
      }
    } else if (!resolvedTrigger || resolvedTrigger.type === 'manual') {
      autoCliDetection = await autoDetectCliTriggerForModel(rawModelForProbe);
      if (autoCliDetection.found && autoCliDetection.trigger) {
        resolvedTrigger = autoCliDetection.trigger;
      }
    }

    const existingRooms = listRuns();
    const targetRoomId = body.roomId?.trim() || existingRooms[0]?.id || '';
    const { agent, isReconnect } = agentHub.join({
      id: body.id,
      name: body.name,
      model: body.model,
      relay: body.relay,
      source: body.source,
      clientPath: body.clientPath,
      baseUrl: body.baseUrl,
      trigger: resolvedTrigger,
      thinkingOptions: body.thinkingOptions,
      role: body.role,
      color: body.color,
      roomId: targetRoomId,
    });
    const modeLabel =
      agent.trigger?.type === 'cli'
        ? `⚡ 自动拉起 CLI：\`${agent.trigger.command}\``
        : agent.trigger?.type === 'webhook'
          ? '⚡ 自动回调 Webhook'
          : '按需唤醒（未检测到本机 CLI）';
    if (targetRoomId) {
      engine.postSystemNotice(
        targetRoomId,
        isReconnect
          ? `🟢 **${agent.name}** 已更新就绪（${modeLabel}）`
          : `🟢 **${agent.name}** 已接入聊天室（${modeLabel}）`,
      );
    }
    res.json({
      ok: true,
      agent,
      roomId: targetRoomId,
      autoCliDetected: Boolean(autoCliDetection?.found),
      cliDetection: autoCliDetection,
      pullUrl: `/api/agent/${agent.id}/pull`,
      replyUrl: `/api/agent/${agent.id}/reply`,
      note:
        agent.trigger?.type === 'cli'
          ? '注册成功并已自动绑定本机 CLI 启动方式！聊天室后续会直接自动拉起你。'
          : '注册成功！未检测到本机对应 CLI，已设为按需待命模式，请立即结束本轮、严禁循环轮询。',
    });
  });

  app.post('/api/agents/:agentId/detect-cli', async (req, res) => {
    const agent = agentHub.getAgent(req.params.agentId);
    if (!agent) {
      res.status(404).json({ error: '未找到该成员' });
      return;
    }
    const detection = await autoDetectCliTriggerForModel(agent.modelName || agent.name);
    if (detection.found && detection.trigger) {
      const updated = agentHub.updateAgent(agent.id, { trigger: detection.trigger });
      res.json({
        ok: true,
        found: true,
        agent: updated,
        message: detection.message,
      });
      return;
    }
    res.json({
      ok: true,
      found: false,
      agent,
      message: detection.message,
      suggestion: detection.suggestion,
    });
  });

  app.patch('/api/agents/:agentId', (req, res) => {
    const {
      displayName,
      modelName,
      relayName,
      avatar,
      accentColor,
      online,
      trigger,
      thinkingLevel,
    } = (req.body || {}) as {
      displayName?: string;
      modelName?: string;
      relayName?: string;
      avatar?: string;
      accentColor?: string;
      online?: boolean;
      trigger?: ConnectedAgent['trigger'];
      thinkingLevel?: ConnectedAgent['thinkingLevel'];
    };
    const updated = agentHub.updateAgent(req.params.agentId, {
      displayName,
      modelName,
      relayName,
      avatar,
      accentColor,
      online,
      trigger,
      thinkingLevel,
    });
    if (!updated) {
      res.status(404).json({ error: '未找到该成员' });
      return;
    }
    res.json({ agent: updated });
  });

  app.get('/api/agent/:agentId/pull', (req, res) => {
    try {
      const task = agentHub.pullPendingTask(req.params.agentId);
      res.json({ task });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Zero-token EventEmitter long-poll endpoint for `chatroom wait` (supports NDJSON heartbeat stream!)
  app.get('/api/agent/:agentId/wait', async (req, res) => {
    const rawTimeout = Number(req.query.timeout);
    const timeoutSec = Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.min(3600, Math.max(5, rawTimeout)) : 1800;
    const isStream = req.query.stream === '1' || req.query.stream === 'true';
    const rawHb = Number(req.query.heartbeat);
    const heartbeatSec = Number.isFinite(rawHb) && rawHb >= 2 ? Math.min(120, Math.round(rawHb)) : 25;

    const ac = new AbortController();
    let hbTimer: NodeJS.Timeout | null = null;
    const startMs = Date.now();

    req.on('close', () => {
      if (hbTimer) clearInterval(hbTimer);
      if (!res.writableEnded) ac.abort();
    });

    if (isStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      res.write(`${JSON.stringify({ type: 'ready', agentId: req.params.agentId, timeoutSec, heartbeatSec })}\n`);
      hbTimer = setInterval(() => {
        if (!res.writableEnded) {
          const elapsedSec = Math.round((Date.now() - startMs) / 1000);
          res.write(`${JSON.stringify({ type: 'heartbeat', elapsedSec, ts: new Date().toISOString() })}\n`);
        }
      }, heartbeatSec * 1000);
    }

    try {
      const result = await agentHub.waitForTask(req.params.agentId, timeoutSec, ac.signal);
      if (hbTimer) clearInterval(hbTimer);
      const payload = {
        ...result,
        keepStandby: !result.stopped,
        action: result.task ? 'handle_task' : result.stopped ? 'stop' : 'continue_wait',
      };
      if (!res.writableEnded) {
        if (isStream) {
          res.write(`${JSON.stringify({ type: 'done', ...payload })}\n`);
          res.end();
        } else {
          res.json(payload);
        }
      }
    } catch (err) {
      if (hbTimer) clearInterval(hbTimer);
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.writableEnded) {
        if (isStream) {
          res.write(`${JSON.stringify({ type: 'error', error: msg })}\n`);
          res.end();
        } else {
          res.status(404).json({ error: msg });
        }
      }
    }
  });

  app.post('/api/agents/:agentId/stop-standby', (req, res) => {
    const stopped = agentHub.stopStandby(req.params.agentId);
    res.json({ ok: true, stopped, stopFile: path.join(agentHub.getAgentBridgeDir(req.params.agentId), 'STOP') });
  });

  app.get('/api/agents/:agentId/bridge', (req, res) => {
    const agentId = req.params.agentId;
    const dirs = agentHub.ensureBridgeWatcherScript(agentId);
    res.json({
      agentId,
      bridgeDir: dirs.baseDir,
      tasksDir: dirs.tasksDir,
      repliesDir: dirs.repliesDir,
      stopFile: dirs.stopFile,
      watchPyPath: dirs.watchPyPath,
    });
  });

  app.post('/api/agents/quick-bridge', (req, res) => {
    const { name, avatar, roomId } = (req.body || {}) as {
      name?: string;
      avatar?: string;
      roomId?: string;
    };
    const modelName = (name || '').trim() || 'AWS Quick';
    const targetRoom = roomId || listRuns()[0]?.id;
    const { agent, isReconnect } = agentHub.join({
      model: modelName,
      role: '文件夹桥接桌面 Agent（1秒自动回执）',
      roomId: targetRoom,
      trigger: { type: 'manual' },
    });
    if (avatar?.trim()) {
      agentHub.updateAgent(agent.id, { avatar: avatar.trim() });
    }
    const dirs = agentHub.ensureBridgeWatcherScript(agent.id);
    if (targetRoom && !isReconnect) {
      engine.postSystemNotice(
        targetRoom,
        `📁 **${agent.name}** 已通过「一键文件夹桥接」加入聊天室`,
      );
    }
    res.json({
      ok: true,
      agent: agentHub.getAgent(agent.id) || agent,
      bridgeDir: dirs.baseDir,
      tasksDir: dirs.tasksDir,
      repliesDir: dirs.repliesDir,
      watchPyPath: dirs.watchPyPath,
    });
  });

  // Non-blocking backwards-compatible alias if an older agent still hits /next
  app.get('/api/agent/:agentId/next', (req, res) => {
    try {
      const task = agentHub.pullPendingTask(req.params.agentId);
      res.json({
        task,
        pollingDeprecated: true,
        note: '当前聊天室已切换为按需启动模式，无需循环轮询；拿到 null 时请直接结束本轮。',
      });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/agent/:agentId/progress', (req, res) => {
    const { message } = (req.body || {}) as { message?: string };
    const ok = agentHub.reportProgress(req.params.agentId, message || '');
    res.json({ ok });
  });

  app.post('/api/agent/:agentId/reply', (req, res) => {
    const body = (req.body || {}) as {
      taskId?: string;
      content?: string;
      reply?: string;
      message?: string;
      text?: string;
      roomId?: string;
      usage?: Partial<TokenUsage> & {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      };
      remainingLabel?: string;
      usedPercent?: number;
      resetAtLabel?: string;
      creditRemaining?: number;
      creditTotal?: number;
    };
    const content = (body.content || body.reply || body.message || body.text || '').trim();
    const {
      taskId,
      roomId,
      usage,
      remainingLabel,
      usedPercent,
      resetAtLabel,
      creditRemaining,
      creditTotal,
    } = body;
    if (!content) {
      res.status(400).json({ error: '请提供回复内容 content' });
      return;
    }
    try {
      const quotaUpdate: Partial<MemberQuotaConfig> = {};
      if (remainingLabel && remainingLabel.trim()) {
        quotaUpdate.balanceLabel = remainingLabel.trim().slice(0, 60);
        quotaUpdate.balanceCheckedAt = new Date().toISOString();
      }
      if (typeof usedPercent === 'number' && Number.isFinite(usedPercent)) {
        quotaUpdate.mode = 'subscription';
        quotaUpdate.usedPercent = usedPercent;
        if (resetAtLabel?.trim()) quotaUpdate.resetAtLabel = resetAtLabel.trim().slice(0, 32);
        quotaUpdate.balanceCheckedAt = new Date().toISOString();
      }
      if (typeof creditRemaining === 'number' && Number.isFinite(creditRemaining)) {
        quotaUpdate.mode = 'credits';
        quotaUpdate.creditRemaining = creditRemaining;
        if (typeof creditTotal === 'number' && Number.isFinite(creditTotal) && creditTotal > 0) {
          quotaUpdate.creditTotal = creditTotal;
        }
        quotaUpdate.balanceCheckedAt = new Date().toISOString();
      }
      if (Object.keys(quotaUpdate).length > 0) {
        updateMemberQuota(req.params.agentId, quotaUpdate);
      }
      const resolved = agentHub.submitReply(req.params.agentId, { taskId, content, usage });
      if (!resolved) {
        // Fallback: post as a proactive room message if no pending task matched
        const fallbackRoom = roomId || agentHub.getAgent(req.params.agentId)?.roomId || listRuns()[0]?.id;
        if (fallbackRoom) {
          engine.postAgentMessage(fallbackRoom, req.params.agentId, content);
        }
      }
      res.json({ ok: true, resolvedTask: resolved });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ===== Member Token Usage & Quota Telemetry =====
  app.get('/api/usage', (_req, res) => {
    res.json({ usage: loadMemberUsage() });
  });

  app.patch('/api/usage/:memberId/quota', (req, res) => {
    const patch = (req.body || {}) as Partial<MemberQuotaConfig>;
    const record = updateMemberQuota(req.params.memberId, {
      mode: patch.mode,
      usedPercent: patch.usedPercent,
      secondaryLabel:
        patch.secondaryLabel !== undefined ? patch.secondaryLabel.trim() || undefined : undefined,
      secondaryUsedPercent: patch.secondaryUsedPercent,
      resetAtLabel:
        patch.resetAtLabel !== undefined ? patch.resetAtLabel.trim() || undefined : undefined,
      creditUnit: patch.creditUnit !== undefined ? patch.creditUnit.trim() || '积分' : undefined,
      creditTotal: patch.creditTotal,
      creditRemaining: patch.creditRemaining,
      creditPerCall: patch.creditPerCall,
      tokenLimit: patch.tokenLimit,
      callLimit: patch.callLimit,
      periodLabel: patch.periodLabel !== undefined ? patch.periodLabel.trim() || undefined : undefined,
      balanceLabel: patch.balanceLabel !== undefined ? patch.balanceLabel.trim() || undefined : undefined,
      balanceCheckedAt:
        patch.balanceLabel || patch.usedPercent !== undefined || patch.creditRemaining !== undefined
          ? new Date().toISOString()
          : undefined,
    });
    res.json({ record, usage: loadMemberUsage() });
  });

  app.post('/api/usage/:memberId/reset', (req, res) => {
    const record = resetMemberUsage(req.params.memberId);
    res.json({ record, usage: loadMemberUsage() });
  });

  app.post('/api/usage/:memberId/refresh-balance', async (req, res) => {
    const memberId = req.params.memberId;
    const provider = loadProviders().find((p) => p.id === memberId);
    if (!provider || !provider.apiKey?.trim()) {
      res.json({
        ok: false,
        supported: false,
        message: '外部桌面/订阅模型未向本地开放余额接口，可在下方设置预算额度追踪剩余用量。',
      });
      return;
    }

    const baseUrl = (provider.apiBaseUrl || '').trim().toLowerCase();
    const apiKey = provider.apiKey.trim();
    try {
      if (baseUrl.includes('deepseek.com')) {
        const resp = await fetch('https://api.deepseek.com/user/balance', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) throw new Error(`DeepSeek 余额接口返回 ${resp.status}`);
        const data = (await resp.json()) as {
          is_available?: boolean;
          balance_infos?: Array<{ currency?: string; total_balance?: string }>;
        };
        const first = data.balance_infos?.[0];
        const label = first
          ? `${first.currency || 'CNY'} ${first.total_balance ?? '0'}`
          : data.is_available
            ? '可用'
            : '余额不足';
        const record = updateMemberQuota(memberId, {
          balanceLabel: label,
          balanceCheckedAt: new Date().toISOString(),
        });
        res.json({ ok: true, supported: true, balanceLabel: label, record, usage: loadMemberUsage() });
        return;
      }

      if (baseUrl.includes('openrouter.ai')) {
        const resp = await fetch('https://openrouter.ai/api/v1/credits', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) throw new Error(`OpenRouter 余额接口返回 ${resp.status}`);
        const data = (await resp.json()) as {
          data?: { total_credits?: number; total_usage?: number };
        };
        const remain = Math.max(0, (data.data?.total_credits ?? 0) - (data.data?.total_usage ?? 0));
        const label = `USD $${remain.toFixed(4)} 剩余`;
        const record = updateMemberQuota(memberId, {
          balanceLabel: label,
          balanceCheckedAt: new Date().toISOString(),
        });
        res.json({ ok: true, supported: true, balanceLabel: label, record, usage: loadMemberUsage() });
        return;
      }

      res.json({
        ok: false,
        supported: false,
        message: '该 API 服务商暂未提供公开余额查询接口（目前自动支持 DeepSeek / OpenRouter），可使用下方预算额度追踪剩余量。',
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        supported: true,
        message: err instanceof Error ? err.message : '余额查询失败',
      });
    }
  });

  app.post('/api/agent/:agentId/say', (req, res) => {
    const { roomId, content } = (req.body || {}) as { roomId?: string; content?: string };
    if (!content?.trim()) {
      res.status(400).json({ error: '请提供发言内容 content' });
      return;
    }
    const targetRoom = roomId || agentHub.getAgent(req.params.agentId)?.roomId || listRuns()[0]?.id;
    if (!targetRoom) {
      res.status(404).json({ error: '当前没有活跃聊天室' });
      return;
    }
    const run = engine.postAgentMessage(targetRoom, req.params.agentId, content);
    if (!run) {
      res.status(404).json({ error: '未找到对应的 Agent 或聊天室' });
      return;
    }
    res.json({ ok: true, roomId: targetRoom });
  });

  app.post('/api/agent/:agentId/leave', (req, res) => {
    const agent = agentHub.getAgent(req.params.agentId);
    const ok = agentHub.leave(req.params.agentId);
    if (ok && agent?.roomId) {
      engine.postSystemNotice(agent.roomId, `⚪ **${agent.name}** 已离开聊天室。`);
    }
    res.json({ ok });
  });

  app.delete('/api/agents/:agentId', (req, res) => {
    res.json({ removed: agentHub.remove(req.params.agentId) });
  });

  // ===== Providers =====
  app.get('/api/providers', (_req, res) => {
    res.json({ providers: loadProviders() });
  });

  app.put('/api/providers', (req, res) => {
    const { providers } = req.body as { providers?: ProviderConfig[] };
    if (!Array.isArray(providers) || providers.length === 0) {
      res.status(400).json({ error: 'providers 必须为非空数组' });
      return;
    }
    saveProviders(providers);
    res.json({ providers });
  });

  app.patch('/api/providers/:id', (req, res) => {
    const patch = (req.body || {}) as Partial<ProviderConfig>;
    const list = loadProviders();
    const idx = list.findIndex((p) => p.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: '未找到对应模型' });
      return;
    }
    const next: ProviderConfig = { ...list[idx], ...patch, id: list[idx].id };
    if (patch.avatar !== undefined) {
      next.avatar = patch.avatar.trim() || undefined;
    }
    if (patch.shortName !== undefined && patch.shortName.trim()) {
      next.shortName = patch.shortName.trim().slice(0, 48);
    }
    list[idx] = next;
    saveProviders(list);
    res.json({ provider: list[idx], providers: list });
  });

  app.post('/api/providers/check', async (_req, res) => {
    try {
      const providers = loadProviders();
      const health = await checkAllEnvironment(providers);
      res.json({ health });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/providers/test', async (req, res) => {
    const { provider } = (req.body || {}) as { provider?: ProviderConfig };
    if (!provider) {
      res.status(400).json({ error: '缺少 provider 配置' });
      return;
    }
    const result = await testProviderConnection(provider);
    res.json(result);
  });

  app.post('/api/providers/launch-terminal', (req, res) => {
    const { command, title, autoRun } = (req.body || {}) as {
      command?: string;
      title?: string;
      autoRun?: boolean;
    };
    const shouldAutoRun = autoRun !== false;
    const cleanCmd = (command || '').trim();
    if (shouldAutoRun && (!cleanCmd || cleanCmd.startsWith('#'))) {
      res.status(400).json({ error: '请先填写可执行的终端命令（不能是注释）' });
      return;
    }
    try {
      const safeTitle = (title || 'Multi-Agent Terminal').replace(/['"`\r\n]/g, '').slice(0, 48);
      if (process.platform === 'win32') {
        const banner = cleanCmd.replace(/'/g, "''");
        const innerLines = [
          `$Host.UI.RawUI.WindowTitle = '${safeTitle}'`,
          ...(shouldAutoRun
            ? [
                `Write-Host '>>> ${banner}' -ForegroundColor Cyan`,
                cleanCmd,
              ]
            : cleanCmd && !cleanCmd.startsWith('#')
              ? [
                  `Write-Host '已复制命令到剪贴板，按 Ctrl+V 或右键即可粘贴执行：' -ForegroundColor Cyan`,
                  `Write-Host '  ${banner}' -ForegroundColor Yellow`,
                  `Write-Host ''`,
                ]
              : [
                  `Write-Host '已打开本机终端，可直接粘贴命令执行。' -ForegroundColor Cyan`,
                  `Write-Host ''`,
                ]),
        ];
        const innerEncoded = Buffer.from(innerLines.join('; '), 'utf16le').toString('base64');
        const launcherScript = `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-EncodedCommand','${innerEncoded}') -PassThru; Write-Output $p.Id`;
        const launcherEncoded = Buffer.from(launcherScript, 'utf16le').toString('base64');
        const pidOut = execFileSync(
          'powershell.exe',
          ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', launcherEncoded],
          { encoding: 'utf8', windowsHide: true, timeout: 10000 },
        ).trim();
        res.json({ ok: true, launched: cleanCmd, autoRun: shouldAutoRun, pid: Number(pidOut) || undefined });
        return;
      } else if (process.platform === 'darwin') {
        const script = shouldAutoRun
          ? cleanCmd
          : `echo 'Copied to clipboard - press Cmd+V to paste:'`;
        const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const child = spawn(
          'osascript',
          ['-e', `tell application "Terminal" to do script "${escaped}"`, '-e', 'tell application "Terminal" to activate'],
          { detached: true, stdio: 'ignore' },
        );
        child.unref();
      } else {
        const bashCmd = shouldAutoRun
          ? `${cleanCmd}; exec bash`
          : `echo 'Copied to clipboard - paste to run'; exec bash`;
        const child = spawn('x-terminal-emulator', ['-e', 'bash', '-lc', bashCmd], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
      res.json({ ok: true, launched: cleanCmd, autoRun: shouldAutoRun });
    } catch (err) {
      res.status(500).json({ error: `打开本机终端失败：${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ===== Workbench (Skills, Plugins/MCP, Global Knowledge, Templates & Schedules) =====
  app.get('/api/workbench', (_req, res) => {
    res.json({ workbench: loadWorkbench() });
  });

  app.put('/api/workbench', (req, res) => {
    const incoming = (req.body?.workbench || req.body || {}) as Partial<WorkbenchConfig>;
    const current = loadWorkbench();
    const next: WorkbenchConfig = {
      skills: Array.isArray(incoming.skills) ? incoming.skills : current.skills,
      plugins: Array.isArray(incoming.plugins) ? incoming.plugins : current.plugins,
      knowledge: Array.isArray(incoming.knowledge) ? incoming.knowledge : current.knowledge,
      templates: Array.isArray(incoming.templates) ? incoming.templates : current.templates,
      schedules: Array.isArray(incoming.schedules) ? incoming.schedules : current.schedules,
    };
    saveWorkbench(next);
    res.json({ workbench: next });
  });

  app.get('/api/workbench/skills/discover', (req, res) => {
    const cwd = typeof req.query.cwd === 'string' ? req.query.cwd : undefined;
    const customDir = typeof req.query.dir === 'string' ? req.query.dir : undefined;
    const result = discoverLocalSkills({ cwd, customDir });
    res.json(result);
  });

  app.post('/api/workbench/skills/import-url', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url : '';
      const result = await importSkillsFromUrl(url);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/workbench/plugins/:id/test', async (req, res) => {
    const wb = loadWorkbench();
    const idx = wb.plugins.findIndex((p) => p.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: '未找到对应插件' });
      return;
    }
    const cwd = (req.body as { cwd?: string } | undefined)?.cwd || process.cwd();
    const result = await testWorkbenchPlugin(wb.plugins[idx], cwd);
    wb.plugins[idx] = {
      ...wb.plugins[idx],
      lastTestOk: result.ok,
      lastTestMessage: result.message,
      lastTestedAt: new Date().toISOString(),
    };
    saveWorkbench(wb);
    res.json({ result, plugin: wb.plugins[idx], workbench: wb });
  });

  app.post('/api/workbench/schedules/:id/run', async (req, res) => {
    try {
      const roomId = (req.body as { roomId?: string } | undefined)?.roomId;
      const out = await workbenchScheduler.runNow(req.params.id, roomId);
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ===== Workflow Definition & Templates =====
  app.get('/api/workflow', (_req, res) => {
    res.json({ workflow: loadWorkflow() });
  });

  app.put('/api/workflow', (req, res) => {
    const { workflow } = req.body as { workflow?: WorkflowDefinition };
    if (!workflow || !Array.isArray(workflow.nodes)) {
      res.status(400).json({ error: '无效的工作流定义' });
      return;
    }
    saveWorkflow(workflow);
    // If current workflow matches an existing template id, also keep that template's saved node/model config synced
    const templates = loadWorkflowTemplates();
    const tIdx = templates.findIndex((t) => t.id === workflow.id);
    if (tIdx >= 0) {
      templates[tIdx] = {
        ...templates[tIdx],
        workflow: structuredClone(workflow),
        updatedAt: new Date().toISOString(),
      };
      saveWorkflowTemplates(templates);
    }
    res.json({ workflow, templates });
  });

  app.post('/api/workflow/reset', (_req, res) => {
    const workflow = resetWorkflow();
    res.json({ workflow });
  });

  app.post('/api/workflow/generate', async (req, res) => {
    const ac = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) ac.abort();
    };
    req.on('close', onClose);
    try {
      const body = (req.body || {}) as {
        prompt?: string;
        currentWorkflow?: WorkflowDefinition;
        onlineMemberIds?: string[];
        providerId?: string;
        generatorId?: string;
        apply?: boolean;
      };
      const result = await generateWorkflowFromPrompt({
        prompt: body.prompt || '',
        currentWorkflow: body.currentWorkflow,
        onlineMemberIds: body.onlineMemberIds,
        providerId: body.providerId || body.generatorId,
        signal: ac.signal,
      });
      if (ac.signal.aborted || res.writableEnded) return;
      if (body.apply !== false) {
        saveWorkflow(result.workflow);
      }
      res.json(result);
    } catch (err) {
      if (ac.signal.aborted || res.writableEnded) return;
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      req.off('close', onClose);
    }
  });

  app.get('/api/workflow-templates', (_req, res) => {
    res.json({ templates: loadWorkflowTemplates() });
  });

  app.post('/api/workflow-templates', (req, res) => {
    const body = (req.body || {}) as {
      id?: string;
      name?: string;
      description?: string;
      workflow?: WorkflowDefinition;
    };
    const name = (body.name || body.workflow?.name || '').trim().slice(0, 60);
    if (!name || !body.workflow || !Array.isArray(body.workflow.nodes) || body.workflow.nodes.length === 0) {
      res.status(400).json({ error: '请提供有效的模板名称与阶段节点' });
      return;
    }
    const templates = loadWorkflowTemplates();
    const id = body.id?.trim() || `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    const nextItem: WorkflowPresetTemplate = {
      id,
      name,
      description: (body.description || body.workflow.description || '自定义多模型工作流模板').trim(),
      builtin: false,
      workflow: {
        ...structuredClone(body.workflow),
        id,
        name,
      },
      updatedAt: new Date().toISOString(),
    };
    const idx = templates.findIndex((t) => t.id === id);
    if (idx >= 0) {
      templates[idx] = { ...nextItem, builtin: templates[idx].builtin };
    } else {
      templates.push(nextItem);
    }
    saveWorkflowTemplates(templates);
    res.status(201).json({ template: nextItem, templates });
  });

  app.post('/api/workflow-templates/:id/apply', (req, res) => {
    const templates = loadWorkflowTemplates();
    const tpl = templates.find((t) => t.id === req.params.id);
    if (!tpl) {
      res.status(404).json({ error: '未找到对应的工作流模板' });
      return;
    }
    const wf = structuredClone(tpl.workflow);
    saveWorkflow(wf);
    res.json({ workflow: wf, template: tpl });
  });

  app.delete('/api/workflow-templates/:id', (req, res) => {
    const templates = loadWorkflowTemplates();
    const target = templates.find((t) => t.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: '未找到对应的工作流模板' });
      return;
    }
    if (target.builtin) {
      res.status(400).json({ error: '内置模板不可删除，可直接编辑各阶段或另存为自定义模板' });
      return;
    }
    const next = templates.filter((t) => t.id !== req.params.id);
    saveWorkflowTemplates(next);
    res.json({ removed: true, templates: next });
  });

  // ===== Runs =====
  app.get('/api/runs', (_req, res) => {
    res.json({ runs: engine.listRuns() });
  });

  app.post('/api/runs', (req, res) => {
    const payload = (req.body || {}) as CreateRunPayload;
    try {
      const run = engine.createAndStartRun(payload);
      res.status(201).json({ run });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/runs/:id/chat', async (req, res) => {
    try {
      const payload = req.body as ChatSendPayload;
      const run = await engine.sendChatMessage(req.params.id, payload);
      res.json({ run });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = engine.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: '运行记录不存在' });
      return;
    }
    res.json({ run });
  });

  app.patch('/api/runs/:id', (req, res) => {
    const { title } = (req.body || {}) as { title?: string };
    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: '会话名不能为空' });
      return;
    }
    const run = engine.renameRun(req.params.id, title);
    if (!run) {
      res.status(404).json({ error: '运行记录不存在' });
      return;
    }
    res.json({ run });
  });

  app.delete('/api/runs/:id', (req, res) => {
    engine.abortRun(req.params.id);
    const removed = deleteRun(req.params.id);
    res.json({ removed });
  });

  app.post('/api/runs/:id/approve', (req, res) => {
    try {
      const payload = req.body as ApprovalPayload;
      const run = engine.submitApproval(req.params.id, payload);
      res.json({ run });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/runs/:id/rerun', (req, res) => {
    try {
      const { nodeId } = req.body as { nodeId?: string };
      if (!nodeId) {
        res.status(400).json({ error: '请提供 nodeId' });
        return;
      }
      const run = engine.rerunFromNode(req.params.id, nodeId);
      res.json({ run });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/runs/:id/abort', (req, res) => {
    const run = engine.abortRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: '运行记录不存在' });
      return;
    }
    res.json({ run });
  });

  app.post('/api/runs/:id/messages/:msgId/cancel', (req, res) => {
    const run = engine.cancelMessage(req.params.id, req.params.msgId);
    if (!run) {
      res.status(404).json({ error: '运行记录不存在' });
      return;
    }
    res.json({ run });
  });

  app.get('/api/workspace/files', (req, res) => {
    const rawCwd = typeof req.query.cwd === 'string' && req.query.cwd.trim()
      ? req.query.cwd.trim()
      : process.cwd();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const rootDir = path.resolve(rawCwd);
    if (!fs.existsSync(rootDir)) {
      res.json({ rootDir, files: [] });
      return;
    }

    const IGNORE_DIRS = new Set([
      '.git',
      'node_modules',
      'dist',
      'dist-server',
      'release',
      '.next',
      '.nuxt',
      '__pycache__',
      '.venv',
      'venv',
      'target',
      '.cache',
    ]);

    const files: Array<{
      relPath: string;
      absPath: string;
      name: string;
      size: number;
      ext: string;
    }> = [];

    const walk = (dir: string, depth: number) => {
      if (depth > 5 || files.length >= 250) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= 250) break;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          const relPath = path.relative(rootDir, full).replace(/\\/g, '/');
          if (q && !relPath.toLowerCase().includes(q) && !entry.name.toLowerCase().includes(q)) {
            continue;
          }
          try {
            const stat = fs.statSync(full);
            files.push({
              relPath,
              absPath: full,
              name: entry.name,
              size: stat.size,
              ext: path.extname(entry.name).replace(/^\./, '').toUpperCase(),
            });
          } catch {
            // skip unreadable file
          }
        }
      }
    };

    walk(rootDir, 0);
    files.sort((a, b) => a.relPath.localeCompare(b.relPath));
    res.json({ rootDir, files: files.slice(0, 80) });
  });

  /** Safe path resolver guaranteeing target stays strictly within rootDir */
  const resolveWithinRoot = (rawCwd: string, rawTarget = ''): { rootDir: string; absPath: string; relPath: string } => {
    const rootDir = path.resolve(rawCwd || process.cwd());
    const absPath = rawTarget
      ? path.isAbsolute(rawTarget)
        ? path.resolve(rawTarget)
        : path.resolve(rootDir, rawTarget)
      : rootDir;
    const rel = path.relative(rootDir, absPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('路径超出当前工作区范围');
    }
    return { rootDir, absPath, relPath: rel.replace(/\\/g, '/') };
  };

  const WORKSPACE_SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    '__pycache__',
    '.venv',
    'venv',
    '.next',
    '.nuxt',
    '.cache',
    'release',
  ]);

  app.get('/api/workspace/tree', (req, res) => {
    try {
      const rawCwd = typeof req.query.cwd === 'string' && req.query.cwd.trim()
        ? req.query.cwd.trim()
        : process.cwd();
      const rawDir = typeof req.query.dir === 'string' ? req.query.dir.trim() : '';
      const showHidden = req.query.hidden === '1';
      const { rootDir, absPath, relPath } = resolveWithinRoot(rawCwd, rawDir);

      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        res.status(404).json({ error: '目录不存在' });
        return;
      }

      const dirents = fs.readdirSync(absPath, { withFileTypes: true });
      const entries: Array<{
        name: string;
        relPath: string;
        absPath: string;
        isDir: boolean;
        size: number;
        ext: string;
        mtime: string;
      }> = [];

      for (const d of dirents) {
        if (!showHidden && (d.name.startsWith('.') || WORKSPACE_SKIP_DIRS.has(d.name))) {
          if (d.name !== '.env.example' && d.name !== '.gitignore') continue;
        }
        const full = path.join(absPath, d.name);
        const isDir = d.isDirectory();
        let size = 0;
        let mtime = '';
        try {
          const st = fs.statSync(full);
          size = isDir ? 0 : st.size;
          mtime = st.mtime.toISOString();
        } catch {
          continue;
        }
        entries.push({
          name: d.name,
          relPath: path.relative(rootDir, full).replace(/\\/g, '/'),
          absPath: full,
          isDir,
          size,
          ext: isDir ? '' : path.extname(d.name).replace(/^\./, '').toLowerCase(),
          mtime,
        });
      }

      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      res.json({ rootDir, dir: relPath, entries: entries.slice(0, 300) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/workspace/read', (req, res) => {
    try {
      const rawCwd = typeof req.query.cwd === 'string' && req.query.cwd.trim()
        ? req.query.cwd.trim()
        : process.cwd();
      const rawFile = typeof req.query.file === 'string' ? req.query.file.trim() : '';
      if (!rawFile) {
        res.status(400).json({ error: '缺少文件路径' });
        return;
      }
      const { absPath, relPath } = resolveWithinRoot(rawCwd, rawFile);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }

      const stat = fs.statSync(absPath);
      const name = path.basename(absPath);
      const ext = path.extname(name).replace(/^\./, '').toLowerCase();
      const imageMimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
      };

      if (imageMimeMap[ext]) {
        const mimeType = imageMimeMap[ext];
        const dataUrl =
          stat.size <= 5 * 1024 * 1024
            ? `data:${mimeType};base64,${fs.readFileSync(absPath).toString('base64')}`
            : undefined;
        res.json({
          absPath,
          relPath,
          name,
          size: stat.size,
          ext,
          isBinary: true,
          isImage: true,
          mimeType,
          content: '',
          dataUrl,
        });
        return;
      }

      const MAX_BYTES = 512 * 1024;
      const truncated = stat.size > MAX_BYTES;
      const fd = fs.openSync(absPath, 'r');
      const buf = Buffer.alloc(Math.min(stat.size, MAX_BYTES));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);

      // Heuristic binary detection (null bytes in first 4KB)
      let isBinary = false;
      const probeLen = Math.min(buf.length, 4096);
      for (let i = 0; i < probeLen; i++) {
        if (buf[i] === 0) {
          isBinary = true;
          break;
        }
      }

      res.json({
        absPath,
        relPath,
        name,
        size: stat.size,
        ext,
        isBinary,
        isImage: false,
        truncated,
        mimeType: isBinary ? 'application/octet-stream' : 'text/plain',
        content: isBinary ? '' : buf.toString('utf8'),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put('/api/workspace/write', (req, res) => {
    try {
      const rawCwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim() : process.cwd();
      const rawFile = typeof req.body?.file === 'string' ? req.body.file.trim() : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      if (!rawFile) {
        res.status(400).json({ error: '缺少文件路径' });
        return;
      }
      const { absPath, relPath } = resolveWithinRoot(rawCwd, rawFile);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf8');
      const stat = fs.statSync(absPath);
      res.json({ ok: true, absPath, relPath, size: stat.size });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/workspace/create', (req, res) => {
    try {
      const rawCwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim() : process.cwd();
      const rawRel = typeof req.body?.relPath === 'string' ? req.body.relPath.trim() : '';
      const kind = req.body?.kind === 'dir' ? 'dir' : 'file';
      if (!rawRel) {
        res.status(400).json({ error: '请输入名称或相对路径' });
        return;
      }
      const { absPath, relPath } = resolveWithinRoot(rawCwd, rawRel);
      if (fs.existsSync(absPath)) {
        res.status(409).json({ error: '目标已存在' });
        return;
      }
      if (kind === 'dir') {
        fs.mkdirSync(absPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, '', 'utf8');
      }
      res.json({ ok: true, absPath, relPath, kind });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/workspace/git-status', (req, res) => {
    const rawCwd = typeof req.query.cwd === 'string' && req.query.cwd.trim()
      ? req.query.cwd.trim()
      : process.cwd();
    const rootDir = path.resolve(rawCwd);
    if (!fs.existsSync(rootDir)) {
      res.json({ isGitRepo: false, branch: '', changes: [] });
      return;
    }
    try {
      const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (inside !== 'true') {
        res.json({ isGitRepo: false, branch: '', changes: [] });
        return;
      }
      let branch = 'HEAD';
      try {
        branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: rootDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // empty repo without commits
      }
      const rawStatus = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const gitTop = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      const changes = rawStatus
        .split(/\r?\n/)
        .filter((l) => l.length >= 4)
        .slice(0, 150)
        .map((line) => {
          const code = line.slice(0, 2);
          let filePart = line.slice(3).trim();
          if (filePart.includes(' -> ')) {
            filePart = filePart.split(' -> ').pop()!.trim();
          }
          filePart = filePart.replace(/^"|"$/g, '');
          const absPath = path.resolve(gitTop, filePart);
          const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/');
          const statusLabel =
            code === '??'
              ? '新增'
              : code.includes('D')
                ? '删除'
                : code.includes('A')
                  ? '暂存'
                  : code.includes('R')
                    ? '重命名'
                    : '修改';
          return { code: code.trim() || 'M', statusLabel, relPath, absPath, gitPath: filePart };
        });

      res.json({ isGitRepo: true, branch, changes });
    } catch {
      res.json({ isGitRepo: false, branch: '', changes: [] });
    }
  });

  app.get('/api/workspace/git-diff', (req, res) => {
    try {
      const rawCwd = typeof req.query.cwd === 'string' && req.query.cwd.trim()
        ? req.query.cwd.trim()
        : process.cwd();
      const rawFile = typeof req.query.file === 'string' ? req.query.file.trim() : '';
      const rootDir = path.resolve(rawCwd);
      if (!rawFile) {
        res.status(400).json({ error: '缺少文件参数' });
        return;
      }
      const gitTop = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      let diffText = '';
      try {
        const unstaged = execFileSync('git', ['diff', '--', rawFile], {
          cwd: gitTop,
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const staged = execFileSync('git', ['diff', '--cached', '--', rawFile], {
          cwd: gitTop,
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        diffText = [staged, unstaged].filter(Boolean).join('\n');
      } catch {
        // fall through to untracked check
      }

      if (!diffText.trim()) {
        const abs = path.resolve(gitTop, rawFile);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile() && fs.statSync(abs).size <= 256 * 1024) {
          const text = fs.readFileSync(abs, 'utf8');
          diffText = `--- /dev/null\n+++ b/${rawFile}\n@@ -0,0 +1,${text.split('\n').length} @@\n${text
            .split('\n')
            .map((l) => `+${l}`)
            .join('\n')}`;
        }
      }

      res.json({ file: rawFile, diff: diffText });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/workspace/open-explorer', (req, res) => {
    try {
      const target = typeof req.body?.targetPath === 'string' ? req.body.targetPath.trim() : '';
      if (!target || !fs.existsSync(target)) {
        res.status(404).json({ error: '路径不存在' });
        return;
      }
      if (process.platform === 'win32') {
        const isFile = fs.statSync(target).isFile();
        const child = spawn(
          'explorer.exe',
          isFile ? ['/select,', path.resolve(target)] : [path.resolve(target)],
          { detached: true, stdio: 'ignore' },
        );
        child.unref();
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/runs/:id/attach-local', (req, res) => {
    try {
      const run = engine.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: '运行记录不存在' });
        return;
      }
      const { absPath } = (req.body || {}) as { absPath?: string };
      if (!absPath?.trim() || !fs.existsSync(absPath)) {
        res.status(404).json({ error: '找不到指定的本地文件' });
        return;
      }
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) {
        res.status(400).json({ error: '只能引用单个文件' });
        return;
      }
      if (stat.size > 15 * 1024 * 1024) {
        res.status(400).json({ error: '文件超过 15MB 限制' });
        return;
      }

      const name = path.basename(absPath);
      const ext = path.extname(name).toLowerCase();
      const imgMime: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
      };
      const isImg = Boolean(imgMime[ext]);
      const isText =
        !isImg &&
        /\.(md|txt|json|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|css|scss|html|xml|yaml|yml|toml|ini|env|sql|csv|sh|ps1|log)$/i.test(
          name,
        );

      let url: string | undefined;
      let textContent: string | undefined;
      if (isImg) {
        const buf = fs.readFileSync(absPath);
        const { storedName } = saveUploadedFile(run.id, name, buf);
        url = `/api/runs/${encodeURIComponent(run.id)}/uploads/${encodeURIComponent(storedName)}`;
      } else if (isText) {
        textContent = fs.readFileSync(absPath, 'utf8').slice(0, 40000);
      }

      res.status(201).json({
        attachment: {
          id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          size: stat.size,
          mimeType: imgMime[ext] || (isText ? 'text/plain' : 'application/octet-stream'),
          savedPath: absPath,
          url,
          textContent,
        },
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/runs/:id/upload', (req, res) => {
    try {
      const run = engine.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: '运行记录不存在' });
        return;
      }
      const body = (req.body || {}) as {
        name?: string;
        mimeType?: string;
        dataBase64?: string;
        textContent?: string;
      };
      const name = (body.name || 'attachment').trim().slice(0, 120);
      const mimeType = (body.mimeType || 'application/octet-stream').trim();
      const buffer = body.dataBase64
        ? Buffer.from(body.dataBase64, 'base64')
        : Buffer.from(body.textContent || '', 'utf8');
      const { storedName, savedPath } = saveUploadedFile(run.id, name, buffer);
      res.status(201).json({
        attachment: {
          id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          size: buffer.length,
          mimeType,
          savedPath,
          url: `/api/runs/${encodeURIComponent(run.id)}/uploads/${encodeURIComponent(storedName)}`,
          textContent: body.textContent ? body.textContent.slice(0, 40000) : undefined,
        },
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/runs/:id/uploads/:fileName', (req, res) => {
    const dir = getUploadsDir(req.params.id);
    const safe = path.basename(req.params.fileName);
    const fullPath = path.join(dir, safe);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: '文件不存在' });
      return;
    }
    res.sendFile(fullPath);
  });

  app.post('/api/runs/:id/materials', (req, res) => {
    try {
      const { title, content, source } = (req.body || {}) as {
        title?: string;
        content?: string;
        source?: 'manual' | 'file';
      };
      const run = engine.addMaterial(req.params.id, {
        title: title || '参考资料',
        content: content || '',
        source,
      });
      res.status(201).json({ run });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/runs/:id/materials/:materialId', (req, res) => {
    try {
      const run = engine.deleteMaterial(req.params.id, req.params.materialId);
      res.json({ run });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/runs/:id/export', (req, res) => {
    try {
      const md = engine.exportMarkdown(req.params.id);
      res.type('text/markdown; charset=utf-8').send(md);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ===== SSE Stream =====
  app.get('/api/runs/:id/stream', (req, res) => {
    const runId = req.params.id;
    const run = engine.getRun(runId);
    if (!run) {
      res.status(404).json({ error: '运行记录不存在' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (snapshot: WorkflowRun) => {
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };

    send(run);

    const listener = (updated: WorkflowRun) => send(updated);
    engine.on(`run:${runId}`, listener);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      engine.off(`run:${runId}`, listener);
    });
  });

  // Serve built frontend
  const distDir = options?.distDir || path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

export function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  if (options.dataDir) {
    process.env.AGENT_WORKFLOW_DATA_DIR = options.dataDir;
  }
  const host = options.host || '127.0.0.1';
  const requestedPort = options.port ?? Number(process.env.PORT || 4310);
  const app = createApp({ distDir: options.distDir, portHint: requestedPort, host });

  return new Promise((resolve, reject) => {
    const server = app.listen(requestedPort, host, () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr.port;
      workbenchScheduler.start(async (sched, targetRoomId) => {
        const onlineAgents = agentHub.listAgents().filter((a) => a.online).map((a) => a.id);
        const fallbackTargets =
          sched.targetIds && sched.targetIds.length > 0
            ? sched.targetIds
            : onlineAgents.length > 0
              ? [onlineAgents[0]]
              : [loadProviders()[0]?.id || 'claude'];
        engine.postSystemNotice(
          targetRoomId,
          `⏰ 定时任务 **「${sched.name}」** 已触发执行`,
        );
        await engine.sendChatMessage(targetRoomId, {
          content: `[定时任务 · ${sched.name}] ${sched.prompt}`,
          targetProviderIds: fallbackTargets,
          mode: sched.mode,
        });
      });
      console.log(`[agent-workflow] 本地编排服务已启动：http://${host}:${actualPort}`);
      console.log(`[agent-workflow] 仅绑定本机 127.0.0.1，所有数据与订阅 CLI 调用均在本地运行。`);
      resolve({
        port: actualPort,
        host,
        server,
        close: () =>
          new Promise<void>((res) => {
            workbenchScheduler.stop();
            server.close(() => res());
          }),
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

// Direct CLI execution guard (works in both CJS/ESM and tsx)
const isMainModule =
  typeof require !== 'undefined'
    ? require.main === module
    : process.argv[1] &&
      path.resolve(process.argv[1]) === path.resolve(__filename || '');

if (isMainModule) {
  void startServer().catch((err) => {
    console.error('[agent-workflow] 启动失败：', err);
    process.exit(1);
  });
}
