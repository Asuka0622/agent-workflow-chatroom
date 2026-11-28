import React, { useRef, useState } from 'react';
import {
  Blocks,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  FileUp,
  FolderOpen,
  Globe,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  KnowledgeDoc,
  PluginKind,
  ScheduledTask,
  WorkbenchConfig,
  WorkbenchPlugin,
  WorkbenchSkill,
  WorkflowTemplate,
} from '../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';

export type WorkbenchModalTab = 'skills' | 'plugins' | 'knowledge' | 'automation';

export interface WorkbenchMemberOption {
  id: string;
  name: string;
  color?: string;
}

interface WorkbenchModalProps {
  workbench: WorkbenchConfig;
  initialTab: WorkbenchModalTab;
  repoPath: string;
  activeRoomId: string;
  members?: WorkbenchMemberOption[];
  onClose: () => void;
  onSaveWorkbench: (next: WorkbenchConfig, toastMsg?: string) => Promise<void>;
  onTestPlugin: (pluginId: string) => Promise<void>;
  onRunSchedule: (scheduleId: string) => Promise<void>;
  onInsertPrompt: (text: string, mode?: 'chat' | 'workflow', sendImmediately?: boolean) => void;
}

const PLUGIN_SHORT_KIND: Record<PluginKind, string> = {
  mcp_stdio: 'MCP',
  mcp_http: 'MCP',
  cli_tool: '工具',
  webhook: 'Webhook',
};

const MCP_QUICK_PRESETS: Array<{
  name: string;
  kind: PluginKind;
  description: string;
  command?: string;
  args?: string[];
}> = [
  {
    name: 'Filesystem MCP',
    kind: 'mcp_stdio',
    description: '读写与检索本地工作区文件',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  },
  {
    name: 'Fetch 网页抓取',
    kind: 'mcp_stdio',
    description: '抓取网页与文档转 Markdown',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
  },
  {
    name: 'Sequential Thinking',
    kind: 'mcp_stdio',
    description: '结构化分步推理与拆解',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    name: 'Git 变更检查',
    kind: 'cli_tool',
    description: '查看仓库暂存与未提交改动',
    command: 'git',
    args: ['diff', '--stat'],
  },
  {
    name: 'TypeScript 校验',
    kind: 'cli_tool',
    description: '检查当前项目类型错误',
    command: 'npm',
    args: ['run', 'typecheck'],
  },
];

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function parseLocalSkillFileText(
  rawText: string,
  fileName: string,
): Array<{ name: string; description: string; prompt: string; trigger?: string }> {
  const trimmed = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];
  const baseName = fileName.replace(/\.(md|mdc|txt|json)$/i, '').trim() || '外部技能';

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { skills?: unknown[] }).skills)
          ? (parsed as { skills: unknown[] }).skills
          : [parsed];
      const out: Array<{ name: string; description: string; prompt: string; trigger?: string }> = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const prompt = String(obj.prompt || obj.content || obj.instructions || '').trim();
        if (!prompt) continue;
        out.push({
          name: String(obj.name || obj.title || baseName).trim(),
          description: String(obj.description || '').trim() || prompt.slice(0, 80),
          prompt: prompt.slice(0, 12000),
          trigger: typeof obj.trigger === 'string' && obj.trigger.trim() ? obj.trigger.trim() : undefined,
        });
      }
      if (out.length > 0) return out;
    } catch {
      // fall back to Markdown
    }
  }

  let name = baseName;
  let description = '';
  let trigger: string | undefined;
  let body = trimmed;

  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    const fmLines = fmMatch[1].split(/\r?\n/);
    body = fmMatch[2].trim();
    let currentKey = '';
    const fmMap: Record<string, string> = {};
    for (const line of fmLines) {
      const keyMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (keyMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
        currentKey = keyMatch[1].toLowerCase();
        const rawVal = keyMatch[2].trim();
        fmMap[currentKey] =
          rawVal === '|' || rawVal === '>' || rawVal === '|-' || rawVal === '>-'
            ? ''
            : rawVal.replace(/^['"]|['"]$/g, '');
      } else if (currentKey && (line.startsWith(' ') || line.startsWith('\t'))) {
        fmMap[currentKey] = `${fmMap[currentKey] ? `${fmMap[currentKey]} ` : ''}${line.trim()}`;
      }
    }
    if (fmMap.name) name = fmMap.name.trim();
    if (fmMap.description) description = fmMap.description.trim();
    if (fmMap.trigger) trigger = fmMap.trigger.trim();
  }

  if (!name || /^skill$/i.test(name)) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1?.[1]?.trim()) name = h1[1].trim().slice(0, 60);
  }
  if (!description) {
    const firstPara = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('---'));
    description = (firstPara || '外部文件导入技能').slice(0, 120);
  }
  const finalPrompt = (body || trimmed).slice(0, 12000);
  return finalPrompt ? [{ name, description, prompt: finalPrompt, trigger }] : [];
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `每 ${minutes} 分钟`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '每天' : `每 ${days} 天`;
  }
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时`;
  return `每 ${minutes} 分钟`;
}

const PillSwitch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
}> = ({ checked, onChange, title }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    title={title}
    className={`pill-switch ${checked ? 'on' : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      onChange(!checked);
    }}
  >
    <span className="pill-switch-thumb" />
  </button>
);

