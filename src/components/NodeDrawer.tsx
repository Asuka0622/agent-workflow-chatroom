import React, { useEffect, useState } from 'react';
import {
  Copy,
  Hand,
  RotateCcw,
  Save,
} from 'lucide-react';
import type {
  NodeExecutionState,
  ProviderConfig,
  WorkflowNodeConfig,
} from '../../shared/types';
import { MarkdownView } from './MarkdownView';

interface NodeDrawerProps {
  node: WorkflowNodeConfig;
  state?: NodeExecutionState;
  providers: ProviderConfig[];
  hasActiveRun: boolean;
  onRerunFromNode: (nodeId: string) => void;
  onOpenApproval: () => void;
  onSaveNodeConfig: (updated: WorkflowNodeConfig) => Promise<void>;
}

export const NodeDrawer: React.FC<NodeDrawerProps> = ({
  node,
  state,
  providers,
  hasActiveRun,
  onRerunFromNode,
  onOpenApproval,
  onSaveNodeConfig,
}) => {
  const [tab, setTab] = useState<'output' | 'logs' | 'config'>('output');
  const [title, setTitle] = useState(node.title);
  const [subtitle, setSubtitle] = useState(node.subtitle || '');
  const [enabled, setEnabled] = useState(node.enabled !== false);
  const [providerId, setProviderId] = useState(node.providerId);
  const [fixProviderId, setFixProviderId] = useState(node.fixProviderId || providers[0]?.id || 'claude');
  const [promptTemplate, setPromptTemplate] = useState(node.promptTemplate || '');
  const [shellCommand, setShellCommand] = useState(node.shellCommand || '');
  const [maxRounds, setMaxRounds] = useState(node.maxRounds ?? 2);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTitle(node.title);
    setSubtitle(node.subtitle || '');
    setEnabled(node.enabled !== false);
    setProviderId(node.providerId);
    setFixProviderId(node.fixProviderId || providers[0]?.id || 'claude');
    setPromptTemplate(node.promptTemplate || '');
    setShellCommand(node.shellCommand || '');
    setMaxRounds(node.maxRounds ?? 2);
  }, [node, providers]);

  const handleCopy = async () => {
    if (!state?.output) return;
    await navigator.clipboard.writeText(state.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveNodeConfig({
        ...node,
        title: title.trim() || node.title,
        subtitle: subtitle.trim(),
        enabled,
        providerId,
        fixProviderId: node.kind === 'review_loop' ? fixProviderId : node.fixProviderId,
        promptTemplate:
          node.kind === 'llm' || node.kind === 'review_loop'
            ? promptTemplate
            : node.promptTemplate,
        shellCommand: node.kind === 'shell' ? shellCommand : node.shellCommand,
        maxRounds: node.kind === 'review_loop' ? maxRounds : node.maxRounds,
      });
    } finally {
      setSaving(false);
    }
  };

  const isHumanInput = node.kind === 'human_input';
  const isHumanGate = node.kind === 'human_gate';

  return (
    <aside className="detail-pane">
      <div className="detail-header">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title">{node.title}</div>
          {node.subtitle && <div className="detail-sub">{node.subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {state?.status === 'waiting_approval' && (
            <button className="btn btn-primary btn-sm" onClick={onOpenApproval}>
              <Hand size={13} />
              去拍板
            </button>
          )}
          {hasActiveRun && !isHumanInput && (
            <button
              className="btn btn-sm"
              onClick={() => onRerunFromNode(node.id)}
              title="从该板块开始重新执行"
            >
              <RotateCcw size={13} />
              重跑
            </button>
          )}
          {state?.output && (
            <button className="btn btn-sm" onClick={handleCopy}>
              <Copy size={13} />
              {copied ? '已复制' : '复制'}
            </button>
          )}
        </div>
      </div>

      <div className="drawer-tabs">
        <button
          className={`drawer-tab ${tab === 'output' ? 'active' : ''}`}
          onClick={() => setTab('output')}
        >
          产出内容
        </button>
        <button
          className={`drawer-tab ${tab === 'logs' ? 'active' : ''}`}
          onClick={() => setTab('logs')}
        >
          运行日志 ({state?.logs.length ?? 0})
        </button>
        <button
          className={`drawer-tab ${tab === 'config' ? 'active' : ''}`}
          onClick={() => setTab('config')}
        >
          板块与模型设置
        </button>
      </div>

      <div className="drawer-body">
        {tab === 'output' && (
          <div>
            {state?.error && (
              <div className="error-box">
                <strong>执行失败：</strong>
                {state.error}
              </div>
            )}

            {state?.commandPreview && (
              <div className="cmd-preview">$ {state.commandPreview}</div>
            )}

            {state?.output ? (
              <MarkdownView content={state.output} />
            ) : (
              <div className="empty-state">
                <p>当前板块尚无产出。</p>
                <span>
                  你可以直接在左侧板块卡片上切换使用的模型，或点右上角「新建需求」开始执行。
                </span>
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div>
            {state?.commandPreview && (
              <div className="cmd-preview">$ {state.commandPreview}</div>
            )}
            <div className="log-box">
              {state?.logs && state.logs.length > 0
                ? state.logs.join('\n')
                : '暂无日志。运行后本地 CLI 的实时输出会显示在这里。'}
            </div>
          </div>
        )}

        {tab === 'config' && (
          <div>
            {!isHumanInput && (
              <div
                className="field"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  background: '#f8fafc',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>启用此板块</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {enabled ? '参与执行' : '运行时自动跳过'}
                  </span>
                </label>
              </div>
            )}

            <div className="grid-2">
              <div className="field">
                <label>板块名称</label>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="field">
                <label>板块说明</label>
                <input
                  className="input"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                />
              </div>
            </div>

            {(node.kind === 'llm' || node.kind === 'review_loop') && (
              <div className={node.kind === 'review_loop' ? 'grid-2' : ''}>
                <div className="field">
                  <label>
                    {node.kind === 'review_loop' ? '审查模型' : '执行模型'}
                  </label>
                  <select
                    className="select"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.shortName}（{p.command}）
                      </option>
                    ))}
                  </select>
                </div>

                {node.kind === 'review_loop' && (
                  <div className="field">
                    <label>自动修复模型</label>
                    <select
                      className="select"
                      value={fixProviderId}
                      onChange={(e) => setFixProviderId(e.target.value)}
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.shortName}（{p.command}）
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {node.kind === 'review_loop' && (
              <div className="field">
                <label>最多审查轮次</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  className="input"
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(Math.max(1, Number(e.target.value) || 2))}
                />
              </div>
            )}

            {(node.kind === 'llm' || node.kind === 'review_loop') && (
              <div className="field">
                <label>
                  提示词模板（变量：<code>{'{{requirement}}'}</code> /{' '}
                  <code>{'{{providerName}}'}</code> /{' '}
                  <code>{'{{outputs.板块ID}}'}</code>）
                </label>
                <textarea
                  className="textarea"
                  rows={12}
                  value={promptTemplate}
                  onChange={(e) => setPromptTemplate(e.target.value)}
                />
              </div>
            )}

            {node.kind === 'shell' && (
              <div className="field">
                <label>Shell 命令</label>
                <input
                  className="input"
                  value={shellCommand}
                  onChange={(e) => setShellCommand(e.target.value)}
                />
              </div>
            )}

            {isHumanGate && (
              <p style={{ fontSize: 12.5, color: '#6b7280', marginTop: 0 }}>
                关闭「启用此板块」后，双方案合成完成将直接跳过人工拍板自动往下跑。
              </p>
            )}

            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              <Save size={14} />
              {saving ? '保存中...' : '保存板块设置'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
