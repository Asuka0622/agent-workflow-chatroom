import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Terminal,
  Trash2,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ProviderConfig,
  ProviderConnectionType,
  ProviderHealth,
} from '../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';

interface ProvidersModalProps {
  providers: ProviderConfig[];
  onClose: () => void;
  onOpenInvite?: () => void;
  onSaved: (updated: ProviderConfig[]) => void;
}

interface ProviderQuickGuide {
  steps: string[];
  docsUrl?: string;
  docsLabel?: string;
  apiKeyUrl?: string;
  apiKeyLabel?: string;
  switchToApi?: {
    label: string;
    connectionType: ProviderConnectionType;
    apiBaseUrl: string;
    model: string;
  };
}

const OPENAI_COMPAT_QUICK_FILLS: Array<{
  label: string;
  apiBaseUrl: string;
  model: string;
  relayName?: string;
  keyUrl: string;
}> = [
  {
    label: 'DeepSeek 官方',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    label: 'OpenAI 官方',
    apiBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    label: 'OpenRouter 中转',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5',
    relayName: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    label: '硅基流动',
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    relayName: '硅基流动',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    label: '本机 Ollama（免 Key）',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:14b',
    keyUrl: 'https://ollama.com/download',
  },
];

function getProviderGuide(p: ProviderConfig): ProviderQuickGuide {
  const connType: ProviderConnectionType = p.connectionType || 'cli';
  const id = (p.id || '').toLowerCase();
  const cmd = (p.command || '').toLowerCase();
  const base = (p.apiBaseUrl || '').toLowerCase();

  if (connType === 'cli') {
    if (id.includes('claude') || cmd === 'claude') {
      return {
        docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
        docsLabel: 'Claude Code 文档',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        apiKeyLabel: '获取 Claude API Key',
        switchToApi: {
          label: '改用 Claude API 直连',
          connectionType: 'anthropic_api',
          apiBaseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5',
        },
        steps: [
          '点击下方「终端运行」先安装 Claude Code CLI（需本机已装 Node.js / npm）。',
          '点击登录行的「终端运行」，在弹出的窗口中按提示打开浏览器完成 Claude Pro / Max 授权。',
          '授权完成后回到这里点「刷新状态」，看到绿色「CLI 已就绪」再点底部保存。',
        ],
      };
    }
    if (id.includes('gemini') || cmd === 'agy' || cmd === 'gemini') {
      const isAgy = cmd === 'agy' || (p.installCmd || '').includes('antigravity.google');
      return {
        docsUrl: isAgy
          ? 'https://antigravity.google/docs/getting-started'
          : 'https://antigravity.google/docs/cli/reference',
        docsLabel: 'Antigravity CLI 文档',
        apiKeyUrl: 'https://aistudio.google.com/apikey',
        apiKeyLabel: '获取 AI Studio Key',
        switchToApi: {
          label: '改用 Gemini API 直连',
          connectionType: 'gemini_api',
          apiBaseUrl: 'https://generativelanguage.googleapis.com',
          model: 'gemini-2.5-pro',
        },
        steps: isAgy
          ? [
              '点击下方安装行的「终端运行」安装官方 Antigravity CLI（agy，默认安装到 %LOCALAPPDATA%\\agy\\bin）。',
              '点击登录行的「终端运行」启动 agy，用个人 Google / Antigravity 账号完成浏览器授权登录（运行 agy models 可查看模型名）。',
              '授权完成后回到这里点「刷新状态」，变为绿色「CLI 已就绪」后点底部保存（无需重启应用）。',
            ]
          : [
              'Google 已停用旧版 gemini CLI 的个人账号登录，建议改用官方 Antigravity CLI（把命令改为 agy、参数改为 -p --output-format text）。',
              '或者直接点右侧「改用 Gemini API 直连」，用 Google AI Studio API Key 即可免 OAuth 登录直接使用。',
              '配置完成后点「刷新状态」并保存。',
            ],
      };
    }
    if (id.includes('codex') || cmd === 'codex') {
      return {
        docsUrl: 'https://github.com/openai/codex',
        docsLabel: 'Codex CLI 文档',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        apiKeyLabel: '获取 OpenAI API Key',
        switchToApi: {
          label: '改用 OpenAI API 直连',
          connectionType: 'openai_api',
          apiBaseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        },
        steps: [
          '点击安装行的「终端运行」安装 OpenAI Codex CLI。',
          '点击登录行的「终端运行」用 ChatGPT Plus / Pro 订阅账号完成授权。',
          '回到这里点「刷新状态」，确认绿色「CLI 已就绪」后保存。',
        ],
      };
    }
    if (id.includes('ollama') || cmd === 'ollama') {
      return {
        docsUrl: 'https://ollama.com/download',
        docsLabel: '下载 Ollama / 查看模型库',
        switchToApi: {
          label: '改用本机 Ollama API（免 Key）',
          connectionType: 'openai_api',
          apiBaseUrl: 'http://127.0.0.1:11434/v1',
          model: 'qwen2.5-coder:14b',
        },
        steps: [
          '点击「下载 Ollama」或安装行的「终端运行」安装 Ollama 客户端并启动。',
          '点击拉取模型行的「终端运行」下载本地模型（如 qwen2.5-coder:14b，纯本地 0 费用）。',
          '下载完成后点「刷新状态」确认就绪，或点右侧一键切为本机 API 直连。',
        ],
      };
    }
    return {
      steps: [
        '把下面「CLI 命令名」和「CLI 参数」改成你本机工具的无头调用方式（支持从 stdin 读取提示词）。',
        '先在本机终端确认该命令可直接输出文本，再点右上角「刷新状态」检测命令是否在 PATH 中。',
        '如果用的是网页版/桌面聊天窗口（如豆包、Cursor、WorkBuddy），建议点顶部「去邀请模型入群」更省事。',
      ],
    };
  }

  // API modes
  if (connType === 'anthropic_api') {
    return {
      apiKeyUrl: 'https://console.anthropic.com/settings/keys',
      apiKeyLabel: '前往 Anthropic 获取 Key',
      steps: [
        '点击右侧「前往 Anthropic 获取 Key」登录控制台并创建一个 sk-ant-... 密钥。',
        '将密钥粘贴到下方 API Key 输入框，按需确认 Model ID（如 claude-sonnet-4-5）。',
        '点「测试连通性」看到绿色通过提示后，点底部「保存模型池」。',
      ],
    };
  }
  if (connType === 'gemini_api') {
    return {
      apiKeyUrl: 'https://aistudio.google.com/apikey',
      apiKeyLabel: '前往 Google AI Studio 获取 Key',
      steps: [
        '点击右侧「前往 Google AI Studio 获取 Key」一键创建免费/付费 API Key。',
        '粘贴到下方 API Key 输入框，模型名可保持 gemini-2.5-pro 或改为 gemini-2.5-flash。',
        '点「测试连通性」验证通过后，点底部「保存模型池」。',
      ],
    };
  }
  if (connType === 'azure_openai') {
    return {
      apiKeyUrl: 'https://portal.azure.com/',
      apiKeyLabel: '前往 Azure Portal',
      steps: [
        '在 Azure OpenAI 资源页的「密钥和终结点」复制 Endpoint URL 和 KEY 1。',
        '模型名称栏填写你在 Azure AI Foundry 里创建的 Deployment 部署名（非基础模型名）。',
        '点「测试连通性」验证通过后，点底部「保存模型池」。',
      ],
    };
  }
  if (base.includes('deepseek')) {
    return {
      apiKeyUrl: 'https://platform.deepseek.com/api_keys',
      apiKeyLabel: '前往 DeepSeek 开放平台获取 Key',
      steps: [
        '点击右侧「前往 DeepSeek 开放平台获取 Key」新建一个 API Key。',
        '把 sk-... 粘贴到下方 API Key 框，模型可填 deepseek-chat 或 deepseek-reasoner。',
        '点「测试连通性」验证通过后，点底部「保存模型池」。',
      ],
    };
  }
  if (/127\.0\.0\.1|localhost/.test(base)) {
    return {
      docsUrl: 'https://ollama.com/download',
      docsLabel: '打开 Ollama 官网',
      steps: [
        '确认本机 Ollama 或本地 OpenAI 兼容服务已启动（默认端口 11434）。',
        '本机服务无需填写 API Key，直接确认模型名（如 qwen2.5-coder:14b）已拉取即可。',
        '点「测试连通性」验证通过后保存。',
      ],
    };
  }
  return {
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiKeyLabel: 'OpenAI Key 入口',
    steps: [
      '可先点下方快捷按钮一键填入 DeepSeek / OpenAI / OpenRouter / 硅基流动 / 本机 Ollama 的地址与默认模型。',
      '前往对应平台获取 API Key 并粘贴到下方输入框。',
      '点「测试连通性」变绿后，点底部「保存模型池」。',
    ],
  };
}

