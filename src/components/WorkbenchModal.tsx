import React, { useRef, useState } from 'react';
import {
  Blocks,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  FileUp,
  Loader2,
  Play,
  Plus,
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

export type WorkbenchModalTab = 'skills' | 'plugins' | 'knowledge' | 'automation';

interface WorkbenchModalProps {
  workbench: WorkbenchConfig;
  initialTab: WorkbenchModalTab;
  repoPath: string;
  activeRoomId: string;
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
  onClose,
  onSaveWorkbench,
  onTestPlugin,
  onRunSchedule,
  onInsertPrompt,
}) => {
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
    setExpandedId(null);
  };

  const handleAddSkill = async () => {
    if (!skillName.trim() || !skillPrompt.trim()) return;
    const item: WorkbenchSkill = {
      id: makeId('skill'),
      name: skillName.trim(),
      trigger: skillTrigger.trim(),
      description: skillAutoInject ? '自动附加到所有对话' : '快捷调用指令',
      prompt: skillPrompt.trim(),
      autoInject: skillAutoInject,
      enabled: true,
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
              <span>技能</span>
            </button>
            <button
              type="button"
              className={tab === 'plugins' ? 'active' : ''}
              onClick={() => switchTab('plugins')}
            >
              <Blocks size={13} />
              <span>插件 / MCP</span>
            </button>
            <button
              type="button"
              className={tab === 'knowledge' ? 'active' : ''}
              onClick={() => switchTab('knowledge')}
            >
              <BookOpen size={13} />
              <span>资料库</span>
            </button>
            <button
              type="button"
              className={tab === 'automation' ? 'active' : ''}
              onClick={() => switchTab('automation')}
            >
              <Clock size={13} />
              <span>模板与定时</span>
            </button>
          </div>
          <button type="button" className="mini-icon-btn" onClick={onClose} title="关闭">
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
                快捷模板 ({workbench.templates.length})
              </button>
              <button
                type="button"
                className={autoSubTab === 'schedules' ? 'active' : ''}
                onClick={() => {
                  setAutoSubTab('schedules');
                  setShowAddForm(false);
                }}
              >
                定时任务 ({workbench.schedules.length})
              </button>
            </div>
          ) : (
            <span className="wb-toolbar-hint">
              {tab === 'skills' && '点击开关启用，或在聊天框输入 / 快捷调用'}
              {tab === 'plugins' && '一键添加常用 MCP 或本地工具，开箱即用'}
              {tab === 'knowledge' && '开启开关后自动共享给所有模型，也支持直接拖文件进聊天框'}
            </span>
          )}

          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
                  导入文件
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-ink btn-sm"
              onClick={() => setShowAddForm((v) => !v)}
            >
              <Plus size={13} />
              添加
            </button>
          </div>
        </div>

        <div className="modal-body wb-clean-body">
          {/* ===== INLINE COMPACT ADD DRAWERS ===== */}
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
              <div className="wb-create-foot">
                <label className="wb-check">
                  <input
                    type="checkbox"
                    checked={skillAutoInject}
                    onChange={(e) => setSkillAutoInject(e.target.checked)}
                  />
                  <span>每次对话自动生效</span>
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
                            <span>自动注入每次对话</span>
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
