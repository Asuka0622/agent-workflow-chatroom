import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ProviderConfig,
  ProviderConnectionType,
  ProviderHealth,
} from '../../shared/types';
import { api } from '../api';

interface ProvidersModalProps {
  providers: ProviderConfig[];
  onClose: () => void;
  onSaved: (updated: ProviderConfig[]) => void;
}

const CONNECTION_LABELS: Record<ProviderConnectionType, string> = {
  cli: '订阅制（本地 CLI）',
  openai_api: 'OpenAI 兼容 API',
  anthropic_api: 'Anthropic API',
  gemini_api: 'Gemini API',
};

const API_PRESETS: Array<{
  label: string;
  create: () => ProviderConfig;
}> = [
  {
    label: '+ DeepSeek API',
    create: () => ({
      id: `deepseek_${Date.now().toString(36).slice(-4)}`,
      name: 'DeepSeek',
      shortName: 'DeepSeek',
      accentColor: '#4f46e5',
      connectionType: 'openai_api',
      subscriptionHint: 'OpenAI 兼容 API（DeepSeek 官方或中转）',
      command: 'api',
      args: [],
      inputMode: 'stdin',
      apiBaseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      installCmd: '',
      loginCmd: '',
      docsHint: '填入 DeepSeek API Key 即可直接在聊天室 @DeepSeek 或分配到任意板块。',
      timeoutSec: 180,
      forceMock: false,
    }),
  },
  {
    label: '+ OpenAI 兼容 API',
    create: () => ({
      id: `openai_${Date.now().toString(36).slice(-4)}`,
      name: 'OpenAI 兼容模型',
      shortName: 'GPT / 兼容',
      accentColor: '#059669',
      connectionType: 'openai_api',
      subscriptionHint: '通吃 OpenAI / Kimi / Qwen / 智谱 / OpenRouter / 硅基流动 / OneAPI',
      command: 'api',
      args: [],
      inputMode: 'stdin',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o',
      installCmd: '',
      loginCmd: '',
      docsHint: '修改 Base URL、API Key 和模型名即可接入任意 OpenAI 兼容服务。',
      timeoutSec: 180,
      forceMock: false,
    }),
  },
  {
    label: '+ Claude API',
    create: () => ({
      id: `claude_api_${Date.now().toString(36).slice(-4)}`,
      name: 'Claude API',
      shortName: 'Claude API',
      accentColor: '#d97706',
      connectionType: 'anthropic_api',
      subscriptionHint: 'Anthropic Messages API（官方或代理）',
      command: 'api',
      args: [],
      inputMode: 'stdin',
      apiBaseUrl: 'https://api.anthropic.com',
      apiKey: '',
      model: 'claude-sonnet-4-5',
      installCmd: '',
      loginCmd: '',
      docsHint: '填入 Anthropic API Key 即可按量直连 Claude。',
      timeoutSec: 180,
      forceMock: false,
    }),
  },
  {
    label: '+ Gemini API',
    create: () => ({
      id: `gemini_api_${Date.now().toString(36).slice(-4)}`,
      name: 'Gemini API',
      shortName: 'Gemini API',
      accentColor: '#2563eb',
      connectionType: 'gemini_api',
      subscriptionHint: 'Google Gemini REST API（AI Studio Key）',
      command: 'api',
      args: [],
      inputMode: 'stdin',
      apiBaseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: '',
      model: 'gemini-2.5-pro',
      installCmd: '',
      loginCmd: '',
      docsHint: '填入 Google AI Studio Key 即可直连 Gemini API。',
      timeoutSec: 180,
      forceMock: false,
    }),
  },
  {
    label: '+ 订阅制 CLI',
    create: () => ({
      id: `cli_${Date.now().toString(36).slice(-4)}`,
      name: '自定义订阅 CLI',
      shortName: '新 CLI',
      accentColor: '#0891b2',
      connectionType: 'cli',
      subscriptionHint: '本机官方订阅 CLI 或本地 Ollama / 自定义脚本',
      command: 'claude',
      args: ['-p'],
      inputMode: 'stdin',
      modelFlag: '--model',
      model: '',
      installCmd: '# 填写该 CLI 的安装命令',
      loginCmd: '# 完成该 CLI 的订阅登录',
      docsHint: '支持任意读取 stdin 或参数的本地命令行工具。',
      timeoutSec: 300,
      forceMock: false,
    }),
  },
];