export const WorkbenchModal: React.FC<WorkbenchModalProps> = ({
  workbench,
  initialTab,
  repoPath,
  members = [],
  onClose,
  onSaveWorkbench,
  onTestPlugin,
  onRunSchedule,
  onInsertPrompt,
}) => {
  const { tr } = useI18n();
  const [tab, setTab] = useState<WorkbenchModalTab>(initialTab);
  const [autoSubTab, setAutoSubTab] = useState<'templates' | 'schedules'>('templates');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState('');
  const [runningSchedId, setRunningSchedId] = useState('');

  // Add-form toggles (only 1 open at a time, super clean!)
  const [showAddForm, setShowAddForm] = useState(false);
  const [pluginAddMode, setPluginAddMode] = useState<'preset' | 'json' | 'custom'>('preset');

  // Skill fields
  const [skillName, setSkillName] = useState('');
  const [skillTrigger, setSkillTrigger] = useState('');
  const [skillPrompt, setSkillPrompt] = useState('');
  const [skillAutoInject, setSkillAutoInject] = useState(false);
  const [skillTargetIds, setSkillTargetIds] = useState<string[]>([]);

  // External Skill Import drawer state
  const [showSkillImport, setShowSkillImport] = useState(false);
  const [skillImportMode, setSkillImportMode] = useState<'scan' | 'file' | 'url'>('scan');
  const [importAutoInject, setImportAutoInject] = useState(true);
  const [importTargetIds, setImportTargetIds] = useState<string[]>([]);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverErr, setDiscoverErr] = useState('');
  const [customScanDir, setCustomScanDir] = useState('');
  const [discoveredSkills, setDiscoveredSkills] = useState<
    Array<{
      key: string;
      name: string;
      description: string;
      prompt: string;
      trigger?: string;
      source: string;
      filePath: string;
    }>
  >([]);
  const [selectedDiscoverKeys, setSelectedDiscoverKeys] = useState<string[]>([]);
  const [skillUrlInput, setSkillUrlInput] = useState('');
  const [skillUrlBusy, setSkillUrlBusy] = useState(false);
  const [skillUrlErr, setSkillUrlErr] = useState('');
  const skillFileInputRef = useRef<HTMLInputElement | null>(null);

  // Plugin fields
  const [mcpJsonText, setMcpJsonText] = useState('');
  const [mcpImportErr, setMcpImportErr] = useState('');
  const [pluginName, setPluginName] = useState('');
  const [pluginKind, setPluginKind] = useState<PluginKind>('mcp_stdio');
  const [pluginCmd, setPluginCmd] = useState('');
  const [pluginArgs, setPluginArgs] = useState('');
  const [pluginUrl, setPluginUrl] = useState('');

  // Knowledge fields
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Template / Schedule fields
  const [tplName, setTplName] = useState('');
  const [tplMode, setTplMode] = useState<'chat' | 'workflow'>('chat');
  const [tplPrompt, setTplPrompt] = useState('');
  const [schedName, setSchedName] = useState('');
  const [schedInterval, setSchedInterval] = useState(60);
  const [schedPrompt, setSchedPrompt] = useState('');

  const switchTab = (next: WorkbenchModalTab) => {
    setTab(next);
    setShowAddForm(false);
    setShowSkillImport(false);
    setExpandedId(null);
  };

  const runDiscoverLocalSkills = async (dirOverride?: string) => {
    setDiscoverBusy(true);
    setDiscoverErr('');
    try {
      const targetDir = dirOverride !== undefined ? dirOverride : customScanDir.trim();
      const res = await api.discoverLocalSkills(repoPath, targetDir || undefined);
      setDiscoveredSkills(res.skills);
      setSelectedDiscoverKeys([]);
    } catch (err) {
      setDiscoverErr(err instanceof Error ? err.message : '扫描本机 Skill 目录失败');
      setDiscoveredSkills([]);
    } finally {
      setDiscoverBusy(false);
    }
  };

  const openSkillImportDrawer = () => {
    const next = !showSkillImport;
    setShowSkillImport(next);
    if (next) {
      setShowAddForm(false);
      if (skillImportMode === 'scan' && discoveredSkills.length === 0) {
        void runDiscoverLocalSkills();
      }
    }
  };

  const commitImportedSkills = async (
    items: Array<{ name: string; description: string; prompt: string; trigger?: string }>,
    label: string,
  ) => {
    if (items.length === 0) return;
    const now = new Date().toISOString();
    const created: WorkbenchSkill[] = items.map((item) => ({
      id: makeId('skill'),
      name: item.name.trim() || '外部技能',
      trigger: item.trigger?.trim() || '',
      description: item.description.trim() || '外部导入技能',
      prompt: item.prompt.trim().slice(0, 12000),
      autoInject: importAutoInject,
      enabled: true,
      targetMemberIds: importTargetIds.length > 0 ? [...importTargetIds] : undefined,
      updatedAt: now,
    }));
    await onSaveWorkbench(
      { ...workbench, skills: [...created, ...workbench.skills] },
      `${label}（共 ${created.length} 个 Skill）`,
    );
    setSelectedDiscoverKeys([]);
    setShowSkillImport(false);
  };

  const handleImportDiscovered = async () => {
    const picked = discoveredSkills.filter((s) => selectedDiscoverKeys.includes(s.key));
    if (picked.length === 0) return;
    await commitImportedSkills(picked, '已从本机导入');
  };

  const handleUploadSkillFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    const parsedAll: Array<{ name: string; description: string; prompt: string; trigger?: string }> = [];
    for (const file of files) {
      const text = await file.text();
      parsedAll.push(...parseLocalSkillFileText(text, file.name));
    }
    if (parsedAll.length === 0) {
      setSkillUrlErr('所选文件中未解析出有效内容');
      return;
    }
    await commitImportedSkills(parsedAll, '已从文件导入');
  };

  const handleImportSkillFromUrl = async () => {
    const u = skillUrlInput.trim();
    if (!u) return;
    setSkillUrlBusy(true);
    setSkillUrlErr('');
    try {
      const res = await api.importSkillsFromUrl(u);
      await commitImportedSkills(res.skills, '已从链接导入');
      setSkillUrlInput('');
    } catch (err) {
      setSkillUrlErr(err instanceof Error ? err.message : '拉取链接失败');
    } finally {
      setSkillUrlBusy(false);
    }
  };

  const formatSkillScope = (targetIds?: string[]): string => {
    if (!targetIds || targetIds.length === 0) return '';
    const matchedNames = targetIds
      .map((id) => members.find((m) => m.id === id)?.name)
      .filter((n): n is string => Boolean(n));
    if (matchedNames.length === 0) return `仅 ${targetIds.length} 位成员`;
    if (matchedNames.length <= 2) return `仅 ${matchedNames.join(' · ')}`;
    return `仅 ${matchedNames[0]} 等 ${matchedNames.length} 位`;
  };

  const toggleSkillTarget = (skill: WorkbenchSkill, memberId: string) => {
    const cur = Array.isArray(skill.targetMemberIds) ? skill.targetMemberIds : [];
    const nextIds = cur.includes(memberId)
      ? cur.filter((id) => id !== memberId)
      : [...cur, memberId];
    const skills = workbench.skills.map((x) =>
      x.id === skill.id
        ? {
            ...x,
            targetMemberIds: nextIds.length > 0 ? nextIds : undefined,
            updatedAt: new Date().toISOString(),
          }
        : x,
    );
    void onSaveWorkbench({ ...workbench, skills });
  };

  const clearSkillTargets = (skill: WorkbenchSkill) => {
    const skills = workbench.skills.map((x) =>
      x.id === skill.id
        ? { ...x, targetMemberIds: undefined, updatedAt: new Date().toISOString() }
        : x,
    );
    void onSaveWorkbench({ ...workbench, skills });
  };

  const handleAddSkill = async () => {
    if (!skillName.trim() || !skillPrompt.trim()) return;
    const scopeDesc =
      skillTargetIds.length > 0
        ? `仅对 ${skillTargetIds.length} 位指定成员生效`
        : skillAutoInject
          ? '自动附加到全部成员对话'
          : '快捷调用指令';
    const item: WorkbenchSkill = {
      id: makeId('skill'),
      name: skillName.trim(),
      trigger: skillTrigger.trim(),
      description: scopeDesc,
      prompt: skillPrompt.trim(),
      autoInject: skillAutoInject,
      enabled: true,
      targetMemberIds: skillTargetIds.length > 0 ? [...skillTargetIds] : undefined,
      updatedAt: new Date().toISOString(),
    };
    await onSaveWorkbench(
      { ...workbench, skills: [item, ...workbench.skills] },
      `已添加「${item.name}」`,
    );
    setSkillName('');
    setSkillTrigger('');
    setSkillPrompt('');
    setSkillAutoInject(false);
    setSkillTargetIds([]);
    setShowAddForm(false);
  };

  const handleQuickAddPreset = async (preset: (typeof MCP_QUICK_PRESETS)[number]) => {
    const existing = workbench.plugins.find((p) => p.name === preset.name);
    if (existing) {
      const plugins = workbench.plugins.map((p) =>
        p.id === existing.id ? { ...p, enabled: true } : p,
      );
      await onSaveWorkbench({ ...workbench, plugins }, `已启用「${preset.name}」`);
      setShowAddForm(false);
      return;
    }
    const item: WorkbenchPlugin = {
      id: makeId('plugin'),
      name: preset.name,
      kind: preset.kind,
      description: preset.description,
      enabled: true,
      command: preset.command,
      args: preset.args,
      updatedAt: new Date().toISOString(),
    };
    await onSaveWorkbench(
      { ...workbench, plugins: [item, ...workbench.plugins] },
      `已添加「${preset.name}」`,
    );
    setShowAddForm(false);
  };

  const handleImportMcpJson = async () => {
    setMcpImportErr('');
    try {
      const raw = JSON.parse(mcpJsonText.trim()) as Record<string, unknown>;
      const serversObj =
        raw.mcpServers && typeof raw.mcpServers === 'object'
          ? (raw.mcpServers as Record<string, Record<string, unknown>>)
          : (raw as Record<string, Record<string, unknown>>);
      const added: WorkbenchPlugin[] = [];
      for (const [name, cfg] of Object.entries(serversObj)) {
        if (!cfg || typeof cfg !== 'object') continue;
        const command = typeof cfg.command === 'string' ? cfg.command.trim() : '';
        const url =
          typeof cfg.url === 'string'
            ? cfg.url.trim()
            : typeof cfg.serverUrl === 'string'
              ? cfg.serverUrl.trim()
              : '';
        if (!command && !url) continue;
        added.push({
          id: makeId('plugin'),
          name,
          kind: command ? 'mcp_stdio' : 'mcp_http',
          description: '从 JSON 导入',
          enabled: true,
          command: command || undefined,
          args: Array.isArray(cfg.args) ? cfg.args.map((x) => String(x)) : undefined,
          url: url || undefined,
          updatedAt: new Date().toISOString(),
        });
      }
      if (added.length === 0) {
        setMcpImportErr('未识别到有效的 command 或 url');
        return;
      }
      await onSaveWorkbench(
        { ...workbench, plugins: [...added, ...workbench.plugins] },
        `已导入 ${added.length} 个插件`,
      );
      setMcpJsonText('');
      setShowAddForm(false);
    } catch {
      setMcpImportErr('JSON 格式不正确');
    }
  };

  const handleAddPlugin = async () => {
    if (!pluginName.trim()) return;
    const item: WorkbenchPlugin = {
      id: makeId('plugin'),
      name: pluginName.trim(),
      kind: pluginKind,
      description: PLUGIN_SHORT_KIND[pluginKind],
      enabled: true,
      command:
        pluginKind === 'mcp_stdio' || pluginKind === 'cli_tool'
          ? pluginCmd.trim()
          : undefined,
      args:
        pluginKind === 'mcp_stdio' || pluginKind === 'cli_tool'
          ? pluginArgs.split(/\s+/).filter(Boolean)
          : undefined,
      url:
        pluginKind === 'mcp_http' || pluginKind === 'webhook'
          ? pluginUrl.trim()
          : undefined,
      updatedAt: new Date().toISOString(),
    };
    await onSaveWorkbench(
      { ...workbench, plugins: [item, ...workbench.plugins] },
      `已添加「${item.name}」`,
    );
    setPluginName('');
    setPluginCmd('');
    setPluginArgs('');
    setPluginUrl('');
    setShowAddForm(false);
  };

  const handleAddDoc = async () => {
    if (!docTitle.trim() || !docContent.trim()) return;
    const item: KnowledgeDoc = {
      id: makeId('kb'),
      title: docTitle.trim(),
      content: docContent.trim(),
      pinned: true,
      source: 'manual',
      updatedAt: new Date().toISOString(),
    };
    await onSaveWorkbench(
      { ...workbench, knowledge: [item, ...workbench.knowledge] },
      `已保存「${item.title}」`,
    );
    setDocTitle('');
    setDocContent('');
    setShowAddForm(false);
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    if (!text.trim()) return;
    const item: KnowledgeDoc = {
      id: makeId('kb'),
      title: file.name,
      content: text.slice(0, 20000),
      pinned: true,
      source: 'file',
      updatedAt: new Date().toISOString(),
    };
    await onSaveWorkbench(
      { ...workbench, knowledge: [item, ...workbench.knowledge] },
      `已导入「${file.name}」`,
    );
  };

  const handleAddTemplate = async () => {
    if (!tplName.trim() || !tplPrompt.trim()) return;
    const item: WorkflowTemplate = {
      id: makeId('tpl'),
      name: tplName.trim(),
      description: tplMode === 'workflow' ? '板块流程' : '群聊模板',
      mode: tplMode,
      prompt: tplPrompt.trim(),
      updatedAt: new Date().toISOString(),
    };
    await onSaveWorkbench(
      { ...workbench, templates: [item, ...workbench.templates] },
      `已保存「${item.name}」`,
    );
    setTplName('');
    setTplPrompt('');
    setShowAddForm(false);
  };

  const handleAddSchedule = async () => {
    if (!schedName.trim() || !schedPrompt.trim()) return;
    const interval = Math.max(1, Number(schedInterval) || 60);
    const item: ScheduledTask = {
      id: makeId('sched'),
      name: schedName.trim(),
      enabled: true,
      intervalMinutes: interval,
      mode: 'chat',
      prompt: schedPrompt.trim(),
      nextRunAt: new Date(Date.now() + interval * 60_000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await onSaveWorkbench(
      { ...workbench, schedules: [item, ...workbench.schedules] },
      `已创建定时任务「${item.name}」`,
    );
    setSchedName('');
    setSchedPrompt('');
    setSchedInterval(60);
    setShowAddForm(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wb-modal-clean" onClick={(e) => e.stopPropagation()}>
        {/* Ultra-clean Header with Segmented Tabs */}
        <div className="wb-clean-header">
          <div className="wb-seg-nav">
            <button
              type="button"
              className={tab === 'skills' ? 'active' : ''}
              onClick={() => switchTab('skills')}
            >
              <Sparkles size={13} />
              <span>{tr('技能', 'Skills')}</span>
            </button>
            <button
              type="button"
              className={tab === 'plugins' ? 'active' : ''}
              onClick={() => switchTab('plugins')}
            >
              <Blocks size={13} />
              <span>{tr('插件 / MCP', 'Plugins / MCP')}</span>
            </button>
            <button
              type="button"
              className={tab === 'knowledge' ? 'active' : ''}
              onClick={() => switchTab('knowledge')}
            >
              <BookOpen size={13} />
              <span>{tr('资料库', 'Knowledge')}</span>
            </button>
            <button
              type="button"
              className={tab === 'automation' ? 'active' : ''}
              onClick={() => switchTab('automation')}
            >
              <Clock size={13} />
              <span>{tr('模板与定时', 'Templates & Cron')}</span>
            </button>
          </div>
          <button type="button" className="mini-icon-btn" onClick={onClose} title={tr('关闭', 'Close')}>
            <X size={16} />
          </button>
        </div>

        {/* Clean Action Bar */}
        <div className="wb-clean-toolbar">
          {tab === 'automation' ? (
            <div className="studio-segmented">
              <button
                type="button"
                className={autoSubTab === 'templates' ? 'active' : ''}
                onClick={() => {
                  setAutoSubTab('templates');
                  setShowAddForm(false);
                }}
              >
                {tr('快捷模板', 'Templates')} ({workbench.templates.length})
              </button>
              <button
                type="button"
                className={autoSubTab === 'schedules' ? 'active' : ''}
                onClick={() => {
                  setAutoSubTab('schedules');
                  setShowAddForm(false);
                }}
              >
                {tr('定时任务', 'Schedules')} ({workbench.schedules.length})
              </button>
            </div>
          ) : (
            <span className="wb-toolbar-hint">
              {tab === 'skills' && tr('点击开关启用，或在聊天框输入 / 快捷调用', 'Toggle to enable, or type / in chat to invoke')}
              {tab === 'plugins' && tr('一键添加常用 MCP 或本地工具，开箱即用', 'One-click MCP servers or local CLI tools')}
              {tab === 'knowledge' && tr('开启开关后自动共享给所有模型，也支持直接拖文件进聊天框', 'Pinned docs are shared with all models automatically')}
            </span>
          )}

          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {tab === 'skills' && (
              <>
                <input
                  ref={skillFileInputRef}
                  type="file"
                  multiple
                  accept=".md,.mdc,.txt,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => void handleUploadSkillFiles(e)}
                />
                <button
                  type="button"
                  className={`btn btn-sm ${showSkillImport ? 'btn-ink' : ''}`}
                  onClick={openSkillImportDrawer}
                >
                  <FileUp size={13} />
                  {tr('导入 Skill', 'Import Skill')}
                </button>
              </>
            )}
            {tab === 'knowledge' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt,.json,.yaml,.yml,.ts,.js,.py,.csv"
                  style={{ display: 'none' }}
                  onChange={(e) => void handleUploadDoc(e)}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp size={13} />
                  {tr('导入文件', 'Import File')}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-ink btn-sm"
              onClick={() => {
                setShowAddForm((v) => !v);
                setShowSkillImport(false);
              }}
            >
              <Plus size={13} />
              {tr('添加', 'Add')}
            </button>
          </div>
        </div>

        <div className="modal-body wb-clean-body">
          {/* ===== INLINE COMPACT ADD DRAWERS ===== */}
          {showSkillImport && tab === 'skills' && (
            <div className="wb-inline-drawer">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div className="studio-segmented">
                  <button
                    type="button"
                    className={skillImportMode === 'scan' ? 'active' : ''}
                    onClick={() => {
                      setSkillImportMode('scan');
                      if (discoveredSkills.length === 0) void runDiscoverLocalSkills();
                    }}
                  >
                    {tr('扫描本机', 'Scan Local')}
                  </button>
                  <button
                    type="button"
                    className={skillImportMode === 'file' ? 'active' : ''}
                    onClick={() => setSkillImportMode('file')}
                  >
                    {tr('导入文件', 'From File')}
                  </button>
                  <button
                    type="button"
                    className={skillImportMode === 'url' ? 'active' : ''}
                    onClick={() => setSkillImportMode('url')}
                  >
                    {tr('链接导入', 'From URL')}
                  </button>
                </div>
                <button
                  type="button"
                  className="mini-icon-btn"
                  onClick={() => setShowSkillImport(false)}
                >
                  <X size={14} />
                </button>
              </div>

              {skillImportMode === 'scan' && (
                <div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="留空自动扫描 ~/.agents / ~/.claude / ~/.codex / Cursor / 当前项目，或填自定义目录"
                      value={customScanDir}
                      onChange={(e) => setCustomScanDir(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void runDiscoverLocalSkills();
                      }}
                    />
                    {window.desktopApi?.isDesktop && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="选择本地目录"
                        onClick={async () => {
                          const picked = await window.desktopApi?.pickFolder(customScanDir || repoPath);
                          if (picked) {
                            setCustomScanDir(picked);
                            void runDiscoverLocalSkills(picked);
                          }
                        }}
                      >
                        <FolderOpen size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={discoverBusy}
                      onClick={() => void runDiscoverLocalSkills()}
                    >
                      {discoverBusy ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
                      扫描
                    </button>
                  </div>

                  {discoverErr && (
                    <div className="wb-test-output fail" style={{ marginBottom: 8 }}>
                      {discoverErr}
                    </div>
                  )}

                  {discoverBusy ? (
                    <div className="wb-discover-empty">正在扫描本机 Skill 目录…</div>
                  ) : discoveredSkills.length === 0 ? (
                    <div className="wb-discover-empty">
                      未在默认路径发现 <code>SKILL.md</code> / <code>.mdc</code>，可输入自定义目录扫描，或切到「导入文件 / 链接导入」。
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
                        <span>发现 {discoveredSkills.length} 个本机 Skill（勾选后一键导入）</span>
                        <button
                          type="button"
                          className="wb-ghost-action"
                          onClick={() => {
                            const existingNames = new Set(workbench.skills.map((x) => x.name.toLowerCase()));
                            const freshKeys = discoveredSkills
                              .filter((s) => !existingNames.has(s.name.toLowerCase()))
                              .map((s) => s.key);
                            setSelectedDiscoverKeys(
                              freshKeys.length > 0 ? freshKeys : discoveredSkills.map((s) => s.key),
                            );
                          }}
                        >
                          全选未导入
                        </button>
                      </div>
                      <div className="wb-discover-list">
                        {discoveredSkills.map((item) => {
                          const checked = selectedDiscoverKeys.includes(item.key);
                          const alreadyAdded = workbench.skills.some(
                            (x) => x.name.toLowerCase() === item.name.toLowerCase(),
                          );
                          return (
                            <label
                              key={item.key}
                              className={`wb-discover-item ${checked ? 'is-picked' : ''}`}
                              title={item.filePath}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedDiscoverKeys((prev) =>
                                    e.target.checked
                                      ? [...prev, item.key]
                                      : prev.filter((k) => k !== item.key),
                                  );
                                }}
                              />
                              <div className="wb-discover-body">
                                <div className="wb-row-title-line">
                                  <span className="wb-row-title" style={{ fontSize: 12.5 }}>{item.name}</span>
                                  <span className="wb-mini-tag">{item.source}</span>
                                  {alreadyAdded && <span className="wb-mini-tag accent">已导入</span>}
                                </div>
                                <div className="wb-row-sub">{item.description}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {skillImportMode === 'file' && (
                <div className="wb-file-drop-box">
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    支持一次选择多个 <code>SKILL.md</code> / <code>.md</code> / <code>.mdc</code> / <code>.txt</code> / <code>.json</code>，自动解析 YAML 名称与描述。
                  </div>
                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    onClick={() => skillFileInputRef.current?.click()}
                  >
                    <FileUp size={13} />
                    选择本地 Skill 文件…
                  </button>
                </div>
              )}

              {skillImportMode === 'url' && (
                <div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="粘贴 GitHub SKILL.md 链接或 Raw Markdown URL，如 https://github.com/.../SKILL.md"
                      value={skillUrlInput}
                      onChange={(e) => setSkillUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !skillUrlBusy) void handleImportSkillFromUrl();
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ink btn-sm"
                      style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                      disabled={skillUrlBusy || !skillUrlInput.trim()}
                      onClick={() => void handleImportSkillFromUrl()}
                    >
                      {skillUrlBusy ? <Loader2 size={12} className="spin" /> : <Globe size={12} />}
                      {skillUrlBusy ? '拉取中…' : '拉取并导入'}
                    </button>
                  </div>
                  {skillUrlErr && (
                    <div className="wb-test-output fail" style={{ marginTop: 8 }}>
                      {skillUrlErr}
                    </div>
                  )}
                </div>
              )}

              {/* Shared Scope + Auto-Inject Options for Imported Skills */}
              {members.length > 0 && (
                <div className="wb-scope-row">
                  <span className="wb-scope-label">导入生效成员：</span>
                  <div className="wb-scope-chips">
                    <button
                      type="button"
                      className={`wb-scope-chip ${importTargetIds.length === 0 ? 'active' : ''}`}
                      onClick={() => setImportTargetIds([])}
                    >
                      全部成员
                    </button>
                    {members.map((m) => {
                      const picked = importTargetIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`wb-scope-chip ${picked ? 'active' : ''}`}
                          onClick={() =>
                            setImportTargetIds((prev) =>
                              prev.includes(m.id)
                                ? prev.filter((id) => id !== m.id)
                                : [...prev, m.id],
                            )
                          }
                        >
                          <span
                            className="wb-scope-dot"
                            style={{ background: m.color || '#64748b' }}
                          />
                          <span>{m.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="wb-create-foot">
                <label className="wb-check">
                  <input
                    type="checkbox"
                    checked={importAutoInject}
                    onChange={(e) => setImportAutoInject(e.target.checked)}
                  />
                  <span>
                    {importTargetIds.length > 0
                      ? `导入后自动生效（仅所选 ${importTargetIds.length} 位成员）`
                      : '导入后每次对话自动生效'}
                  </span>
                </label>
                {skillImportMode === 'scan' && (
                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    disabled={selectedDiscoverKeys.length === 0}
                    onClick={() => void handleImportDiscovered()}
                  >
                    导入选中 ({selectedDiscoverKeys.length})
                  </button>
                )}
              </div>
            </div>
          )}

          {showAddForm && tab === 'skills' && (
            <div className="wb-inline-drawer">
              <div className="grid-2" style={{ marginBottom: 8 }}>
                <input
                  className="input"
                  autoFocus
                  placeholder="技能名称，如：代码审查"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="触发词（可选），如 /review"
                  value={skillTrigger}
                  onChange={(e) => setSkillTrigger(e.target.value)}
                />
              </div>
              <textarea
                className="textarea"
                rows={2}
                placeholder="输入指令内容..."
                value={skillPrompt}
                onChange={(e) => setSkillPrompt(e.target.value)}
              />
              {members.length > 0 && (
                <div className="wb-scope-row">
                  <span className="wb-scope-label">生效成员：</span>
                  <div className="wb-scope-chips">
                    <button
                      type="button"
                      className={`wb-scope-chip ${skillTargetIds.length === 0 ? 'active' : ''}`}
                      onClick={() => setSkillTargetIds([])}
                    >
                      全部成员
                    </button>
                    {members.map((m) => {
                      const picked = skillTargetIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`wb-scope-chip ${picked ? 'active' : ''}`}
                          onClick={() =>
                            setSkillTargetIds((prev) =>
                              prev.includes(m.id)
                                ? prev.filter((id) => id !== m.id)
                                : [...prev, m.id],
                            )
                          }
                        >
                          <span
                            className="wb-scope-dot"
                            style={{ background: m.color || '#64748b' }}
                          />
                          <span>{m.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="wb-create-foot">
                <label className="wb-check">
                  <input
                    type="checkbox"
                    checked={skillAutoInject}
                    onChange={(e) => setSkillAutoInject(e.target.checked)}
                  />
                  <span>
                    {skillTargetIds.length > 0
                      ? `自动生效（仅所选 ${skillTargetIds.length} 位成员）`
                      : '每次对话自动生效'}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setShowAddForm(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    disabled={!skillName.trim() || !skillPrompt.trim()}
                    onClick={() => void handleAddSkill()}
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}

          {showAddForm && tab === 'plugins' && (
            <div className="wb-inline-drawer">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div className="studio-segmented">
                  <button
                    type="button"
                    className={pluginAddMode === 'preset' ? 'active' : ''}
                    onClick={() => setPluginAddMode('preset')}
                  >
                    常用预设
                  </button>
                  <button
                    type="button"
                    className={pluginAddMode === 'json' ? 'active' : ''}
                    onClick={() => setPluginAddMode('json')}
                  >
                    粘贴 mcp.json
                  </button>
                  <button
                    type="button"
                    className={pluginAddMode === 'custom' ? 'active' : ''}
                    onClick={() => setPluginAddMode('custom')}
                  >
                    自定义
                  </button>
                </div>
                <button type="button" className="mini-icon-btn" onClick={() => setShowAddForm(false)}>
                  <X size={14} />
                </button>
              </div>

              {pluginAddMode === 'preset' && (
                <div className="wb-preset-grid">
                  {MCP_QUICK_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="wb-preset-item"
                      onClick={() => void handleQuickAddPreset(preset)}
                    >
                      <div className="wb-preset-item-name">
                        <span>{preset.name}</span>
                        <span className="wb-mini-tag">{PLUGIN_SHORT_KIND[preset.kind]}</span>
                      </div>
                      <div className="wb-preset-item-desc">{preset.description}</div>
                    </button>
                  ))}
                </div>
              )}

              {pluginAddMode === 'json' && (
                <div>
                  <textarea
                    className="textarea"
                    rows={4}
                    placeholder={'直接粘贴 mcpServers JSON，例如：\n{"mcpServers": {"github": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"]}}}'}
                    value={mcpJsonText}
                    onChange={(e) => setMcpJsonText(e.target.value)}
                  />
                  {mcpImportErr && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{mcpImportErr}</div>}
                  <div className="wb-create-foot" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-ink btn-sm"
                      disabled={!mcpJsonText.trim()}
                      onClick={() => void handleImportMcpJson()}
                    >
                      一键导入
                    </button>
                  </div>
                </div>
              )}

              {pluginAddMode === 'custom' && (
                <div>
                  <div className="grid-2" style={{ marginBottom: 8 }}>
                    <input
                      className="input"
                      placeholder="名称"
                      value={pluginName}
                      onChange={(e) => setPluginName(e.target.value)}
                    />
                    <select
                      className="select"
                      value={pluginKind}
                      onChange={(e) => setPluginKind(e.target.value as PluginKind)}
                    >
                      <option value="mcp_stdio">MCP（本地命令）</option>
                      <option value="mcp_http">MCP（HTTP 地址）</option>
                      <option value="cli_tool">本地 CLI 工具</option>
                      <option value="webhook">Webhook</option>
                    </select>
                  </div>
                  {pluginKind === 'mcp_stdio' || pluginKind === 'cli_tool' ? (
                    <div className="grid-2">
                      <input
                        className="input"
                        placeholder="命令，如 npx / git"
                        value={pluginCmd}
                        onChange={(e) => setPluginCmd(e.target.value)}
                      />
                      <input
                        className="input"
                        placeholder="参数（空格分隔）"
                        value={pluginArgs}
                        onChange={(e) => setPluginArgs(e.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      className="input"
                      placeholder="http://127.0.0.1:..."
                      value={pluginUrl}
                      onChange={(e) => setPluginUrl(e.target.value)}
                    />
                  )}
                  <div className="wb-create-foot" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-ink btn-sm"
                      disabled={!pluginName.trim()}
                      onClick={() => void handleAddPlugin()}
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showAddForm && tab === 'knowledge' && (
            <div className="wb-inline-drawer">
              <input
                className="input"
                autoFocus
                style={{ marginBottom: 8 }}
                placeholder="资料标题，如：接口规范"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
              />
              <textarea
                className="textarea"
                rows={3}
                placeholder="粘贴项目规范或参考内容..."
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
              />
              <div className="wb-create-foot" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowAddForm(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-ink btn-sm"
                  disabled={!docTitle.trim() || !docContent.trim()}
                  onClick={() => void handleAddDoc()}
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {showAddForm && tab === 'automation' && autoSubTab === 'templates' && (
            <div className="wb-inline-drawer">
              <div className="grid-2" style={{ marginBottom: 8 }}>
                <input
                  className="input"
                  autoFocus
                  placeholder="模板名称"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                />
                <select
                  className="select"
                  value={tplMode}
                  onChange={(e) => setTplMode(e.target.value as 'chat' | 'workflow')}
                >
                  <option value="chat">群聊模式</option>
                  <option value="workflow">板块流程模式</option>
                </select>
              </div>
              <textarea
                className="textarea"
                rows={2}
                placeholder="填写模板提示词..."
                value={tplPrompt}
                onChange={(e) => setTplPrompt(e.target.value)}
              />
              <div className="wb-create-foot" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowAddForm(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-ink btn-sm"
                  disabled={!tplName.trim() || !tplPrompt.trim()}
                  onClick={() => void handleAddTemplate()}
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {showAddForm && tab === 'automation' && autoSubTab === 'schedules' && (
            <div className="wb-inline-drawer">
              <div className="grid-2" style={{ marginBottom: 8 }}>
                <input
                  className="input"
                  autoFocus
                  placeholder="定时任务名称"
                  value={schedName}
                  onChange={(e) => setSchedName(e.target.value)}
                />
                <select
                  className="select"
                  value={schedInterval}
                  onChange={(e) => setSchedInterval(Number(e.target.value))}
                >
                  <option value={15}>每 15 分钟</option>
                  <option value={30}>每 30 分钟</option>
                  <option value={60}>每 1 小时</option>
                  <option value={360}>每 6 小时</option>
                  <option value={1440}>每天</option>
                </select>
              </div>
              <textarea
                className="textarea"
                rows={2}
                placeholder="定时执行内容..."
                value={schedPrompt}
                onChange={(e) => setSchedPrompt(e.target.value)}
              />
              <div className="wb-create-foot" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowAddForm(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-ink btn-sm"
                  disabled={!schedName.trim() || !schedPrompt.trim()}
                  onClick={() => void handleAddSchedule()}
                >
                  创建
                </button>
              </div>
            </div>
          )}

          {/* ===== CLEAN CALM LISTS ===== */}
          {tab === 'skills' && (
            <div className="wb-clean-list">
              {workbench.skills.map((s) => {
                const open = expandedId === s.id;
                return (
                  <div key={s.id} className={`wb-row ${s.enabled ? '' : 'is-off'}`}>
                    <div
                      className="wb-row-main"
                      onClick={() => setExpandedId(open ? null : s.id)}
                    >
                      <span className="wb-row-chevron">
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </span>
                      <div className="wb-row-text">
                        <div className="wb-row-title-line">
                          <span className="wb-row-title">{s.name}</span>
                          {s.trigger && <code className="wb-code-tag">{s.trigger}</code>}
                          {s.autoInject && <span className="wb-mini-tag accent">自动生效</span>}
                          {s.targetMemberIds && s.targetMemberIds.length > 0 && (
                            <span className="wb-mini-tag scope">
                              {formatSkillScope(s.targetMemberIds)}
                            </span>
                          )}
                        </div>
                        <div className="wb-row-sub">{s.description}</div>
                      </div>
                      <div className="wb-row-ops" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="wb-ghost-action"
                          onClick={() => {
                            onInsertPrompt(s.prompt, 'chat', false);
                            onClose();
                          }}
                        >
                          使用
                        </button>
                        <PillSwitch
                          checked={s.enabled}
                          title={s.enabled ? '已开启' : '已关闭'}
                          onChange={(checked) => {
                            const skills = workbench.skills.map((x) =>
                              x.id === s.id ? { ...x, enabled: checked } : x,
                            );
                            void onSaveWorkbench({ ...workbench, skills });
                          }}
                        />
                      </div>
                    </div>

                    {open && (
                      <div className="wb-row-detail">
                        <div className="wb-detail-box">{s.prompt}</div>
                        {members.length > 0 && (
                          <div className="wb-scope-row">
                            <span className="wb-scope-label">生效成员：</span>
                            <div className="wb-scope-chips">
                              <button
                                type="button"
                                className={`wb-scope-chip ${!s.targetMemberIds || s.targetMemberIds.length === 0 ? 'active' : ''}`}
                                onClick={() => clearSkillTargets(s)}
                              >
                                全部成员
                              </button>
                              {members.map((m) => {
                                const picked = Boolean(s.targetMemberIds?.includes(m.id));
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    className={`wb-scope-chip ${picked ? 'active' : ''}`}
                                    onClick={() => toggleSkillTarget(s, m.id)}
                                  >
                                    <span
                                      className="wb-scope-dot"
                                      style={{ background: m.color || '#64748b' }}
                                    />
                                    <span>{m.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="wb-detail-bar">
                          <label className="wb-check">
                            <input
                              type="checkbox"
                              checked={s.autoInject}
                              onChange={(e) => {
                                const skills = workbench.skills.map((x) =>
                                  x.id === s.id
                                    ? { ...x, autoInject: e.target.checked, enabled: true }
                                    : x,
                                );
                                void onSaveWorkbench({ ...workbench, skills });
                              }}
                            />
                            <span>
                              {s.targetMemberIds && s.targetMemberIds.length > 0
                                ? `自动注入到所选 ${s.targetMemberIds.length} 位成员的对话`
                                : '自动注入每次对话（全部成员）'}
                            </span>
                          </label>
                          <button
                            type="button"
                            className="wb-del-link"
                            onClick={() => {
                              const skills = workbench.skills.filter((x) => x.id !== s.id);
                              void onSaveWorkbench({ ...workbench, skills }, '已删除');
                            }}
                          >
                            <Trash2 size={12} />
                            删除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'plugins' && (
            <div className="wb-clean-list">
              {workbench.plugins.map((p) => {
                const open = expandedId === p.id;
                const isTesting = testingId === p.id;
                const cmdPreview =
                  p.kind === 'mcp_stdio' || p.kind === 'cli_tool'
                    ? `${p.command || ''} ${(p.args || []).join(' ')}`.trim()
                    : p.url || '';
                return (
                  <div key={p.id} className={`wb-row ${p.enabled ? '' : 'is-off'}`}>
                    <div
                      className="wb-row-main"
                      onClick={() => setExpandedId(open ? null : p.id)}
                    >
                      <span className="wb-row-chevron">
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </span>
                      <div className="wb-row-text">
                        <div className="wb-row-title-line">
                          <span className="wb-row-title">{p.name}</span>
                          <span className="wb-mini-tag">{PLUGIN_SHORT_KIND[p.kind]}</span>
                          {p.lastTestOk !== undefined && (
                            <span
                              className={`presence-dot ${p.lastTestOk ? 'idle' : 'offline'}`}
                              title={p.lastTestMessage}
                            />
                          )}
                        </div>
                        <div className="wb-row-sub">{p.description}</div>
                      </div>
                      <div className="wb-row-ops" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="wb-ghost-action"
                          disabled={isTesting}
                          onClick={async () => {
                            setTestingId(p.id);
                            setExpandedId(p.id);
                            try {
                              await onTestPlugin(p.id);
                            } finally {
                              setTestingId('');
                            }
                          }}
                        >
                          {isTesting ? <Loader2 size={12} className="spin" /> : '测试'}
                        </button>
                        <PillSwitch
                          checked={p.enabled}
                          onChange={(checked) => {
                            const plugins = workbench.plugins.map((x) =>
                              x.id === p.id ? { ...x, enabled: checked } : x,
                            );
                            void onSaveWorkbench({ ...workbench, plugins });
                          }}
                        />
                      </div>
                    </div>

                    {open && (
                      <div className="wb-row-detail">
                        {cmdPreview && <div className="wb-cmd-line">{cmdPreview}</div>}
                        {p.lastTestMessage && (
                          <div className={`wb-test-output ${p.lastTestOk ? 'ok' : 'fail'}`}>
                            {p.lastTestMessage}
                          </div>
                        )}
                        <div className="wb-detail-bar" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="wb-del-link"
                            onClick={() => {
                              const plugins = workbench.plugins.filter((x) => x.id !== p.id);
                              void onSaveWorkbench({ ...workbench, plugins }, '已删除');
                            }}
                          >
                            <Trash2 size={12} />
                            移除插件
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'knowledge' && (
            <div className="wb-clean-list">
              {workbench.knowledge.length === 0 ? (
                <div className="invite-empty">暂无资料，点右上角「添加」或直接把文件拖到聊天输入框。</div>
              ) : (
                workbench.knowledge.map((doc) => {
                  const open = expandedId === doc.id;
                  return (
                    <div key={doc.id} className={`wb-row ${doc.pinned ? '' : 'is-off'}`}>
                      <div
                        className="wb-row-main"
                        onClick={() => setExpandedId(open ? null : doc.id)}
                      >
                        <span className="wb-row-chevron">
                          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </span>
                        <div className="wb-row-text">
                          <div className="wb-row-title-line">
                            <span className="wb-row-title">{doc.title}</span>
                            <span className="wb-mini-tag">{doc.content.length} 字</span>
                          </div>
                          <div className="wb-row-sub">
                            {doc.pinned ? '已全局共享给所有模型' : '已暂停共享'}
                          </div>
                        </div>
                        <div className="wb-row-ops" onClick={(e) => e.stopPropagation()}>
                          <PillSwitch
                            checked={doc.pinned}
                            title={doc.pinned ? '全局生效中' : '已暂停'}
                            onChange={(checked) => {
                              const knowledge = workbench.knowledge.map((x) =>
                                x.id === doc.id ? { ...x, pinned: checked } : x,
                              );
                              void onSaveWorkbench({ ...workbench, knowledge });
                            }}
                          />
                        </div>
                      </div>

                      {open && (
                        <div className="wb-row-detail">
                          <div className="wb-detail-box">{doc.content}</div>
                          <div className="wb-detail-bar" style={{ justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="wb-del-link"
                              onClick={() => {
                                const knowledge = workbench.knowledge.filter((x) => x.id !== doc.id);
                                void onSaveWorkbench({ ...workbench, knowledge }, '已删除');
                              }}
                            >
                              <Trash2 size={12} />
                              删除资料
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {tab === 'automation' && autoSubTab === 'templates' && (
            <div className="wb-clean-list">
              {workbench.templates.map((tpl) => {
                const open = expandedId === tpl.id;
                return (
                  <div key={tpl.id} className="wb-row">
                    <div
                      className="wb-row-main"
                      onClick={() => setExpandedId(open ? null : tpl.id)}
                    >
                      <span className="wb-row-chevron">
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </span>
                      <div className="wb-row-text">
                        <div className="wb-row-title-line">
                          <span className="wb-row-title">{tpl.name}</span>
                          <span className="wb-mini-tag">
                            {tpl.mode === 'workflow' ? '板块流程' : '群聊'}
                          </span>
                        </div>
                        <div className="wb-row-sub">{tpl.description}</div>
                      </div>
                      <div className="wb-row-ops" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="wb-ghost-action"
                          onClick={() => {
                            onInsertPrompt(tpl.prompt, tpl.mode, false);
                            onClose();
                          }}
                        >
                          填入
                        </button>
                        <button
                          type="button"
                          className="btn btn-ink btn-sm"
                          onClick={() => {
                            onInsertPrompt(tpl.prompt, tpl.mode, true);
                            onClose();
                          }}
                        >
                          <Play size={11} />
                          运行
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="wb-row-detail">
                        <div className="wb-detail-box">{tpl.prompt}</div>
                        <div className="wb-detail-bar" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="wb-del-link"
                            onClick={() => {
                              const templates = workbench.templates.filter((x) => x.id !== tpl.id);
                              void onSaveWorkbench({ ...workbench, templates }, '已删除');
                            }}
                          >
                            <Trash2 size={12} />
                            删除模板
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'automation' && autoSubTab === 'schedules' && (
            <div className="wb-clean-list">
              {workbench.schedules.map((sc) => {
                const open = expandedId === sc.id;
                const isRunning = runningSchedId === sc.id;
                return (
                  <div key={sc.id} className={`wb-row ${sc.enabled ? '' : 'is-off'}`}>
                    <div
                      className="wb-row-main"
                      onClick={() => setExpandedId(open ? null : sc.id)}
                    >
                      <span className="wb-row-chevron">
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </span>
                      <div className="wb-row-text">
                        <div className="wb-row-title-line">
                          <span className="wb-row-title">{sc.name}</span>
                          <span className="wb-mini-tag">{formatInterval(sc.intervalMinutes)}</span>
                        </div>
                        <div className="wb-row-sub">
                          {sc.lastSummary || (sc.enabled ? '等待下次定时触发' : '已暂停')}
                        </div>
                      </div>
                      <div className="wb-row-ops" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="wb-ghost-action"
                          disabled={isRunning}
                          onClick={async () => {
                            setRunningSchedId(sc.id);
                            try {
                              await onRunSchedule(sc.id);
                              onClose();
                            } finally {
                              setRunningSchedId('');
                            }
                          }}
                        >
                          {isRunning ? <Loader2 size={12} className="spin" /> : '运行'}
                        </button>
                        <PillSwitch
                          checked={sc.enabled}
                          onChange={(enabled) => {
                            const schedules = workbench.schedules.map((x) =>
                              x.id === sc.id
                                ? {
                                    ...x,
                                    enabled,
                                    nextRunAt: enabled
                                      ? new Date(Date.now() + (x.intervalMinutes || 60) * 60_000).toISOString()
                                      : undefined,
                                  }
                                : x,
                            );
                            void onSaveWorkbench({ ...workbench, schedules });
                          }}
                        />
                      </div>
                    </div>

                    {open && (
                      <div className="wb-row-detail">
                        <div className="wb-detail-box">{sc.prompt}</div>
                        <div className="wb-detail-bar" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="wb-del-link"
                            onClick={() => {
                              const schedules = workbench.schedules.filter((x) => x.id !== sc.id);
                              void onSaveWorkbench({ ...workbench, schedules }, '已删除');
                            }}
                          >
                            <Trash2 size={12} />
                            删除任务
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
