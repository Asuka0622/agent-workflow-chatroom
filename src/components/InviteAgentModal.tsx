import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  FolderSync,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Plug,
  Sparkles,
  Terminal,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type { AgentTrigger, ConnectedAgent } from '../../shared/types';
import { api } from '../api';
import { MemberAvatar } from './MemberAvatar';

interface InviteAgentModalProps {
  roomId: string;
  agents: ConnectedAgent[];
  onClose: () => void;
  onOpenProviders?: () => void;
  onRenameAgent: (
    id: string,
    payload: {
      modelName?: string;
      relayName?: string;
      online?: boolean;
      trigger?: AgentTrigger;
    },
  ) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
}

type ScenarioKey = 'chat' | 'bridge' | 'mcp';

export const InviteAgentModal: React.FC<InviteAgentModalProps> = ({
  roomId,
  agents,
  onClose,
  onOpenProviders,
  onRenameAgent,
  onDeleteAgent,
}) => {
  const [scenario, setScenario] = useState<ScenarioKey>('chat');
  const [joinMode, setJoinMode] = useState<'standby' | 'register'>('standby');
  const [mcpMode, setMcpMode] = useState<'http' | 'stdio'>('http');
  const [copiedKey, setCopiedKey] = useState('');

  // Quick File-Bridge state
  const [bridgeName, setBridgeName] = useState('AWS Quick');
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeError, setBridgeError] = useState('');
  const [bridgeResult, setBridgeResult] = useState<{
    agent: ConnectedAgent;
    bridgeDir: string;
    tasksDir: string;
    repliesDir: string;
    watchPyPath: string;
  } | null>(null);

  // Connected members drawer (collapsed by default for clean first-time flow)
  const [showManage, setShowManage] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModel, setEditModel] = useState('');
  const [editRelay, setEditRelay] = useState('');
  const [editTriggerType, setEditTriggerType] = useState<'manual' | 'cli' | 'webhook'>('manual');
  const [editCmd, setEditCmd] = useState('');
  const [editArgs, setEditArgs] = useState('');
  const [editWebhook, setEditWebhook] = useState('');
  const [detectingId, setDetectingId] = useState('');
  const [detectHint, setDetectHint] = useState<
    Record<
      string,
      {
        found: boolean;
        message: string;
        installCmd?: string;
        loginCmd?: string;
        note?: string;
      }
    >
  >({});

  const origin = window.location.origin;

  const chatPrompt = useMemo(() => {
    if (joinMode === 'standby') {
      return `请加入我本地的多模型群聊（${origin}），按下面两步完成，不要反问我名字：
1. 运行 \`chatroom join --model "<你的具体模型名>" --json\` 完成入群；
2. 立刻运行 \`chatroom wait --json\` 进入 0 Token 静默待命（收到 @ 任务后运行 \`chatroom reply --task <taskId> --text "<回复>"\` 并继续待命）。`;
    }
    return `请一次性加入我本地的多模型群聊（${origin}），不要反问我名字，注册完立刻结束本轮：
1. 运行 \`chatroom join --model "<你的具体模型名>" --json\` 完成入群（聊天室会自动识别本机 CLI）；
2. 告诉我你的模型名和最终绑定方式即可结束。`;
  }, [origin, joinMode]);

  const bridgePrompt = useMemo(() => {
    if (!bridgeResult) return '';
    return `python "${bridgeResult.watchPyPath}"`;
  }, [bridgeResult]);

  const mcpHttpUrl = `${origin}/mcp`;
  const mcpHttpConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            'multi-agent-chatroom': {
              url: mcpHttpUrl,
            },
          },
        },
        null,
        2,
      ),
    [mcpHttpUrl],
  );
  const mcpStdioConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            'multi-agent-chatroom': {
              command: 'chatroom',
              args: ['mcp'],
            },
          },
        },
        null,
        2,
      ),
    [],
  );

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? '' : cur)), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleQuickBridge = async () => {
    const cleanName = bridgeName.trim() || 'AWS Quick';
    setBridgeBusy(true);
    setBridgeError('');
    try {
      const res = await api.createQuickBridgeAgent({
        name: cleanName,
        roomId: roomId || undefined,
      });
      setBridgeResult({
        agent: res.agent,
        bridgeDir: res.bridgeDir,
        tasksDir: res.tasksDir,
        repliesDir: res.repliesDir,
        watchPyPath: res.watchPyPath,
      });
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : '创建文件桥接失败');
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleDetectCli = async (agentId: string) => {
    setDetectingId(agentId);
    try {
      const res = await api.detectAgentCli(agentId);
      setDetectHint((prev) => ({
        ...prev,
        [agentId]: {
          found: res.found,
          message: res.message,
          installCmd: res.suggestion?.installCmd,
          loginCmd: res.suggestion?.loginCmd,
          note: res.suggestion?.note,
        },
      }));
    } catch (err) {
      setDetectHint((prev) => ({
        ...prev,
        [agentId]: {
          found: false,
          message: err instanceof Error ? err.message : '检测失败',
        },
      }));
    } finally {
      setDetectingId('');
    }
  };

  const startEdit = (a: ConnectedAgent) => {
    setEditingId(a.id);
    setEditModel(
      a.modelName || a.name.replace(/\s*[（(][^）)]+[）)]\s*$/, '').trim(),
    );
    setEditRelay(a.relayName || '');
    const t = a.trigger || { type: 'manual' };
    setEditTriggerType(t.type);
    setEditCmd(t.type === 'cli' ? t.command : '');
    setEditArgs(t.type === 'cli' ? (t.args || []).join(' ') : '');
    setEditWebhook(t.type === 'webhook' ? t.url : '');
  };

  const saveEdit = async (id: string) => {
    let trigger: AgentTrigger = { type: 'manual' };
    if (editTriggerType === 'cli' && editCmd.trim()) {
      trigger = {
        type: 'cli',
        command: editCmd.trim(),
        args: editArgs.split(/\s+/).filter(Boolean),
        inputMode: 'stdin',
      };
    } else if (editTriggerType === 'webhook' && editWebhook.trim()) {
      trigger = {
        type: 'webhook',
        url: editWebhook.trim(),
      };
    }
    await onRenameAgent(id, {
      modelName: editModel,
      relayName: editRelay,
      trigger,
    });
    setEditingId(null);
  };

  const triggerBadge = (a: ConnectedAgent) => {
    if (a.trigger?.type === 'cli') return `⚡ 自动拉起 CLI (${a.trigger.command})`;
    if (a.trigger?.type === 'webhook') return '⚡ 自动回调 Webhook';
    if (a.lastBridgeAt) return '📁 文件桥接';
    return '待命（按需唤醒）';
  };

  const onlineCount = agents.filter((a) => a.online).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 670 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserPlus size={17} />
            <h2>一键拉模型入群</h2>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {/* Step 1: Pick Scenario */}
          <div className="invite-scenario-grid" role="tablist" aria-label="选择接入场景">
            <button
              type="button"
              role="tab"
              aria-selected={scenario === 'chat'}
              className={`invite-scenario-card ${scenario === 'chat' ? 'active' : ''}`}
              onClick={() => setScenario('chat')}
            >
              <div className="isc-head">
                <MessageSquare size={14} />
                <strong>对话 / IDE 客户端</strong>
              </div>
              <span>WorkBuddy · Cursor · Antigravity · Cline</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={scenario === 'bridge'}
              className={`invite-scenario-card ${scenario === 'bridge' ? 'active' : ''}`}
              onClick={() => setScenario('bridge')}
            >
              <div className="isc-head">
                <FolderSync size={14} />
                <strong>受限桌面端（文件桥接）</strong>
              </div>
              <span>AWS Quick 等无命令行但可读写目录</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={scenario === 'mcp'}
              className={`invite-scenario-card ${scenario === 'mcp' ? 'active' : ''}`}
              onClick={() => setScenario('mcp')}
            >
              <div className="isc-head">
                <Plug size={14} />
                <strong>MCP 客户端</strong>
              </div>
              <span>Claude Desktop · Cherry Studio · Cursor</span>
            </button>
          </div>

          {/* Step 2: Action Box for Chosen Scenario */}
          {scenario === 'chat' && (
            <div className="invite-step-box">
              <div className="invite-step-head">
                <strong style={{ fontSize: 12.5 }}>把下面 3 行直接发给对方，即可自动入群</strong>
                <div className="invite-mode-pills">
                  <button
                    type="button"
                    className={`member-quota-tab ${joinMode === 'standby' ? 'active' : ''}`}
                    onClick={() => setJoinMode('standby')}
                  >
                    一步入群并秒回（推荐）
                  </button>
                  <button
                    type="button"
                    className={`member-quota-tab ${joinMode === 'register' ? 'active' : ''}`}
                    onClick={() => setJoinMode('register')}
                  >
                    仅登记入群
                  </button>
                </div>
              </div>

              <pre className="invite-prompt-box" style={{ maxHeight: 150 }}>
                {chatPrompt}
              </pre>

              <div className="invite-primary-action-row">
                <span className="invite-micro-hint">
                  入群时会自动探测本机 CLI（Claude / Gemini / Codex / Ollama），没有则走 0 Token 静默待命。
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleCopyText('chat', chatPrompt)}
                >
                  {copiedKey === 'chat' ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey === 'chat' ? '已复制，去粘贴发送' : '一键复制发给对方'}
                </button>
              </div>
            </div>
          )}

          {scenario === 'bridge' && (
            <div className="invite-step-box">
              <div className="invite-step-head">
                <strong style={{ fontSize: 12.5 }}>
                  专为 AWS Quick 等逐轮对话桌面端设计（单轮直答 + 自动回执，不触发安全拦截）
                </strong>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={bridgeName}
                  onChange={(e) => setBridgeName(e.target.value)}
                  placeholder="给对方起个名字，如 AWS Quick / 企业内网助手"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !bridgeBusy) {
                      void handleQuickBridge();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                  disabled={bridgeBusy}
                  onClick={() => void handleQuickBridge()}
                >
                  {bridgeBusy ? <Loader2 size={14} className="spin" /> : <FolderSync size={14} />}
                  {bridgeBusy ? '登记中…' : '一键登记该成员'}
                </button>
              </div>

              {bridgeError && (
                <div className="wb-test-output fail" style={{ marginBottom: 8 }}>
                  {bridgeError}
                </div>
              )}

              {bridgeResult ? (
                <>
                  <div
                    className="wb-test-output ok"
                    style={{
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>
                      已登记成员 <strong>{bridgeResult.agent.name}</strong> 并准备好本地回执目录
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void api.openInExplorer(bridgeResult.bridgeDir)}
                    >
                      <FolderOpen size={12} />
                      打开回执目录
                    </button>
                  </div>

                  <div className="invite-micro-hint" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                    <strong>接下来直接去群里 @{bridgeResult.agent.name} 提问即可（无需提前发任何监听指令）：</strong>
                    <div>1. 提问后，消息下方会出现「<strong>复制本轮问题发给对方</strong>」，点一下直接粘贴到 {bridgeResult.agent.name} 对话框；</div>
                    <div>2. 指令里直接附带你的问题与保存路径，<strong>不含轮询/待命字眼</strong>，对方回答并顺手保存文件后 1 秒自动上屏；</div>
                    <div>3. 若对方未开写文件权限，点旁边的「<strong>手动粘贴回复</strong>」也能 1 秒提交到群聊。</div>
                  </div>

                  <details style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
                    <summary style={{ cursor: 'pointer' }}>进阶：若客户端允许跑本机 Python 脚本</summary>
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {bridgePrompt}
                      </code>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void handleCopyText('bridge', bridgePrompt)}
                      >
                        {copiedKey === 'bridge' ? <Check size={12} /> : <Copy size={12} />}
                        {copiedKey === 'bridge' ? '已复制' : '复制命令'}
                      </button>
                    </div>
                  </details>
                </>
              ) : (
                <div className="invite-micro-hint">
                  点「一键登记该成员」后会建好成员与本地回执目录；之后每次在群里 <code>@它</code> 提问，点「复制本轮问题发给对方」发过去即可——单轮直答、顺手写回回执文件，不要求常驻后台轮询，不会触发 AWS Quick 等客户端的安全拒绝。
                </div>
              )}
            </div>
          )}

          {scenario === 'mcp' && (
            <div className="invite-step-box">
              <div className="invite-step-head">
                <strong style={{ fontSize: 12.5 }}>内置标准 MCP Server，任选一种粘贴到客户端</strong>
                <div className="invite-mode-pills">
                  <button
                    type="button"
                    className={`member-quota-tab ${mcpMode === 'http' ? 'active' : ''}`}
                    onClick={() => setMcpMode('http')}
                  >
                    Streamable HTTP（推荐）
                  </button>
                  <button
                    type="button"
                    className={`member-quota-tab ${mcpMode === 'stdio' ? 'active' : ''}`}
                    onClick={() => setMcpMode('stdio')}
                  >
                    Stdio（Claude Desktop）
                  </button>
                </div>
              </div>

              {mcpMode === 'http' ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 8,
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>
                      端点地址：<code>{mcpHttpUrl}</code>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void handleCopyText('mcp_url', mcpHttpUrl)}
                    >
                      {copiedKey === 'mcp_url' ? <Check size={12} /> : <Copy size={12} />}
                      {copiedKey === 'mcp_url' ? '已复制地址' : '复制地址'}
                    </button>
                  </div>
                  <pre className="invite-prompt-box" style={{ maxHeight: 132 }}>
                    {mcpHttpConfig}
                  </pre>
                  <div className="invite-primary-action-row">
                    <span className="invite-micro-hint">
                      挂载后自动提供 6 个群聊工具，直接对它说「加入我的群聊」即可。
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleCopyText('mcp_http', mcpHttpConfig)}
                    >
                      {copiedKey === 'mcp_http' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedKey === 'mcp_http' ? '已复制 JSON' : '一键复制 JSON 配置'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <pre className="invite-prompt-box" style={{ maxHeight: 132 }}>
                    {mcpStdioConfig}
                  </pre>
                  <div className="invite-primary-action-row">
                    <span className="invite-micro-hint">
                      适用于 Claude Desktop / Claude Code 等经典 Stdio MCP 宿主。
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleCopyText('mcp_stdio', mcpStdioConfig)}
                    >
                      {copiedKey === 'mcp_stdio' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedKey === 'mcp_stdio' ? '已复制 JSON' : '一键复制 JSON 配置'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Quick shortcut to Model Pool for API Key / Local Subscription CLI */}
          {onOpenProviders && (
            <div className="invite-pool-banner">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={13} />
                已有 API Key（DeepSeek / OpenAI / Azure / Claude / Gemini）或本机订阅 CLI？
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={onOpenProviders}
              >
                去模型池一键开启
                <ArrowRight size={12} />
              </button>
            </div>
          )}

          {/* Collapsible Connected Members Management */}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="invite-manage-toggle"
              onClick={() => setShowManage((v) => !v)}
              aria-expanded={showManage}
            >
              {showManage ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Link2 size={13} />
              <span>
                已接入成员管理（{onlineCount}/{agents.length} 就绪 · 改名 / 绑定 CLI / 移除）
              </span>
            </button>

            {showManage && (
              <div style={{ marginTop: 8 }}>
                {agents.length === 0 ? (
                  <div className="invite-empty">
                    还没有外部成员。复制上方指令发给对方后，它会自动出现在这里。
                  </div>
                ) : (
                  <div className="connected-list">
                    {agents.map((a) => (
                      <div
                        key={a.id}
                        className="connected-row"
                        style={{ flexDirection: 'column', alignItems: 'stretch' }}
                      >
                        {editingId === a.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div className="grid-2">
                              <input
                                className="input"
                                placeholder="模型名"
                                value={editModel}
                                onChange={(e) => setEditModel(e.target.value)}
                              />
                              <input
                                className="input"
                                placeholder="中转名（可选）"
                                value={editRelay}
                                onChange={(e) => setEditRelay(e.target.value)}
                              />
                            </div>

                            <select
                              className="select"
                              value={editTriggerType}
                              onChange={(e) =>
                                setEditTriggerType(
                                  e.target.value as 'manual' | 'cli' | 'webhook',
                                )
                              }
                            >
                              <option value="cli">⚡ 自动按需拉起本机 CLI（免手动唤醒）</option>
                              <option value="webhook">⚡ 自动回调本地 Webhook（免手动唤醒）</option>
                              <option value="manual">手动复制唤醒指令 / 静默待命</option>
                            </select>

                            {editTriggerType === 'cli' && (
                              <div className="grid-2">
                                <input
                                  className="input"
                                  placeholder="命令名或路径，如 claude / codex / gemini"
                                  value={editCmd}
                                  onChange={(e) => setEditCmd(e.target.value)}
                                />
                                <input
                                  className="input"
                                  placeholder="参数（空格分隔），如 -p 或 exec -"
                                  value={editArgs}
                                  onChange={(e) => setEditArgs(e.target.value)}
                                />
                              </div>
                            )}

                            {editTriggerType === 'webhook' && (
                              <input
                                className="input"
                                placeholder="http://127.0.0.1:PORT/..."
                                value={editWebhook}
                                onChange={(e) => setEditWebhook(e.target.value)}
                              />
                            )}

                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setEditingId(null)}
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => void saveEdit(a.id)}
                              >
                                保存启动配置
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 10,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <MemberAvatar
                                  name={a.name}
                                  avatar={a.avatar}
                                  color={a.accentColor}
                                  size={24}
                                  status={!a.online ? 'off' : a.busy ? 'busy' : 'on'}
                                />
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    <span style={{ fontWeight: 650, fontSize: 13 }}>{a.name}</span>
                                    <span
                                      className={`presence-pill is-${!a.online ? 'offline' : a.busy ? 'working' : 'idle'}`}
                                    >
                                      <span
                                        className={`presence-dot ${!a.online ? 'offline' : a.busy ? 'working' : 'idle'}`}
                                      />
                                      {!a.online ? '离线' : a.busy ? '工作中' : '在线 · 空闲'}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                                    {triggerBadge(a)}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                {(!a.trigger || a.trigger.type === 'manual') && (
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={detectingId === a.id}
                                    title="自动检测本机是否安装了对应 CLI 并绑定自动拉起"
                                    onClick={() => void handleDetectCli(a.id)}
                                  >
                                    {detectingId === a.id ? (
                                      <Loader2 size={12} className="spin" />
                                    ) : (
                                      <Terminal size={12} />
                                    )}
                                    自动绑定 CLI
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  title={a.online ? '设为离线' : '恢复在线'}
                                  onClick={() => void onRenameAgent(a.id, { online: !a.online })}
                                >
                                  {a.online ? '离线' : '上线'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  title="配置启动方式或微调名称"
                                  onClick={() => startEdit(a)}
                                >
                                  <Pencil size={12} />
                                  配置
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  title="移出列表"
                                  onClick={() => void onDeleteAgent(a.id)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                            {detectHint[a.id] && (
                              <div
                                className={`wb-test-output ${detectHint[a.id].found ? 'ok' : 'fail'}`}
                                style={{ marginTop: 8 }}
                              >
                                <div>{detectHint[a.id].message}</div>
                                {!detectHint[a.id].found && detectHint[a.id].installCmd && (
                                  <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                                    安装：<code>{detectHint[a.id].installCmd}</code>
                                    {detectHint[a.id].loginCmd ? (
                                      <>
                                        {' '}
                                        · 登录：<code>{detectHint[a.id].loginCmd}</code>
                                      </>
                                    ) : null}
                                  </div>
                                )}
                                {detectHint[a.id].note && (
                                  <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
                                    {detectHint[a.id].note}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
