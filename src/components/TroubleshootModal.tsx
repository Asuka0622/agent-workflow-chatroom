import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  RefreshCw,
  Settings2,
  Square,
  Terminal,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { ConnectedAgent } from '../../shared/types';
import { MemberAvatar } from './MemberAvatar';
import { useI18n } from '../i18n';

export function buildStandbyPrompt(agentId: string): string {
  return `请开启超长保活待命模式，帮我自动响应本地聊天室消息（单次等待 30 分钟仅占 1 轮调用，每 15 秒发保活心跳防断连、支持重启自动重连，全程 0 模型 token）：
1. 运行 \`chatroom wait ${agentId} --timeout 1800 --heartbeat 15 --json\`；
2. 若返回 \`action: "handle_task"\`（有 \`task\`），完成任务后用 \`chatroom reply --agent ${agentId} --task <taskId> --stdin\`（或直接传内容）提交回复，然后立刻继续运行 \`chatroom wait ${agentId} --timeout 1800 --heartbeat 15 --json\`；
3. 若返回 \`action: "continue_wait"\`（正常超时无任务），不要结束任务，直接再次运行 \`chatroom wait\` 继续保活等待；
4. 若返回 \`action: "stop"\`（聊天室端点了「停等」）或我手动叫停，再正式退出。`;
}

export function buildFileBridgePrompt(agentId: string, name: string): string {
  const dir = `C:\\Users\\Administrator\\chatroom-bridge\\${agentId}`;
  return `你好 ${name}，请帮我做一次单次本地文件协作（不需要后台待命或循环轮询）：
1. 读取 \`${dir}\\tasks\` 里最新的一份任务 JSON，先告诉我里面的问题内容；
2. 由我确认后直接回答该问题，并把你的回复保存为 UTF-8 文件放到 \`${dir}\\replies\\<taskId>.md\`（只做这一次即可）。`;
}

export interface ErrorDiagnosis {
  title: string;
  reason: string;
  steps: string[];
  suggestStandby?: boolean;
  suggestProviders?: boolean;
}

export function diagnoseMessageError(content: string): ErrorDiagnosis {
  const lower = (content || '').toLowerCase();
  if (content.includes('服务重启前未完成') || lower.includes('econnreset') || lower.includes('socket hang up')) {
    return {
      title: '桌面端重启或连接中断',
      reason: '该回复生成期间本地服务发生重启或连接断开，旧任务已自动收尾。',
      steps: [
        '直接重新发送一次该问题即可恢复。',
        '若对方是 WorkBuddy / 外部 GUI 模型，请确认左侧栏亮起「⚡ 监听待命」；新版 `chatroom wait` 已支持 2 秒自动重连。',
      ],
      suggestStandby: true,
    };
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('api key') || lower.includes('unauthorized') || lower.includes('invalid_api_key')) {
    return {
      title: 'API 鉴权失败（Key 无效或过期）',
      reason: '目标模型接口拒绝了当前凭证或权限不足。',
      steps: [
        '打开左下角「模型池（订阅 / API）」核对 API Key、Base URL 与模型 ID 是否正确。',
        '点击模型卡片里的「测试连接」确认返回 200 OK 后再发送。',
      ],
      suggestProviders: true,
    };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota') || content.includes('额度')) {
    return {
      title: '触发限流或额度不足',
      reason: '当前模型账号频率受限或余额/订阅配额已用尽。',
      steps: [
        '稍等片刻重试，或在下方改 @ 聊天室里其他在线模型继续。',
        '若需减少额度消耗，请优先使用 `chatroom wait` 零耗保活待命，避免短间隔轮询。',
      ],
      suggestProviders: true,
    };
  }
  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('未安装') || lower.includes('command not found')) {
    return {
      title: '本地 CLI 未安装或不在 PATH 中',
      reason: '系统未能找到对应模型的本地命令行工具。',
      steps: [
        '打开左下角「模型池」查看该模型的安装命令与登录命令，或在终端执行 `claude --version` / `gemini --version` 核实。',
        '也可改用「邀请模型入群」接入外部 Agent，或填写 API Key 走直连模式。',
      ],
      suggestProviders: true,
    };
  }
  if (lower.includes('timeout') || content.includes('超时') || lower.includes('aborted')) {
    return {
      title: '等待响应超时或已中止',
      reason: '模型处理耗时过长、未处于保活监听状态，或本次运行被手动停止。',
      steps: [
        '如果是外部 GUI 模型（如 WorkBuddy），请点击下方「复制保活待命指令」让它进入 `⚡ 监听待命` 后再试。',
        '如果是复杂代码任务，可缩小单次问题范围或在「模型池」调大超时秒数。',
      ],
      suggestStandby: true,
    };
  }
  return {
    title: '执行异常排障建议',
    reason: '模型返回了错误或执行未能正常结束。',
    steps: [
      '展开上方「执行过程」查看具体报错日志。',
      '外部接入模型请确认其已挂起 `chatroom wait` 保活待命；本地 CLI/API 模型请点左下角「模型池」测试连接。',
    ],
    suggestStandby: true,
    suggestProviders: true,
  };
}

