import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Blocks,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileCode2,
  FileText,
  FolderOpen,
  GitBranch,
  Hand,
  Image as ImageIcon,
  Layers,
  Loader2,
  Moon,
  PanelLeft,
  PanelRight,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  UserRoundX,
  Wrench,
  X,
} from 'lucide-react';
import type {
  ApprovalPayload,
  ChatAttachment,
  ChatMessage,
  ConnectedAgent,
  ExecutionMode,
  MemberQuotaConfig,
  MemberUsageRecord,
  ProviderConfig,
  ProviderHealth,
  ThinkingLevel,
  TokenUsage,
  WorkbenchConfig,
  WorkflowDefinition,
  WorkflowNodeConfig,
  WorkflowPresetTemplate,
  WorkflowRun,
} from '../shared/types';
import {
  getNativeThinkingOptions,
  getThinkingFullLabel,
  getThinkingLabel,
} from '../shared/thinkingOptions';
import { api, subscribeAgents, subscribeRun } from './api';
import { ApprovalModal } from './components/ApprovalModal';
import { InviteAgentModal } from './components/InviteAgentModal';
import { MarkdownView } from './components/MarkdownView';
import { MemberAvatar } from './components/MemberAvatar';
import {
  MemberProfileModal,
  type EditableMember,
  type MemberPresence,
} from './components/MemberProfileModal';
import { ProvidersModal } from './components/ProvidersModal';
import {
  TaskWorkspaceDrawer,
  type WorkspaceTab,
} from './components/TaskWorkspaceDrawer';
import {
  WorkbenchModal,
  type WorkbenchModalTab,
} from './components/WorkbenchModal';
import { WorkflowTemplateCanvas } from './components/WorkflowTemplateCanvas';
import { WorkspacePane } from './components/WorkspacePane';
import { AmbientStage } from './components/AmbientStage';
import { BRAND } from './brand';
import { RinneMascot, RINNE_LINES, type RinneState } from './components/RinneMascot';
import { JournalCover, type CoverIssue, type CoverStep } from './components/JournalCover';
import {
  TroubleshootModal,
  buildFileBridgePrompt,
  buildStandbyPrompt,
  diagnoseMessageError,
} from './components/TroubleshootModal';

const QUICK_PROMPTS = [
  {
    title: '双模型方案评审',
    text: '帮我评估：给当前本地项目新增「一键导出 Markdown 报告」功能，方案该怎么设计？',
  },
  {
    title: '全流程协同研发',
    text: '给订单列表增加多条件筛选、后端分页与 CSV 导出，帮我走一遍完整方案和前后端开发。',
  },
];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatCompactTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString('en-US');
}

function estimateInlineTokens(text: string): number {
  const s = (text || '').trim();
  if (!s) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.max(1, Math.ceil(cjk * 0.72 + other / 3.8));
}