export const ProvidersModal: React.FC<ProvidersModalProps> = ({
  providers,
  onClose,
  onSaved,
}) => {
  const [draft, setDraft] = useState<ProviderConfig[]>(() =>
    structuredClone(providers).map((p) => ({
      ...p,
      connectionType: p.connectionType || 'cli',
    })),
  );
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<
    Record<string, { testing?: boolean; ok?: boolean; message?: string }>
  >({});

  const runHealthCheck = async () => {
    setChecking(true);
    try {
      const res = await api.checkProviders();
      setHealth(res.health);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void runHealthCheck();
  }, []);

  const healthMap = new Map(health.map((h) => [h.id, h]));

  const formatProviderLabel = (modelOrName: string, relayName?: string): string => {
    const base = modelOrName.trim();
    const relay = (relayName || '').trim();
    if (!relay) return base;
    if (base.includes(`(${relay})`) || base.includes(`（${relay}）`)) return base;
    return `${base} (${relay})`;
  };

  const updateField = (idx: number, patch: Partial<ProviderConfig>) => {
    setDraft((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const next = { ...item, ...patch };
        // Auto-sync display name as "模型名" or "模型名 (中转名)" when model or relayName changes
        if ('model' in patch || 'relayName' in patch) {
          const base =
            (next.model || '').trim() ||
            item.shortName.replace(/\s*[（(][^）)]+[）)]\s*$/, '').trim();
          if (base) {
            const label = formatProviderLabel(base, next.relayName);
            next.shortName = label;
            next.name = label;
          }
        }
        return next;
      }),
    );
  };

  const switchConnectionType = (idx: number, nextType: ProviderConnectionType) => {
    setDraft((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const patch: Partial<ProviderConfig> = { connectionType: nextType };
        if (nextType === 'openai_api' && !item.apiBaseUrl) {
          patch.apiBaseUrl = 'https://api.openai.com/v1';
          if (!item.model) patch.model = 'gpt-4o';
        } else if (nextType === 'anthropic_api' && !item.apiBaseUrl) {
          patch.apiBaseUrl = 'https://api.anthropic.com';
          if (!item.model) patch.model = 'claude-sonnet-4-5';
        } else if (nextType === 'gemini_api' && !item.apiBaseUrl) {
          patch.apiBaseUrl = 'https://generativelanguage.googleapis.com';
          if (!item.model) patch.model = 'gemini-2.5-pro';
        }
        return { ...item, ...patch };
      }),
    );
  };

  const addPreset = (creator: () => ProviderConfig) => {
    setDraft((prev) => [creator(), ...prev]);
  };

  const removeProvider = (idx: number) => {
    if (draft.length <= 1) return;
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleTestApi = async (provider: ProviderConfig) => {
    setTestResults((prev) => ({ ...prev, [provider.id]: { testing: true } }));
    try {
      const res = await api.testProvider(provider);
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: { testing: false, ok: res.ok, message: res.message },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: {
          testing: false,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const copyCmd = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 1400);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveProviders(draft);
      onSaved(res.providers);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const gitHealth = healthMap.get('git');
  const ghHealth = healthMap.get('gh');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>模型池配置（支持订阅制 CLI / API 直连）</h2>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
              每个模型可自由切换「订阅制本地 CLI」或「API 直连（OpenAI 兼容 / Anthropic / Gemini）」，所有密钥仅保存在本机。
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={runHealthCheck} disabled={checking}>
              <RefreshCw size={13} className={checking ? 'spin' : ''} />
              {checking ? '检测中...' : '检测环境'}
            </button>
            <button className="btn btn-sm" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {/* Quick-Add Preset Strip */}
          <div className="quick-add-bar">
            <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} />
              快速接入其他模型：
            </span>
            {API_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="preset-chip active-chip"
                onClick={() => addPreset(preset.create)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              marginBottom: 14,
              padding: '8px 12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            <strong>本机工具：</strong>
            <span className={`health-pill ${gitHealth?.installed ? 'ok' : 'miss'}`}>
              {gitHealth?.installed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              git {gitHealth?.installed ? '已安装' : '未安装'}
            </span>
            <span className={`health-pill ${ghHealth?.installed ? 'ok' : 'miss'}`}>
              {ghHealth?.installed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              gh（可选）{ghHealth?.installed ? '已安装' : '未安装'}
            </span>
          </div>

          {draft.map((p, idx) => {
            const connType: ProviderConnectionType = p.connectionType || 'cli';
            const isApi = connType !== 'cli';
            const h = healthMap.get(p.id);
            const testState = testResults[p.id];
            const apiReady = isApi && Boolean(p.apiKey?.trim() && p.model?.trim());

            return (
              <div key={p.id} className="provider-card">
                <div className="provider-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: p.accentColor,
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {p.shortName}
                        <span className="conn-type-badge">
                          {CONNECTION_LABELS[connType]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {p.subscriptionHint}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(p.forceMock)}
                        onChange={(e) => updateField(idx, { forceMock: e.target.checked })}
                      />
                      单独走模拟
                    </label>

                    {isApi ? (
                      <span className={`health-pill ${apiReady ? 'ok' : 'miss'}`}>
                        {apiReady ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        {apiReady ? `API 已填 (${p.model})` : '待填 API Key / 模型名'}
                      </span>
                    ) : (
                      <span className={`health-pill ${h?.installed ? 'ok' : 'miss'}`}>
                        {h?.installed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        {h?.installed ? `CLI 已就绪` : `未检测到 ${p.command}`}
                      </span>
                    )}

                    {draft.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="删除此模型"
                        onClick={() => removeProvider(idx)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Common row: Display Name + Relay + Connection Mode */}
                <div className="grid-2" style={{ marginTop: 10 }}>
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label>显示名称（默认自动用「模型名」或「模型名 (中转名)」）</label>
                    <input
                      className="input"
                      value={p.shortName}
                      onChange={(e) =>
                        updateField(idx, { shortName: e.target.value, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label>中转 / 平台名（可选，如 WorkBuddy / OpenRouter）</label>
                    <input
                      className="input"
                      placeholder="直连官方留空；中转填名称，自动加括号"
                      value={p.relayName || ''}
                      onChange={(e) => updateField(idx, { relayName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="field" style={{ marginBottom: 8 }}>
                  <label>接入方式（订阅制 CLI 或 API）</label>
                  <select
                    className="select"
                    value={connType}
                    onChange={(e) =>
                      switchConnectionType(idx, e.target.value as ProviderConnectionType)
                    }
                  >
                    <option value="cli">订阅制（调用本机官方 CLI / Ollama）</option>
                    <option value="openai_api">API · OpenAI 兼容（OpenAI / DeepSeek / Kimi / Qwen / 中转）</option>
                    <option value="anthropic_api">API · Anthropic（Claude 官方或兼容代理）</option>
                    <option value="gemini_api">API · Google Gemini REST</option>
                  </select>
                </div>

                {isApi ? (
                  <>
                    <div className="grid-2">
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>API Base URL</label>
                        <input
                          className="input"
                          placeholder="例如：https://api.deepseek.com/v1"
                          value={p.apiBaseUrl || ''}
                          onChange={(e) => updateField(idx, { apiBaseUrl: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>模型名称（Model ID）*</label>
                        <input
                          className="input"
                          placeholder="例如：deepseek-chat / gpt-4o / qwen-max / claude-sonnet-4-5"
                          value={p.model || ''}
                          onChange={(e) => updateField(idx, { model: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>API Key（仅加密/明文保存在你本地电脑 data/providers.json，不上传）</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type={visibleKeys[p.id] ? 'text' : 'password'}
                          className="input"
                          placeholder="sk-..."
                          value={p.apiKey || ''}
                          onChange={(e) => updateField(idx, { apiKey: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn"
                          style={{ flexShrink: 0 }}
                          title={visibleKeys[p.id] ? '隐藏' : '显示'}
                          onClick={() =>
                            setVisibleKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                          }
                        >
                          {visibleKeys[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ flexShrink: 0 }}
                          disabled={testState?.testing}
                          onClick={() => void handleTestApi(p)}
                        >
                          <PlugZap size={14} />
                          {testState?.testing ? '测试中...' : '测试连通性'}
                        </button>
                      </div>
                    </div>

                    {testState && !testState.testing && (
                      <div
                        style={{
                          fontSize: 12,
                          padding: '6px 10px',
                          borderRadius: 8,
                          background: testState.ok ? '#dcfce7' : '#fee2e2',
                          color: testState.ok ? '#166534' : '#991b1b',
                        }}
                      >
                        {testState.message}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="grid-2">
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>CLI 命令名</label>
                        <input
                          className="input"
                          value={p.command}
                          onChange={(e) => updateField(idx, { command: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>CLI 参数（空格分隔）</label>
                        <input
                          className="input"
                          value={p.args.join(' ')}
                          onChange={(e) =>
                            updateField(idx, {
                              args: e.target.value.split(/\s+/).filter(Boolean),
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>指定模型名（可选，留空走订阅默认）</label>
                        <input
                          className="input"
                          placeholder="留空默认"
                          value={p.model || ''}
                          onChange={(e) => updateField(idx, { model: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>提示词传入方式 & 超时（秒）</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select
                            className="select"
                            value={p.inputMode}
                            onChange={(e) =>
                              updateField(idx, {
                                inputMode: e.target.value as 'stdin' | 'arg',
                              })
                            }
                          >
                            <option value="stdin">stdin 管道</option>
                            <option value="arg">命令行参数</option>
                          </select>
                          <input
                            type="number"
                            className="input"
                            style={{ width: 84 }}
                            value={p.timeoutSec}
                            onChange={(e) =>
                              updateField(idx, {
                                timeoutSec: Math.max(30, Number(e.target.value) || 300),
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {(p.installCmd || p.loginCmd) && (
                      <div
                        style={{
                          background: '#f8fafc',
                          borderRadius: 8,
                          padding: '7px 10px',
                          fontSize: 12,
                          color: '#334155',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        {p.installCmd && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span>
                              <strong>安装：</strong>
                              <code>{p.installCmd}</code>
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => copyCmd(`${p.id}-install`, p.installCmd)}
                            >
                              <Copy size={11} />
                              {copiedKey === `${p.id}-install` ? '已复制' : '复制'}
                            </button>
                          </div>
                        )}
                        {p.loginCmd && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span>
                              <strong>订阅登录：</strong>
                              <code>{p.loginCmd}</code>
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => copyCmd(`${p.id}-login`, p.loginCmd)}
                            >
                              <Copy size={11} />
                              {copiedKey === `${p.id}-login` ? '已复制' : '复制'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? '保存中...' : '保存模型池'}
          </button>
        </div>
      </div>
    </div>
  );
};