interface TroubleshootModalProps {
  agents: ConnectedAgent[];
  onClose: () => void;
  onOpenProviders: () => void;
  onStopStandby: (agentId: string, name: string) => Promise<void>;
  onDetectCli: (agentId: string) => Promise<void>;
  onToast: (msg: string) => void;
}

export const TroubleshootModal: React.FC<TroubleshootModalProps> = ({
  agents,
  onClose,
  onOpenProviders,
  onStopStandby,
  onDetectCli,
  onToast,
}) => {
  const { tr } = useI18n();
  const [copiedId, setCopiedId] = useState('');
  const [detectingId, setDetectingId] = useState('');

  const copyStandby = async (agent: ConnectedAgent) => {
    await navigator.clipboard.writeText(buildStandbyPrompt(agent.id));
    setCopiedId(agent.id);
    onToast(`已复制「${agent.name}」的保活心跳待命指令（每 15s 心跳 / 自动重连）`);
    setTimeout(() => setCopiedId(''), 1800);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wrench size={15} />
            <h2>{tr('连接诊断与常见问题解决', 'Connection Diagnostics & Troubleshooting')}</h2>
            <span className="ef-index-tag">DIAG</span>
          </div>
          <button type="button" className="mini-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Section 1: Real-time Agent Standby Diagnostics */}
          <div className="diag-section">
            <div className="diag-section-head">
              <span className="diag-section-title">
                <Activity size={13} />
                {tr(`外部接入成员实时待命诊断（${agents.length}）`, `Connected Agent Diagnostics (${agents.length})`)}
              </span>
              <button
                type="button"
                className="tl-btn"
                onClick={() => {
                  onClose();
                  onOpenProviders();
                }}
              >
                <Settings2 size={11} />
                {tr('检查模型池', 'Model Pool')}
              </button>
            </div>

            {agents.length === 0 ? (
              <div className="invite-empty">
                {tr(
                  '当前没有外部接入的 Agent 成员；本地订阅 CLI / API 模型会自动由后台直接拉起，无需心跳待命。',
                  'No external agents connected yet. Local CLI and API models run automatically without standby.',
                )}
              </div>
            ) : (
              <div className="diag-agent-list">
                {agents.map((a) => {
                  const isCli = a.trigger?.type === 'cli';
                  const isListening = Boolean(a.listening);
                  const needsStandby = a.online && !isCli && !isListening;

                  return (
                    <div key={a.id} className={`diag-agent-row ${needsStandby ? 'is-warn' : ''}`}>
                      <MemberAvatar
                        name={a.name}
                        avatar={a.avatar}
                        color={a.accentColor}
                        size={26}
                        radius={4}
                        status={a.busy ? 'busy' : a.online ? 'on' : 'off'}
                      />
                      <div className="diag-agent-info">
                        <div className="diag-agent-top">
                          <strong>{a.name}</strong>
                          {!a.online ? (
                            <span className="diag-pill is-off">{tr('已离线', 'Offline')}</span>
                          ) : isCli ? (
                            <span className="diag-pill is-ok">
                              <CheckCircle2 size={10} />
                              {tr('自动 CLI', 'Auto CLI')} ({a.trigger?.type === 'cli' ? a.trigger.command : ''})
                            </span>
                          ) : isListening ? (
                            <span className="diag-pill is-live">
                              <Zap size={10} />
                              {tr('保活心跳监听中（0 token）', 'Live Standby (0 tokens)')}
                            </span>
                          ) : (
                            <span className="diag-pill is-warn">
                              <AlertTriangle size={10} />
                              {tr('未开启保活待命（发消息需手动唤醒）', 'Not on standby (manual wake needed)')}
                            </span>
                          )}
                        </div>
                        <div className="diag-agent-sub">
                          {needsStandby
                            ? tr('解决：点右侧「复制保活指令」发给对方客户端，亮起 ⚡ 监听待命后即可自动秒回。', 'Fix: click "Copy Standby" on the right and send to the client to restore auto-reply.')
                            : isListening
                              ? tr('状态健康：聊天室每 15 秒推送保活心跳，发消息时毫秒级自动唤醒，重启可自动重连。', 'Healthy: 15s keepalive heartbeat active, instant wake, auto-reconnect on restart.')
                              : isCli
                                ? tr('状态健康：已绑定本机 CLI，@ 它时后台直接自动执行。', 'Healthy: bound to local CLI and runs automatically when @mentioned.')
                                : tr('成员当前处于离线状态，点击左侧栏头像可恢复在线。', 'Member is offline. Click its sidebar row to bring it online.')}
                        </div>
                      </div>

                      <div className="diag-agent-ops">
                        {isListening ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void onStopStandby(a.id, a.name)}
                          >
                            <Square size={11} />
                            {tr('停等', 'Stop')}
                          </button>
                        ) : a.online && !isCli ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-ink btn-sm"
                              onClick={() => void copyStandby(a)}
                            >
                              <Copy size={11} />
                              {copiedId === a.id ? tr('已复制', 'Copied') : tr('复制保活指令', 'Copy Standby')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              title="适合 AWS Quick 等只能通过授权文件夹读写的桌面客户端（读写 tasks/*.json → replies/*.json）"
                              onClick={async () => {
                                await navigator.clipboard.writeText(buildFileBridgePrompt(a.id, a.name));
                                setCopiedId(`fb_${a.id}`);
                                onToast(`已复制「${a.name}」的文件夹桥接指令（目录 C:\\Users\\Administrator\\chatroom-bridge\\${a.id}）`);
                                setTimeout(() => setCopiedId(''), 1800);
                              }}
                            >
                              <Copy size={11} />
                              {copiedId === `fb_${a.id}` ? '已复制桥接' : '文件夹桥接'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              title="尝试自动检测并绑定本机官方 CLI（绑定后永久免待命）"
                              disabled={detectingId === a.id}
                              onClick={async () => {
                                setDetectingId(a.id);
                                try {
                                  await onDetectCli(a.id);
                                } finally {
                                  setDetectingId('');
                                }
                              }}
                            >
                              <RefreshCw size={11} className={detectingId === a.id ? 'spin' : ''} />
                              检 CLI
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Clear Playbooks for Recurring Issues */}
          <div className="diag-section">
            <div className="diag-section-title" style={{ marginBottom: 8 }}>
              <Terminal size={13} />
              高频问题自助解决手册
            </div>

            <div className="diag-faq-list">
              <div className="diag-faq-card">
                <div className="diag-faq-q">01 · 为什么刚才还能自动回，突然又提示「按需唤醒」了？</div>
                <div className="diag-faq-a">
                  <strong>常见原因：</strong>① 上次点击了「仅单次唤醒」（只回 1 条就退出，不会续挂 `chatroom wait`）；② 外部客户端（如 WorkBuddy）单轮对话达到总步数/总时长上限自动结束了；③ 电脑休眠或旧版进程在重启时中断。<br />
                  <strong>解决方法：</strong>在上方点该成员的<strong>「复制保活指令」</strong>发给对方即可恢复。新版 `chatroom wait --heartbeat 15` 已自带<strong>每 15 秒保活心跳（0 token）+ 服务重启 2 秒自动重连</strong>。
                </div>
              </div>

              <div className="diag-faq-card">
                <div className="diag-faq-q">02 · 一直挂着心跳待命会白耗模型额度吗？</div>
                <div className="diag-faq-a">
                  <strong>不会。</strong>等待期间只有本机 `chatroom wait` 进程和聊天室 `127.0.0.1:4310` 之间发本地心跳，<strong>不调用任何大模型接口（0 Token）</strong>。只有你在聊天室里真正 `@` 它时，模型才消耗一次正常推理额度。不用时点左侧栏<strong>「停等」</strong>即可远程让它退出。
                </div>
              </div>

              <div className="diag-faq-card">
                <div className="diag-faq-q">03 · 出现「服务重启前未完成」或模型报错 / 超时怎么办？</div>
                <div className="diag-faq-a">
                  <strong>解决方法：</strong>每条报错消息下方都会自动显示对应原因与修复按钮；若涉及订阅 CLI 登录过期或 API Key 错误，点左下角<strong>「模型池（订阅 / API）」</strong>执行「测试连接」即可快速定位。
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
