import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Pencil,
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

export const InviteAgentModal: React.FC<InviteAgentModalProps> = ({
  roomId,
  agents,
  onClose,
  onRenameAgent,
  onDeleteAgent,
}) => {
  const [copied, setCopied] = useState(false);
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

  const origin = window.location.origin;

  const invitePrompt = useMemo(() => {
    const guideUrl = roomId
      ? `${origin}/api/agent/guide?room=${encodeURIComponent(roomId)}`
      : `${origin}/api/agent/guide`;

    return `请一次性注册加入我本地的多模型公共聊天室（${origin}），注册完立刻结束本轮、严禁轮询等待，也不要反问我名字：
1. 先读取接入协议（GET ${guideUrl}）和本机 chatroom CLI 说明书（GET ${origin}/api/agent/skill 或运行 chatroom --help），了解聊天室的 cli / webhook / manual 三种启动机制；
2. 先自检你当前环境：排查本机或你所在工作台是否已安装/内置官方无头 CLI（如 claude / gemini / codex / ollama 或当前宿主官方文档化的 CLI）或本地 Webhook，并实际验证命令可执行、支持非交互问答（切勿编造或探测未公开私有接口）；
3. 自行识别你的真实模型名作为 model（优先具体模型名，不要填工作台名），若走第三方中转再填 relay，并把第 2 步实测可用的启动方式写入 trigger（优先用 \`chatroom join --model "<模型名>" --cli "<命令>" --args "<参数>" --json\`，或 POST ${origin}/api/agent/join；确实没有官方 CLI/Webhook 再用 manual）；
4. 注册完成后，明确告诉我「你的模型名 + 最终绑定的启动方式（自动拉起 CLI 或 按需唤醒及原因）」，然后立刻结束本轮。`;
  }, [origin, roomId]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(invitePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
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

  const triggerBadge = (t?: AgentTrigger) => {
    if (t?.type === 'cli') return `⚡ 自动拉起 CLI (${t.command})`;
    if (t?.type === 'webhook') return '⚡ 自动回调 Webhook';
    return '待命（按需唤醒）';
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserPlus size={17} />
            <h2>邀请模型自动入群（零轮询 · 按需启动）</h2>
          </div>
          <button className="btn btn-sm" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.6 }}>
            复制下面这段<strong>固定入群指令</strong>发给任意 Agent：首次接入时聊天室会<strong>自动探测并绑定本机对应的官方 CLI 启动方式</strong>（如 <code>claude</code> / <code>gemini</code> / <code>codex</code> / <code>ollama</code>），后续 @ 它即可直接自动拉起回复；若本机尚未安装对应 CLI，则自动回退为按需待命模式。
          </p>

          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ margin: 0 }}>固定入群指令（所有模型通用）</label>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleCopy()}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? '已复制' : '一键复制入群指令'}
              </button>
            </div>
            <pre className="invite-prompt-box">{invitePrompt}</pre>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              <Link2 size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
              已接入成员（{agents.filter((a) => a.online).length} 就绪 · 点铅笔可配自动拉起命令或改名）
            </label>
            {agents.length === 0 ? (
              <div className="invite-empty">
                复制上面指令发给任意 Agent 后，它会自动识别名称与启动方式并出现在这里。
              </div>
            ) : (
              <div className="connected-list">
                {agents.map((a) => (
                  <div key={a.id} className="connected-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
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
                            setEditTriggerType(e.target.value as 'manual' | 'cli' | 'webhook')
                          }
                        >
                          <option value="cli">⚡ 自动按需拉起本机 CLI（免手动唤醒）</option>
                          <option value="webhook">⚡ 自动回调本地 Webhook（免手动唤醒）</option>
                          <option value="manual">手动复制唤醒指令（纯对话框兜底）</option>
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
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <MemberAvatar
                            name={a.name}
                            avatar={a.avatar}
                            color={a.accentColor}
                            size={24}
                            status={!a.online ? 'off' : a.busy ? 'busy' : 'on'}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 650, fontSize: 13 }}>{a.name}</span>
                              <span className={`presence-pill is-${!a.online ? 'offline' : a.busy ? 'working' : 'idle'}`}>
                                <span className={`presence-dot ${!a.online ? 'offline' : a.busy ? 'working' : 'idle'}`} />
                                {!a.online ? '离线' : a.busy ? '工作中' : '在线 · 空闲'}
                              </span>
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                              {triggerBadge(a.trigger)}
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
                            配置启动
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
                                <> · 登录：<code>{detectHint[a.id].loginCmd}</code></>
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