const CONNECTION_LABELS: Record<ProviderConnectionType, string> = {
  cli: '订阅制（本地 CLI）',
  openai_api: 'OpenAI 兼容 API',
  azure_openai: 'Azure OpenAI API',
  anthropic_api: 'Anthropic API',
  gemini_api: 'Gemini API',
};

const API_PRESETS: Array<{
  label: string;
  labelEn: string;
  create: () => ProviderConfig;
}> = [
  {
    label: '+ DeepSeek API',
    labelEn: '+ DeepSeek API',
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
    labelEn: '+ OpenAI-Compat API',
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
    label: '+ Azure OpenAI',
    labelEn: '+ Azure OpenAI',
    create: () => ({
      id: `azure_${Date.now().toString(36).slice(-4)}`,
      name: 'Azure OpenAI',
      shortName: 'Azure GPT',
      accentColor: '#0284c7',
      connectionType: 'azure_openai',
      subscriptionHint: 'Azure OpenAI（使用 api-key 请求头与 Deployment 部署名）',
      command: 'api',
      args: [],
      inputMode: 'stdin',
      apiBaseUrl: 'https://<your-resource>.openai.azure.com',
      apiKey: '',
      model: 'gpt-4o',
      installCmd: '',
      loginCmd: '',
      docsHint: 'Base URL 填 Azure Resource Endpoint（或完整含 api-version 的部署 URL），模型名称填 Deployment Name。',
      timeoutSec: 180,
      forceMock: false,
    }),
  },
  {
    label: '+ Claude API',
    labelEn: '+ Claude API',
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
    labelEn: '+ Gemini API',
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
    label: '+ Antigravity CLI (agy)',
    labelEn: '+ Antigravity CLI (agy)',
    create: () => ({
      id: `agy_${Date.now().toString(36).slice(-4)}`,
      name: 'Antigravity CLI (Gemini)',
      shortName: 'Gemini (agy)',
      accentColor: '#2563eb',
      connectionType: 'cli',
      subscriptionHint: 'Google 账号 / Antigravity 订阅（官方 Antigravity CLI · agy）',
      command: 'agy',
      args: ['-p', '--output-format', 'text'],
      inputMode: 'stdin',
      modelFlag: '--model',
      model: '',
      installCmd: 'irm https://antigravity.google/cli/install.ps1 | iex',
      loginCmd: 'agy',
      docsHint: '首次运行 agy 完成 Google / Antigravity 登录，支持 agy -p --output-format text 读取 stdin 执行。',
      timeoutSec: 300,
      forceMock: false,
    }),
  },
  {
    label: '+ 订阅制 CLI',
    labelEn: '+ Local CLI',
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
  onOpenInvite,
  onSaved,
}) => {
  const { isEn, tr } = useI18n();
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
  const [copyOpenTerminal, setCopyOpenTerminal] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('providers_copy_open_terminal');
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });
  const [terminalNotice, setTerminalNotice] = useState<Record<string, string>>({});
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
        } else if (nextType === 'azure_openai' && !item.apiBaseUrl) {
          patch.apiBaseUrl = 'https://<your-resource>.openai.azure.com';
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

  const toggleCopyOpenTerminal = (checked: boolean) => {
    setCopyOpenTerminal(checked);
    try {
      localStorage.setItem('providers_copy_open_terminal', checked ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  };

  const copyCmd = async (
    key: string,
    text: string,
    opts?: { providerId?: string; title?: string },
  ) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 1800);
    if (copyOpenTerminal) {
      try {
        await api.launchProviderTerminal(text, opts?.title || '本机终端', false);
        if (opts?.providerId) {
          setTerminalNotice((prev) => ({
            ...prev,
            [opts.providerId!]: '已复制命令并自动弹出本机终端，直接按 Ctrl+V / 右键粘贴回车即可',
          }));
        }
      } catch (err) {
        if (opts?.providerId) {
          setTerminalNotice((prev) => ({
            ...prev,
            [opts.providerId!]: `命令已复制，但自动打开终端失败：${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      }
    }
  };

  const launchInTerminal = async (providerId: string, cmd: string, title: string) => {
    const clean = cmd.trim();
    if (!clean || clean.startsWith('#')) {
      setTerminalNotice((prev) => ({ ...prev, [providerId]: '当前命令是注释占位，请先填写实际命令' }));
      return;
    }
    try {
      await api.launchProviderTerminal(clean, title, true);
      setTerminalNotice((prev) => ({
        ...prev,
        [providerId]: '已弹出本机终端运行命令；安装或登录完成后点右上角「检测环境」刷新状态',
      }));
    } catch (err) {
      setTerminalNotice((prev) => ({
        ...prev,
        [providerId]: err instanceof Error ? err.message : '打开终端失败，可改点右侧「复制」手动运行',
      }));
    }
  };

  const openExternal = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
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
            <h2>{tr('模型池配置（支持订阅制 CLI / API 直连）', 'Model Pool (Subscription CLI / Direct API)')}</h2>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
              {tr(
                '每个模型可自由切换「订阅制本地 CLI」或「API 直连（OpenAI 兼容 / Anthropic / Gemini）」，所有密钥仅保存在本机。',
                'Switch any model between Local Subscription CLI and Direct API (OpenAI-compat / Anthropic / Gemini). Keys stay local.',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={runHealthCheck} disabled={checking}>
              <RefreshCw size={13} className={checking ? 'spin' : ''} />
              {checking ? tr('检测中...', 'Checking...') : tr('检测环境', 'Check Env')}
            </button>
            <button className="btn btn-sm" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {/* 3-Way Onboarding & Shortcut Banner */}
          <div className="providers-onboarding-strip">
            <div className="providers-onboarding-copy">
              <strong>{tr('不知道选哪种？3 秒选对接入方式：', 'Not sure which to pick? 3-second guide:')}</strong>
              <span>
                {tr(
                  '① 已有豆包 / DeepSeek / Cursor / Antigravity 等现成 AI 窗口 → 直接「邀请入群」免配 Key；② 有官方订阅 → 下面 CLI 点「终端运行」两步装好登录；③ 有 API Key → 点下方快捷模板，点「去获取 Key」粘贴测通即可。',
                  '① Existing AI window (Cursor / Antigravity / WorkBuddy / Doubao) → use "Invite Agent" (no key needed); ② Subscription CLI → click "Run in Terminal" below to install & sign in; ③ API Key → pick a preset below, paste your key, and test.',
                )}
              </span>
            </div>
            {onOpenInvite && (
              <button
                type="button"
                className="btn btn-ink btn-sm"
                style={{ flexShrink: 0 }}
                onClick={onOpenInvite}
              >
                <UserPlus size={12} />
                <span>{tr('去「邀请模型入群」', 'Invite Agent')}</span>
                <ArrowRight size={12} />
              </button>
            )}
          </div>

          {/* Quick-Add Preset Strip */}
          <div className="quick-add-bar">
            <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} />
              {tr('快速接入其他模型：', 'Quick Add Model:')}
            </span>
            {API_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="preset-chip active-chip"
                onClick={() => addPreset(preset.create)}
              >
                {isEn ? preset.labelEn : preset.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
              padding: '8px 12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>{tr('本机工具：', 'Local Tools:')}</strong>
              <span className={`health-pill ${gitHealth?.installed ? 'ok' : 'miss'}`}>
                {gitHealth?.installed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                git {gitHealth?.installed ? tr('已安装', 'Ready') : tr('未安装', 'Missing')}
              </span>
              <span className={`health-pill ${ghHealth?.installed ? 'ok' : 'miss'}`}>
                {ghHealth?.installed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                gh{tr('（可选）', ' (opt)')} {ghHealth?.installed ? tr('已安装', 'Ready') : tr('未安装', 'Missing')}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label
                className="copy-terminal-toggle"
                title={tr(
                  '开启后，点任意命令的「复制」按钮都会顺便弹出一个本机终端窗口，直接 Ctrl+V 就能粘贴执行',
                  'When enabled, clicking Copy also opens a local PowerShell terminal ready for Ctrl+V',
                )}
              >
                <input
                  type="checkbox"
                  checked={copyOpenTerminal}
                  onChange={(e) => toggleCopyOpenTerminal(e.target.checked)}
                />
                <Terminal size={12} />
                <span>{tr('复制命令后自动打开终端', 'Auto-open terminal on copy')}</span>
              </label>
              <button
                type="button"
                className="btn btn-sm"
                title={tr('直接打开一个空白本机 PowerShell 终端', 'Open a blank local PowerShell window')}
                onClick={() => void api.launchProviderTerminal('', 'Local Terminal', false)}
              >
                <Terminal size={12} />
                <span>{tr('打开终端', 'Open Terminal')}</span>
              </button>
            </div>
          </div>

          {draft.map((p, idx) => {
            const connType: ProviderConnectionType = p.connectionType || 'cli';
            const isApi = connType !== 'cli';
            const h = healthMap.get(p.id);
            const testState = testResults[p.id];
            const isLocalApi = isApi && /127\.0\.0\.1|localhost/i.test(p.apiBaseUrl || '');
            const apiReady = isApi && Boolean((p.apiKey?.trim() || isLocalApi) && p.model?.trim());
            const guide = getProviderGuide(p);
            const connLabelMap: Record<ProviderConnectionType, string> = isEn
              ? {
                  cli: 'Subscription (Local CLI)',
                  openai_api: 'OpenAI-Compatible API',
                  azure_openai: 'Azure OpenAI API',
                  anthropic_api: 'Anthropic API',
                  gemini_api: 'Gemini API',
                }
              : CONNECTION_LABELS;

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
                          {connLabelMap[connType]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {p.subscriptionHint}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {isApi ? (
                      <span className={`health-pill ${apiReady ? 'ok' : 'miss'}`}>
                        {apiReady ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        {apiReady
                          ? tr(`API 已填 (${p.model})`, `API Ready (${p.model})`)
                          : tr('待填 API Key / 模型名', 'API Key / Model Needed')}
                      </span>
                    ) : (
                      <span className={`health-pill ${h?.installed ? 'ok' : 'miss'}`}>
                        {h?.installed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        {h?.installed
                          ? tr('CLI 已就绪', 'CLI Ready')
                          : tr(`未检测到 ${p.command}`, `${p.command} not found`)}
                      </span>
                    )}

                    {draft.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        title={tr('删除此模型', 'Delete model')}
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
                    <label>{tr('显示名称（默认自动用「模型名」或「模型名 (中转名)」）', 'Display Name')}</label>
                    <input
                      className="input"
                      value={p.shortName}
                      onChange={(e) =>
                        updateField(idx, { shortName: e.target.value, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label>{tr('中转 / 平台名（可选，如 WorkBuddy / OpenRouter）', 'Relay / Platform (optional)')}</label>
                    <input
                      className="input"
                      placeholder={tr('直连官方留空；中转填名称，自动加括号', 'Leave blank for direct; relay name adds suffix')}
                      value={p.relayName || ''}
                      onChange={(e) => updateField(idx, { relayName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="field" style={{ marginBottom: 8 }}>
                  <label>{tr('接入方式（订阅制 CLI 或 API）', 'Connection Type (CLI or Direct API)')}</label>
                  <select
                    className="select"
                    value={connType}
                    onChange={(e) =>
                      switchConnectionType(idx, e.target.value as ProviderConnectionType)
                    }
                  >
                    <option value="cli">{tr('订阅制（调用本机官方 CLI / Ollama）', 'Subscription (Local CLI / Ollama)')}</option>
                    <option value="openai_api">{tr('API · OpenAI 兼容（OpenAI / DeepSeek / Kimi / Qwen / 中转）', 'API · OpenAI-Compatible (OpenAI / DeepSeek / OpenRouter)')}</option>
                    <option value="azure_openai">{tr('API · Azure OpenAI（api-key 头 + Deployment 部署名）', 'API · Azure OpenAI (api-key + Deployment)')}</option>
                    <option value="anthropic_api">{tr('API · Anthropic（Claude 官方或兼容代理）', 'API · Anthropic (Claude Official or Proxy)')}</option>
                    <option value="gemini_api">{tr('API · Google Gemini REST', 'API · Google Gemini REST')}</option>
                  </select>
                </div>

                {isApi ? (
                  <>
                    {/* API Step-by-Step Guide & Quick Actions */}
                    <div className="provider-guide-box">
                      <div className="provider-guide-head">
                        <strong>配置步骤</strong>
                        <div className="provider-quick-links">
                          {guide.apiKeyUrl && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => openExternal(guide.apiKeyUrl!)}
                            >
                              <KeyRound size={11} />
                              <span>{guide.apiKeyLabel || '去官网获取 API Key'}</span>
                              <ExternalLink size={11} />
                            </button>
                          )}
                          {guide.docsUrl && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => openExternal(guide.docsUrl!)}
                            >
                              <span>{guide.docsLabel || '官方文档'}</span>
                              <ExternalLink size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      <ol className="provider-guide-steps">
                        {guide.steps.map((s, si) => (
                          <li key={si}>{s}</li>
                        ))}
                      </ol>
                      {connType === 'openai_api' && (
                        <div className="provider-quick-fills">
                          <span className="provider-quick-fills-label">一键填地址：</span>
                          {OPENAI_COMPAT_QUICK_FILLS.map((qf) => (
                            <button
                              key={qf.label}
                              type="button"
                              className="preset-chip"
                              title={`填入 ${qf.apiBaseUrl} / ${qf.model}`}
                              onClick={() =>
                                updateField(idx, {
                                  apiBaseUrl: qf.apiBaseUrl,
                                  model: qf.model,
                                  relayName: qf.relayName || '',
                                })
                              }
                            >
                              {qf.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid-2">
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>
                          {connType === 'azure_openai' ? 'Azure Endpoint / 完整部署 URL' : 'API Base URL'}
                        </label>
                        <input
                          className="input"
                          placeholder={
                            connType === 'azure_openai'
                              ? 'https://<resource>.openai.azure.com（或完整部署 URL）'
                              : '例如：https://api.deepseek.com/v1'
                          }
                          value={p.apiBaseUrl || ''}
                          onChange={(e) => updateField(idx, { apiBaseUrl: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>
                          {connType === 'azure_openai' ? '部署名（Deployment Name）*' : '模型名称（Model ID）*'}
                        </label>
                        <input
                          className="input"
                          placeholder={
                            connType === 'azure_openai'
                              ? '例如：gpt-4o / gpt-5-mini（Azure Portal 中的部署名称）'
                              : '例如：deepseek-chat / gpt-4o / qwen-max / claude-sonnet-4-5'
                          }
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
                          {testState?.testing ? tr('测试中...', 'Testing...') : tr('测试连通性', 'Test Connection')}
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
                        <label>{tr('CLI 命令名', 'CLI Command')}</label>
                        <input
                          className="input"
                          value={p.command}
                          onChange={(e) => updateField(idx, { command: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>{tr('CLI 参数（空格分隔）', 'CLI Args (space-separated)')}</label>
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
                        <label>{tr('指定模型名（可选，留空走订阅默认）', 'Model ID (optional, blank for default)')}</label>
                        <input
                          className="input"
                          placeholder={tr('留空默认', 'Default')}
                          value={p.model || ''}
                          onChange={(e) => updateField(idx, { model: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label>{tr('提示词传入方式 & 超时（秒）', 'Prompt Input & Timeout (s)')}</label>
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
                            <option value="stdin">{tr('stdin 管道', 'stdin pipe')}</option>
                            <option value="arg">{tr('命令行参数', 'CLI arg')}</option>
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

                    <div className="provider-guide-box">
                      <div className="provider-guide-head">
                        <strong>
                          {tr('操作步骤', 'Setup Steps')} ({h?.installed ? tr('已检测到本机 CLI', 'CLI detected') : tr('按步骤 1 → 2 → 3 完成配置', 'Follow steps 1 → 2 → 3')})
                        </strong>
                        <div className="provider-quick-links">
                          {guide.docsUrl && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => openExternal(guide.docsUrl!)}
                            >
                              <span>{guide.docsLabel || tr('官方文档', 'Docs')}</span>
                              <ExternalLink size={11} />
                            </button>
                          )}
                          {guide.switchToApi && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() =>
                                updateField(idx, {
                                  connectionType: guide.switchToApi!.connectionType,
                                  apiBaseUrl: guide.switchToApi!.apiBaseUrl,
                                  model: guide.switchToApi!.model,
                                })
                              }
                            >
                              <KeyRound size={11} />
                              <span>{tr(guide.switchToApi.label, 'Switch to Direct API')}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={checking}
                            onClick={() => void runHealthCheck()}
                          >
                            <RefreshCw size={11} className={checking ? 'spin' : ''} />
                            <span>{tr('刷新状态', 'Refresh')}</span>
                          </button>
                        </div>
                      </div>

                      <ol className="provider-guide-steps">
                        {guide.steps.map((s, si) => (
                          <li key={si}>{s}</li>
                        ))}
                      </ol>

                      {(p.installCmd || p.loginCmd) && (
                        <div className="provider-cmd-list">
                          {p.installCmd && (
                            <div className="provider-cmd-row">
                              <span className="provider-cmd-text">
                                <strong>{tr('① 安装：', '① Install: ')}</strong>
                                <code>{p.installCmd}</code>
                              </span>
                              <div className="provider-cmd-actions">
                                {!p.installCmd.trim().startsWith('#') && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    onClick={() =>
                                      void launchInTerminal(p.id, p.installCmd, `${p.shortName} Install`)
                                    }
                                  >
                                    <Terminal size={11} />
                                    <span>{tr('终端运行', 'Run in Terminal')}</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  title={
                                    copyOpenTerminal
                                      ? tr('复制命令并自动打开本机终端（不自动执行，粘贴确认后回车）', 'Copy command & open local terminal')
                                      : tr('仅复制命令到剪贴板', 'Copy command to clipboard')
                                  }
                                  onClick={() =>
                                    void copyCmd(`${p.id}-install`, p.installCmd, {
                                      providerId: p.id,
                                      title: `${p.shortName} Install`,
                                    })
                                  }
                                >
                                  <Copy size={11} />
                                  {copiedKey === `${p.id}-install`
                                    ? copyOpenTerminal
                                      ? tr('已复制并开终端', 'Copied + Opened')
                                      : tr('已复制', 'Copied')
                                    : copyOpenTerminal
                                      ? tr('复制并开终端', 'Copy + Terminal')
                                      : tr('复制', 'Copy')}
                                </button>
                              </div>
                            </div>
                          )}
                          {p.loginCmd && (
                            <div className="provider-cmd-row">
                              <span className="provider-cmd-text">
                                <strong>{tr('② 登录：', '② Sign In: ')}</strong>
                                <code>{p.loginCmd}</code>
                              </span>
                              <div className="provider-cmd-actions">
                                {!p.loginCmd.trim().startsWith('#') && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-ink"
                                    onClick={() =>
                                      void launchInTerminal(p.id, p.loginCmd, `${p.shortName} Sign In`)
                                    }
                                  >
                                    <Terminal size={11} />
                                    <span>{tr('终端运行', 'Run in Terminal')}</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  title={
                                    copyOpenTerminal
                                      ? tr('复制命令并自动打开本机终端（不自动执行，粘贴确认后回车）', 'Copy command & open local terminal')
                                      : tr('仅复制命令到剪贴板', 'Copy command to clipboard')
                                  }
                                  onClick={() =>
                                    void copyCmd(`${p.id}-login`, p.loginCmd, {
                                      providerId: p.id,
                                      title: `${p.shortName} Sign In`,
                                    })
                                  }
                                >
                                  <Copy size={11} />
                                  {copiedKey === `${p.id}-login`
                                    ? copyOpenTerminal
                                      ? tr('已复制并开终端', 'Copied + Opened')
                                      : tr('已复制', 'Copied')
                                    : copyOpenTerminal
                                      ? tr('复制并开终端', 'Copy + Terminal')
                                      : tr('复制', 'Copy')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {terminalNotice[p.id] && (
                        <div className="provider-terminal-notice">{terminalNotice[p.id]}</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {tr('取消', 'Cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? tr('保存中...', 'Saving...') : tr('保存模型池', 'Save Model Pool')}
          </button>
        </div>
      </div>
    </div>
  );
};