function formatTokenTooltip(u: TokenUsage): string {
  const mode =
    u.source === 'api'
      ? '官方 API 精确计数'
      : u.source === 'cli'
        ? 'Claude CLI 官方 JSON 精确计数'
        : u.source === 'agent' && !u.estimated
          ? '成员主动上报精确计数'
          : '本地中英字符校准估算（外部桌面客户端未开放原始计数）';
  const costLine =
    typeof u.costUsd === 'number' && u.costUsd > 0
      ? `\n本次计费：$${u.costUsd.toFixed(4)}`
      : '';
  return `本次消耗：${u.estimated ? '~' : ''}${u.totalTokens.toLocaleString('en-US')} tokens\n输入：${u.inputTokens.toLocaleString('en-US')} · 输出：${u.outputTokens.toLocaleString('en-US')}${costLine}\n来源：${mode}`;
}

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('ag_chat_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  // Mascot (Rinne) visibility, remembered across sessions
  const [showRinne, setShowRinne] = useState(() => localStorage.getItem('ag_rinne_visible') !== '0');

  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowPresetTemplate[]>([]);
  const [workbench, setWorkbench] = useState<WorkbenchConfig>({
    skills: [],
    plugins: [],
    knowledge: [],
    templates: [],
    schedules: [],
  });
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealth>>({});
  const [connectedAgents, setConnectedAgents] = useState<ConnectedAgent[]>([]);
  const [memberUsage, setMemberUsage] = useState<Record<string, MemberUsageRecord>>({});
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);

  const [repoPath, setRepoPath] = useState('D:\\video');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('mock');
  // Real mode calls paid subscriptions / APIs, so switching to it asks first
  const [confirmRealMode, setConfirmRealMode] = useState(false);
  // Inline room rename in the sidebar (double-click a room title)
  const [renamingRoomId, setRenamingRoomId] = useState<string | null>(null);
  const [roomTitleDraft, setRoomTitleDraft] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [inlineFeedback, setInlineFeedback] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const [showWorkspace, setShowWorkspace] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1080,
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('progress');
  const [showCanvas, setShowCanvas] = useState(false);
  const [showProjectWorkspace, setShowProjectWorkspace] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('ag_sidebar_w'));
      if (Number.isFinite(saved) && saved >= 184 && saved <= 320) return saved;
    } catch {}
    return typeof window !== 'undefined' && window.innerWidth <= 960 ? 204 : 228;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarSections, setSidebarSections] = useState<{
    workbench: boolean;
    threads: boolean;
    members: boolean;
  }>(() => {
    try {
      const raw = localStorage.getItem('ag_sidebar_sec');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          workbench: parsed.workbench !== false,
          threads: parsed.threads !== false,
          members: parsed.members !== false,
        };
      }
    } catch {}
    return { workbench: true, threads: true, members: true };
  });
  const [canvasFullscreen, setCanvasFullscreen] = useState(false);
  const [canvasWidthPx, setCanvasWidthPx] = useState<number>(() => {
    if (typeof window === 'undefined') return 560;
    return Math.min(720, Math.max(400, Math.round(window.innerWidth * 0.5)));
  });
  const [isResizingCanvas, setIsResizingCanvas] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchModalTab | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const [showQuickExtMenu, setShowQuickExtMenu] = useState(false);
  const [showWorkflowPicker, setShowWorkflowPicker] = useState(false);
  const [attachMenuMode, setAttachMenuMode] = useState<'closed' | 'menu' | 'workspace' | 'snippet'>('closed');
  const [wsFileQuery, setWsFileQuery] = useState('');
  const [wsFiles, setWsFiles] = useState<Array<{ relPath: string; absPath: string; name: string; size: number; ext: string }>>([]);
  const [loadingWsFiles, setLoadingWsFiles] = useState(false);
  const [snippetTitle, setSnippetTitle] = useState('');
  const [snippetText, setSnippetText] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [runningQuickPluginId, setRunningQuickPluginId] = useState('');
  const [editingMember, setEditingMember] = useState<EditableMember | null>(null);
  const [copiedId, setCopiedId] = useState('');
  const [expandedWakeIds, setExpandedWakeIds] = useState<Record<string, boolean>>({});
  const [wakeNowTick, setWakeNowTick] = useState(() => Date.now());
  const [autoRelayRounds, setAutoRelayRounds] = useState<number>(() => {
    const raw = localStorage.getItem('ag_auto_relay_rounds');
    if (raw === null) return 4;
    const parsed = Number(raw);
    if (parsed === -1) return -1;
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 999) return Math.floor(parsed);
    return 4;
  });
  const [showRelayMenu, setShowRelayMenu] = useState(false);
  const [customRelayInput, setCustomRelayInput] = useState('8');
  const [toast, setToast] = useState('');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCursorEndRef = useRef(false);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const prevOnlineIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!pendingCursorEndRef.current) return;
    pendingCursorEndRef.current = false;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [input]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ag_chat_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ag_rinne_visible', showRinne ? '1' : '0');
  }, [showRinne]);

  useEffect(() => {
    localStorage.setItem('ag_auto_relay_rounds', String(autoRelayRounds));
  }, [autoRelayRounds]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? '' : cur)), 2600);
  }, []);

  const ensureInitialRoom = useCallback(async (cwd: string) => {
    const { run } = await api.createRun({
      title: '新协作会话',
      repoPath: cwd,
      executionMode: 'mock',
      startWorkflow: false,
    });
    setRuns([run]);
    setActiveRun(run);
  }, []);

  const refreshProviderHealth = useCallback(async () => {
    try {
      const { health } = await api.checkProviders();
      const map: Record<string, ProviderHealth> = {};
      for (const h of health) map[h.id] = h;
      setProviderHealth(map);
    } catch {
      // ignore health probe error
    }
  }, []);

  const refreshMemberUsage = useCallback(async () => {
    try {
      const { usage } = await api.getUsage();
      setMemberUsage(usage);
    } catch {
      // ignore
    }
  }, []);

  const loadInitial = useCallback(async () => {
    const [wfRes, wfTplRes, provRes, runsRes, healthRes, agentsRes, wbRes, usageRes] = await Promise.all([
      api.getWorkflow(),
      api.listWorkflowTemplates().catch(() => ({ templates: [] })),
      api.getProviders(),
      api.listRuns(),
      api.getHealth(),
      api.listAgents(),
      api.getWorkbench().catch(() => ({ workbench: null })),
      api.getUsage().catch(() => ({ usage: {} as Record<string, MemberUsageRecord> })),
    ]);
    setWorkflow(wfRes.workflow);
    setWorkflowTemplates(wfTplRes.templates);
    if (wbRes.workbench) setWorkbench(wbRes.workbench);
    setMemberUsage(usageRes.usage || {});
    setProviders(provRes.providers);
    setConnectedAgents(agentsRes.agents);
    prevOnlineIdsRef.current = new Set(
      agentsRes.agents.filter((a) => a.online).map((a) => a.id),
    );
    const defaultCwd = healthRes.cwd || 'D:\\video';
    setRepoPath(defaultCwd);

    if (runsRes.runs.length > 0) {
      setRuns(runsRes.runs);
      const first = runsRes.runs[0];
      setActiveRun(first);
      setExecutionMode(first.executionMode);
      if (first.repoPath) setRepoPath(first.repoPath);
    } else {
      await ensureInitialRoom(defaultCwd);
    }

    void refreshProviderHealth();
  }, [ensureInitialRoom, refreshProviderHealth]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const unsub = subscribeAgents((agents) => {
      setConnectedAgents(agents);
      const newlyOnline = agents.filter(
        (a) => a.online && !prevOnlineIdsRef.current.has(a.id),
      );
      if (newlyOnline.length > 0) {
        flash(`${newlyOnline.map((a) => a.name).join('、')} 已连入聊天室`);
      }
      prevOnlineIdsRef.current = new Set(
        agents.filter((a) => a.online).map((a) => a.id),
      );
    });
    return unsub;
  }, [flash]);

  useEffect(() => {
    if (!activeRun?.id) return;
    const unsub = subscribeRun(activeRun.id, (updated) => {
      setActiveRun(updated);
      setRuns((prev) => {
        const exists = prev.some((r) => r.id === updated.id);
        if (!exists) return [updated, ...prev];
        return prev.map((r) => (r.id === updated.id ? updated : r));
      });
    });
    return unsub;
  }, [activeRun?.id]);

  const doneAssistantCount = useMemo(
    () => (activeRun?.messages || []).filter((m) => m.role === 'assistant' && m.status === 'done').length,
    [activeRun?.messages],
  );
  useEffect(() => {
    if (doneAssistantCount > 0) {
      void refreshMemberUsage();
    }
  }, [doneAssistantCount, refreshMemberUsage]);

  useEffect(() => {
    if (editingMember) {
      void refreshMemberUsage();
    }
  }, [editingMember?.id, refreshMemberUsage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeRun?.messages?.length, activeRun?.status]);

  // Real-time busy/working detection across active chat messages, workflow nodes, and agents
  const busyMemberIds = useMemo(() => {
    const busy = new Set<string>();
    for (const a of connectedAgents) {
      if (a.online && a.busy) busy.add(a.id);
    }
    const inspectRun = (r: WorkflowRun | null | undefined) => {
      if (!r) return;
      for (const m of r.messages || []) {
        if (m.role === 'assistant' && m.status === 'streaming') {
          busy.add(m.senderId);
        }
      }
      if (workflow) {
        for (const n of workflow.nodes) {
          if (r.nodes?.[n.id]?.status === 'running' && n.providerId) {
            busy.add(n.providerId);
          }
        }
      }
    };
    inspectRun(activeRun);
    for (const r of runs) {
      if (r.id !== activeRun?.id && r.status === 'running') {
        inspectRun(r);
      }
    }
    return busy;
  }, [connectedAgents, activeRun, runs, workflow]);

  // Only show actually connected / configured members in member list & @mentions!
  const onlineAgents = useMemo(
    () => connectedAgents.filter((a) => a.online),
    [connectedAgents],
  );

  const offlineAgents = useMemo(
    () => connectedAgents.filter((a) => !a.online),
    [connectedAgents],
  );

  const configuredProviders = useMemo(() => {
    return providers.filter((p) => {
      if (p.connectionType && p.connectionType !== 'cli') {
        return Boolean(p.apiKey?.trim() && p.model?.trim());
      }
      // Exclude unconfigured default powershell placeholder
      if (p.id === 'custom' && p.command.toLowerCase() === 'powershell') {
        return false;
      }
      return Boolean(providerHealth[p.id]?.installed);
    });
  }, [providers, providerHealth]);

  const readyProviders = useMemo(
    () => configuredProviders.filter((p) => !p.offline),
    [configuredProviders],
  );

  const offlineProviders = useMemo(
    () => configuredProviders.filter((p) => Boolean(p.offline)),
    [configuredProviders],
  );

  const activeMembers = useMemo(
    () => [
      ...onlineAgents.map((a) => ({
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        color: a.accentColor || '#10b981',
        presence: (busyMemberIds.has(a.id) ? 'working' : 'idle') as MemberPresence,
        listening: Boolean(a.listening),
        bridgeActive: Boolean(a.lastBridgeAt),
        subtitle: a.listening
          ? '零耗长连接监听待命中（@后秒回）'
          : a.lastBridgeAt
            ? '文件夹桥接模式已连通（自动回执）'
            : a.trigger?.type === 'cli'
              ? `外部 CLI · ${a.trigger.command}`
              : '外部接入模型',
        thinkingLevel: a.thinkingLevel || ('default' as ThinkingLevel),
        thinkingOptions: getNativeThinkingOptions({
          modelName: a.modelName || a.name,
          id: a.id,
          customOptions: a.thinkingOptions,
        }),
        kind: 'agent' as const,
      })),
      ...readyProviders.map((p) => ({
        id: p.id,
        name: p.shortName,
        avatar: p.avatar,
        color: p.accentColor,
        presence: (busyMemberIds.has(p.id) ? 'working' : 'idle') as MemberPresence,
        listening: false,
        bridgeActive: false,
        subtitle: p.connectionType && p.connectionType !== 'cli'
          ? `直连 API · ${p.model || p.id}`
          : `本地订阅 CLI · ${p.model || p.command}`,
        thinkingLevel: p.thinkingLevel || ('default' as ThinkingLevel),
        thinkingOptions: getNativeThinkingOptions({
          modelName: p.model || p.shortName,
          id: p.id,
          command: p.command,
        }),
        kind: 'provider' as const,
      })),
    ],
    [onlineAgents, readyProviders, busyMemberIds],
  );

  const sidebarMembers = useMemo(() => {
    const offlineList = [
      ...offlineAgents.map((a) => ({
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        color: a.accentColor || '#64748b',
        presence: 'offline' as MemberPresence,
        listening: false,
        bridgeActive: false,
        subtitle: a.trigger?.type === 'cli' ? `外部 CLI · ${a.trigger.command}` : '外部接入模型',
        thinkingLevel: a.thinkingLevel || ('default' as ThinkingLevel),
        kind: 'agent' as const,
      })),
      ...offlineProviders.map((p) => ({
        id: p.id,
        name: p.shortName,
        avatar: p.avatar,
        color: p.accentColor,
        presence: 'offline' as MemberPresence,
        listening: false,
        bridgeActive: false,
        subtitle: p.connectionType && p.connectionType !== 'cli'
          ? `直连 API · ${p.model || p.id}`
          : `本地订阅 CLI · ${p.model || p.command}`,
        thinkingLevel: p.thinkingLevel || ('default' as ThinkingLevel),
        kind: 'provider' as const,
      })),
    ];

    const rank: Record<MemberPresence, number> = { working: 0, idle: 1, offline: 2 };
    return [...activeMembers, ...offlineList].sort(
      (a, b) => rank[a.presence] - rank[b.presence],
    );
  }, [activeMembers, offlineAgents, offlineProviders]);

  const memberProfileMap = useMemo(() => {
    const map: Record<string, EditableMember> = {};
    for (const a of connectedAgents) {
      map[a.id] = {
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        color: a.accentColor || '#10b981',
        presence: !a.online ? 'offline' : busyMemberIds.has(a.id) ? 'working' : 'idle',
        kind: 'agent',
        subtitle: a.trigger?.type === 'cli' ? `外部 CLI · ${a.trigger.command}` : '外部接入模型',
      };
    }
    for (const p of providers) {
      const isOnline = !p.offline && configuredProviders.some((cp) => cp.id === p.id);
      map[p.id] = {
        id: p.id,
        name: p.shortName,
        avatar: p.avatar,
        color: p.accentColor || '#18181b',
        presence: !isOnline ? 'offline' : busyMemberIds.has(p.id) ? 'working' : 'idle',
        kind: 'provider',
        subtitle: p.connectionType && p.connectionType !== 'cli'
          ? `直连 API · ${p.model || p.id}`
          : `本地订阅 CLI · ${p.model || p.command}`,
      };
    }
    return map;
  }, [connectedAgents, providers, configuredProviders, busyMemberIds]);

  const handleToggleMemberOnline = async (
    member: { id: string; name: string; kind: 'agent' | 'provider' },
    nextOnline: boolean,
  ) => {
    if (member.kind === 'agent') {
      const { agent } = await api.renameAgent(member.id, { online: nextOnline });
      setConnectedAgents((prev) =>
        prev.map((item) => (item.id === agent.id ? agent : item)),
      );
    } else {
      const res = await api.patchProvider(member.id, { offline: !nextOnline });
      setProviders(res.providers);
    }
    if (!nextOnline) {
      setSelectedTargets((prev) => prev.filter((id) => id !== member.id));
    }
    flash(`${member.name} 已${nextOnline ? '恢复在线（空闲）' : '设为离线'}`);
  };

  const handleSaveMemberProfile = async (
    member: EditableMember,
    payload: { name: string; avatar: string; accentColor: string },
  ) => {
    const oldName = member.name;
    if (member.kind === 'agent') {
      const { agent } = await api.renameAgent(member.id, {
        displayName: payload.name,
        avatar: payload.avatar,
        accentColor: payload.accentColor,
      });
      setConnectedAgents((prev) =>
        prev.map((item) => (item.id === agent.id ? agent : item)),
      );
    } else {
      const res = await api.patchProvider(member.id, {
        shortName: payload.name,
        avatar: payload.avatar,
        accentColor: payload.accentColor,
      });
      setProviders(res.providers);
    }
    if (oldName && oldName !== payload.name) {
      setInput((prev) =>
        prev.includes(`@${oldName}`)
          ? prev.replaceAll(`@${oldName}`, `@${payload.name}`)
          : prev,
      );
    }
    flash(`已更新「${payload.name}」的昵称与头像`);
  };

  const handleSetThinkingLevel = async (
    member: { id: string; name: string; kind: 'agent' | 'provider' },
    level: ThinkingLevel,
  ) => {
    try {
      if (member.kind === 'agent') {
        await api.renameAgent(member.id, { thinkingLevel: level });
      } else {
        const res = await api.patchProvider(member.id, { thinkingLevel: level });
        setProviders(res.providers);
      }
      flash(`${member.name} 思考程度已设为「${getThinkingFullLabel(level)}」`);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const activeMemberIds = useMemo(
    () => activeMembers.map((m) => m.id),
    [activeMembers],
  );

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.trim().toLowerCase();
    const list: Array<{ id: string; name: string; color: string; avatar?: string; isAll?: boolean }> = [];
    if (activeMembers.length > 1 && (!q || '全员all'.includes(q))) {
      list.push({ id: '__all__', name: '全员', color: '#8a8a93', isAll: true });
    }
    for (const m of activeMembers) {
      if (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) {
        list.push(m);
      }
    }
    return list;
  }, [mentionQuery, activeMembers]);

  const detectMentionQuery = (text: string, cursorPos: number | null) => {
    const pos = cursorPos ?? text.length;
    const before = text.slice(0, pos);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
      setSlashQuery(null);
      return;
    }
    setMentionQuery(null);

    const slashMatch = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (slashMatch) {
      setSlashQuery(slashMatch[1]);
      setSlashIndex(0);
    } else {
      setSlashQuery(null);
    }
  };

  type SlashCandidate =
    | { id: string; kind: 'skill'; name: string; trigger?: string; desc: string; prompt: string }
    | { id: string; kind: 'template'; name: string; desc: string; prompt: string; mode: 'chat' | 'workflow' }
    | { id: string; kind: 'plugin'; name: string; desc: string; pluginId: string };

  const slashSkillCandidates = useMemo<SlashCandidate[]>(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.trim().toLowerCase();
    const list: SlashCandidate[] = [];

    for (const s of workbench.skills) {
      if (!s.enabled) continue;
      const trig = (s.trigger || '').replace(/^\//, '').toLowerCase();
      if (!q || trig.includes(q) || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) {
        list.push({
          id: s.id,
          kind: 'skill',
          name: s.name,
          trigger: s.trigger,
          desc: s.description,
          prompt: s.prompt,
        });
      }
    }

    for (const t of workbench.templates) {
      if (!q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) {
        list.push({
          id: t.id,
          kind: 'template',
          name: t.name,
          desc: `${t.mode === 'workflow' ? '板块流程' : '群聊模板'} · ${t.description}`,
          prompt: t.prompt,
          mode: t.mode,
        });
      }
    }

    for (const p of workbench.plugins) {
      if (!p.enabled || p.kind !== 'cli_tool') continue;
      if (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || 'run工具插件'.includes(q)) {
        list.push({
          id: p.id,
          kind: 'plugin',
          name: `运行：${p.name}`,
          desc: `本地执行并自动将结果附到输入框 · ${p.command || ''}`,
          pluginId: p.id,
        });
      }
    }

    return list;
  }, [slashQuery, workbench]);

  const handleRunPluginIntoComposer = async (pluginId: string, pluginName: string) => {
    setRunningQuickPluginId(pluginId);
    try {
      const res = await api.testWorkbenchPlugin(pluginId, repoPath);
      setWorkbench(res.workbench);
      const snippet = `\n【${pluginName} 执行结果】\n\`\`\`\n${res.result.message}\n\`\`\`\n`;
      setInput((prev) => `${prev.replace(/(?:^|\s)\/[^\s/]*$/, '').trimEnd()}${prev.trim() ? '\n' : ''}${snippet.trimStart()}`);
      setSlashQuery(null);
      setShowQuickExtMenu(false);
      flash(res.result.ok ? `已运行「${pluginName}」并将结果填入输入框` : `「${pluginName}」执行异常`);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningQuickPluginId('');
    }
  };

  const applySlashCandidate = (item: SlashCandidate) => {
    if (item.kind === 'plugin') {
      void handleRunPluginIntoComposer(item.pluginId, item.name.replace(/^运行：/, ''));
      return;
    }
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? input.length;
    const before = input.slice(0, pos);
    const after = input.slice(pos);
    const replacedBefore = before.replace(/\/([^\s/]*)$/, item.prompt);
    setInput(`${replacedBefore}${after}`);
    setSlashQuery(null);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(replacedBefore.length, replacedBefore.length);
      }
    });
  };

  const handleArchiveMessageToKnowledge = async (msg: ChatMessage) => {
    const firstLine = msg.content
      .replace(/^#+\s*/gm, '')
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.slice(0, 32);
    const title = firstLine || `${msg.senderName} 的回复总结`;
    const nextDoc = {
      id: `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      title,
      content: msg.content.slice(0, 16000),
      pinned: true,
      source: 'manual' as const,
      updatedAt: new Date().toISOString(),
    };
    await handleSaveWorkbench(
      { ...workbench, knowledge: [nextDoc, ...workbench.knowledge] },
      `已存入全局资料库「${title}」（所有模型可用）`,
    );
  };

  const isTextLikeFile = (file: File): boolean => {
    if (file.type.startsWith('text/')) return true;
    if (
      file.type === 'application/json' ||
      file.type === 'application/xml' ||
      file.type === 'application/javascript'
    ) {
      return true;
    }
    return /\.(md|txt|json|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|css|scss|html|xml|yaml|yml|toml|ini|env|sql|csv|sh|ps1|log)$/i.test(
      file.name,
    );
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
      reader.onload = () => {
        const str = String(reader.result || '');
        const comma = str.indexOf(',');
        resolve(comma >= 0 ? str.slice(comma + 1) : str);
      };
      reader.readAsDataURL(file);
    });

  const handleAttachFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 8);
    setUploadingFiles(true);
    try {
      let roomId = activeRun?.id;
      if (!roomId) {
        const { run } = await api.createRun({
          repoPath,
          executionMode,
          startWorkflow: false,
        });
        setRuns((prev) => [run, ...prev]);
        setActiveRun(run);
        roomId = run.id;
      }

      const uploaded: ChatAttachment[] = [];
      for (const file of list) {
        if (file.size > 15 * 1024 * 1024) {
          flash(`文件「${file.name}」超过 15MB，已跳过`);
          continue;
        }
        const dataBase64 = await readFileAsBase64(file);
        const textContent = isTextLikeFile(file)
          ? (await file.text()).slice(0, 40000)
          : undefined;
        const { attachment } = await api.uploadFile(roomId, {
          name: file.name || `paste_${Date.now()}.png`,
          mimeType: file.type || 'application/octet-stream',
          dataBase64,
          textContent,
        });
        uploaded.push(attachment);
      }

      if (uploaded.length > 0) {
        setPendingAttachments((prev) => [...prev, ...uploaded]);
        flash(`已添加 ${uploaded.length} 个附件`);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : '文件上传失败');
    } finally {
      setUploadingFiles(false);
    }
  };

  const openWorkspaceFilePicker = async (query = '') => {
    setAttachMenuMode('workspace');
    setLoadingWsFiles(true);
    try {
      const res = await api.listWorkspaceFiles(repoPath, query);
      setWsFiles(res.files);
    } catch {
      setWsFiles([]);
    } finally {
      setLoadingWsFiles(false);
    }
  };

  const handleAttachWorkspaceFile = async (absPath: string) => {
    setUploadingFiles(true);
    try {
      let roomId = activeRun?.id;
      if (!roomId) {
        const { run } = await api.createRun({
          repoPath,
          executionMode,
          startWorkflow: false,
        });
        setRuns((prev) => [run, ...prev]);
        setActiveRun(run);
        roomId = run.id;
      }
      const { attachment } = await api.attachLocalFile(roomId, absPath);
      setPendingAttachments((prev) => [...prev, attachment]);
      setAttachMenuMode('closed');
      flash(`已引用工作区文件「${attachment.name}」`);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      flash(err instanceof Error ? err.message : '引用文件失败');
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleAddSnippetAttachment = async () => {
    const content = snippetText.trim();
    if (!content) return;
    const rawName = snippetTitle.trim() || `代码片段_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }).replace(':', '')}`;
    const finalName = /\.[a-z0-9]+$/i.test(rawName) ? rawName : `${rawName}.txt`;
    setUploadingFiles(true);
    try {
      let roomId = activeRun?.id;
      if (!roomId) {
        const { run } = await api.createRun({
          repoPath,
          executionMode,
          startWorkflow: false,
        });
        setRuns((prev) => [run, ...prev]);
        setActiveRun(run);
        roomId = run.id;
      }
      const bytes = new TextEncoder().encode(content);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      const { attachment } = await api.uploadFile(roomId, {
        name: finalName,
        mimeType: 'text/plain',
        dataBase64: btoa(bin),
        textContent: content.slice(0, 40000),
      });
      setPendingAttachments((prev) => [...prev, attachment]);
      setSnippetTitle('');
      setSnippetText('');
      setAttachMenuMode('closed');
      flash(`已添加文本片段「${finalName}」`);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      flash(err instanceof Error ? err.message : '添加片段失败');
    } finally {
      setUploadingFiles(false);
    }
  };

  const getFileExtBadge = (name: string): string => {
    const m = name.match(/\.([a-z0-9]{1,5})$/i);
    return (m ? m[1] : 'FILE').toUpperCase();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSaveWorkbench = async (next: WorkbenchConfig, toastMsg?: string) => {
    const { workbench: saved } = await api.saveWorkbench(next);
    setWorkbench(saved);
    if (toastMsg) flash(toastMsg);
  };

  const handleTestPlugin = async (pluginId: string) => {
    try {
      const res = await api.testWorkbenchPlugin(pluginId, repoPath);
      setWorkbench(res.workbench);
      flash(
        res.result.ok
          ? `插件检测通过 (${res.result.latencyMs}ms)`
          : `插件检测失败：${res.result.message.slice(0, 60)}`,
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunSchedule = async (scheduleId: string) => {
    try {
      const res = await api.runScheduledTask(scheduleId, activeRun?.id);
      setWorkbench(res.workbench);
      flash(res.ok ? `已触发执行：${res.message}` : `触发失败：${res.message}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const insertMentionFromPopup = (item: { id: string; name: string; isAll?: boolean }) => {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? input.length;
    const before = input.slice(0, pos);
    const after = input.slice(pos);
    const replacedBefore = before.replace(/@([^\s@]*)$/, `@${item.name} `);
    const nextText = `${replacedBefore}${after}`;
    setInput(nextText);
    setMentionQuery(null);

    if (item.isAll) {
      setSelectedTargets(activeMemberIds);
    } else {
      setSelectedTargets((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
    }

    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(replacedBefore.length, replacedBefore.length);
      }
    });
  };

  const focusTextareaAtEnd = (_expectedLength?: number) => {
    pendingCursorEndRef.current = true;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const mentionMemberQuick = (id: string, name: string) => {
    setSelectedTargets((prev) => (prev.includes(id) ? prev : [...prev, id]));
    let nextLen: number | undefined;
    setInput((prev) => {
      if (hasMentionTag(prev, name)) {
        nextLen = prev.length;
        return prev;
      }
      const next = appendMentionTag(prev, name);
      nextLen = next.length;
      return next;
    });
    setMentionQuery(null);
    focusTextareaAtEnd(nextLen);
  };

  // Keep selectedTargets strictly synced with actually connected members
  useEffect(() => {
    setSelectedTargets((prev) => prev.filter((id) => activeMemberIds.includes(id)));
  }, [activeMemberIds]);

  const combinedProviders = useMemo<ProviderConfig[]>(() => {
    const agentAsProviders: ProviderConfig[] = onlineAgents.map((a) => ({
      id: a.id,
      name: `${a.name}（在线）`,
      shortName: a.name,
      accentColor: a.accentColor,
      subscriptionHint: '主动接入的外部 Agent',
      command: 'agent-join',
      args: [],
      inputMode: 'stdin',
      installCmd: '',
      loginCmd: '',
      docsHint: '',
      timeoutSec: 600,
    }));
    return [...agentAsProviders, ...readyProviders, ...providers.filter((p) => !readyProviders.some((r) => r.id === p.id))];
  }, [onlineAgents, readyProviders, providers]);

  const handleNewRoom = async () => {
    const { run } = await api.createRun({
      title: '新协作会话',
      repoPath,
      executionMode,
      startWorkflow: false,
    });
    setRuns((prev) => [run, ...prev]);
    setActiveRun(run);
  };

  const handleDeleteRoom = async (roomId: string) => {
    await api.deleteRun(roomId);
    const remaining = runs.filter((r) => r.id !== roomId);
    setRuns(remaining);
    if (activeRun?.id === roomId) {
      if (remaining.length > 0) {
        setActiveRun(remaining[0]);
      } else {
        await ensureInitialRoom(repoPath);
      }
    }
  };

  const handleRenameAgent = async (
    agentId: string,
    payload: {
      modelName?: string;
      relayName?: string;
      online?: boolean;
      trigger?: ConnectedAgent['trigger'];
    },
  ) => {
    const { agent } = await api.renameAgent(agentId, payload);
    setConnectedAgents((prev) =>
      prev.map((item) => (item.id === agent.id ? agent : item)),
    );
    flash(`已更新「${agent.name}」配置`);
  };

  const handleDeleteAgent = async (agentId: string) => {
    await api.deleteAgent(agentId);
    setSelectedTargets((prev) => prev.filter((id) => id !== agentId));
    flash('已移出该接入成员');
  };

  const stripMentionTag = (text: string, name: string): string => {
    const escaped = `@${name}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text
      .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'gi'), '$1')
      .replace(/\s{2,}/g, ' ')
      .trimStart();
  };

  const hasMentionTag = (text: string, name: string): boolean => {
    const escaped = `@${name}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i').test(text);
  };

  const appendMentionTag = (text: string, name: string): string => {
    if (hasMentionTag(text, name)) return text;
    if (!text.trim()) return `@${name} `;
    // Keep all @mentions grouped cleanly before user body text, or append after existing trailing @mentions
    return `${text.trimEnd()} @${name} `;
  };

  const handlePillClick = (id: string, name: string) => {
    const isSelected = selectedTargets.includes(id);
    if (isSelected) {
      const remaining = selectedTargets.filter((x) => x !== id);
      setSelectedTargets(remaining);
      setInput((prev) => {
        // If @全员 was used to select everyone, replace @全员 with the remaining selected members
        if (hasMentionTag(prev, '全员')) {
          const withoutAll = stripMentionTag(prev, '全员').trim();
          const remainingTags = remaining
            .map((rid) => activeMembers.find((m) => m.id === rid)?.name)
            .filter((n): n is string => Boolean(n))
            .map((n) => `@${n}`)
            .join(' ');
          if (!remainingTags) return withoutAll;
          return withoutAll ? `${remainingTags} ${withoutAll}` : `${remainingTags} `;
        }
        return stripMentionTag(prev, name);
      });
    } else {
      const next = selectedTargets.includes(id) ? selectedTargets : [...selectedTargets, id];
      setSelectedTargets(next);
      setInput((prev) => appendMentionTag(prev, name));
    }
    setMentionQuery(null);
    focusTextareaAtEnd();
  };

  const allTargetsSelected =
    activeMemberIds.length > 0 &&
    activeMemberIds.every((id) => selectedTargets.includes(id));

  const toggleAllTargets = () => {
    if (activeMemberIds.length === 0) return;
    if (allTargetsSelected) {
      setSelectedTargets([]);
      setInput((prev) => {
        let next = stripMentionTag(prev, '全员');
        for (const m of activeMembers) {
          next = stripMentionTag(next, m.name);
        }
        return next;
      });
    } else {
      setSelectedTargets(activeMemberIds);
      setInput((prev) => {
        let cleaned = stripMentionTag(prev, '全员');
        for (const m of activeMembers) {
          cleaned = stripMentionTag(cleaned, m.name);
        }
        cleaned = cleaned.trim();
        return cleaned ? `@全员 ${cleaned}` : '@全员 ';
      });
    }
    setMentionQuery(null);
    focusTextareaAtEnd();
  };

  const syncTargetsFromInputText = (prevText: string, nextText: string) => {
    if (hasMentionTag(prevText, '全员') && !hasMentionTag(nextText, '全员')) {
      setSelectedTargets([]);
      return;
    }
    const removedIds: string[] = [];
    for (const m of activeMembers) {
      if (hasMentionTag(prevText, m.name) && !hasMentionTag(nextText, m.name)) {
        removedIds.push(m.id);
      }
    }
    if (removedIds.length > 0) {
      setSelectedTargets((prev) => prev.filter((id) => !removedIds.includes(id)));
    }
  };

  const commitRoomRename = async () => {
    const id = renamingRoomId;
    const title = roomTitleDraft.trim();
    setRenamingRoomId(null);
    if (!id || !title || title === runs.find((r) => r.id === id)?.title) return;
    try {
      const { run } = await api.renameRun(id, title);
      setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
      setActiveRun((prev) => (prev?.id === run.id ? run : prev));
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSend = async (mode: 'chat' | 'workflow', overrideContent?: string) => {
    const text = (overrideContent !== undefined ? overrideContent : input).trim();
    const attachmentsToSend = overrideContent !== undefined ? [] : pendingAttachments;
    if (!text && attachmentsToSend.length === 0) return;

    // Parse explicit @mentions typed directly in the message text (match full multi-word names first!)
    let resolvedTargets = [...selectedTargets];
    if (mode === 'chat') {
      const matchedIds: string[] = [];
      const lowerText = text.toLowerCase();
      if (/(?:^|\s)@(?:全员|all)(?=\s|$)/i.test(text)) {
        matchedIds.push(...activeMemberIds);
      }

      // 1. Exact full-name match (longest name first so "Gemini 4 Hydrogen" doesn't collide with "Gemini 4 Neon")
      let remainingText = lowerText;
      const sortedByLen = [...activeMembers].sort((a, b) => b.name.length - a.name.length);
      for (const m of sortedByLen) {
        const needle = `@${m.name.toLowerCase()}`;
        if (remainingText.includes(needle)) {
          matchedIds.push(m.id);
          remainingText = remainingText.split(needle).join(' ');
        }
      }

      // 2. Fallback short-token @word match for remaining unmatched @tokens
      const explicitTokens = Array.from(remainingText.matchAll(/@([^\s@]+)/g)).map((m) =>
        m[1].toLowerCase(),
      );
      for (const token of explicitTokens) {
        if (token === '全员' || token === 'all') {
          matchedIds.push(...activeMemberIds);
          continue;
        }
        for (const m of activeMembers) {
          const lowerName = m.name.toLowerCase();
          if (lowerName.includes(token) || m.id.toLowerCase().includes(token)) {
            matchedIds.push(m.id);
          }
        }
      }

      if (matchedIds.length > 0) {
        resolvedTargets = Array.from(new Set(matchedIds));
        setSelectedTargets(resolvedTargets);
      }
    }

    // Nobody picked or mentioned: fall back to the implied targets shown under the composer
    if (mode === 'chat' && resolvedTargets.length === 0 && impliedTargets) {
      resolvedTargets = [...impliedTargets.ids];
    }

    if (mode === 'chat' && resolvedTargets.length === 0) {
      if (activeMemberIds.length === 0) {
        flash('当前还没有已接入的成员，请先邀请模型入群或在模型池配置订阅 / API');
        setShowInvite(true);
      } else {
        flash('有多位成员在线：请点选下方的成员，或在消息里 @ 点名');
      }
      return;
    }

    let roomId = activeRun?.id;
    if (!roomId) {
      const { run } = await api.createRun({
        repoPath,
        executionMode,
        startWorkflow: false,
      });
      setRuns((prev) => [run, ...prev]);
      setActiveRun(run);
      roomId = run.id;
    }

    setInput('');
    setSelectedTargets([]);
    setPendingAttachments([]);
    setMentionQuery(null);
    setSlashQuery(null);
    try {
      const { run } = await api.sendChat(roomId, {
        content: text,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        targetProviderIds: resolvedTargets,
        mode,
        executionMode,
        repoPath,
        autoRelayMaxRounds: mode === 'chat' ? autoRelayRounds : 0,
      });
      setActiveRun(run);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApproval = async (payload: ApprovalPayload) => {
    if (!activeRun) return;
    try {
      const { run } = await api.submitApproval(activeRun.id, payload);
      setActiveRun(run);
      setInlineFeedback('');
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRerunFromNode = async (nodeId: string) => {
    if (!activeRun) return;
    try {
      const { run } = await api.rerunFromNode(activeRun.id, nodeId);
      setActiveRun(run);
      flash('已从该板块重跑');
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAbort = async () => {
    if (!activeRun) return;
    const { run } = await api.abortRun(activeRun.id);
    setActiveRun(run);
  };

  const handleSaveNode = async (updatedNode: WorkflowNodeConfig) => {
    if (!workflow) return;
    const nextWf: WorkflowDefinition = {
      ...workflow,
      nodes: workflow.nodes.map((n) => (n.id === updatedNode.id ? updatedNode : n)),
    };
    const res = await api.saveWorkflow(nextWf);
    setWorkflow(res.workflow);
    if (res.templates) setWorkflowTemplates(res.templates);
    flash(`已更新「${updatedNode.title}」`);
  };

  const handleSaveWorkflow = async (updatedWf: WorkflowDefinition, toastMsg?: string) => {
    const res = await api.saveWorkflow(updatedWf);
    setWorkflow(res.workflow);
    if (res.templates) setWorkflowTemplates(res.templates);
    if (toastMsg) flash(toastMsg);
  };

  const handleApplyWorkflowTemplate = async (templateId: string) => {
    const res = await api.applyWorkflowTemplate(templateId);
    setWorkflow(res.workflow);
    flash(`已切换工作流模板「${res.template.name}」`);
  };

  const handleSaveAsWorkflowTemplate = async (name: string, description: string) => {
    if (!workflow) return;
    const res = await api.saveWorkflowTemplate({
      name,
      description,
      workflow,
    });
    setWorkflowTemplates(res.templates);
    setWorkflow(res.template.workflow);
    await api.applyWorkflowTemplate(res.template.id);
    flash(`已保存为模板「${res.template.name}」`);
  };

  const handleDeleteWorkflowTemplate = async (templateId: string) => {
    try {
      const res = await api.deleteWorkflowTemplate(templateId);
      setWorkflowTemplates(res.templates);
      if (res.templates.length > 0 && workflow?.id === templateId) {
        await handleApplyWorkflowTemplate(res.templates[0].id);
      }
      flash('已删除自定义模板');
    } catch (err) {
      flash(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handlePickFolder = async () => {
    if (!window.desktopApi?.isDesktop) return;
    const picked = await window.desktopApi.pickFolder(repoPath);
    if (picked) {
      setRepoPath(picked);
      flash(`已切换目录：${picked}`);
    }
  };

  const handleCopyMsg = async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(''), 1400);
  };

  const handleAddMaterial = async (payload: {
    title: string;
    content: string;
    source?: 'manual' | 'file';
  }) => {
    if (!activeRun) return;
    const { run } = await api.addMaterial(activeRun.id, payload);
    setActiveRun(run);
    flash(`已共享资料「${payload.title}」`);
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!activeRun) return;
    const { run } = await api.deleteMaterial(activeRun.id, materialId);
    setActiveRun(run);
  };

  const openWorkflowCanvas = useCallback(() => {
    setShowWorkspace(false);
    setShowProjectWorkspace(false);
    setShowWorkflowPicker(false);
    setShowCanvas(true);
    if (typeof window !== 'undefined' && window.innerWidth < 1180) {
      setSidebarCollapsed(true);
      setCanvasWidthPx(Math.min(540, Math.max(380, Math.round(window.innerWidth * 0.52))));
    }
  }, []);

  const openProjectWorkspace = useCallback(() => {
    setShowWorkspace(false);
    setShowCanvas(false);
    setShowWorkflowPicker(false);
    setShowProjectWorkspace(true);
    if (typeof window !== 'undefined' && window.innerWidth < 1180) {
      setSidebarCollapsed(true);
      setCanvasWidthPx(Math.min(560, Math.max(390, Math.round(window.innerWidth * 0.54))));
    }
  }, []);

  const closeRightSplitPane = useCallback(() => {
    setShowCanvas(false);
    setShowProjectWorkspace(false);
    setCanvasFullscreen(false);
    setSidebarCollapsed(false);
  }, []);

  const toggleSidebarSection = useCallback((key: 'workbench' | 'threads' | 'members') => {
    setSidebarSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('ag_sidebar_sec', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const handleStartSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    let latestW = sidebarWidthPx;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(320, Math.max(184, Math.round(ev.clientX)));
      latestW = next;
      setSidebarWidthPx(next);
    };
    const onUp = () => {
      setIsResizingSidebar(false);
      try {
        localStorage.setItem('ag_sidebar_w', String(latestW));
      } catch {}
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidthPx]);

  const handleStartCanvasResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingCanvas(true);
    const onMove = (ev: MouseEvent) => {
      const maxW = Math.max(420, Math.round(window.innerWidth * 0.72));
      const next = Math.min(maxW, Math.max(360, window.innerWidth - ev.clientX));
      setCanvasWidthPx(next);
    };
    const onUp = () => {
      setIsResizingCanvas(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const handleArchiveTextToKnowledge = async (title: string, content: string) => {
    const newDoc = {
      id: `doc_${Date.now().toString(36)}`,
      title: title.slice(0, 60),
      content,
      tags: ['画布产出'],
      pinned: true,
      source: 'manual' as const,
      updatedAt: new Date().toISOString(),
    };
    const nextKb = [newDoc, ...workbench.knowledge];
    const saved = await api.saveWorkbench({ ...workbench, knowledge: nextKb });
    setWorkbench(saved.workbench);
    flash(`已存入全局资料库「${newDoc.title}」`);
  };

  const handleExportMarkdown = async () => {
    if (!activeRun) return;
    try {
      const md = await api.exportRunMarkdown(activeRun.id);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeRun.title.replace(/[\\/:*?"<>|]/g, '_') || activeRun.id}.md`;
      a.click();
      URL.revokeObjectURL(url);
      flash('已导出任务报告 (.md)');
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    }
  };

  const messages = activeRun?.messages || [];
  const hasStreamingWakeMsg = useMemo(
    () => messages.some((m) => m.status === 'streaming' && Boolean(m.wakePrompt)),
    [messages],
  );
  useEffect(() => {
    if (!hasStreamingWakeMsg) return;
    setWakeNowTick(Date.now());
    const id = window.setInterval(() => setWakeNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasStreamingWakeMsg]);
  const realMessages = messages.filter((m) => m.role !== 'system');

  // Who a message goes to when nobody is picked or @-mentioned:
  // the members who replied after your last message, else the only online member.
  const impliedTargets: { ids: string[]; reason: 'last' | 'only' } | null = (() => {
    if (selectedTargets.length > 0) return null;
    const lastUserIdx = realMessages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      const repliers = realMessages
        .slice(lastUserIdx + 1)
        .filter((m) => m.role === 'assistant' && activeMemberIds.includes(m.senderId))
        .map((m) => m.senderId);
      const ids = Array.from(new Set(repliers));
      if (ids.length > 0) return { ids, reason: 'last' };
    }
    if (activeMemberIds.length === 1) return { ids: [...activeMemberIds], reason: 'only' };
    return null;
  })();
  const impliedTargetNames = impliedTargets
    ? impliedTargets.ids.map((id) => activeMembers.find((m) => m.id === id)?.name || id).join('、')
    : '';
  const systemNotices = messages.filter(
    (m) => m.role === 'system' && !m.content.startsWith('欢迎来到'),
  );
  const isFreshRoom = realMessages.length === 0 && systemNotices.length === 0;

  const isWaitingApproval = activeRun?.status === 'waiting_approval';
  const isRunning = activeRun?.status === 'running';
  const hasWorkflowActivity = Boolean(activeRun?.requirement);
  const totalConnectedCount = onlineAgents.length + readyProviders.length;
  const workingCount = activeMembers.filter((m) => m.presence === 'working').length;
  const idleCount = activeMembers.filter((m) => m.presence === 'idle').length;
  const offlineCount = sidebarMembers.filter((m) => m.presence === 'offline').length;

  // Mascot mood follows the room: approval > error > working > nobody online > listening > done > idle
  const lastRealMessage = realMessages[realMessages.length - 1];
  const rinneState: RinneState = isWaitingApproval
    ? 'approval'
    : activeRun?.status === 'failed' || lastRealMessage?.status === 'error'
      ? 'error'
      : isRunning || workingCount > 0
        ? 'working'
        : totalConnectedCount === 0
          ? 'sleep'
          : activeMembers.some((m) => m.listening)
            ? 'listening'
            : activeRun?.status === 'completed'
              ? 'done'
              : 'idle';
  const rinneLine =
    rinneState === 'working' && workingCount > 0
      ? `正在协作中…（${workingCount} 位成员工作中）`
      : RINNE_LINES[rinneState];

  // Issue numbers: rooms in creation order, oldest = No.01
  const issueNoById = new Map(
    [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r, i) => [r.id, i + 1] as const),
  );
  const issueLabel = (id?: string) => `No.${String((id && issueNoById.get(id)) || runs.length + 1).padStart(2, '0')}`;

  // Journal cover: each room is one issue, the active workflow's steps are its contents
  const coverIssue: CoverIssue = (() => {
    const ordered = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const idx = activeRun ? ordered.findIndex((r) => r.id === activeRun.id) : -1;
    const repo = (activeRun?.repoPath || repoPath || '').replace(/[\\/]+$/, '');
    const statusLabel: Record<string, string> = {
      idle: '待启动',
      running: '进行中',
      waiting_approval: '等你拍板',
      completed: '已完成',
      failed: '出错',
      aborted: '已终止',
    };
    return {
      no: idx >= 0 ? idx + 1 : ordered.length + 1,
      title: activeRun?.title || '新协作会话',
      createdAt: activeRun?.createdAt,
      workspace: repo.split(/[\\/]/).pop() || 'workspace',
      statusLabel: statusLabel[activeRun?.status || 'idle'] || '待启动',
      messageCount: realMessages.length,
      requirement: activeRun?.requirement,
    };
  })();
  const coverSteps: CoverStep[] = (workflow?.nodes || [])
    .filter((n) => n.enabled !== false)
    .map((n) => {
      const provider = combinedProviders.find((p) => p.id === n.providerId);
      const owner = n.kind.startsWith('human_')
        ? '人工'
        : ['shell', 'condition', 'delay', 'file_read', 'file_write', 'http'].includes(n.kind)
          ? '系统'
          : provider?.shortName || provider?.name || n.providerId || '未分配';
      return { id: n.id, title: n.title.replace(/（.*?）/g, ''), owner };
    });

  return (
    <div className="studio-app">
      {/* ===== Left Collapsible, Resizable, Unified-Scroll Sidebar ===== */}
      <div
        className={`studio-sidebar-shell ${sidebarCollapsed ? 'is-collapsed' : ''} ${isResizingSidebar ? 'is-resizing' : ''}`}
        style={{ width: sidebarCollapsed ? 0 : sidebarWidthPx }}
      >
      <aside className="studio-sidebar" style={{ width: sidebarWidthPx }}>
        {/* Sticky Header */}
        <div className="studio-sidebar-sticky-top">
          <div className="ef-brand-strip">
            <div className="ef-brand-left">
              <span className="ef-infinity-mark">∞</span>
              <div className="ef-brand-text">
                <span className="ef-brand-title">{BRAND.title}</span>
                <span className="ef-brand-sub">{BRAND.sub}</span>
              </div>
            </div>
            <div className="ef-brand-right">
              <span
                className={`ef-mini-wave ${workingCount > 0 || onlineAgents.some((a) => a.listening) ? 'is-active' : ''}`}
                title={workingCount > 0 ? '模型运算中' : '系统在线遥测'}
              >
                <i /><i /><i /><i />
              </span>
              <span className="ef-index-tag">{BRAND.code}</span>
            </div>
          </div>

          <div className="studio-sidebar-top">
            <button className="studio-new-thread" onClick={handleNewRoom}>
              <Plus size={15} />
              <span>新建协作会话</span>
            </button>
          </div>
        </div>

        {/* Single Unified Smooth Scroll Body (No fighting nested scrollbars!) */}
        <div className="studio-sidebar-scroll">
          {/* Accordion 1: Workbench (expands to 01-06 list, collapses to sleek 6-icon quick dock) */}
          <section className="sb-section">
            <div className="sb-section-head">
              <button
                type="button"
                className="sb-section-toggle"
                onClick={() => toggleSidebarSection('workbench')}
                title={sidebarSections.workbench ? '折叠为单行快捷图标栏' : '展开工作台导航列表'}
              >
                <span className={`sb-section-chev ${sidebarSections.workbench ? 'is-open' : ''}`}>
                  <ChevronRight size={12} />
                </span>
                <span>工作台</span>
              </button>
              <span className="sb-section-meta">06</span>
            </div>

            {sidebarSections.workbench ? (
              <div className="studio-workbench-nav">
                <button
                  type="button"
                  className={`wb-nav-btn ${showProjectWorkspace ? 'active' : ''}`}
                  onClick={() => {
                    if (showProjectWorkspace) closeRightSplitPane();
                    else openProjectWorkspace();
                  }}
                  title="打开本地项目工作区（浏览文件树、查看/编辑代码、Git Diff 与一键引用到对话）"
                >
                  <span className="wb-nav-idx">01</span>
                  <FolderOpen size={13} />
                  <span className="wb-nav-label">工作区</span>
                  <span className="wb-nav-count">
                    {repoPath.split(/[/\\]/).filter(Boolean).pop() || '目录'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`wb-nav-btn ${showCanvas ? 'active' : ''}`}
                  onClick={() => {
                    if (showCanvas) closeRightSplitPane();
                    else openWorkflowCanvas();
                  }}
                  title="以分屏画布形式可视化编排工作流模板与实时产出"
                >
                  <span className="wb-nav-idx">02</span>
                  <Layers size={13} />
                  <span className="wb-nav-label">工作流画布</span>
                  <span className="wb-nav-count">
                    {workflow ? `${workflow.nodes.length}步` : '画布'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`wb-nav-btn ${workbenchTab === 'skills' ? 'active' : ''}`}
                  onClick={() => setWorkbenchTab('skills')}
                  title="管理可复用提示词技能与全局自动注入规则（输入框打 / 也可唤起）"
                >
                  <span className="wb-nav-idx">03</span>
                  <Sparkles size={13} />
                  <span className="wb-nav-label">技能 Skills</span>
                  <span className="wb-nav-count">
                    {workbench.skills.filter((s) => s.enabled).length}
                  </span>
                </button>
                <button
                  type="button"
                  className={`wb-nav-btn ${workbenchTab === 'plugins' ? 'active' : ''}`}
                  onClick={() => setWorkbenchTab('plugins')}
                  title="接入与检测本地 MCP Server、CLI 工具或 Webhook 插件"
                >
                  <span className="wb-nav-idx">04</span>
                  <Blocks size={13} />
                  <span className="wb-nav-label">插件 / MCP</span>
                  <span className="wb-nav-count">
                    {workbench.plugins.filter((p) => p.enabled).length}
                  </span>
                </button>
                <button
                  type="button"
                  className={`wb-nav-btn ${workbenchTab === 'knowledge' ? 'active' : ''}`}
                  onClick={() => setWorkbenchTab('knowledge')}
                  title="跨会话共享的项目规范与全局参考资料库"
                >
                  <span className="wb-nav-idx">05</span>
                  <BookOpen size={13} />
                  <span className="wb-nav-label">全局资料库</span>
                  <span className="wb-nav-count">
                    {workbench.knowledge.filter((k) => k.pinned).length}
                  </span>
                </button>
                <button
                  type="button"
                  className={`wb-nav-btn ${workbenchTab === 'automation' ? 'active' : ''}`}
                  onClick={() => setWorkbenchTab('automation')}
                  title="协作快捷模板与本地定时自动化任务"
                >
                  <span className="wb-nav-idx">06</span>
                  <Clock size={13} />
                  <span className="wb-nav-label">模板与定时</span>
                  <span className="wb-nav-count">
                    {workbench.schedules.some((s) => s.enabled)
                      ? `${workbench.schedules.filter((s) => s.enabled).length}运行`
                      : workbench.templates.length}
                  </span>
                </button>
              </div>
            ) : (
              <div className="wb-compact-dock">
                <button
                  type="button"
                  className={`wb-dock-btn ${showProjectWorkspace ? 'active' : ''}`}
                  title={`01 工作区 (${repoPath.split(/[/\\]/).filter(Boolean).pop() || '目录'})`}
                  onClick={() => (showProjectWorkspace ? closeRightSplitPane() : openProjectWorkspace())}
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  type="button"
                  className={`wb-dock-btn ${showCanvas ? 'active' : ''}`}
                  title="02 工作流画布"
                  onClick={() => (showCanvas ? closeRightSplitPane() : openWorkflowCanvas())}
                >
                  <Layers size={14} />
                </button>
                <button
                  type="button"
                  className={`wb-dock-btn ${workbenchTab === 'skills' ? 'active' : ''}`}
                  title="03 技能 Skills"
                  onClick={() => setWorkbenchTab('skills')}
                >
                  <Sparkles size={14} />
                </button>
                <button
                  type="button"
                  className={`wb-dock-btn ${workbenchTab === 'plugins' ? 'active' : ''}`}
                  title="04 插件 / MCP"
                  onClick={() => setWorkbenchTab('plugins')}
                >
                  <Blocks size={14} />
                </button>
                <button
                  type="button"
                  className={`wb-dock-btn ${workbenchTab === 'knowledge' ? 'active' : ''}`}
                  title="05 全局资料库"
                  onClick={() => setWorkbenchTab('knowledge')}
                >
                  <BookOpen size={14} />
                </button>
                <button
                  type="button"
                  className={`wb-dock-btn ${workbenchTab === 'automation' ? 'active' : ''}`}
                  title="06 模板与定时"
                  onClick={() => setWorkbenchTab('automation')}
                >
                  <Clock size={14} />
                </button>
              </div>
            )}
          </section>

          {/* Accordion 2: Sessions / Threads */}
          <section className="sb-section">
            <div className="sb-section-head">
              <button
                type="button"
                className="sb-section-toggle"
                onClick={() => toggleSidebarSection('threads')}
              >
                <span className={`sb-section-chev ${sidebarSections.threads ? 'is-open' : ''}`}>
                  <ChevronRight size={12} />
                </span>
                <span>会话</span>
                <span className="sb-section-count">{runs.length}</span>
              </button>
              <button
                type="button"
                className="mini-icon-btn"
                title="新建协作会话"
                onClick={handleNewRoom}
              >
                <Plus size={12} />
              </button>
            </div>

            {sidebarSections.threads && (
              <div className="studio-thread-list">
                {runs.map((r) => (
                  <div
                    key={r.id}
                    className={`studio-thread-item ${activeRun?.id === r.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveRun(r);
                      setExecutionMode(r.executionMode);
                      if (r.repoPath) setRepoPath(r.repoPath);
                    }}
                  >
                    <span className="studio-thread-no">{issueLabel(r.id)}</span>
                    {renamingRoomId === r.id ? (
                      <input
                        className="studio-thread-rename"
                        value={roomTitleDraft}
                        autoFocus
                        maxLength={40}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRoomTitleDraft(e.target.value)}
                        onBlur={() => void commitRoomRename()}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitRoomRename();
                          } else if (e.key === 'Escape') {
                            setRenamingRoomId(null);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="studio-thread-title"
                        title="双击改名"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setRenamingRoomId(r.id);
                          setRoomTitleDraft(r.title);
                        }}
                      >
                        {r.title}
                      </span>
                    )}
                    {runs.length > 1 && (
                      <button
                        type="button"
                        className="thread-del-btn"
                        title="删除会话"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteRoom(r.id);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Accordion 3: Members / Operators */}
          <section className="sb-section">
            <div className="sb-section-head">
              <button
                type="button"
                className="sb-section-toggle"
                onClick={() => toggleSidebarSection('members')}
              >
                <span className={`sb-section-chev ${sidebarSections.members ? 'is-open' : ''}`}>
                  <ChevronRight size={12} />
                </span>
                <span>成员</span>
                {totalConnectedCount > 0 && (
                  <span className="sb-section-count">{totalConnectedCount}在线</span>
                )}
              </button>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <button
                  type="button"
                  className="mini-icon-btn"
                  title="连接诊断与常见问题解决（心跳待命 / 掉线 / 报错排障）"
                  onClick={() => setShowTroubleshoot(true)}
                >
                  <Wrench size={12} />
                </button>
                <button
                  type="button"
                  className="mini-icon-btn"
                  title="邀请外部 Agent 入群"
                  onClick={() => setShowInvite(true)}
                >
                  <UserPlus size={13} />
                </button>
              </div>
            </div>

            {!sidebarSections.members ? (
              sidebarMembers.length > 0 && (
                <div className="member-compact-strip">
                  {sidebarMembers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`member-compact-btn ${selectedTargets.includes(m.id) ? 'active' : ''}`}
                      title={`${m.name}（${m.listening ? '⚡ 监听待命' : m.bridgeActive ? '📁 文件桥接' : m.presence === 'working' ? '工作中' : m.presence === 'offline' ? '离线' : '在线 · 空闲'}）· 点击 @点名`}
                      onClick={() => {
                        if (m.presence !== 'offline') mentionMemberQuick(m.id, m.name);
                      }}
                    >
                      <MemberAvatar
                        name={m.name}
                        avatar={m.avatar}
                        color={m.color}
                        size={24}
                        radius={4}
                        status={m.presence === 'working' ? 'busy' : m.presence === 'offline' ? 'off' : 'on'}
                      />
                    </button>
                  ))}
                </div>
              )
            ) : (
              <>
                {sidebarMembers.length > 0 && (
                  <div className="member-status-summary">
                    {workingCount > 0 && (
                      <span className="status-sum-chip is-working">
                        <span className="presence-dot working" />
                        {workingCount} 工作中
                      </span>
                    )}
                    <span className="status-sum-chip is-idle">
                      <span className="presence-dot idle" />
                      {idleCount} 空闲
                    </span>
                    {offlineCount > 0 && (
                      <span className="status-sum-chip is-offline">
                        <span className="presence-dot offline" />
                        {offlineCount} 离线
                      </span>
                    )}
                  </div>
                )}

                <div className="studio-member-list">
                  {sidebarMembers.length === 0 ? (
                    <div className="studio-member-empty">
                      <span>暂无已接入成员</span>
                      <button
                        type="button"
                        className="empty-invite-link"
                        onClick={() => setShowInvite(true)}
                      >
                        + 邀请模型入群
                      </button>
                    </div>
                  ) : (
                    sidebarMembers.map((m) => {
                      const isOffline = m.presence === 'offline';
                      const isWorking = m.presence === 'working';
                      const active = !isOffline && selectedTargets.includes(m.id);
                      const lvl = m.thinkingLevel || 'default';
                      const openProfile = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        setEditingMember({
                          id: m.id,
                          name: m.name,
                          avatar: m.avatar,
                          color: m.color,
                          presence: m.presence,
                          kind: m.kind,
                          subtitle: m.subtitle,
                        });
                      };
                      const statusLabel = isWorking
                        ? '工作中'
                        : isOffline
                          ? '离线'
                          : m.listening
                            ? '⚡ 监听待命'
                            : m.bridgeActive
                              ? '📁 文件桥接'
                              : '在线 · 空闲';

                      return (
                        <div
                          key={m.id}
                          role="button"
                          tabIndex={0}
                          className={`studio-member ${active ? 'selected' : ''} ${isOffline ? 'is-offline' : ''} ${isWorking ? 'is-working' : ''}`}
                          onClick={() => {
                            if (isOffline) {
                              setEditingMember({
                                id: m.id,
                                name: m.name,
                                avatar: m.avatar,
                                color: m.color,
                                presence: m.presence,
                                kind: m.kind,
                                subtitle: m.subtitle,
                              });
                            } else {
                              mentionMemberQuick(m.id, m.name);
                            }
                          }}
                          onDoubleClick={openProfile}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (!isOffline) mentionMemberQuick(m.id, m.name);
                            }
                          }}
                          title={
                            isOffline
                              ? `${m.name}（离线）· 点击可恢复在线或编辑头像名称`
                              : `${m.name}（${statusLabel}）· 点击插入 @${m.name}，点铅笔可改名/换头像`
                          }
                        >
                          <MemberAvatar
                            name={m.name}
                            avatar={m.avatar}
                            color={m.color}
                            size={24}
                            radius={7}
                            status={isWorking ? 'busy' : isOffline ? 'off' : 'on'}
                            onClick={openProfile}
                            title="点击修改头像、名称或上下线状态"
                          />
                          <div className="studio-member-body">
                            <span className="studio-member-name">{m.name}</span>
                            <div className="studio-member-sub">
                              <span className={`presence-text is-${m.presence}`}>
                                <span className={`presence-dot ${m.presence}`} />
                                {statusLabel}
                              </span>
                              {m.listening && !isWorking && (
                                <button
                                  type="button"
                                  className="member-effort-tag"
                                  style={{ cursor: 'pointer' }}
                                  title="点击远程结束该成员的待命监听"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void api.stopAgentStandby(m.id).then(() => {
                                      flash(`已通知「${m.name}」退出待命监听`);
                                    });
                                  }}
                                >
                                  停等
                                </button>
                              )}
                              {lvl !== 'default' && !isOffline && (
                                <span className="member-effort-tag">{getThinkingLabel(lvl)}</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="member-edit-btn"
                            title="快捷重命名、自定义头像与上下线状态"
                            onClick={openProfile}
                          >
                            <Pencil size={11} />
                          </button>
                          {active && <span className="studio-at">@</span>}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {/* Sticky Footer */}
        <div className="studio-sidebar-footer">
          <button
            type="button"
            className="sidebar-ghost-btn"
            onClick={() => setShowInvite(true)}
          >
            <UserPlus size={14} />
            <span>邀请模型入群</span>
          </button>
          <button
            type="button"
            className="sidebar-ghost-btn"
            onClick={() => setShowProviders(true)}
          >
            <Settings2 size={14} />
            <span>模型池（订阅 / API）</span>
          </button>
        </div>
      </aside>
      </div>
      {!sidebarCollapsed && (
        <div
          className={`sidebar-split-resizer ${isResizingSidebar ? 'is-dragging' : ''}`}
          onMouseDown={handleStartSidebarResize}
          title="左右拖动调整左侧栏宽度"
        />
      )}

      {/* ===== Center Editorial Chat Workspace ===== */}
      <div
        className={`studio-main ${isDraggingFile ? 'is-dragover-window' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            setIsDraggingFile(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsDraggingFile(false);
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            setIsDraggingFile(false);
            void handleAttachFiles(e.dataTransfer.files);
          }
        }}
      >
        {isDraggingFile && (
          <div className="window-drop-overlay">
            <div className="window-drop-card">
              <Upload size={26} />
              <div className="window-drop-title">松开鼠标即可上传附件</div>
              <div className="window-drop-sub">支持图片、文档、代码或日志，自动附带到当前对话</div>
            </div>
          </div>
        )}

        <AmbientStage
          compact={showCanvas || showProjectWorkspace}
          reading={!isFreshRoom}
          quietBottom={!isFreshRoom && showRinne}
          eyeDocked={isFreshRoom}
          mood={
            rinneState === 'approval'
              ? 'approval'
              : rinneState === 'error'
                ? 'error'
                : rinneState === 'working'
                  ? 'busy'
                  : 'idle'
          }
        />

        <header className="studio-topbar">
          <div className="studio-topbar-left">
            <button
              type="button"
              className={`studio-icon-btn ${!sidebarCollapsed ? '' : 'active'}`}
              title={sidebarCollapsed ? '展开左侧边栏' : '收起左侧边栏'}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              <PanelLeft size={15} />
            </button>
            <span className="studio-thread-heading">
              {activeRun?.title || '新协作会话'}
            </span>
            <button
              type="button"
              className={`studio-repo-chip ${showProjectWorkspace ? 'active' : ''}`}
              onClick={() => {
                if (showProjectWorkspace) {
                  closeRightSplitPane();
                } else {
                  openProjectWorkspace();
                }
              }}
              title={`打开 / 收起工作区：${repoPath}`}
            >
              <FolderOpen size={12} />
              <span>{repoPath.split(/[/\\]/).filter(Boolean).pop() || repoPath}</span>
            </button>
          </div>

          <div className="studio-topbar-right">
            <div
              className={`studio-segmented ${executionMode === 'real' ? 'is-real' : ''}`}
              role="group"
              title="执行模式仅对当前会话生效：模拟不调用任何模型，真实会调用你的订阅 / API"
            >
              <button
                type="button"
                className={executionMode === 'mock' ? 'active' : ''}
                onClick={() => setExecutionMode('mock')}
              >
                模拟
              </button>
              <button
                type="button"
                className={executionMode === 'real' ? 'active' : ''}
                onClick={() => {
                  if (executionMode !== 'real') setConfirmRealMode(true);
                }}
              >
                真实
              </button>
            </div>

            <button
              type="button"
              className="studio-icon-btn"
              title={theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <button
              type="button"
              className={`studio-icon-btn ${showRinne ? 'active' : ''}`}
              title={showRinne ? '隐藏看板娘' : '显示看板娘'}
              aria-pressed={showRinne}
              onClick={() => {
                setShowRinne((v) => !v);
                flash(showRinne ? '看板娘已隐藏' : '看板娘已显示');
              }}
            >
              {showRinne ? <UserRound size={15} /> : <UserRoundX size={15} />}
            </button>

            <button
              type="button"
              className={`studio-canvas-toggle ${showCanvas ? 'active' : ''}`}
              title="打开 / 收起可视化工作流画布（支持分屏拖拽与全屏）"
              onClick={() => {
                if (showCanvas) {
                  closeRightSplitPane();
                } else {
                  openWorkflowCanvas();
                }
              }}
            >
              <Layers size={13} />
              <span>画布</span>
            </button>

            <button
              type="button"
              className={`studio-icon-btn ${showWorkspace ? 'active' : ''}`}
              title="任务进度、资料库与列表编排"
              onClick={() => {
                setShowWorkspace((v) => {
                  const next = !v;
                  if (next) {
                    setShowCanvas(false);
                    setShowProjectWorkspace(false);
                    setCanvasFullscreen(false);
                  }
                  return next;
                });
              }}
            >
              <PanelRight size={15} />
            </button>
          </div>
        </header>

        {executionMode === 'real' && (
          <div className="real-mode-ribbon" role="status">
            真实模式 · 消息会调用你的订阅 / API，可能产生费用
            <button type="button" onClick={() => setExecutionMode('mock')}>
              切回模拟
            </button>
          </div>
        )}

        {hasWorkflowActivity && workflow && activeRun && (
          <div className="studio-progress-strip">
            <div className="studio-progress-inner">
              {workflow.nodes.map((n) => {
                const st = activeRun.nodes[n.id]?.status || 'idle';
                const disabled = n.enabled === false;
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`stage-chip status-${disabled ? 'skipped' : st}`}
                    onClick={() => {
                      setWorkspaceTab('progress');
                      setShowWorkspace(true);
                    }}
                  >
                    <span className="stage-chip-dot" />
                    <span>{n.title.replace(/（.*）/, '')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Editorial Centered Conversation Feed */}
        <div className="studio-feed">
          <div className="studio-feed-inner">
            {!isFreshRoom && (
              <header className="jr-running-head" aria-label="当前会话">
                <span className="jr-rh-brand">{BRAND.title}</span>
                <span>{issueLabel(activeRun?.id)}</span>
                <span className="jr-rh-title">{activeRun?.title}</span>
                <span className="jr-rh-count">{realMessages.length} 条消息</span>
              </header>
            )}
            {isFreshRoom ? (
              <JournalCover
                showRinne={showRinne}
                runs={runs}
                issue={coverIssue}
                workflowName={workflow?.name || '多模型协作工作流'}
                steps={coverSteps}
                onOpenSteps={openWorkflowCanvas}
                quickActions={[
                  { label: '邀请 Agent 接入', onPick: () => setShowInvite(true) },
                  ...QUICK_PROMPTS.map((q) => ({ label: q.title, onPick: () => setInput(q.text) })),
                ]}
              />
            ) : (
              messages
                .filter((m) => !(m.role === 'system' && m.content.startsWith('欢迎来到')))
                .map((msg) => {
                  if (msg.role === 'system') {
                    return (
                      <div key={msg.id} className="studio-sys-event">
                        <MarkdownView content={msg.content} />
                      </div>
                    );
                  }

                  if (msg.role === 'user') {
                    return (
                      <div key={msg.id} className="studio-user-turn">
                        <div className="studio-user-bubble">
                          {msg.stageTitle && (
                            <div className="studio-user-tag">{msg.stageTitle}</div>
                          )}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="msg-attachments">
                              {msg.attachments.map((att) =>
                                att.mimeType?.startsWith('image/') && att.url ? (
                                  <button
                                    key={att.id}
                                    type="button"
                                    className="msg-att-img-wrap"
                                    title={`点击查看大图：${att.name}`}
                                    onClick={() => setPreviewAttachment(att)}
                                  >
                                    <img src={att.url} alt={att.name} className="msg-att-img" />
                                  </button>
                                ) : (
                                  <span key={att.id} className="msg-att-file" title={att.savedPath || att.name}>
                                    <span className="att-ext-pill">{getFileExtBadge(att.name)}</span>
                                    <span className="msg-att-file-name">{att.name}</span>
                                    <span className="att-size">{formatFileSize(att.size)}</span>
                                  </span>
                                ),
                              )}
                            </div>
                          )}
                          <div className="studio-user-text">{msg.content}</div>
                        </div>
                      </div>
                    );
                  }

                  // Editorial borderless AI turn (Claude / Codex / Antigravity style!)
                  const liveProfile = memberProfileMap[msg.senderId];
                  const displaySenderName = liveProfile?.name || msg.senderName;
                  const displayAvatar = liveProfile?.avatar ?? msg.avatar;
                  const displayColor = liveProfile?.color || msg.accentColor || '#18181b';

                  return (
                    <article
                      key={msg.id}
                      className={`studio-ai-turn ${msg.status === 'streaming' ? 'is-streaming' : ''}`}
                    >
                      <div className="studio-ai-head">
                        <MemberAvatar
                          name={displaySenderName}
                          avatar={displayAvatar}
                          color={displayColor}
                          size={22}
                          radius={6}
                          onClick={
                            liveProfile
                              ? () => setEditingMember(liveProfile)
                              : undefined
                          }
                          title={liveProfile ? '点击快捷修改名称与头像' : undefined}
                        />
                        <span className="studio-ai-name">{displaySenderName}</span>
                        {msg.stageTitle && (
                          <span className="studio-ai-role">{msg.stageTitle}</span>
                        )}
                        <span className="studio-ai-time">
                          {formatTime(msg.createdAt)}
                          {msg.durationMs !== undefined && msg.durationMs > 0
                            ? ` · ${(msg.durationMs / 1000).toFixed(1)}s`
                            : ''}
                        </span>
                        {msg.status === 'done' && (() => {
                          const displayUsage: TokenUsage | null = msg.usage && msg.usage.totalTokens > 0
                            ? msg.usage
                            : msg.content?.trim()
                              ? (() => {
                                  const outTok = estimateInlineTokens(msg.content);
                                  return {
                                    inputTokens: 0,
                                    outputTokens: outTok,
                                    totalTokens: outTok,
                                    estimated: true,
                                    source: 'estimated',
                                  };
                                })()
                              : null;
                          if (!displayUsage) return null;
                          const isLegacyOutOnly = !msg.usage;
                          return (
                            <span
                              className={`studio-ai-token-pill ${displayUsage.estimated ? '' : 'is-exact'}`}
                              title={
                                isLegacyOutOnly
                                  ? `历史回复正文估算：~${displayUsage.outputTokens.toLocaleString('en-US')} tokens（新发送的消息会记录完整输入+输出）`
                                  : formatTokenTooltip(displayUsage)
                              }
                            >
                              {displayUsage.estimated ? '~' : ''}
                              {formatCompactTokens(displayUsage.totalTokens)} tok
                              {!displayUsage.estimated && typeof displayUsage.costUsd === 'number' && displayUsage.costUsd > 0
                                ? ` · $${displayUsage.costUsd.toFixed(3)}`
                                : ''}
                            </span>
                          );
                        })()}
                      </div>

                      <div
                        className={`studio-ai-content ${msg.status === 'error' ? 'is-error' : ''}`}
                      >
                        {msg.status === 'streaming' ? (() => {
                          const liveAgent = connectedAgents.find((a) => a.id === msg.senderId);
                          const isNowListening = Boolean(liveAgent?.listening);
                          const isBridgeAgent =
                            Boolean(liveAgent?.lastBridgeAt) ||
                            Boolean(msg.stageTitle?.includes('文件桥接'));
                          const createdMs = new Date(msg.createdAt).getTime();
                          const elapsedSec = Number.isFinite(createdMs)
                            ? Math.max(0, (wakeNowTick - createdMs) / 1000)
                            : 999;
                          const lastListenAgeSec = liveAgent?.lastListenAt
                            ? Math.max(
                                0,
                                (wakeNowTick - new Date(liveAgent.lastListenAt).getTime()) / 1000,
                              )
                            : Infinity;
                          const inReconnectGrace =
                            !isBridgeAgent && lastListenAgeSec < 120 && elapsedSec < 12;
                          const showWakeHelper =
                            Boolean(msg.wakePrompt) && !isNowListening && !inReconnectGrace;
                          const wakeExpanded = Boolean(expandedWakeIds[msg.id]);

                          const pillText = isNowListening
                            ? msg.logs.length > 0
                              ? msg.logs[msg.logs.length - 1]
                              : `${displaySenderName} 已连上监听待命，正在处理...`
                            : inReconnectGrace
                              ? `${displaySenderName} 正在接单处理中...`
                              : isBridgeAgent
                                ? `已写入桥接目录 tasks\\，等待 ${displaySenderName} 自动回执...`
                                : msg.wakePrompt
                                  ? `任务已就绪，等待 ${displaySenderName} 接单...`
                                  : msg.logs.length > 0
                                    ? msg.logs[msg.logs.length - 1]
                                    : `${displaySenderName} 正在思考与执行...`;

                          return (
                            <div className="studio-pending-block">
                              <div className="studio-thinking-pill">
                                <Loader2 size={14} className="spin" />
                                <span>{pillText}</span>
                              </div>
                              {showWakeHelper && (
                                <div className={`wake-compact-bar ${isBridgeAgent ? 'is-bridge' : ''}`}>
                                  <div className="wake-compact-head">
                                    <span className="wake-compact-label">
                                      <span className={`wake-compact-dot ${isBridgeAgent ? 'is-bridge' : ''}`} />
                                      {isBridgeAgent
                                        ? '文件夹桥接模式 · 无需手动唤醒'
                                        : '未检测到保活监听'}
                                    </span>
                                    <div className="wake-compact-actions">
                                      {isBridgeAgent ? (
                                        <button
                                          type="button"
                                          className="btn btn-sm wake-mini-btn"
                                          title="复制文件夹桥接接入指令"
                                          onClick={async () => {
                                            await navigator.clipboard.writeText(
                                              buildFileBridgePrompt(msg.senderId, displaySenderName),
                                            );
                                            setCopiedId(`bridge_${msg.id}`);
                                            flash(`已复制「${displaySenderName}」文件夹桥接指令`);
                                            setTimeout(() => setCopiedId(''), 1800);
                                          }}
                                        >
                                          <Copy size={11} />
                                          {copiedId === `bridge_${msg.id}` ? '已复制' : '复制桥接指令'}
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            className="btn btn-ink btn-sm wake-mini-btn"
                                            title="复制零耗保活长连接待命指令发给该模型（每 15s 保活心跳 / 0 token / 重启自动重连）"
                                            onClick={async () => {
                                              await navigator.clipboard.writeText(
                                                buildStandbyPrompt(msg.senderId),
                                              );
                                              setCopiedId(`standby_${msg.id}`);
                                              flash('已复制保活待命指令，发给对方即可恢复自动秒回');
                                              setTimeout(() => setCopiedId(''), 1800);
                                            }}
                                          >
                                            <Terminal size={11} />
                                            {copiedId === `standby_${msg.id}` ? '已复制' : '复制保活指令'}
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-sm wake-mini-btn"
                                            onClick={async () => {
                                              await navigator.clipboard.writeText(msg.wakePrompt!);
                                              setCopiedId(`wake_${msg.id}`);
                                              setTimeout(() => setCopiedId(''), 1600);
                                            }}
                                          >
                                            <Copy size={11} />
                                            {copiedId === `wake_${msg.id}` ? '已复制' : '单次唤醒'}
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        className="wake-detail-toggle"
                                        onClick={() =>
                                          setExpandedWakeIds((prev) => ({
                                            ...prev,
                                            [msg.id]: !prev[msg.id],
                                          }))
                                        }
                                      >
                                        {wakeExpanded ? '收起 ▴' : '详情 ▾'}
                                      </button>
                                    </div>
                                  </div>

                                  {wakeExpanded && (
                                    <div className="wake-detail-drawer">
                                      <div className="wake-detail-note">
                                        {isBridgeAgent ? (
                                          <span>
                                            {displaySenderName} 通过本地目录 <code>chatroom-bridge\{msg.senderId}\tasks</code> 接收任务并写回 <code>replies\</code>。若长时间未回复，请确认对方窗口的监听脚本或定时任务仍在运行。
                                          </span>
                                        ) : (
                                          <span>
                                            {displaySenderName} 当前未挂起「⚡ 监听待命」（可能是首次未启动、上次点了单次唤醒或对方会话已退出）。发送<strong>保活待命指令</strong>即可恢复 0 token 自动秒回；一旦对方接单本提示将自动隐藏。
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          className="wake-diag-link"
                                          onClick={() => setShowTroubleshoot(true)}
                                        >
                                          排障中心 →
                                        </button>
                                      </div>
                                      <div className="wake-code">{msg.wakePrompt}</div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })() : (
                          <>
                            {msg.logs.length > 0 && (
                              <details className="studio-thought-toggle">
                                <summary>
                                  <Terminal size={12} />
                                  <span>
                                    执行过程（{msg.logs.length} 条日志
                                    {msg.durationMs
                                      ? ` · ${(msg.durationMs / 1000).toFixed(1)}s`
                                      : ''}
                                    ）
                                  </span>
                                </summary>
                                <div className="studio-thought-body">
                                  {msg.commandPreview && (
                                    <div className="cmd-preview">$ {msg.commandPreview}</div>
                                  )}
                                  <div className="log-box">{msg.logs.join('\n')}</div>
                                </div>
                              </details>
                            )}

                            <MarkdownView content={msg.content} />

                            {msg.status === 'error' && (() => {
                              const diag = diagnoseMessageError(msg.content);
                              const isExternalAgent = connectedAgents.some((a) => a.id === msg.senderId);
                              return (
                                <div className="error-diag-card">
                                  <div className="error-diag-head">
                                    <Wrench size={12} />
                                    <strong>解决方法 · {diag.title}</strong>
                                  </div>
                                  <div className="error-diag-reason">{diag.reason}</div>
                                  <ul className="error-diag-steps">
                                    {diag.steps.map((st, idx) => (
                                      <li key={idx}>{st}</li>
                                    ))}
                                  </ul>
                                  <div className="error-diag-ops">
                                    {diag.suggestStandby && isExternalAgent && (
                                      <button
                                        type="button"
                                        className="btn btn-ink btn-sm"
                                        style={{ height: 25, fontSize: 11 }}
                                        onClick={async () => {
                                          await navigator.clipboard.writeText(buildStandbyPrompt(msg.senderId));
                                          setCopiedId(`err_standby_${msg.id}`);
                                          flash(`已复制「${displaySenderName}」保活待命指令`);
                                          setTimeout(() => setCopiedId(''), 1800);
                                        }}
                                      >
                                        <Copy size={11} />
                                        {copiedId === `err_standby_${msg.id}` ? '已复制保活指令' : '复制保活待命指令'}
                                      </button>
                                    )}
                                    {diag.suggestProviders && (
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        style={{ height: 25, fontSize: 11 }}
                                        onClick={() => setShowProviders(true)}
                                      >
                                        <Settings2 size={11} />
                                        检查模型池
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      style={{ height: 25, fontSize: 11 }}
                                      onClick={() => setShowTroubleshoot(true)}
                                    >
                                      <Wrench size={11} />
                                      排障中心
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}

                            <div className="studio-turn-actions">
                              <button
                                type="button"
                                className="turn-action-btn"
                                onClick={() => void handleCopyMsg(msg)}
                              >
                                <Copy size={12} />
                                {copiedId === msg.id ? '已复制' : '复制'}
                              </button>
                              <button
                                type="button"
                                className="turn-action-btn"
                                title="一键存入全局资料库，后续所有会话和模型都能自动参考"
                                onClick={() => void handleArchiveMessageToKnowledge(msg)}
                              >
                                <BookOpen size={12} />
                                存为资料
                              </button>
                              {msg.stageId && msg.stageId !== 'user_requirement' && (
                                <button
                                  type="button"
                                  className="turn-action-btn"
                                  onClick={() => void handleRerunFromNode(msg.stageId!)}
                                >
                                  <RotateCcw size={12} />
                                  从此重跑
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })
            )}

            {/* Inline Human Approval Card */}
            {isWaitingApproval && activeRun && (
              <div className="studio-approval-card">
                <div className="inline-approval-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Hand size={16} />
                    <strong>等待人工拍板</strong>
                    <span className="muted-sm">双方案对比已完成</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setShowApproval(true)}
                  >
                    三栏对比
                  </button>
                </div>

                <input
                  className="input"
                  style={{ marginTop: 10 }}
                  placeholder="可选补充指示；打回重议时请填写修改意见..."
                  value={inlineFeedback}
                  onChange={(e) => setInlineFeedback(e.target.value)}
                />

                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void handleApproval({
                        decision: 'rejected',
                        feedback: inlineFeedback,
                      })
                    }
                  >
                    <RotateCcw size={12} />
                    打回重议
                  </button>
                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    onClick={() =>
                      void handleApproval({
                        decision: 'approved',
                        feedback: inlineFeedback,
                      })
                    }
                  >
                    <CheckCircle2 size={13} />
                    拍板通过
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Floating Pill Composer (Claude / Codex / Antigravity signature!) */}
        <footer className="studio-composer-dock">
          <div className="studio-composer-card">
            {showRinne && !isFreshRoom && <RinneMascot variant="dock" state={rinneState} line={rinneLine} />}
            <input
              ref={composerFileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                void handleAttachFiles(e.target.files);
                e.target.value = '';
              }}
            />

            {/* Claude / Antigravity Style '+' Attachment Popover */}
            {attachMenuMode !== 'closed' && (
              <div className="attach-popover">
                {attachMenuMode === 'menu' && (
                  <div className="attach-menu-list">
                    <button
                      type="button"
                      className="attach-menu-item"
                      onClick={() => {
                        setAttachMenuMode('closed');
                        composerFileInputRef.current?.click();
                      }}
                    >
                      <Paperclip size={14} />
                      <div className="attach-menu-text">
                        <span>上传本地文件或图片</span>
                        <small>支持多选、拖拽到窗口任意处或 Ctrl+V 粘贴截图</small>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="attach-menu-item"
                      onClick={() => {
                        setWsFileQuery('');
                        void openWorkspaceFilePicker('');
                      }}
                    >
                      <FileCode2 size={14} />
                      <div className="attach-menu-text">
                        <span>引用工作区文件</span>
                        <small>从当前目录「{repoPath.split(/[/\\]/).filter(Boolean).pop() || repoPath}」快速选择</small>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="attach-menu-item"
                      onClick={() => setAttachMenuMode('snippet')}
                    >
                      <FileText size={14} />
                      <div className="attach-menu-text">
                        <span>粘贴长文本 / 代码片段</span>
                        <small>收起为独立文件卡片，保持输入框整洁</small>
                      </div>
                    </button>
                  </div>
                )}

                {attachMenuMode === 'workspace' && (
                  <div className="attach-subpanel">
                    <div className="attach-subhead">
                      <button
                        type="button"
                        className="mini-icon-btn"
                        onClick={() => setAttachMenuMode('menu')}
                        title="返回"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span>引用工作区文件</span>
                      <button
                        type="button"
                        className="mini-icon-btn"
                        style={{ marginLeft: 'auto' }}
                        onClick={() => setAttachMenuMode('closed')}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div className="attach-search-wrap">
                      <Search size={13} />
                      <input
                        className="attach-search-input"
                        autoFocus
                        placeholder="搜索文件名或路径..."
                        value={wsFileQuery}
                        onChange={(e) => {
                          const v = e.target.value;
                          setWsFileQuery(v);
                          void openWorkspaceFilePicker(v);
                        }}
                      />
                    </div>
                    <div className="attach-ws-list">
                      {loadingWsFiles ? (
                        <div className="attach-ws-empty">
                          <Loader2 size={13} className="spin" /> 扫描工作区文件...
                        </div>
                      ) : wsFiles.length === 0 ? (
                        <div className="attach-ws-empty">未找到匹配文件</div>
                      ) : (
                        wsFiles.map((f) => (
                          <button
                            key={f.absPath}
                            type="button"
                            className="attach-ws-row"
                            onClick={() => void handleAttachWorkspaceFile(f.absPath)}
                          >
                            <span className="att-ext-pill">{f.ext || 'FILE'}</span>
                            <span className="attach-ws-path" title={f.relPath}>
                              {f.relPath}
                            </span>
                            <span className="att-size">{formatFileSize(f.size)}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {attachMenuMode === 'snippet' && (
                  <div className="attach-subpanel">
                    <div className="attach-subhead">
                      <button
                        type="button"
                        className="mini-icon-btn"
                        onClick={() => setAttachMenuMode('menu')}
                        title="返回"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span>粘贴长文本 / 代码片段</span>
                      <button
                        type="button"
                        className="mini-icon-btn"
                        style={{ marginLeft: 'auto' }}
                        onClick={() => setAttachMenuMode('closed')}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <input
                      className="input"
                      style={{ marginBottom: 7 }}
                      placeholder="片段名称（可选），如 error.log 或 spec.md"
                      value={snippetTitle}
                      onChange={(e) => setSnippetTitle(e.target.value)}
                    />
                    <textarea
                      className="textarea"
                      autoFocus
                      rows={5}
                      placeholder="在此粘贴报错日志、代码或文档内容..."
                      value={snippetText}
                      onChange={(e) => setSnippetText(e.target.value)}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setAttachMenuMode('closed')}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn btn-ink btn-sm"
                        disabled={!snippetText.trim() || uploadingFiles}
                        onClick={() => void handleAddSnippetAttachment()}
                      >
                        添加为附件
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {mentionQuery !== null && mentionCandidates.length > 0 && (
              <div className="mention-popover" role="listbox">
                {mentionCandidates.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`mention-option ${idx === mentionIndex ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMentionFromPopup(item);
                    }}
                  >
                    {item.isAll ? (
                      <span className="at-dot" style={{ background: item.color }} />
                    ) : (
                      <MemberAvatar
                        name={item.name}
                        avatar={item.avatar}
                        color={item.color}
                        size={18}
                        radius={5}
                      />
                    )}
                    <span>@{item.name}</span>
                  </button>
                ))}
              </div>
            )}

            {slashQuery !== null && slashSkillCandidates.length > 0 && (
              <div className="mention-popover slash-popover" role="listbox">
                {slashSkillCandidates.map((item, idx) => (
                  <button
                    key={`${item.kind}_${item.id}`}
                    type="button"
                    className={`mention-option ${idx === slashIndex ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySlashCandidate(item);
                    }}
                  >
                    {item.kind === 'skill' ? (
                      <Sparkles size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                    ) : item.kind === 'template' ? (
                      <Clock size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                    ) : (
                      <Play size={13} style={{ flexShrink: 0, color: '#10b981' }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{item.name}</span>
                        {item.kind === 'skill' && item.trigger && (
                          <code className="wb-code-tag">{item.trigger}</code>
                        )}
                      </div>
                      <div className="slash-desc">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {showQuickExtMenu && (
              <div className="quick-ext-popover">
                <div className="thinking-popover-head">
                  <span>快捷扩展（随点随用 · 无需离开聊天）</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="quick-ext-manage-link"
                      onClick={() => {
                        setShowQuickExtMenu(false);
                        setWorkbenchTab('skills');
                      }}
                    >
                      全部管理 →
                    </button>
                    <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => setShowQuickExtMenu(false)}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Quick Skills & Templates */}
                <div className="qext-section">
                  <div className="qext-label">一键填入技能 / 模板（也可直接打 / 唤起）</div>
                  <div className="qext-chips">
                    {workbench.skills
                      .filter((s) => s.enabled && !s.autoInject)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="qext-chip"
                          title={s.description}
                          onClick={() => {
                            setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${s.prompt}` : s.prompt));
                            setShowQuickExtMenu(false);
                            requestAnimationFrame(() => textareaRef.current?.focus());
                          }}
                        >
                          <Sparkles size={11} />
                          <span>{s.name}</span>
                        </button>
                      ))}
                    {workbench.templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="qext-chip"
                        title={t.description}
                        onClick={() => {
                          setShowQuickExtMenu(false);
                          if (t.mode === 'workflow') {
                            setInput(t.prompt);
                            requestAnimationFrame(() => textareaRef.current?.focus());
                          } else {
                            void handleSend('chat', t.prompt);
                          }
                        }}
                      >
                        <Play size={10} />
                        <span>{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick CLI Plugins */}
                {workbench.plugins.some((p) => p.kind === 'cli_tool') && (
                  <div className="qext-section">
                    <div className="qext-label">一键运行本地工具并将结果贴入输入框</div>
                    <div className="qext-chips">
                      {workbench.plugins
                        .filter((p) => p.kind === 'cli_tool')
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="qext-chip"
                            disabled={runningQuickPluginId === p.id}
                            onClick={() => void handleRunPluginIntoComposer(p.id, p.name)}
                          >
                            {runningQuickPluginId === p.id ? (
                              <Loader2 size={11} className="spin" />
                            ) : (
                              <Terminal size={11} />
                            )}
                            <span>{p.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Quick Context Toggles */}
                <div className="qext-section">
                  <div className="qext-label">当前对话自动注入开关（点击切换）</div>
                  <div className="qext-chips">
                    {workbench.skills
                      .filter((s) => s.autoInject)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`qext-toggle ${s.enabled ? 'on' : ''}`}
                          onClick={() => {
                            const skills = workbench.skills.map((x) =>
                              x.id === s.id ? { ...x, enabled: !x.enabled } : x,
                            );
                            void handleSaveWorkbench({ ...workbench, skills });
                          }}
                        >
                          <span className={`presence-dot ${s.enabled ? 'idle' : 'offline'}`} />
                          <span>技能：{s.name}</span>
                        </button>
                      ))}
                    {workbench.knowledge.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        className={`qext-toggle ${k.pinned ? 'on' : ''}`}
                        onClick={() => {
                          const knowledge = workbench.knowledge.map((x) =>
                            x.id === k.id ? { ...x, pinned: !x.pinned } : x,
                          );
                          void handleSaveWorkbench({ ...workbench, knowledge });
                        }}
                      >
                        <span className={`presence-dot ${k.pinned ? 'idle' : 'offline'}`} />
                        <span>资料：{k.title}</span>
                      </button>
                    ))}
                    {workbench.plugins
                      .filter((p) => p.kind !== 'cli_tool')
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`qext-toggle ${p.enabled ? 'on' : ''}`}
                          onClick={() => {
                            const plugins = workbench.plugins.map((x) =>
                              x.id === p.id ? { ...x, enabled: !x.enabled } : x,
                            );
                            void handleSaveWorkbench({ ...workbench, plugins });
                          }}
                        >
                          <span className={`presence-dot ${p.enabled ? 'idle' : 'offline'}`} />
                          <span>{p.name}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {showWorkflowPicker && workflow && (
              <div className="wf-picker-popover">
                <div className="thinking-popover-head">
                  <span>选择工作流模板并为各节点指派模型</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="quick-ext-manage-link"
                      onClick={openWorkflowCanvas}
                    >
                      在画布中编排 →
                    </button>
                    <button
                      type="button"
                      className="mini-icon-btn"
                      onClick={() => setShowWorkflowPicker(false)}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Template Chips */}
                <div className="wf-picker-chips">
                  {workflowTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className={`wf-picker-chip ${workflow.id === tpl.id ? 'active' : ''}`}
                      onClick={() => void handleApplyWorkflowTemplate(tpl.id)}
                      title={tpl.description}
                    >
                      <span>{tpl.name}</span>
                      <span className="wf-picker-steps">{tpl.workflow.nodes.length}步</span>
                    </button>
                  ))}
                </div>

                {/* Per-Node Model Assignment right inside the task launcher! */}
                <div className="wf-picker-nodes">
                  {workflow.nodes
                    .filter((n) => n.kind !== 'human_input' && n.enabled !== false)
                    .map((node, idx) => {
                      const isGate = node.kind === 'human_gate';
                      return (
                        <div key={node.id} className="wf-picker-node-row">
                          <span className="wf-picker-node-idx">{idx + 1}</span>
                          <span className="wf-picker-node-title" title={node.subtitle}>
                            {node.title}
                          </span>
                          {isGate ? (
                            <span className="sf-human-tag">人工拍板</span>
                          ) : (
                            <select
                              className={`sf-model-select ${!node.providerId ? 'is-unassigned' : ''}`}
                              style={{ maxWidth: 150 }}
                              value={node.providerId || ''}
                              onChange={(e) =>
                                void handleSaveNode({ ...node, providerId: e.target.value })
                              }
                            >
                              <option value="">选择模型（自动）</option>
                              {combinedProviders.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.shortName}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                </div>

                <div className="wf-picker-foot">
                  <span className="wf-picker-hint">
                    {input.trim() || pendingAttachments.length > 0
                      ? '就绪：点击右侧按钮立刻按此模板执行'
                      : '请先在下方聊天框输入任务需求'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    disabled={!input.trim() && pendingAttachments.length === 0}
                    onClick={() => {
                      setShowWorkflowPicker(false);
                      void handleSend('workflow');
                    }}
                  >
                    <Play size={11} />
                    按此模板启动
                  </button>
                </div>
              </div>
            )}

            {showThinkingMenu && activeMembers.length > 0 && (
              <div className="thinking-popover">
                <div className="thinking-popover-head">
                  <span>各模型思考程度（即时生效）</span>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    onClick={() => setShowThinkingMenu(false)}
                  >
                    ×
                  </button>
                </div>
                {activeMembers.map((m) => (
                  <div key={m.id} className="thinking-row">
                    <div className="thinking-member">
                      <MemberAvatar
                        name={m.name}
                        avatar={m.avatar}
                        color={m.color}
                        size={18}
                        radius={5}
                      />
                      <span className="thinking-member-name">{m.name}</span>
                    </div>
                    <div className="thinking-seg">
                      {m.thinkingOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          title={opt.label}
                          className={m.thinkingLevel === opt.value ? 'active' : ''}
                          onClick={() => void handleSetThinkingLevel(m, opt.value)}
                        >
                          {opt.shortLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showRelayMenu && (
              <div className="relay-popover">
                <div className="thinking-popover-head">
                  <span>AI 互聊自动接力轮数</span>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    onClick={() => setShowRelayMenu(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="relay-presets">
                  {[
                    { value: 0, label: '关闭 (单轮)' },
                    { value: 2, label: '2 轮' },
                    { value: 4, label: '4 轮' },
                    { value: 6, label: '6 轮' },
                    { value: 10, label: '10 轮' },
                    { value: -1, label: '∞ 无限' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`relay-preset-btn ${autoRelayRounds === opt.value ? 'active' : ''} ${opt.value === -1 ? 'is-infinite' : ''}`}
                      onClick={() => {
                        setAutoRelayRounds(opt.value);
                        flash(
                          opt.value === -1
                            ? '已开启 ∞ 无限互聊接力（可随时点红色停止按钮叫停）'
                            : opt.value === 0
                              ? '已关闭 AI 自动互聊接力（单轮模式）'
                              : `已设置 AI 自动互聊上限：${opt.value} 轮`,
                        );
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="relay-custom-row">
                  <span className="relay-custom-label">自定义轮数</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    className="relay-custom-input"
                    value={customRelayInput}
                    onChange={(e) => setCustomRelayInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const n = Math.floor(Number(customRelayInput));
                        if (Number.isFinite(n) && n >= 1 && n <= 999) {
                          setAutoRelayRounds(n);
                          flash(`已设置 AI 自动互聊上限：${n} 轮`);
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ height: 26, fontSize: 11 }}
                    onClick={() => {
                      const n = Math.floor(Number(customRelayInput));
                      if (Number.isFinite(n) && n >= 1 && n <= 999) {
                        setAutoRelayRounds(n);
                        flash(`已设置 AI 自动互聊上限：${n} 轮`);
                      } else {
                        flash('请输入 1 到 999 之间的整数');
                      }
                    }}
                  >
                    应用
                  </button>
                </div>
                <div className="relay-hint-note">
                  {autoRelayRounds === -1
                    ? '⚡ 无限模式：模型只要在回复中互相 @对方就会持续接力，直到不再 @任何人，或随时点击右下角红色「停止」按钮立刻叫停。'
                    : autoRelayRounds > 0
                      ? `模型回复正文里 @其他在线成员 时自动接力下一轮（最多 ${autoRelayRounds} 轮），对话期间可随时点停止中断。`
                      : '当前为单轮模式：仅响应你发送的消息，AI 之间不会自动接力。'}
                </div>
              </div>
            )}

            {pendingAttachments.length > 0 && (
              <div className="composer-attachments">
                {pendingAttachments.map((att) => {
                  const isImg = Boolean(att.mimeType?.startsWith('image/') && att.url);
                  return (
                    <div
                      key={att.id}
                      className={`att-card ${isImg ? 'is-image' : 'is-file'}`}
                      title={att.savedPath || att.name}
                      onClick={() => setPreviewAttachment(att)}
                    >
                      {isImg ? (
                        <img src={att.url} alt={att.name} className="att-card-img" />
                      ) : (
                        <>
                          <div className="att-card-top">
                            <span className="att-ext-pill">{getFileExtBadge(att.name)}</span>
                            <span className="att-size">{formatFileSize(att.size)}</span>
                          </div>
                          <div className="att-card-name">{att.name}</div>
                        </>
                      )}
                      <button
                        type="button"
                        className="att-card-remove"
                        title="移除附件"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingAttachments((prev) => prev.filter((x) => x.id !== att.id));
                        }}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <textarea
              ref={textareaRef}
              className="studio-textarea"
              rows={2}
              placeholder="输入 @ 点名模型，输入 / 唤起技能，点击左下角 + 或拖拽上传附件"
              value={input}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  e.preventDefault();
                  void handleAttachFiles(files);
                }
              }}
              onChange={(e) => {
                const nextVal = e.target.value;
                syncTargetsFromInputText(input, nextVal);
                setInput(nextVal);
                detectMentionQuery(nextVal, e.target.selectionStart);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (slashQuery !== null && slashSkillCandidates.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % slashSkillCandidates.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex((i) => (i - 1 + slashSkillCandidates.length) % slashSkillCandidates.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    e.stopPropagation();
                    const picked = slashSkillCandidates[slashIndex] || slashSkillCandidates[0];
                    if (picked) applySlashCandidate(picked);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSlashQuery(null);
                    return;
                  }
                }
                if (mentionQuery !== null && mentionCandidates.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    e.stopPropagation();
                    insertMentionFromPopup(mentionCandidates[mentionIndex] || mentionCandidates[0]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionQuery(null);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend('chat');
                }
              }}
            />

            <div className="studio-composer-bar">
              <div className="studio-mentions">
                <button
                  type="button"
                  className={`composer-plus-btn ${attachMenuMode !== 'closed' ? 'active' : ''}`}
                  disabled={uploadingFiles}
                  onClick={() => {
                    setAttachMenuMode((m) => (m === 'closed' ? 'menu' : 'closed'));
                    setShowQuickExtMenu(false);
                    setShowThinkingMenu(false);
                  }}
                  title="添加附件：上传文件/图片、引用工作区文件或粘贴代码片段"
                >
                  {uploadingFiles ? <Loader2 size={14} className="spin" /> : <Plus size={15} />}
                </button>
                {totalConnectedCount === 0 ? (
                  <button
                    type="button"
                    className="at-pill"
                    onClick={() => setShowInvite(true)}
                  >
                    <UserPlus size={11} />
                    先邀请模型入群或配置 API
                  </button>
                ) : (
                  <>
                    {totalConnectedCount > 1 && (
                      <button
                        type="button"
                        className={`at-pill ${allTargetsSelected ? 'active' : ''}`}
                        onClick={toggleAllTargets}
                        title={allTargetsSelected ? '再次点击取消全选' : '选中全部在线模型'}
                      >
                        @全员
                      </button>
                    )}
                    {activeMembers.map((m) => {
                      const active = selectedTargets.includes(m.id);
                      const implied = Boolean(impliedTargets?.ids.includes(m.id));
                      const isWorking = m.presence === 'working';
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`at-pill ${active ? 'active' : ''} ${implied ? 'is-implied' : ''} ${isWorking ? 'is-working' : ''}`}
                          onClick={() => handlePillClick(m.id, m.name)}
                          title={
                            active
                              ? `${m.name}（已点名 · 再点一次取消 @${m.name}）`
                              : `${m.name}（${isWorking ? '工作中' : '在线 · 空闲'} · 点击在聊天框插入 @${m.name}）`
                          }
                        >
                          <MemberAvatar
                            name={m.name}
                            avatar={m.avatar}
                            color={m.color}
                            size={15}
                            radius={4}
                          />
                          <span>{m.name}</span>
                          {isWorking ? (
                            <span className="pill-working-badge">
                              <span className="presence-dot working" />
                              工作中
                            </span>
                          ) : (
                            <span className="presence-dot idle" title="在线 · 空闲" />
                          )}
                        </button>
                      );
                    })}
                    {impliedTargets && (
                      <span className="send-target-hint" title="不点选、不 @ 时，消息会发给这些成员">
                        默认发给 {impliedTargetNames}
                        {impliedTargets.reason === 'last' ? '（上次对话）' : '（唯一在线）'}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="studio-send-group">
                <button
                  type="button"
                  className={`workflow-pill-btn ${showQuickExtMenu ? 'active' : ''}`}
                  onClick={() => {
                    setShowQuickExtMenu((v) => !v);
                    setShowThinkingMenu(false);
                    setShowRelayMenu(false);
                    setShowWorkflowPicker(false);
                    setAttachMenuMode('closed');
                  }}
                  title="随手调用技能、运行插件或开关全局资料注入（也可在输入框打 / 唤起）"
                >
                  <Blocks size={13} />
                  <span>扩展</span>
                </button>
                {activeMembers.length > 0 && (
                  <button
                    type="button"
                    className={`workflow-pill-btn ${showThinkingMenu ? 'active' : ''}`}
                    onClick={() => {
                      setShowThinkingMenu((v) => !v);
                      setShowQuickExtMenu(false);
                      setShowRelayMenu(false);
                      setShowWorkflowPicker(false);
                      setAttachMenuMode('closed');
                    }}
                    title="快捷调节各个模型的思考深度"
                  >
                    <Brain size={13} />
                    <span>思考</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`workflow-pill-btn relay-pill-btn ${showRelayMenu ? 'active' : ''} ${autoRelayRounds === -1 ? 'is-infinite' : autoRelayRounds > 0 ? 'is-enabled' : ''}`}
                  onClick={() => {
                    setShowRelayMenu((v) => !v);
                    setShowQuickExtMenu(false);
                    setShowThinkingMenu(false);
                    setShowWorkflowPicker(false);
                    setAttachMenuMode('closed');
                  }}
                  title="设置 AI 之间 @点名 自动互聊接力轮数（支持关闭 / 自定义 / ∞ 无限）"
                >
                  <Repeat size={13} />
                  <span>
                    {autoRelayRounds === -1
                      ? '互聊 ∞'
                      : autoRelayRounds > 0
                        ? `互聊 ${autoRelayRounds}轮`
                        : '互聊 关'}
                  </span>
                </button>
                {isRunning ? (
                  <button
                    type="button"
                    className="send-circle stop"
                    title="停止当前回复 / 立刻中断互聊接力"
                    onClick={handleAbort}
                  >
                    <Square size={12} fill="currentColor" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`workflow-pill-btn ${showWorkflowPicker ? 'active' : ''}`}
                      onClick={() => {
                        setShowWorkflowPicker((v) => !v);
                        setShowQuickExtMenu(false);
                        setShowThinkingMenu(false);
                        setShowRelayMenu(false);
                        setAttachMenuMode('closed');
                      }}
                      title="选择工作流模板、指定各节点模型并启动板块流程"
                    >
                      <GitBranch size={13} />
                      <span>按板块跑</span>
                    </button>
                    <button
                      type="button"
                      className="send-circle"
                      disabled={!input.trim() && pendingAttachments.length === 0}
                      title="发送给选中的模型 (Enter)"
                      onClick={() => void handleSend('chat')}
                    >
                      <ArrowUp size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </footer>
      </div>

      {showProjectWorkspace && (
        <>
          {!canvasFullscreen && (
            <div
              className={`canvas-split-resizer ${isResizingCanvas ? 'is-dragging' : ''}`}
              onMouseDown={handleStartCanvasResize}
              title="左右拖动调整聊天与工作区分屏宽度"
            />
          )}
          <div
            className={`canvas-pane-shell ${canvasFullscreen ? 'is-fullscreen' : ''}`}
            style={canvasFullscreen ? undefined : { width: canvasWidthPx }}
          >
            <WorkspacePane
              repoPath={repoPath}
              isFullscreen={canvasFullscreen}
              onToggleFullscreen={() => setCanvasFullscreen((v) => !v)}
              onClose={closeRightSplitPane}
              onChangeRepoPath={(nextPath) => {
                setRepoPath(nextPath);
                flash(`已切换工作区：${nextPath}`);
              }}
              onPickFolderDesktop={handlePickFolder}
              onAttachFileToChat={handleAttachWorkspaceFile}
              onInsertPromptToChat={(text) => {
                setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
                focusTextareaAtEnd();
              }}
              onToast={flash}
            />
          </div>
        </>
      )}

      {showCanvas && workflow && (
        <>
          {!canvasFullscreen && (
            <div
              className={`canvas-split-resizer ${isResizingCanvas ? 'is-dragging' : ''}`}
              onMouseDown={handleStartCanvasResize}
              title="左右拖动调整聊天与画布分屏宽度"
            />
          )}
          <div
            className={`canvas-pane-shell ${canvasFullscreen ? 'is-fullscreen' : ''}`}
            style={canvasFullscreen ? undefined : { width: canvasWidthPx }}
          >
            <WorkflowTemplateCanvas
              workflow={workflow}
              workflowTemplates={workflowTemplates}
              providers={combinedProviders}
              run={activeRun}
              theme={theme}
              isFullscreen={canvasFullscreen}
              onToggleFullscreen={() => setCanvasFullscreen((v) => !v)}
              onClose={closeRightSplitPane}
              onSaveWorkflow={handleSaveWorkflow}
              onSaveNode={handleSaveNode}
              onApplyTemplate={handleApplyWorkflowTemplate}
              onSaveAsTemplate={handleSaveAsWorkflowTemplate}
              onDeleteTemplate={handleDeleteWorkflowTemplate}
              onRunWorkflow={(promptText) => void handleSend('workflow', promptText)}
              onRerunFromNode={handleRerunFromNode}
              onOpenApproval={() => setShowApproval(true)}
              onExportMarkdown={handleExportMarkdown}
              onArchiveOutputToKnowledge={handleArchiveTextToKnowledge}
              hasComposerInput={Boolean(input.trim() || pendingAttachments.length > 0)}
            />
          </div>
        </>
      )}

      {showWorkspace && workflow && (
        <TaskWorkspaceDrawer
          workflow={workflow}
          workflowTemplates={workflowTemplates}
          providers={combinedProviders}
          run={activeRun}
          activeTab={workspaceTab}
          onChangeTab={setWorkspaceTab}
          onClose={() => setShowWorkspace(false)}
          onSaveNode={handleSaveNode}
          onSaveWorkflow={handleSaveWorkflow}
          onApplyTemplate={handleApplyWorkflowTemplate}
          onSaveAsTemplate={handleSaveAsWorkflowTemplate}
          onDeleteTemplate={handleDeleteWorkflowTemplate}
          onRerunFromNode={handleRerunFromNode}
          onOpenApproval={() => setShowApproval(true)}
          onAddMaterial={handleAddMaterial}
          onDeleteMaterial={handleDeleteMaterial}
          onExportMarkdown={handleExportMarkdown}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

      {confirmRealMode && (
        <div className="modal-backdrop" onClick={() => setConfirmRealMode(false)}>
          <div className="modal confirm-real-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>切换到真实模式？</h2>
            </div>
            <div className="modal-body">
              <p>真实模式下，这个会话里发出的消息和工作流会调用你配置的订阅 CLI 或 API，可能产生费用。</p>
              <p className="confirm-real-note">
                只对当前会话「{activeRun?.title || '新协作会话'}」生效，随时可以切回模拟。
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-sm" onClick={() => setConfirmRealMode(false)}>
                保持模拟
              </button>
              <button
                type="button"
                className="btn btn-ink btn-sm"
                onClick={() => {
                  setExecutionMode('real');
                  setConfirmRealMode(false);
                }}
              >
                切换到真实
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvite && (
        <InviteAgentModal
          roomId={activeRun?.id || ''}
          agents={connectedAgents}
          onClose={() => setShowInvite(false)}
          onRenameAgent={handleRenameAgent}
          onDeleteAgent={handleDeleteAgent}
        />
      )}

      {showTroubleshoot && (
        <TroubleshootModal
          agents={connectedAgents}
          onClose={() => setShowTroubleshoot(false)}
          onOpenProviders={() => setShowProviders(true)}
          onStopStandby={async (agentId, name) => {
            await api.stopAgentStandby(agentId);
            flash(`已通知「${name}」退出待命监听`);
          }}
          onDetectCli={async (agentId) => {
            const res = await api.detectAgentCli(agentId);
            flash(res.message);
          }}
          onToast={flash}
        />
      )}

      {showProviders && (
        <ProvidersModal
          providers={providers}
          onClose={() => setShowProviders(false)}
          onSaved={(updated) => {
            setProviders(updated);
            void refreshProviderHealth();
            flash('已保存模型池');
          }}
        />
      )}

      {showApproval && activeRun && workflow && (
        <ApprovalModal
          run={activeRun}
          workflow={workflow}
          providers={combinedProviders}
          onClose={() => setShowApproval(false)}
          onSubmit={handleApproval}
        />
      )}

      {editingMember && (() => {
        const matchedProv =
          editingMember.kind === 'provider'
            ? providers.find((p) => p.id === editingMember.id)
            : undefined;
        const matchedAgent =
          editingMember.kind === 'agent'
            ? connectedAgents.find((a) => a.id === editingMember.id)
            : undefined;
        const isClaudeCli = Boolean(matchedProv?.command?.toLowerCase().includes('claude'));
        const isDirectApi = Boolean(matchedProv?.apiKey?.trim());
        const isCreditsClient =
          Boolean(matchedAgent?.relayName?.toLowerCase().includes('workbuddy')) ||
          editingMember.id.includes('deepseek') ||
          editingMember.name.toLowerCase().includes('workbuddy');
        const channelTag = isDirectApi
          ? '直连 API · 官方精确计数'
          : isClaudeCli
            ? 'Claude 订阅制 · 官方 JSON 精确计数'
            : isCreditsClient
              ? 'WorkBuddy 积分制'
              : matchedAgent?.lastBridgeAt
                ? 'AWS Quick 订阅制 · 文件桥接'
                : editingMember.kind === 'agent'
                  ? '订阅制桌面端'
                  : '本地订阅 CLI';
        const defaultQuotaMode = isDirectApi
          ? 'tokens'
          : isCreditsClient
            ? 'credits'
            : 'subscription';
        const memberWithMeta: EditableMember = {
          ...editingMember,
          hasApiKey: isDirectApi,
          channelTag,
          defaultQuotaMode,
        };
        return (
          <MemberProfileModal
            member={memberWithMeta}
            usage={memberUsage[editingMember.id]}
            onClose={() => setEditingMember(null)}
            onSave={(payload) => handleSaveMemberProfile(editingMember, payload)}
            onToggleOnline={(nextOnline) =>
              handleToggleMemberOnline(editingMember, nextOnline)
            }
            onSaveQuota={async (quotaPatch: Partial<MemberQuotaConfig>) => {
              const { usage } = await api.updateMemberQuota(editingMember.id, quotaPatch);
              setMemberUsage(usage);
            }}
            onResetUsage={async () => {
              const { usage } = await api.resetMemberUsage(editingMember.id);
              setMemberUsage(usage);
            }}
            onRefreshBalance={async () => {
              const res = await api.refreshMemberBalance(editingMember.id);
              if (res.usage) setMemberUsage(res.usage);
              return res;
            }}
          />
        );
      })()}

      {workbenchTab && (
        <WorkbenchModal
          workbench={workbench}
          initialTab={workbenchTab}
          repoPath={repoPath}
          activeRoomId={activeRun?.id || ''}
          onClose={() => setWorkbenchTab(null)}
          onSaveWorkbench={handleSaveWorkbench}
          onTestPlugin={handleTestPlugin}
          onRunSchedule={handleRunSchedule}
          onInsertPrompt={(text, mode, sendImmediately) => {
            if (sendImmediately) {
              void handleSend(mode || 'chat', text);
            } else {
              setInput(text);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }
          }}
        />
      )}
      {previewAttachment && (
        <div className="modal-backdrop" onClick={() => setPreviewAttachment(null)}>
          <div
            className="modal"
            style={{ maxWidth: previewAttachment.mimeType?.startsWith('image/') ? 760 : 620 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {previewAttachment.mimeType?.startsWith('image/') ? (
                  <ImageIcon size={15} />
                ) : (
                  <FileText size={15} />
                )}
                <h2 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {previewAttachment.name}
                </h2>
                <span className="wb-mini-tag">{formatFileSize(previewAttachment.size)}</span>
              </div>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => setPreviewAttachment(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ textAlign: previewAttachment.mimeType?.startsWith('image/') ? 'center' : 'left' }}>
              {previewAttachment.mimeType?.startsWith('image/') && previewAttachment.url ? (
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.name}
                  className="lightbox-img"
                />
              ) : previewAttachment.textContent ? (
                <pre className="att-preview-code">{previewAttachment.textContent}</pre>
              ) : (
                <div className="invite-empty">
                  该文件为二进制格式，已保存在本地路径：<code>{previewAttachment.savedPath || previewAttachment.name}</code>，发送后本地模型可直接读取。
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
