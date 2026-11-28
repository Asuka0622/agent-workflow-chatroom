import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesDelete,
  type OnNodesDelete,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Copy,
  Download,
  FileDown,
  FileInput,
  FileText,
  GitBranch,
  GitFork,
  Globe,
  Hand,
  HelpCircle,
  Layers,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  SkipForward,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import type {
  NodeExecutionState,
  NodeKind,
  ProviderConfig,
  WorkflowDefinition,
  WorkflowEdgeConfig,
  WorkflowNodeConfig,
  WorkflowPresetTemplate,
  WorkflowRun,
} from '../../shared/types';
import { MarkdownView } from './MarkdownView';
import { useI18n } from '../i18n';

type CanvasTab = 'canvas' | 'artifacts';

interface CanvasNodeData extends Record<string, unknown> {
  config: WorkflowNodeConfig;
  state?: NodeExecutionState;
  nowTick?: number;
  flowHint?: { label: string; tone: 'parallel' | 'merge' | 'chain' };
  providers: ProviderConfig[];
  selected: boolean;
  onQuickModelChange: (nodeId: string, providerId: string) => void;
  onQuickToggleEnabled: (nodeId: string) => void;
  onQuickAddChild: (parentId: string) => void;
  onOpenArtifact: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

const NODE_WIDTH = 252;
const H_GAP = 58;
const V_GAP = 156;

/** Compute a clean top-down layered DAG layout (centers parallel siblings automatically) */
function computeAutoLayout(nodes: WorkflowNodeConfig[]): Record<string, { x: number; y: number }> {
  const depthMap = new Map<string, number>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const getDepth = (id: string, visiting = new Set<string>()): number => {
    if (depthMap.has(id)) return depthMap.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = nodeMap.get(id);
    if (!n || !n.dependsOn || n.dependsOn.length === 0) {
      depthMap.set(id, 0);
      return 0;
    }
    let maxParent = -1;
    for (const dep of n.dependsOn) {
      if (nodeMap.has(dep)) {
        maxParent = Math.max(maxParent, getDepth(dep, new Set(visiting)));
      }
    }
    const d = maxParent + 1;
    depthMap.set(id, d);
    return d;
  };

  for (const n of nodes) {
    getDepth(n.id);
  }

  const layers = new Map<number, WorkflowNodeConfig[]>();
  for (const n of nodes) {
    const d = depthMap.get(n.id) ?? 0;
    const arr = layers.get(d) || [];
    arr.push(n);
    layers.set(d, arr);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const sortedDepths = Array.from(layers.keys()).sort((a, b) => a - b);
  const centerX = 360;

  for (const d of sortedDepths) {
    const group = layers.get(d)!;
    const totalWidth = group.length * NODE_WIDTH + (group.length - 1) * H_GAP;
    const startX = Math.round(centerX - totalWidth / 2);
    group.forEach((n, idx) => {
      positions[n.id] = {
        x: startX + idx * (NODE_WIDTH + H_GAP),
        y: 36 + d * V_GAP,
      };
    });
  }
  return positions;
}

function needsPixelLayout(nodes: WorkflowNodeConfig[]): boolean {
  if (nodes.length <= 1) return false;
  const maxCoord = Math.max(
    ...nodes.map((n) => Math.max(Math.abs(n.position?.x ?? 0), Math.abs(n.position?.y ?? 0))),
  );
  return maxCoord < 24;
}

function wouldCreateCycle(
  nodes: WorkflowNodeConfig[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  const visited = new Set<string>();
  const stack = [source];
  const depMap = new Map(nodes.map((n) => [n.id, n.dependsOn || []]));
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const parent of depMap.get(cur) || []) {
      stack.push(parent);
    }
  }
  return false;
}

function buildEdgesFromNodes(
  nodes: WorkflowNodeConfig[],
  prevEdges: WorkflowEdgeConfig[] = [],
): WorkflowEdgeConfig[] {
  const validIds = new Set(nodes.map((n) => n.id));
  const prevMap = new Map<string, WorkflowEdgeConfig>();
  for (const e of prevEdges) {
    prevMap.set(`${e.source}__${e.target}`, e);
  }

  const edges: WorkflowEdgeConfig[] = [];
  let i = 1;
  for (const n of nodes) {
    for (const dep of n.dependsOn || []) {
      if (validIds.has(dep) && dep !== n.id) {
        const existing = prevMap.get(`${dep}__${n.id}`);
        edges.push({
          id: existing?.id || `e_${dep}__${n.id}_${i++}`,
          source: dep,
          target: n.id,
          sourceHandle: existing?.sourceHandle,
          targetHandle: existing?.targetHandle,
          label: existing?.label,
        });
      }
    }
  }
  return edges;
}

const KIND_META: Record<NodeKind, { label: string; labelEn: string; color: string }> = {
  human_input: { label: '输入', labelEn: 'Input', color: '#0284c7' },
  llm: { label: 'AI 节点', labelEn: 'AI Node', color: '#8b5cf6' },
  consensus: { label: '汇总投票', labelEn: 'Consensus', color: '#6366f1' },
  debate: { label: '双模型辩论', labelEn: 'Debate', color: '#ec4899' },
  review_loop: { label: '审查循环', labelEn: 'Review Loop', color: '#059669' },
  condition: { label: '条件分支', labelEn: 'Condition', color: '#f59e0b' },
  human_gate: { label: '人工拍板', labelEn: 'Approval', color: '#d97706' },
  delay: { label: '延时等待', labelEn: 'Delay', color: '#64748b' },
  file_read: { label: '读取文件', labelEn: 'Read File', color: '#0ea5e9' },
  file_write: { label: '写入文件', labelEn: 'Write File', color: '#10b981' },
  shell: { label: 'Shell 命令', labelEn: 'Shell Cmd', color: '#475569' },
  http: { label: 'HTTP 请求', labelEn: 'HTTP', color: '#2563eb' },
};

function renderKindIcon(kind: NodeKind, size = 12) {
  switch (kind) {
    case 'human_input':
      return <User size={size} />;
    case 'human_gate':
      return <Hand size={size} />;
    case 'review_loop':
      return <RefreshCw size={size} />;
    case 'consensus':
      return <Scale size={size} />;
    case 'debate':
      return <MessageSquare size={size} />;
    case 'condition':
      return <GitFork size={size} />;
    case 'delay':
      return <Clock size={size} />;
    case 'file_read':
      return <FileInput size={size} />;
    case 'file_write':
      return <FileDown size={size} />;
    case 'http':
      return <Globe size={size} />;
    case 'shell':
      return <Terminal size={size} />;
    default:
      return <Sparkles size={size} />;
  }
}

interface PaletteItem {
  kind: NodeKind;
  mode: 'child' | 'parallel';
  label: string;
  labelEn: string;
  desc: string;
  descEn: string;
}

const NODE_PALETTE_GROUPS: Array<{ title: string; titleEn: string; items: PaletteItem[] }> = [
  {
    title: 'AI 协作节点',
    titleEn: 'AI Collaboration',
    items: [
      { kind: 'llm', mode: 'child', label: 'AI 模型节点', labelEn: 'AI Model Node', desc: '单模型完成分析、编码或文案', descEn: 'Single model for analysis, coding, or writing' },
      { kind: 'llm', mode: 'parallel', label: '并行分支节点', labelEn: 'Parallel Branch', desc: '与当前节点同时跑多视角', descEn: 'Run alongside current node for blind multi-perspective' },
      { kind: 'consensus', mode: 'child', label: '汇总与投票', labelEn: 'Merge & Judge', desc: '对比多路产出并输出唯一结论', descEn: 'Compare upstream outputs and synthesize one decision' },
      { kind: 'debate', mode: 'child', label: '双模型辩论', labelEn: 'Dual-Model Debate', desc: '正反两模型互评质询 N 轮', descEn: 'Two models critique each other for N rounds' },
      { kind: 'review_loop', mode: 'child', label: '审查修复循环', labelEn: 'Review & Fix Loop', desc: '审查找问题 → 自动修复循环', descEn: 'Review finds issues -> fixer patches until pass' },
    ],
  },
  {
    title: '流程控制',
    titleEn: 'Flow Control',
    items: [
      { kind: 'condition', mode: 'child', label: '条件分支 IF/ELSE', labelEn: 'Condition IF/ELSE', desc: '按关键词/正则分流走不同路径', descEn: 'Route by keyword or regex match' },
      { kind: 'human_gate', mode: 'child', label: '人工拍板关', labelEn: 'Human Approval Gate', desc: '暂停等待人工通过或打回重议', descEn: 'Pause for manual approve or reject' },
      { kind: 'delay', mode: 'child', label: '延时等待', labelEn: 'Delay Timer', desc: '暂停指定秒数后再继续下游', descEn: 'Wait N seconds before continuing' },
    ],
  },
  {
    title: '工具与文件读写',
    titleEn: 'Tools & File I/O',
    items: [
      { kind: 'file_read', mode: 'child', label: '读取工作区文件', labelEn: 'Read Workspace Files', desc: '读取本地代码/文档喂给下游', descEn: 'Load local files as upstream context' },
      { kind: 'file_write', mode: 'child', label: '写入本地文件', labelEn: 'Write Local File', desc: '将上游产出自动落盘保存', descEn: 'Save upstream output to disk' },
      { kind: 'shell', mode: 'child', label: 'Shell 命令', labelEn: 'Shell Command', desc: '执行测试、构建或 Git 脚本', descEn: 'Run tests, builds, or Git commands' },
      { kind: 'http', mode: 'child', label: 'HTTP / Webhook', labelEn: 'HTTP / Webhook', desc: '调接口或推送飞书/企微通知', descEn: 'Call APIs or send webhook alerts' },
    ],
  },
];

const MODEL_NODE_KINDS = new Set<NodeKind>(['llm', 'consensus', 'debate', 'review_loop']);

const CanvasStepNode: React.FC<NodeProps<Node<CanvasNodeData>>> = ({ data }) => {
  const { isEn, tr } = useI18n();
  const {
    config,
    state,
    nowTick,
    flowHint,
    providers,
    selected,
    onQuickModelChange,
    onQuickToggleEnabled,
    onQuickAddChild,
    onOpenArtifact,
    onSelectNode,
  } = data;

  const disabled = config.enabled === false;
  const status = disabled ? 'skipped' : state?.status || 'idle';
  const kindMeta = KIND_META[config.kind] || KIND_META.llm;
  const provider = providers.find((p) => p.id === config.providerId);
  const hasOutput = Boolean(state?.output?.trim());
  const isModelNode = MODEL_NODE_KINDS.has(config.kind);
  const isCondition = config.kind === 'condition';
  const runningElapsedSec =
    status === 'running' && state?.startedAt
      ? Math.max(0, Math.floor(((nowTick || Date.now()) - new Date(state.startedAt).getTime()) / 1000))
      : null;
  const latestLogLine =
    state?.logs && state.logs.length > 0 ? state.logs[state.logs.length - 1] : '';

  const statusPill = (() => {
    switch (status) {
      case 'running':
        return {
          icon: <Loader2 size={11} className="spin" />,
          text: `${state?.round ? tr(`第${state.round}轮`, `R${state.round}`) : tr('运行中', 'Running')}${runningElapsedSec !== null ? ` ${runningElapsedSec}s` : ''}`,
          cls: 'is-running',
        };
      case 'waiting_approval':
        return { icon: <Hand size={11} />, text: tr('待拍板', 'Approval'), cls: 'is-waiting' };
      case 'completed':
        return {
          icon: <CheckCircle2 size={11} />,
          text:
            isCondition && state?.branchResult
              ? state.branchResult === 'true'
                ? tr('满足', 'True')
                : tr('不满足', 'False')
              : state?.durationMs !== undefined
                ? `${(state.durationMs / 1000).toFixed(1)}s`
                : tr('完成', 'Done'),
          cls: 'is-done',
        };
      case 'failed':
        return { icon: <AlertCircle size={11} />, text: tr('失败', 'Failed'), cls: 'is-failed' };
      case 'skipped':
        return { icon: <SkipForward size={11} />, text: tr('跳过', 'Skipped'), cls: 'is-skipped' };
      default:
        return { icon: <Circle size={10} />, text: tr('待命', 'Idle'), cls: 'is-idle' };
    }
  })();

  const footerMeta = (() => {
    switch (config.kind) {
      case 'human_input':
        return { icon: <User size={11} />, text: tr('任务起点', 'Task Entry') };
      case 'human_gate':
        return { icon: <Hand size={11} />, text: tr('人工确认关卡', 'Human Gate') };
      case 'condition': {
        const modeText =
          config.conditionMode === 'regex'
            ? tr('正则', 'Regex')
            : config.conditionMode === 'not_contains'
              ? tr('不含', 'Excludes')
              : tr('包含', 'Contains');
        return {
          icon: <GitFork size={11} />,
          text: `${modeText} "${config.conditionPattern || 'PASS'}"`,
        };
      }
      case 'file_read':
        return {
          icon: <FileInput size={11} />,
          text: config.filePaths?.split(/[\r\n,]+/)[0]?.trim() || tr('配置读取路径', 'Set file path'),
        };
      case 'file_write':
        return {
          icon: <FileDown size={11} />,
          text: config.targetFilePath?.trim() || 'output.md',
        };
      case 'http':
        return {
          icon: <Globe size={11} />,
          text: `${config.httpMethod || 'POST'} ${config.httpUrl ? config.httpUrl.replace(/^https?:\/\//, '').slice(0, 18) : tr('配置 URL', 'Set URL')}`,
        };
      case 'delay':
        return {
          icon: <Clock size={11} />,
          text: tr(`等待 ${config.delaySeconds ?? 5} 秒`, `Wait ${config.delaySeconds ?? 5}s`),
        };
      case 'shell':
        return {
          icon: <Terminal size={11} />,
          text: config.shellCommand?.slice(0, 20) || tr('本地命令', 'Local cmd'),
        };
      default:
        return null;
    }
  })();

  return (
    <div
      className={`cc-node status-${status} ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''} ${isCondition ? 'is-condition' : ''}`}
      onClick={() => onSelectNode(config.id)}
    >
      {config.kind !== 'human_input' && (
        <Handle type="target" position={Position.Top} className="cc-handle cc-handle-top" />
      )}

      <div className="cc-node-head">
        <span
          className="cc-kind-badge"
          style={{
            color: kindMeta.color,
            borderColor: `${kindMeta.color}33`,
            background: `${kindMeta.color}12`,
          }}
        >
          {renderKindIcon(config.kind, 11)}
          <span>{isEn ? kindMeta.labelEn : kindMeta.label}</span>
        </span>
        <span className={`cc-status-pill ${statusPill.cls}`}>
          {statusPill.icon}
          <span>{statusPill.text}</span>
        </span>
      </div>

      <div className="cc-node-title" title={config.title}>
        {config.title}
      </div>
      {config.subtitle && (
        <div className="cc-node-sub" title={config.subtitle}>
          {config.subtitle}
        </div>
      )}

      {flowHint && (
        <div className={`cc-node-flow-hint tone-${flowHint.tone}`} title={flowHint.label}>
          {flowHint.label}
        </div>
      )}

      {(status === 'running' || (status === 'failed' && state?.error)) && (
        <div
          className={`cc-node-live-log ${status === 'failed' ? 'is-err' : ''}`}
          title={status === 'failed' ? state?.error : latestLogLine || tr('正在执行节点…', 'Running node…')}
        >
          {status === 'failed'
            ? state?.error
            : latestLogLine ||
              tr(
                `${state?.providerUsed || provider?.shortName || '模型'} 正在处理中…`,
                `${state?.providerUsed || provider?.shortName || 'Model'} working…`,
              )}
        </div>
      )}

      <div className="cc-node-foot">
        {isModelNode ? (
          <div className="cc-model-wrap nodrag nopan" onClick={(e) => e.stopPropagation()}>
            <span
              className="cc-model-dot"
              style={{ background: provider?.accentColor || 'var(--text-muted)' }}
            />
            <select
              className={`cc-model-select ${!config.providerId ? 'is-auto' : ''}`}
              value={config.providerId || ''}
              onChange={(e) => onQuickModelChange(config.id, e.target.value)}
              title={tr('为当前画布节点指派模型', 'Assign model to this node')}
            >
              <option value="">{tr('自动选择模型', 'Auto Model')}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.shortName}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="cc-human-chip" title={footerMeta?.text}>
            {footerMeta?.icon}
            <span className="cc-human-chip-text">{footerMeta?.text}</span>
          </span>
        )}

        <div className="cc-node-quick-ops nodrag nopan" onClick={(e) => e.stopPropagation()}>
          {hasOutput && (
            <button
              type="button"
              className="cc-mini-btn accent"
              title={tr('查看本节点产出预览', 'Preview node output')}
              onClick={() => onOpenArtifact(config.id)}
            >
              <FileText size={11} />
            </button>
          )}
          {config.kind !== 'human_input' && (
            <button
              type="button"
              className="cc-mini-btn"
              title={disabled ? tr('启用该节点', 'Enable node') : tr('跳过该节点', 'Skip node')}
              onClick={() => onQuickToggleEnabled(config.id)}
            >
              <SkipForward size={11} />
            </button>
          )}
          <button
            type="button"
            className="cc-mini-btn"
            title={tr('在此节点后追加下游节点', 'Append downstream node')}
            onClick={() => onQuickAddChild(config.id)}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {isCondition ? (
        <>
          <div className="cc-cond-handle-labels">
            <span className="is-true">{tr('满足', 'True')}</span>
            <span className="is-false">{tr('不满足', 'False')}</span>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="cc-handle cc-handle-true"
            style={{ left: '28%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="cc-handle cc-handle-false"
            style={{ left: '72%' }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="cc-handle cc-handle-bottom" />
      )}
    </div>
  );
};

const nodeTypes = {
  canvasStep: CanvasStepNode,
};

export interface WorkflowTemplateCanvasProps {
  workflow: WorkflowDefinition;
  workflowTemplates: WorkflowPresetTemplate[];
  providers: ProviderConfig[];
  run: WorkflowRun | null;
  theme: 'light' | 'dark';
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onSaveWorkflow: (updated: WorkflowDefinition, toastMsg?: string) => Promise<void>;
  onSaveNode: (updated: WorkflowNodeConfig) => Promise<void>;
  onApplyTemplate: (templateId: string) => Promise<void>;
  onSaveAsTemplate: (name: string, description: string) => Promise<void>;
  onCreateBlankCanvas?: () => Promise<void>;
  onDeleteTemplate: (templateId: string) => Promise<void>;
  onAutoAssignModels?: () => Promise<void>;
  onGenerateWorkflow?: (prompt: string, generatorId?: string) => Promise<void>;
  onCancelGenerateWorkflow?: () => void;
  aiGeneratorOptions?: Array<{ id: string; label: string; group: 'agent' | 'api' }>;
  aiGeneratorId?: string;
  onChangeAiGeneratorId?: (id: string) => void;
  onRunWorkflow: (promptText?: string, dryRun?: boolean) => void;
  onAbortWorkflow?: () => void;
  onRerunFromNode: (nodeId: string) => void;
  onOpenApproval: () => void;
  onExportMarkdown: () => Promise<void>;
  onArchiveOutputToKnowledge?: (title: string, content: string) => Promise<void>;
  hasComposerInput: boolean;
}

const InnerWorkflowCanvas: React.FC<WorkflowTemplateCanvasProps> = ({
  workflow,
  workflowTemplates,
  providers,
  run,
  theme,
  isFullscreen,
  onToggleFullscreen,
  onClose,
  onSaveWorkflow,
  onSaveNode,
  onApplyTemplate,
  onSaveAsTemplate,
  onCreateBlankCanvas,
  onDeleteTemplate,
  onAutoAssignModels,
  onGenerateWorkflow,
  onCancelGenerateWorkflow,
  aiGeneratorOptions = [],
  aiGeneratorId = 'auto',
  onChangeAiGeneratorId,
  onRunWorkflow,
  onAbortWorkflow,
  onRerunFromNode,
  onOpenApproval,
  onExportMarkdown,
  onArchiveOutputToKnowledge,
  hasComposerInput,
}) => {
  const { isEn, tr } = useI18n();
  const { fitView } = useReactFlow();
  const [activeTab, setActiveTab] = useState<CanvasTab>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [copiedArtifact, setCopiedArtifact] = useState(false);
  const [showNodePalette, setShowNodePalette] = useState(false);

  // Save-as-template inline popover
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplNameDraft, setTplNameDraft] = useState('');
  const [tplDescDraft, setTplDescDraft] = useState('');

  // Quick inline run prompt
  const [showQuickRunPrompt, setShowQuickRunPrompt] = useState(false);
  const [quickRunText, setQuickRunText] = useState('');

  // AI workflow generator bar + JSON import ref + compact usage guide
  const [showAiBar, setShowAiBar] = useState(false);
  const [showUsageGuide, setShowUsageGuide] = useState(false);
  const [aiPromptText, setAiPromptText] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const jsonImportRef = useRef<HTMLInputElement | null>(null);

  // Live 1s elapsed timer while any workflow node is running
  const hasRunningWorkflowNode = useMemo(
    () =>
      run?.status === 'running' ||
      workflow.nodes.some((n) => run?.nodes[n.id]?.status === 'running'),
    [run, workflow.nodes],
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunningWorkflowNode) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRunningWorkflowNode]);

  // Inspector local drafts
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftShellCmd, setDraftShellCmd] = useState('');
  const [draftCondPattern, setDraftCondPattern] = useState('');
  const [draftFilePaths, setDraftFilePaths] = useState('');
  const [draftTargetFile, setDraftTargetFile] = useState('');
  const [draftHttpUrl, setDraftHttpUrl] = useState('');
  const [draftHttpHeaders, setDraftHttpHeaders] = useState('');
  const [draftHttpBody, setDraftHttpBody] = useState('');

  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;

  const activeTemplate = useMemo(
    () => workflowTemplates.find((t) => t.id === workflow.id),
    [workflowTemplates, workflow.id],
  );

  const selectedNode = useMemo(
    () => workflow.nodes.find((n) => n.id === selectedNodeId) || null,
    [workflow.nodes, selectedNodeId],
  );

  useEffect(() => {
    if (!selectedNode) return;
    setDraftTitle(selectedNode.title || '');
    setDraftSubtitle(selectedNode.subtitle || '');
    setDraftPrompt(selectedNode.promptTemplate || '');
    setDraftShellCmd(selectedNode.shellCommand || '');
    setDraftCondPattern(selectedNode.conditionPattern || 'PASS');
    setDraftFilePaths(selectedNode.filePaths || '');
    setDraftTargetFile(selectedNode.targetFilePath || '');
    setDraftHttpUrl(selectedNode.httpUrl || '');
    setDraftHttpHeaders(selectedNode.httpHeaders || '');
    setDraftHttpBody(selectedNode.httpBody || '');
  }, [
    selectedNode?.id,
    selectedNode?.title,
    selectedNode?.subtitle,
    selectedNode?.promptTemplate,
    selectedNode?.shellCommand,
    selectedNode?.conditionPattern,
    selectedNode?.filePaths,
    selectedNode?.targetFilePath,
    selectedNode?.httpUrl,
    selectedNode?.httpHeaders,
    selectedNode?.httpBody,
  ]);

  const resolvedPositions = useMemo(() => {
    if (needsPixelLayout(workflow.nodes)) {
      return computeAutoLayout(workflow.nodes);
    }
    const map: Record<string, { x: number; y: number }> = {};
    for (const n of workflow.nodes) {
      map[n.id] = { x: n.position?.x ?? 120, y: n.position?.y ?? 60 };
    }
    return map;
  }, [workflow.nodes]);

  const handleQuickModelChange = useCallback(
    (nodeId: string, providerId: string) => {
      const target = workflowRef.current.nodes.find((n) => n.id === nodeId);
      if (!target) return;
      void onSaveNode({ ...target, providerId });
    },
    [onSaveNode],
  );

  const handleQuickToggleEnabled = useCallback(
    (nodeId: string) => {
      const target = workflowRef.current.nodes.find((n) => n.id === nodeId);
      if (!target) return;
      void onSaveNode({ ...target, enabled: target.enabled === false });
    },
    [onSaveNode],
  );

  const handleOpenArtifact = useCallback((nodeId: string) => {
    setSelectedArtifactId(nodeId);
    setActiveTab('artifacts');
  }, []);

  const addNodeToCanvas = useCallback(
    async (kind: NodeKind, mode: 'child' | 'parallel', anchorNodeId?: string) => {
      const wf = workflowRef.current;
      const anchor =
        wf.nodes.find((n) => n.id === anchorNodeId) ||
        wf.nodes.find((n) => n.id === selectedNodeId) ||
        wf.nodes[wf.nodes.length - 1];

      const id = `stage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      const basePositions = needsPixelLayout(wf.nodes)
        ? computeAutoLayout(wf.nodes)
        : Object.fromEntries(wf.nodes.map((n) => [n.id, n.position]));

      const anchorPos = (anchor && basePositions[anchor.id]) || { x: 240, y: 40 };
      const dependsOn =
        mode === 'parallel' && anchor && anchor.dependsOn.length > 0
          ? [...anchor.dependsOn]
          : anchor
            ? [anchor.id]
            : [];

      const newPos =
        mode === 'parallel'
          ? { x: anchorPos.x + NODE_WIDTH + H_GAP, y: anchorPos.y }
          : { x: anchorPos.x, y: anchorPos.y + V_GAP };

      const defaults: Record<NodeKind, Partial<WorkflowNodeConfig>> = {
        human_input: { title: '需求输入', subtitle: '工作流起点', providerId: 'human', lane: 'human' },
        llm: {
          title: mode === 'parallel' ? '并行专家视角' : 'AI 协作节点',
          subtitle: '结合需求与上游产出完成本阶段工作',
          providerId: '',
          lane: 'claude',
          promptTemplate:
            '你是当前阶段负责专家（当前模型：{{providerName}}）。请结合原始需求与上游阶段产出，高质量完成本阶段任务。\n\n【用户需求】\n{{requirement}}\n\n【前序产出】\n{{previousOutput}}',
        },
        consensus: {
          title: '多模型汇总与投票',
          subtitle: '对比上游各路输出，打分并给出唯一采纳结论',
          providerId: '',
          lane: 'claude',
          promptTemplate:
            '你是多模型汇总与投票裁判（当前模型：{{providerName}}）。请对比上游各路模型的输出，按「共识点 / 分歧点 / 评分对比表 / 最终采纳结论」输出综合方案。\n\n【用户需求】\n{{requirement}}\n\n【上游各路方案】\n{{previousOutput}}',
        },
        debate: {
          title: '双模型互评辩论',
          subtitle: '正反双方交替质询多轮，收敛更优解',
          providerId: '',
          fixProviderId: '',
          maxRounds: 2,
          lane: 'gemini',
        },
        review_loop: {
          title: '审查与自动修复循环',
          subtitle: '审查找问题 → 修复模型改 → 循环至通过',
          providerId: '',
          fixProviderId: '',
          maxRounds: 2,
          lane: 'codex',
          promptTemplate:
            '请作为严格审查员检查当前产出，若需修改请在末尾输出 `VERDICT: CHANGES_REQUESTED`，否则输出 `VERDICT: PASS`。\n\n【目标】\n{{requirement}}\n\n【待审内容】\n{{previousOutput}}',
        },
        condition: {
          title: '条件分支判断',
          subtitle: '满足走左侧绿线，不满足走右侧橙线',
          providerId: 'system',
          lane: 'human',
          conditionMode: 'contains',
          conditionPattern: 'PASS',
        },
        human_gate: {
          title: '人工拍板关',
          subtitle: '暂停等待人工确认通过或打回重议',
          providerId: 'human',
          lane: 'human',
        },
        delay: {
          title: '延时等待',
          subtitle: '等待指定时间后再继续推进下游',
          providerId: 'system',
          lane: 'release',
          delaySeconds: 5,
        },
        file_read: {
          title: '读取工作区文件',
          subtitle: '读取本地代码或文档作为下游上下文',
          providerId: 'system',
          lane: 'release',
          filePaths: 'README.md',
        },
        file_write: {
          title: '写入本地文件',
          subtitle: '将上游产物自动保存为工作区文件',
          providerId: 'system',
          lane: 'release',
          targetFilePath: 'docs/workflow-report.md',
          promptTemplate: '{{previousOutput}}',
        },
        shell: {
          title: 'Shell 命令执行',
          subtitle: '在工作区运行测试、构建或脚本命令',
          providerId: 'shell',
          lane: 'release',
          shellCommand: '{{checkCommand}}',
        },
        http: {
          title: 'HTTP / Webhook 请求',
          subtitle: '调用本地接口或发送飞书/企微通知',
          providerId: 'system',
          lane: 'release',
          httpMethod: 'POST',
          httpUrl: '',
          httpBody: '{"title":"{{requirement}}","content":"{{previousOutput}}"}',
        },
      };

      const cfg = defaults[kind] || defaults.llm;
      const newNode: WorkflowNodeConfig = {
        id,
        title: cfg.title || '新节点',
        subtitle: cfg.subtitle || '',
        lane: cfg.lane || 'claude',
        kind,
        providerId: cfg.providerId ?? '',
        fixProviderId: cfg.fixProviderId,
        maxRounds: cfg.maxRounds,
        conditionMode: cfg.conditionMode,
        conditionPattern: cfg.conditionPattern,
        filePaths: cfg.filePaths,
        targetFilePath: cfg.targetFilePath,
        httpMethod: cfg.httpMethod,
        httpUrl: cfg.httpUrl,
        httpBody: cfg.httpBody,
        delaySeconds: cfg.delaySeconds,
        promptTemplate: cfg.promptTemplate,
        shellCommand: cfg.shellCommand,
        enabled: true,
        dependsOn,
        position: newPos,
      };

      const materializedNodes = wf.nodes.map((n) => ({
        ...n,
        position: basePositions[n.id] || n.position,
      }));
      const nextNodes = [...materializedNodes, newNode];
      const nextEdges = buildEdgesFromNodes(nextNodes, wf.edges);

      // If parent was a condition node, tag newly added child with 'true' by default
      if (anchor?.kind === 'condition' && mode === 'child') {
        const addedEdge = nextEdges.find((e) => e.source === anchor.id && e.target === id);
        if (addedEdge) {
          addedEdge.sourceHandle = 'true';
          addedEdge.label = '满足';
        }
      }

      await onSaveWorkflow(
        { ...wf, nodes: nextNodes, edges: nextEdges },
        `已添加「${newNode.title}」`,
      );
      setSelectedNodeId(id);
      setShowNodePalette(false);
    },
    [onSaveWorkflow, selectedNodeId],
  );

  const handleQuickAddChild = useCallback(
    (parentId: string) => {
      void addNodeToCanvas('llm', 'child', parentId);
    },
    [addNodeToCanvas],
  );

  const computedNodes = useMemo<Node<CanvasNodeData>[]>(() => {
    const enabledList = workflow.nodes.filter((n) => n.enabled !== false);
    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
    const parentSigCounts = new Map<string, number>();
    for (const n of enabledList) {
      if (n.kind === 'human_input') continue;
      const sig = [...(n.dependsOn || [])].sort().join('|');
      if (sig) parentSigCounts.set(sig, (parentSigCounts.get(sig) || 0) + 1);
    }

    return workflow.nodes.map((cfg) => {
      let flowHint: CanvasNodeData['flowHint'];
      if (cfg.kind !== 'human_input' && cfg.enabled !== false) {
        const deps = cfg.dependsOn || [];
        const sig = [...deps].sort().join('|');
        if (deps.length >= 2) {
          flowHint = {
            label: tr(`汇合 ${deps.length} 路结果（可见全部上游）`, `Merges ${deps.length} branches (sees all)`),
            tone: 'merge',
          };
        } else if (sig && (parentSigCounts.get(sig) || 0) >= 2) {
          flowHint = {
            label: tr('并行盲跑（彼此看不到对方输出）', 'Blind parallel (isolated peers)'),
            tone: 'parallel',
          };
        } else if (deps.length === 1) {
          const parent = nodeById.get(deps[0]);
          if (parent && parent.kind !== 'human_input') {
            flowHint = {
              label: tr(`接续「${parent.title}」输出`, `Receives "${parent.title}"`),
              tone: 'chain',
            };
          }
        }
      }

      return {
        id: cfg.id,
        type: 'canvasStep',
        position: resolvedPositions[cfg.id] || { x: 240, y: 40 },
        draggable: true,
        data: {
          config: cfg,
          state: run?.nodes[cfg.id],
          nowTick: hasRunningWorkflowNode ? nowTick : undefined,
          flowHint,
          providers,
          selected: selectedNodeId === cfg.id,
          onQuickModelChange: handleQuickModelChange,
          onQuickToggleEnabled: handleQuickToggleEnabled,
          onQuickAddChild: handleQuickAddChild,
          onOpenArtifact: handleOpenArtifact,
          onSelectNode: (nid) => {
            setSelectedNodeId(nid);
            setShowNodePalette(false);
          },
        },
      };
    });
  }, [
    workflow.nodes,
    resolvedPositions,
    run,
    hasRunningWorkflowNode,
    nowTick,
    providers,
    selectedNodeId,
    handleQuickModelChange,
    handleQuickToggleEnabled,
    handleQuickAddChild,
    handleOpenArtifact,
    tr,
  ]);

  const computedEdges = useMemo<Edge[]>(() => {
    const rawEdges =
      workflow.edges.length > 0 ? workflow.edges : buildEdgesFromNodes(workflow.nodes);
    return rawEdges.map((e) => {
      const srcStatus = run?.nodes[e.source]?.status;
      const dstStatus = run?.nodes[e.target]?.status;
      const isRunningEdge = dstStatus === 'running';
      const isWaitingEdge = dstStatus === 'waiting_approval';
      const isDoneEdge = srcStatus === 'completed' && dstStatus === 'completed';

      const branchStroke =
        e.sourceHandle === 'true'
          ? '#10b981'
          : e.sourceHandle === 'false'
            ? '#f59e0b'
            : null;

      const stroke = isRunningEdge
        ? '#3b82f6'
        : isWaitingEdge
          ? '#d97706'
          : isDoneEdge
            ? '#10b981'
            : branchStroke || (theme === 'dark' ? '#4b5263' : '#b8bcc6');

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label:
          e.label ||
          (e.sourceHandle === 'true'
            ? '满足'
            : e.sourceHandle === 'false'
              ? '不满足'
              : undefined),
        labelStyle: {
          fontSize: 10.5,
          fontWeight: 600,
          fill: branchStroke || (theme === 'dark' ? '#cbd5e1' : '#475569'),
        },
        labelBgStyle: {
          fill: theme === 'dark' ? '#1a1c21' : '#ffffff',
          fillOpacity: 0.92,
        },
        type: 'smoothstep',
        animated: isRunningEdge || isWaitingEdge,
        style: {
          stroke,
          strokeWidth: isRunningEdge || isWaitingEdge || isDoneEdge || branchStroke ? 2 : 1.6,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 15,
          height: 15,
        },
      };
    });
  }, [workflow.edges, workflow.nodes, run, theme]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>(computedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(computedEdges);

  useEffect(() => {
    setRfNodes(computedNodes);
  }, [computedNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(computedEdges);
  }, [computedEdges, setRfEdges]);

  const prevWorkflowIdRef = useRef(workflow.id);
  useEffect(() => {
    if (prevWorkflowIdRef.current !== workflow.id) {
      prevWorkflowIdRef.current = workflow.id;
      setSelectedNodeId(null);
      requestAnimationFrame(() => {
        void fitView({ padding: 0.16, duration: 260 });
      });
    }
  }, [workflow.id, fitView]);

  const handleNodeDragStop = useCallback(
    (_evt: unknown, dragged: Node) => {
      const wf = workflowRef.current;
      const basePos = needsPixelLayout(wf.nodes)
        ? computeAutoLayout(wf.nodes)
        : Object.fromEntries(wf.nodes.map((n) => [n.id, n.position]));

      const nextNodes = wf.nodes.map((n) => {
        if (n.id === dragged.id) {
          return {
            ...n,
            position: {
              x: Math.round(dragged.position.x),
              y: Math.round(dragged.position.y),
            },
          };
        }
        return { ...n, position: basePos[n.id] || n.position };
      });
      void onSaveWorkflow({ ...wf, nodes: nextNodes });
    },
    [onSaveWorkflow],
  );

  const handleConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle } = connection;
      if (!source || !target) return;
      const wf = workflowRef.current;
      if (wouldCreateCycle(wf.nodes, source, target)) return;

      const targetNode = wf.nodes.find((n) => n.id === target);
      if (!targetNode || targetNode.kind === 'human_input') return;

      const nextNodes = wf.nodes.map((n) =>
        n.id === target
          ? {
              ...n,
              dependsOn: (n.dependsOn || []).includes(source)
                ? n.dependsOn
                : [...(n.dependsOn || []), source],
            }
          : n,
      );
      const nextEdges = buildEdgesFromNodes(nextNodes, wf.edges);
      const matched = nextEdges.find((e) => e.source === source && e.target === target);
      if (matched && (sourceHandle === 'true' || sourceHandle === 'false')) {
        matched.sourceHandle = sourceHandle;
        matched.label = sourceHandle === 'true' ? '满足' : '不满足';
      }

      void onSaveWorkflow(
        { ...wf, nodes: nextNodes, edges: nextEdges },
        sourceHandle === 'true'
          ? '已连接「满足」分支'
          : sourceHandle === 'false'
            ? '已连接「不满足」分支'
            : '已连接上下游依赖',
      );
    },
    [onSaveWorkflow],
  );

  const handleEdgesDelete: OnEdgesDelete = useCallback(
    (deletedEdges) => {
      if (deletedEdges.length === 0) return;
      const wf = workflowRef.current;
      const pairSet = new Set(deletedEdges.map((e) => `${e.source}__${e.target}`));
      const nextNodes = wf.nodes.map((n) => ({
        ...n,
        dependsOn: (n.dependsOn || []).filter((dep) => !pairSet.has(`${dep}__${n.id}`)),
      }));
      void onSaveWorkflow(
        { ...wf, nodes: nextNodes, edges: buildEdgesFromNodes(nextNodes, wf.edges) },
        '已断开连线',
      );
    },
    [onSaveWorkflow],
  );

  const handleNodesDelete: OnNodesDelete = useCallback(
    (deletedNodes) => {
      const deletableIds = new Set(
        deletedNodes
          .map((n) => n.id)
          .filter((id) => workflowRef.current.nodes.find((x) => x.id === id)?.kind !== 'human_input'),
      );
      if (deletableIds.size === 0) return;
      const wf = workflowRef.current;
      const nextNodes = wf.nodes
        .filter((n) => !deletableIds.has(n.id))
        .map((n) => ({
          ...n,
          dependsOn: (n.dependsOn || []).filter((dep) => !deletableIds.has(dep)),
        }));
      if (selectedNodeId && deletableIds.has(selectedNodeId)) {
        setSelectedNodeId(null);
      }
      void onSaveWorkflow(
        { ...wf, nodes: nextNodes, edges: buildEdgesFromNodes(nextNodes, wf.edges) },
        '已删除节点',
      );
    },
    [onSaveWorkflow, selectedNodeId],
  );

  const handleAutoLayout = async () => {
    const wf = workflowRef.current;
    const layout = computeAutoLayout(wf.nodes);
    const nextNodes = wf.nodes.map((n) => ({
      ...n,
      position: layout[n.id] || n.position,
    }));
    await onSaveWorkflow(
      { ...wf, nodes: nextNodes, edges: buildEdgesFromNodes(nextNodes, wf.edges) },
      '已自动对齐画布节点',
    );
    requestAnimationFrame(() => {
      void fitView({ padding: 0.16, duration: 280 });
    });
  };

  const handleSaveInspector = async () => {
    if (!selectedNode) return;
    await onSaveNode({
      ...selectedNode,
      title: draftTitle.trim() || selectedNode.title,
      subtitle: draftSubtitle.trim(),
      promptTemplate:
        selectedNode.kind === 'llm' ||
        selectedNode.kind === 'consensus' ||
        selectedNode.kind === 'review_loop' ||
        selectedNode.kind === 'file_write'
          ? draftPrompt
          : selectedNode.promptTemplate,
      shellCommand: selectedNode.kind === 'shell' ? draftShellCmd : selectedNode.shellCommand,
      conditionPattern:
        selectedNode.kind === 'condition' ? draftCondPattern.trim() : selectedNode.conditionPattern,
      filePaths: selectedNode.kind === 'file_read' ? draftFilePaths : selectedNode.filePaths,
      targetFilePath:
        selectedNode.kind === 'file_write' ? draftTargetFile.trim() : selectedNode.targetFilePath,
      httpUrl: selectedNode.kind === 'http' ? draftHttpUrl.trim() : selectedNode.httpUrl,
      httpHeaders: selectedNode.kind === 'http' ? draftHttpHeaders : selectedNode.httpHeaders,
      httpBody: selectedNode.kind === 'http' ? draftHttpBody : selectedNode.httpBody,
    });
  };

  const handleDeleteSelectedNode = async () => {
    if (!selectedNode || selectedNode.kind === 'human_input') return;
    const wf = workflowRef.current;
    const nextNodes = wf.nodes
      .filter((n) => n.id !== selectedNode.id)
      .map((n) => ({
        ...n,
        dependsOn: (n.dependsOn || []).filter((d) => d !== selectedNode.id),
      }));
    setSelectedNodeId(null);
    await onSaveWorkflow(
      { ...wf, nodes: nextNodes, edges: buildEdgesFromNodes(nextNodes, wf.edges) },
      `已删除节点「${selectedNode.title}」`,
    );
  };

  const handleRemoveDependency = async (targetId: string, depId: string) => {
    const wf = workflowRef.current;
    const nextNodes = wf.nodes.map((n) =>
      n.id === targetId
        ? { ...n, dependsOn: (n.dependsOn || []).filter((d) => d !== depId) }
        : n,
    );
    await onSaveWorkflow(
      { ...wf, nodes: nextNodes, edges: buildEdgesFromNodes(nextNodes, wf.edges) },
      '已移除上游连线',
    );
  };

  const stageArtifacts = useMemo(() => {
    if (!run) return [];
    return workflow.nodes
      .map((n) => {
        const st = run.nodes[n.id];
        if (!st?.output?.trim()) return null;
        const prov = providers.find((p) => p.id === n.providerId);
        return {
          id: n.id,
          title: n.title,
          author: st.providerUsed || prov?.shortName || KIND_META[n.kind]?.label || '系统',
          content: st.output,
          status: st.status,
          durationMs: st.durationMs,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [workflow.nodes, run, providers]);

  const activeArtifact =
    stageArtifacts.find((a) => a.id === selectedArtifactId) ||
    stageArtifacts[stageArtifacts.length - 1] ||
    null;

  const isWaitingApproval = run?.status === 'waiting_approval';
  const isWorkflowRunning =
    run?.status === 'running' ||
    workflow.nodes.some((n) => n.enabled !== false && run?.nodes[n.id]?.status === 'running');
  const enabledNodes = workflow.nodes.filter((n) => n.enabled !== false);
  const progressDone = enabledNodes.filter(
    (n) => run?.nodes[n.id]?.status === 'completed',
  ).length;
  const progressTotal = enabledNodes.length || 1;
  const progressPct = Math.round((progressDone / progressTotal) * 100);
  const activeRunNodes = enabledNodes
    .map((n) => ({ node: n, state: run?.nodes[n.id] }))
    .filter(
      (item): item is { node: WorkflowNodeConfig; state: NodeExecutionState } =>
        Boolean(
          item.state &&
            (item.state.status === 'running' ||
              item.state.status === 'waiting_approval' ||
              item.state.status === 'failed'),
        ),
    );
  const showProgressStrip = Boolean(
    run &&
      (isWorkflowRunning ||
        isWaitingApproval ||
        activeRunNodes.length > 0 ||
        (Boolean(run.requirement) && progressDone > 0)),
  );
  const selectedNodeState = selectedNode ? run?.nodes[selectedNode.id] : undefined;

  // Detect unmerged parallel AI branches so new users don't accidentally run blind parallel dead-ends
  const unmergedParallelLeaves = useMemo(() => {
    const enabled = workflow.nodes.filter((n) => n.enabled !== false);
    const referencedAsUpstream = new Set<string>();
    for (const n of enabled) {
      for (const dep of n.dependsOn || []) referencedAsUpstream.add(dep);
    }
    return enabled.filter(
      (n) =>
        MODEL_NODE_KINDS.has(n.kind) &&
        !referencedAsUpstream.has(n.id),
    );
  }, [workflow.nodes]);

  const pickModelIdsForStarter = () => {
    const onlineFirst = providers
      .filter((p) => p.command === 'agent-join')
      .map((p) => p.id);
    const fallback = providers.map((p) => p.id);
    const pool = onlineFirst.length > 0 ? onlineFirst : fallback;
    return {
      a: pool[0] || '',
      b: pool[1] || pool[0] || '',
      c: pool[2] || pool[0] || '',
    };
  };

  const handleAddMergeJudgeNode = async () => {
    if (unmergedParallelLeaves.length < 2) return;
    const wf = workflowRef.current;
    const { c } = pickModelIdsForStarter();
    const id = `judge_${Date.now().toString(36).slice(-5)}`;
    const mergeNode: WorkflowNodeConfig = {
      id,
      title: '汇总与裁决',
      subtitle: '收齐上方所有并行结果，统一对比 / 判分 / 给终稿',
      lane: 'release',
      kind: 'consensus',
      providerId: c,
      enabled: true,
      dependsOn: unmergedParallelLeaves.map((n) => n.id),
      position: { x: 0, y: 0 },
      promptTemplate:
        '你是公正的汇总裁判（当前模型：{{providerName}}）。上游有多路并行成员互相盲跑产出了各自结果，请把所有上游输出放在一起逐项核对、对比优劣或统一判定胜负，并给出清晰结论。\n\n【原始任务】\n{{requirement}}\n\n【上游各路并行输出】\n{{previousOutput}}',
    };
    const nextNodes = [...wf.nodes, mergeNode];
    const layout = computeAutoLayout(nextNodes);
    const positioned = nextNodes.map((n) => ({ ...n, position: layout[n.id] }));
    const nextEdges = buildEdgesFromNodes(positioned, wf.edges);
    await onSaveWorkflow(
      { ...wf, nodes: positioned, edges: nextEdges },
      '已补齐下游「汇总与裁决」节点并自动连线排版',
    );
    setSelectedNodeId(id);
  };

  const handleChainParallelLeaves = async () => {
    if (unmergedParallelLeaves.length < 2) return;
    const wf = workflowRef.current;
    const leafIds = unmergedParallelLeaves.map((n) => n.id);
    const nextNodes = wf.nodes.map((n) => {
      const idx = leafIds.indexOf(n.id);
      if (idx > 0) {
        return { ...n, dependsOn: [leafIds[idx - 1]] };
      }
      return n;
    });
    const layout = computeAutoLayout(nextNodes);
    const positioned = nextNodes.map((n) => ({ ...n, position: layout[n.id] }));
    const nextEdges = buildEdgesFromNodes(positioned);
    await onSaveWorkflow(
      { ...wf, nodes: positioned, edges: nextEdges },
      '已改为串行交接，后一步现在可以看到前一步的完整输出',
    );
  };

  const handleApplyStarterPattern = async (pattern: 'chain' | 'blind_judge' | 'debate') => {
    const wf = workflowRef.current;
    const { a, b, c } = pickModelIdsForStarter();
    const inputNode: WorkflowNodeConfig = {
      id: 'user_requirement',
      title: '任务输入',
      subtitle: '输入任务目标、规则与上下文',
      lane: 'human',
      kind: 'human_input',
      providerId: 'human',
      enabled: true,
      dependsOn: [],
      position: { x: 0, y: 0 },
    };
    let nodes: WorkflowNodeConfig[];
    let desc = '';
    if (pattern === 'chain') {
      desc = '串行接力：A 出初稿 → B 审改优化 → 人工拍板';
      nodes = [
        inputNode,
        {
          id: 'step_draft',
          title: '主笔初稿',
          subtitle: '根据任务输出完整初版方案或内容',
          lane: 'claude',
          kind: 'llm',
          providerId: a,
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: '请围绕以下任务完成完整初稿（当前模型：{{providerName}}）：\n\n【任务】\n{{requirement}}',
        },
        {
          id: 'step_refine',
          title: '接力审改',
          subtitle: '基于主笔初稿挑错、补漏并输出精修版',
          lane: 'gemini',
          kind: 'llm',
          providerId: b,
          enabled: true,
          dependsOn: ['step_draft'],
          position: { x: 0, y: 2 },
          promptTemplate: '请审阅上一步初稿，指出问题并直接给出改进后的最终版本（当前模型：{{providerName}}）：\n\n【任务】\n{{requirement}}\n\n【上一步初稿】\n{{previousOutput}}',
        },
        {
          id: 'user_approve',
          title: '人工拍板',
          subtitle: '确认定稿或给出修改意见打回',
          lane: 'human',
          kind: 'human_gate',
          providerId: 'human',
          enabled: true,
          dependsOn: ['step_refine'],
          position: { x: 0, y: 3 },
        },
      ];
    } else if (pattern === 'blind_judge') {
      desc = '并行盲跑 + 汇总裁判：A、B 互不可见各自作答 → 裁判汇总/判分';
      nodes = [
        inputNode,
        {
          id: 'player_a',
          title: '选手 / 视角 A',
          subtitle: '独立完成本方出招或方案（不看对方）',
          lane: 'claude',
          kind: 'llm',
          providerId: a,
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
          promptTemplate: '你是独立参与方 A（当前模型：{{providerName}}）。请只输出你的本方方案 / 出招序列，不要替对手出招，也不要提前替裁判算总分。\n\n【任务与规则】\n{{requirement}}',
        },
        {
          id: 'player_b',
          title: '选手 / 视角 B',
          subtitle: '并行独立完成本方出招或方案（不看对方）',
          lane: 'gemini',
          kind: 'llm',
          providerId: b,
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 1, y: 1 },
          promptTemplate: '你是独立参与方 B（当前模型：{{providerName}}）。请只输出你的本方方案 / 出招序列，不要替对手出招，也不要提前替裁判算总分。\n\n【任务与规则】\n{{requirement}}',
        },
        {
          id: 'judge_final',
          title: '裁判汇总与判分',
          subtitle: '收齐 A、B 两路盲跑输出，统一对比 / 判分',
          lane: 'release',
          kind: 'consensus',
          providerId: c,
          enabled: true,
          dependsOn: ['player_a', 'player_b'],
          position: { x: 0, y: 2 },
          promptTemplate: '你是唯一裁判与汇总者（当前模型：{{providerName}}）。请严格把下方 A、B 两路独立输出逐项配对对比或计分，给出清晰表格与最终结论。\n\n【原始任务】\n{{requirement}}\n\n【A、B 两路输出】\n{{previousOutput}}',
        },
      ];
    } else {
      desc = '双模型多轮对抗：A、B 轮流看到对方上一轮发言进行博弈';
      nodes = [
        inputNode,
        {
          id: 'dual_debate',
          title: '双模型多轮博弈 / 辩论',
          subtitle: 'A 与 B 交替看到对方上一轮内容，展开 2 轮交锋',
          lane: 'claude',
          kind: 'debate',
          providerId: a,
          fixProviderId: b,
          maxRounds: 2,
          enabled: true,
          dependsOn: ['user_requirement'],
          position: { x: 0, y: 1 },
        },
        {
          id: 'final_summary',
          title: '终局裁决与收束',
          subtitle: '复盘多轮交锋记录并给出最终结论',
          lane: 'release',
          kind: 'consensus',
          providerId: c,
          enabled: true,
          dependsOn: ['dual_debate'],
          position: { x: 0, y: 2 },
          promptTemplate: '请复盘上方双模型多轮交锋记录，提炼关键共识、分歧与最终建议（当前模型：{{providerName}}）：\n\n【任务】\n{{requirement}}\n\n【交锋记录】\n{{previousOutput}}',
        },
      ];
    }
    const layout = computeAutoLayout(nodes);
    const positioned = nodes.map((n) => ({ ...n, position: layout[n.id] }));
    const edges = buildEdgesFromNodes(positioned);
    await onSaveWorkflow(
      { ...wf, description: desc, nodes: positioned, edges },
      `已套用「${pattern === 'chain' ? '串行接力' : pattern === 'blind_judge' ? '并行盲跑 + 裁判' : '双模型多轮对抗'}」结构`,
    );
  };

  return (
    <section className={`claude-canvas-pane ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* Claude Canvas Minimalist Header */}
      <header className="cc-header">
        <div className="cc-header-left">
          <span className="cc-brand-icon" title={tr('可视化工作流画布', 'Visual Workflow Canvas')}>
            <Layers size={14} />
          </span>

          <select
            className="cc-tpl-select"
            value={activeTemplate ? activeTemplate.id : '__custom__'}
            onChange={(e) => {
              const id = e.target.value;
              if (id !== '__custom__') void onApplyTemplate(id);
            }}
            title={tr('切换工作流模板', 'Switch workflow template')}
          >
            {!activeTemplate && <option value="__custom__">{workflow.name}</option>}
            {workflowTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({tr(`${t.workflow.nodes.length}步`, `${t.workflow.nodes.length} steps`)}){t.builtin ? '' : tr(' · 自定义', ' · Custom')}
              </option>
            ))}
          </select>

          {onCreateBlankCanvas && (
            <button
              type="button"
              className="btn btn-ink btn-sm"
              style={{ height: 26, padding: '0 8px', fontSize: 11.5, flexShrink: 0 }}
              title={tr('新建一个空白自定义画布，从零添加节点与连线', 'Create a blank workflow canvas from scratch')}
              onClick={() => void onCreateBlankCanvas()}
            >
              <Plus size={12} />
              <span>{tr('新建画布', 'New Canvas')}</span>
            </button>
          )}

          <button
            type="button"
            className="studio-icon-btn"
            title={tr('另存当前画布为新模板', 'Save canvas as template')}
            onClick={() => {
              setTplNameDraft(`${workflow.name}${tr('（自定义）', ' (Custom)')}`);
              setTplDescDraft(workflow.description || '');
              setShowSaveTpl((v) => !v);
            }}
          >
            <Save size={13} />
          </button>

          {activeTemplate && !activeTemplate.builtin && (
            <button
              type="button"
              className="studio-icon-btn"
              title={tr('删除此自定义模板', 'Delete custom template')}
              onClick={() => void onDeleteTemplate(activeTemplate.id)}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <div className="cc-header-right">
          <div className="cc-seg-switch">
            <button
              type="button"
              className={activeTab === 'canvas' ? 'active' : ''}
              onClick={() => setActiveTab('canvas')}
            >
              <GitBranch size={12} />
              <span>{tr('画布', 'Canvas')}</span>
            </button>
            <button
              type="button"
              className={activeTab === 'artifacts' ? 'active' : ''}
              onClick={() => setActiveTab('artifacts')}
            >
              <FileText size={12} />
              <span>{tr('产出', 'Artifacts')}{stageArtifacts.length > 0 ? ` (${stageArtifacts.length})` : ''}</span>
            </button>
          </div>

          <button
            type="button"
            className="studio-icon-btn"
            title={isFullscreen ? tr('恢复左右分屏', 'Exit fullscreen') : tr('全屏展开画布', 'Expand fullscreen')}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          <button
            type="button"
            className="studio-icon-btn"
            title={tr('关闭画布', 'Close canvas')}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {showSaveTpl && (
        <div className="cc-inline-bar">
          <input
            className="input"
            style={{ maxWidth: 210, padding: '5px 9px', fontSize: 12 }}
            placeholder={tr('新模板名称', 'Template name')}
            value={tplNameDraft}
            onChange={(e) => setTplNameDraft(e.target.value)}
            autoFocus
          />
          <input
            className="input"
            style={{ flex: 1, padding: '5px 9px', fontSize: 12 }}
            placeholder={tr('简短说明（可选）', 'Short description (optional)')}
            value={tplDescDraft}
            onChange={(e) => setTplDescDraft(e.target.value)}
          />
          <button type="button" className="btn btn-sm" onClick={() => setShowSaveTpl(false)}>
            {tr('取消', 'Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-ink btn-sm"
            disabled={!tplNameDraft.trim()}
            onClick={async () => {
              await onSaveAsTemplate(tplNameDraft.trim(), tplDescDraft.trim());
              setShowSaveTpl(false);
            }}
          >
            {tr('保存模板', 'Save')}
          </button>
        </div>
      )}

      {/* ===== VIEW 1: INTERACTIVE VISUAL WORKFLOW CANVAS ===== */}
      {activeTab === 'canvas' && (
        <div className="cc-stage">
          {/* Minimalist Toolbar with Full Node Library Dropdown */}
          <div className="cc-floating-toolbar">
            <div className="cc-palette-anchor">
              <button
                type="button"
                className={`cc-tool-btn is-primary ${showNodePalette ? 'active' : ''}`}
                onClick={() => setShowNodePalette((v) => !v)}
                title={tr('打开全套常用节点库（AI 协作 / 流程控制 / 文件与工具）', 'Open node library (AI / Flow / Files & Tools)')}
              >
                <Plus size={12} />
                <span>{tr('添加节点', 'Add Node')}</span>
                <ChevronDown size={11} />
              </button>

              {showNodePalette && (
                <div className="cc-node-palette" onClick={(e) => e.stopPropagation()}>
                  {NODE_PALETTE_GROUPS.map((grp) => (
                    <div key={grp.title} className="cc-palette-group">
                      <div className="cc-palette-group-title">{isEn ? grp.titleEn : grp.title}</div>
                      <div className="cc-palette-grid">
                        {grp.items.map((item) => {
                          const meta = KIND_META[item.kind];
                          return (
                            <button
                              key={`${item.kind}_${item.mode}`}
                              type="button"
                              className="cc-palette-item"
                              onClick={() => void addNodeToCanvas(item.kind, item.mode)}
                            >
                              <span
                                className="cc-palette-ico"
                                style={{
                                  color: meta.color,
                                  background: `${meta.color}16`,
                                }}
                              >
                                {renderKindIcon(item.kind, 13)}
                              </span>
                              <div className="cc-palette-text">
                                <div className="cc-palette-name">{isEn ? item.labelEn : item.label}</div>
                                <div className="cc-palette-desc">{isEn ? item.descEn : item.desc}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="cc-tool-btn"
              onClick={() => void addNodeToCanvas('llm', 'parallel')}
              title={tr('在当前节点旁添加一个并行分支节点', 'Add a parallel branch node alongside current node')}
            >
              <GitBranch size={12} />
              <span>{tr('并行', 'Parallel')}</span>
            </button>

            <button
              type="button"
              className="cc-tool-btn"
              onClick={() => void addNodeToCanvas('condition', 'child')}
              title={tr('快速添加条件分支 IF/ELSE 节点', 'Add an IF/ELSE condition node')}
            >
              <GitFork size={12} />
              <span>{tr('条件', 'Condition')}</span>
            </button>

            <button
              type="button"
              className="cc-tool-btn"
              onClick={() => void handleAutoLayout()}
              title={tr('按上下游依赖自动整齐排布所有节点', 'Auto-arrange all nodes by dependencies')}
            >
              <LayoutGrid size={12} />
              <span>{tr('自动排布', 'Layout')}</span>
            </button>

            {onAutoAssignModels && (
              <button
                type="button"
                className="cc-tool-btn"
                onClick={() => void onAutoAssignModels()}
                title={tr('一键把当前在线成员智能分配到各个 AI 节点', 'Auto-assign online members across AI nodes')}
              >
                <Sparkles size={12} />
                <span>{tr('分配模型', 'Assign')}</span>
              </button>
            )}

            <button
              type="button"
              className={`cc-tool-btn ${showUsageGuide ? 'active' : ''}`}
              title={tr('30 秒看懂串行 / 并行盲跑 / 双模型对抗三种画布用法', '30s guide: Serial / Blind Parallel / Dual Debate')}
              onClick={() => setShowUsageGuide((v) => !v)}
            >
              <HelpCircle size={12} />
              <span>{tr('用法', 'Guide')}</span>
            </button>

            {onGenerateWorkflow && (
              <button
                type="button"
                className={`cc-tool-btn ${showAiBar ? 'active' : ''}`}
                onClick={() => setShowAiBar((v) => !v)}
                title={tr('一句话让 AI 生成或修改当前画布工作流', 'Generate or modify canvas workflow with AI')}
              >
                <Sparkles size={12} />
                <span>{tr('AI 生成', 'AI Build')}</span>
              </button>
            )}

            <button
              type="button"
              className="cc-tool-btn"
              title={tr('一键复制当前模板为可编辑副本', 'Duplicate current template')}
              onClick={() => void onSaveAsTemplate(`${workflow.name}${tr(' 副本', ' Copy')}`, workflow.description || '')}
            >
              <Copy size={12} />
              <span>{tr('复制', 'Copy')}</span>
            </button>

            <button
              type="button"
              className="cc-tool-btn"
              title={tr('导出当前工作流模板 JSON', 'Export workflow JSON')}
              onClick={() => {
                const blob = new Blob([JSON.stringify(workflow, null, 2)], {
                  type: 'application/json;charset=utf-8',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${workflow.id || 'workflow'}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={12} />
              <span>{tr('导出', 'Export')}</span>
            </button>

            <input
              ref={jsonImportRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text()) as WorkflowDefinition & {
                    workflow?: WorkflowDefinition;
                  };
                  const candidate = parsed.workflow?.nodes ? parsed.workflow : parsed;
                  if (!candidate || !Array.isArray(candidate.nodes) || candidate.nodes.length === 0) {
                    return;
                  }
                  const imported: WorkflowDefinition = {
                    ...candidate,
                    id: `wf_imp_${Date.now().toString(36)}`,
                    name: candidate.name || file.name.replace(/\.json$/i, ''),
                    edges: Array.isArray(candidate.edges) ? candidate.edges : [],
                  };
                  await onSaveWorkflow(imported, tr(`已导入模板「${imported.name}」`, `Imported "${imported.name}"`));
                } catch {
                  // ignore malformed json
                }
              }}
            />
            <button
              type="button"
              className="cc-tool-btn"
              title={tr('从本地 JSON 文件导入工作流模板', 'Import workflow JSON')}
              onClick={() => jsonImportRef.current?.click()}
            >
              <Upload size={12} />
              <span>{tr('导入', 'Import')}</span>
            </button>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              {isWorkflowRunning && onAbortWorkflow && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ borderColor: '#dc2626', color: '#dc2626' }}
                  title={tr('停止当前画布工作流执行', 'Stop workflow execution')}
                  onClick={onAbortWorkflow}
                >
                  <Square size={10} />
                  <span>{tr('停止', 'Stop')}</span>
                </button>
              )}
              {isWaitingApproval && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ borderColor: '#d97706', color: '#d97706' }}
                  onClick={onOpenApproval}
                >
                  <Hand size={12} />
                  <span>{tr('去拍板', 'Approve')}</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn-ink btn-sm"
                onClick={() => {
                  if (hasComposerInput) {
                    onRunWorkflow();
                  } else {
                    setShowQuickRunPrompt((v) => !v);
                  }
                }}
              >
                <Play size={11} />
                <span>{isWorkflowRunning ? tr('重新运行', 'Rerun') : tr('运行此画布', 'Run Canvas')}</span>
              </button>
            </div>
          </div>

          {showAiBar && onGenerateWorkflow && (
            <div className="cc-quick-run-bar">
              {onChangeAiGeneratorId && (
                <select
                  className="input wf-ai-gen-select"
                  title={tr('选择负责设计工作流的 AI 模型或成员', 'Choose which AI designs the workflow')}
                  value={aiGeneratorId}
                  disabled={aiGenerating}
                  onChange={(e) => onChangeAiGeneratorId(e.target.value)}
                >
                  <option value="auto">{tr('✨ 自动选择 AI', '✨ Auto Select AI')}</option>
                  {aiGeneratorOptions.some((o) => o.group === 'agent') && (
                    <optgroup label={tr('在线成员（实时调用）', 'Online Members (Live)')}>
                      {aiGeneratorOptions
                        .filter((o) => o.group === 'agent')
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {aiGeneratorOptions.some((o) => o.group === 'api') && (
                    <optgroup label={tr('模型池 API', 'Model Pool API')}>
                      {aiGeneratorOptions
                        .filter((o) => o.group === 'api')
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  <option value="local">{tr('⚡ 本地规则秒生（0 消耗）', '⚡ Local Instant (0 tokens)')}</option>
                </select>
              )}
              <input
                className="input"
                style={{ flex: 1, padding: '6px 10px', fontSize: 12.5 }}
                placeholder={tr(
                  '一句话描述想要的工作流，如：生成3视角产品评审流并加人工拍板；或在当前流程加一步安全审查...',
                  'Describe your workflow, e.g. 3-perspective review with approval, or add a security check step...',
                )}
                value={aiPromptText}
                autoFocus
                disabled={aiGenerating}
                onChange={(e) => setAiPromptText(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && aiPromptText.trim() && !aiGenerating) {
                    setAiGenerating(true);
                    try {
                      await onGenerateWorkflow(aiPromptText.trim(), aiGeneratorId);
                      setAiPromptText('');
                      setShowAiBar(false);
                    } finally {
                      setAiGenerating(false);
                    }
                  } else if (e.key === 'Escape') {
                    setShowAiBar(false);
                  }
                }}
              />
              {aiGenerating ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  title={tr('若成员端弹出了确认框，可切去点允许，或点此立即取消等待', 'Approve the dialog in the agent window or cancel waiting')}
                  onClick={() => {
                    onCancelGenerateWorkflow?.();
                    setAiGenerating(false);
                  }}
                >
                  <Loader2 size={12} className="spin" />
                  {tr('取消等待', 'Cancel')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ink btn-sm"
                  disabled={!aiPromptText.trim()}
                  onClick={async () => {
                    setAiGenerating(true);
                    try {
                      await onGenerateWorkflow(aiPromptText.trim(), aiGeneratorId);
                      setAiPromptText('');
                      setShowAiBar(false);
                    } finally {
                      setAiGenerating(false);
                    }
                  }}
                >
                  <Sparkles size={12} />
                  {tr('生成并应用', 'Generate')}
                </button>
              )}
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => {
                  if (aiGenerating) {
                    onCancelGenerateWorkflow?.();
                    setAiGenerating(false);
                  }
                  setShowAiBar(false);
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}

          {showQuickRunPrompt && (
            <div className="cc-quick-run-bar">
              <input
                className="input"
                style={{ flex: 1, padding: '6px 10px', fontSize: 12.5 }}
                placeholder={tr('输入任务需求，回车直接按当前画布模板运行...', 'Enter task prompt and press Enter to run this canvas...')}
                value={quickRunText}
                autoFocus
                onChange={(e) => setQuickRunText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickRunText.trim()) {
                    onRunWorkflow(quickRunText.trim());
                    setQuickRunText('');
                    setShowQuickRunPrompt(false);
                  } else if (e.key === 'Escape') {
                    setShowQuickRunPrompt(false);
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-ink btn-sm"
                disabled={!quickRunText.trim()}
                onClick={() => {
                  onRunWorkflow(quickRunText.trim(), false);
                  setQuickRunText('');
                  setShowQuickRunPrompt(false);
                }}
              >
                {tr('启动', 'Start')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!quickRunText.trim()}
                title={tr('仅演练画布节点流转，不调用真实模型、不消耗额度', 'Dry-run node transitions without calling real models')}
                onClick={() => {
                  onRunWorkflow(quickRunText.trim(), true);
                  setQuickRunText('');
                  setShowQuickRunPrompt(false);
                }}
              >
                {tr('演练', 'Dry Run')}
              </button>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => setShowQuickRunPrompt(false)}
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Optional Compact Usage Cheat Sheet */}
          {showUsageGuide && (
            <div className="cc-usage-guide">
              <div className="cc-usage-guide-head">
                <strong>{tr('30 秒看懂画布连线规则（新手必看）', '30-Second Canvas Wiring Guide')}</strong>
                <button
                  type="button"
                  className="mini-icon-btn"
                  onClick={() => setShowUsageGuide(false)}
                >
                  <X size={13} />
                </button>
              </div>
              <ul>
                <li>
                  {isEn ? (
                    <>
                      <strong>Serial (A → B)</strong>: B receives A's full output — ideal for Draft → Review → Approve.
                    </>
                  ) : (
                    <>
                      <strong>串行连线（A → B）</strong>：B 会自动拿到 A 的完整输出，适合「初稿 → 审改 → 拍板」。
                    </>
                  )}
                </li>
                <li>
                  {isEn ? (
                    <>
                      <strong>Parallel (A ‖ B)</strong>: A and B run simultaneously and <strong>cannot see each other</strong> (blind by design). Add a downstream <strong>Merge / Judge</strong> node to compare or score both.
                    </>
                  ) : (
                    <>
                      <strong>并行分支（A ‖ B）</strong>：A 与 B 同时跑且<strong>互相看不见对方输出</strong>（天然防偷看）；若想比对或判分，记得在下游接一个<strong>「汇总 / 裁判」节点</strong>把两路合起来。
                    </>
                  )}
                </li>
                <li>
                  {isEn ? (
                    <>
                      <strong>Dual Debate (<code>Debate</code> node)</strong>: Lets two models take turns seeing each other's previous move directly.
                    </>
                  ) : (
                    <>
                      <strong>双模型对抗（<code>对抗/辩论</code> 节点）</strong>：想让两家轮流看到对方上一手并直接交锋，用对抗节点一步搞定。
                    </>
                  )}
                </li>
                <li>
                  {isEn ? (
                    <>
                      <strong>Role Tip</strong>: Click any node to edit its Prompt Template (assigning Player A / Player B / Judge) and target model on the right.
                    </>
                  ) : (
                    <>
                      <strong>分工小贴士</strong>：点击任意节点即可在右侧修改它的「提示词模板」（明确它扮演选手 A / 选手 B / 裁判）与执行模型。
                    </>
                  )}
                </li>
              </ul>
              <div className="cc-advice-actions">
                <span className="cc-advice-label">{tr('一键套用结构：', 'Quick Patterns:')}</span>
                <button type="button" className="cc-tool-btn" onClick={() => void handleApplyStarterPattern('chain')}>
                  {tr('串行接力', 'Serial Relay')}
                </button>
                <button type="button" className="cc-tool-btn" onClick={() => void handleApplyStarterPattern('blind_judge')}>
                  {tr('并行盲跑 + 裁判', 'Blind Parallel + Judge')}
                </button>
                <button type="button" className="cc-tool-btn" onClick={() => void handleApplyStarterPattern('debate')}>
                  {tr('双模型对抗', 'Dual Debate')}
                </button>
              </div>
            </div>
          )}

          {/* Smart Topology Advisor (catches unmerged blind parallel branches OR bare starter canvas) */}
          {!isWorkflowRunning && unmergedParallelLeaves.length >= 2 && (
            <div className="cc-advice-bar is-warn">
              <div className="cc-advice-text">
                <strong>{tr('提示：', 'Tip: ')}</strong>
                <span>
                  {tr(
                    `当前有 ${unmergedParallelLeaves.length} 个并行节点互不可见且下游未汇总，直接运行会各自独立作答（不会互相对战或合并）。`,
                    `${unmergedParallelLeaves.length} parallel branches are blind to each other with no downstream merge — they will answer independently unless merged or chained.`,
                  )}
                </span>
              </div>
              <div className="cc-advice-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ink"
                  onClick={() => void handleAddMergeJudgeNode()}
                >
                  {tr('+ 一键补下游汇总 / 裁判', '+ Add Merge / Judge')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void handleChainParallelLeaves()}
                >
                  {tr('改为串行交接', 'Chain Serially')}
                </button>
              </div>
            </div>
          )}

          {!isWorkflowRunning &&
            unmergedParallelLeaves.length < 2 &&
            workflow.nodes.length <= 2 &&
            !showUsageGuide && (
              <div className="cc-advice-bar is-guide">
                <div className="cc-advice-text">
                  <strong>{tr('快速搭画布：', 'Quick Start: ')}</strong>
                  <span>{tr('选一种协作结构起步，或点上方「AI 生成」一句话自动搭好分工：', 'Pick a starter topology, or use AI Build above:')}</span>
                </div>
                <div className="cc-advice-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void handleApplyStarterPattern('chain')}
                  >
                    {tr('串行接力', 'Serial Relay')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ink"
                    onClick={() => void handleApplyStarterPattern('blind_judge')}
                  >
                    {tr('并行盲跑 + 裁判', 'Blind Parallel + Judge')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void handleApplyStarterPattern('debate')}
                  >
                    {tr('双模型对抗', 'Dual Debate')}
                  </button>
                </div>
              </div>
            )}

          {/* Live Workflow Run Progress HUD (mirrors chatroom waiting tray right inside canvas) */}
          {showProgressStrip && (
            <div
              className={`cc-run-progress-bar ${
                isWorkflowRunning
                  ? 'is-running'
                  : isWaitingApproval
                    ? 'is-waiting'
                    : activeRunNodes.some((x) => x.state.status === 'failed')
                      ? 'is-failed'
                      : 'is-done'
              }`}
              role="status"
              aria-live="polite"
            >
              <div className="cc-rp-top">
                <div className="cc-rp-summary">
                  <span className="cc-rp-dot" />
                  <strong>
                    {isWorkflowRunning
                      ? tr(
                          `画布运行中 · ${activeRunNodes.filter((x) => x.state.status === 'running').length} 个节点执行中`,
                          `Canvas Running · ${activeRunNodes.filter((x) => x.state.status === 'running').length} active`,
                        )
                      : isWaitingApproval
                        ? tr('画布已暂停 · 等待人工拍板', 'Paused · Awaiting Approval')
                        : activeRunNodes.some((x) => x.state.status === 'failed')
                          ? tr('画布执行有节点失败', 'Canvas Run Has Failures')
                          : tr('画布已全部完成', 'Canvas Completed')}
                  </strong>
                  <span className="cc-rp-count">
                    {progressDone}/{progressTotal} {tr('步', 'steps')} ({progressPct}%)
                  </span>
                </div>

                <div className="cc-rp-track-wrap">
                  <div className="cc-rp-track">
                    <div
                      className="cc-rp-fill"
                      style={{ width: `${Math.max(progressPct, isWorkflowRunning ? 8 : 0)}%` }}
                    />
                  </div>
                  {stageArtifacts.length > 0 && (
                    <button
                      type="button"
                      className="cc-tool-btn"
                      style={{ padding: '2px 7px', fontSize: 11 }}
                      onClick={() => setActiveTab('artifacts')}
                    >
                      <FileText size={11} />
                      <span>{tr('看产出', 'Artifacts')} ({stageArtifacts.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {activeRunNodes.length > 0 && (
                <div className="cc-rp-nodes">
                  {activeRunNodes.map(({ node, state }) => {
                    const sec =
                      state.status === 'running' && state.startedAt
                        ? Math.max(0, Math.floor((nowTick - new Date(state.startedAt).getTime()) / 1000))
                        : state.durationMs !== undefined
                          ? Math.round(state.durationMs / 1000)
                          : 0;
                    const lastLine =
                      state.status === 'failed'
                        ? state.error || '执行失败'
                        : state.logs && state.logs.length > 0
                          ? state.logs[state.logs.length - 1]
                          : state.status === 'waiting_approval'
                            ? '等待你点击「去拍板」确认'
                            : '已派单，等待模型响应…';
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className={`cc-rp-node-chip status-${state.status}`}
                        title={`点击查看「${node.title}」完整实时日志`}
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        {state.status === 'running' ? (
                          <Loader2 size={11} className="spin" />
                        ) : state.status === 'waiting_approval' ? (
                          <Hand size={11} />
                        ) : (
                          <AlertCircle size={11} />
                        )}
                        <span className="cc-rp-node-title">{node.title}</span>
                        {state.providerUsed && (
                          <span className="cc-rp-node-model">{state.providerUsed}</span>
                        )}
                        <span className="cc-rp-node-log">{lastLine}</span>
                        <span className="cc-rp-node-time">{sec}s</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ReactFlow Interactive Graph */}
          <div className="cc-flow-wrap">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={handleNodeDragStop}
              onConnect={handleConnect}
              onEdgesDelete={handleEdgesDelete}
              onNodesDelete={handleNodesDelete}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setShowNodePalette(false);
              }}
              deleteKeyCode={['Backspace', 'Delete']}
              snapToGrid
              snapGrid={[16, 16]}
              fitView
              fitViewOptions={{ padding: 0.16 }}
              minZoom={0.35}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1.2}
                color={theme === 'dark' ? '#2c303a' : '#d8d7d0'}
              />
              <Controls showInteractive={false} className="cc-controls" />
              {isFullscreen && (
                <MiniMap
                  className="cc-minimap"
                  pannable
                  zoomable
                  maskColor={theme === 'dark' ? 'rgba(13,14,17,0.68)' : 'rgba(249,249,248,0.72)'}
                  nodeColor={(n) => {
                    const st = (n.data as CanvasNodeData)?.state?.status;
                    if (st === 'completed') return '#10b981';
                    if (st === 'running') return '#3b82f6';
                    if (st === 'waiting_approval') return '#d97706';
                    if (st === 'failed') return '#ef4444';
                    return theme === 'dark' ? '#525866' : '#a1a1aa';
                  }}
                />
              )}
            </ReactFlow>

            <div className="cc-canvas-hint">
              {tr(
                `拖拽排版 · 从底部圆点拖线连下游 · 条件节点支持绿(满足)/橙(不满足)双出口 · 进度 ${progressDone}/${progressTotal}`,
                `Drag to arrange · Connect bottom handle to downstream · Condition supports True/False · Progress ${progressDone}/${progressTotal}`,
              )}
            </div>

            {/* Floating Node Inspector Card */}
            {selectedNode && (
              <aside className="cc-inspector">
                <div className="cc-inspector-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span
                      className="cc-model-dot"
                      style={{ background: KIND_META[selectedNode.kind]?.color || 'var(--ink)' }}
                    />
                    <strong className="cc-inspector-title">{selectedNode.title}</strong>
                  </div>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    onClick={() => setSelectedNodeId(null)}
                    title={tr('收起属性面板', 'Close inspector')}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="cc-inspector-body">
                  {selectedNodeState && selectedNodeState.status !== 'idle' && (
                    <div className={`cc-inspector-live status-${selectedNodeState.status}`}>
                      <div className="cc-inspector-live-head">
                        <span>
                          {selectedNodeState.status === 'running'
                            ? `${tr('运行中', 'Running')} · ${
                                selectedNodeState.startedAt
                                  ? Math.max(
                                      0,
                                      Math.floor(
                                        (nowTick - new Date(selectedNodeState.startedAt).getTime()) /
                                          1000,
                                      ),
                                    )
                                  : 0
                              }s`
                            : selectedNodeState.status === 'completed'
                              ? `${tr('已完成', 'Done')}${
                                  selectedNodeState.durationMs !== undefined
                                    ? ` · ${(selectedNodeState.durationMs / 1000).toFixed(1)}s`
                                    : ''
                                }`
                              : selectedNodeState.status === 'waiting_approval'
                                ? tr('等待人工拍板', 'Awaiting Approval')
                                : tr('执行失败', 'Failed')}
                          {selectedNodeState.providerUsed ? ` (${selectedNodeState.providerUsed})` : ''}
                        </span>
                        {selectedNodeState.output?.trim() && (
                          <button
                            type="button"
                            className="cc-tool-btn"
                            style={{ padding: '1px 6px', fontSize: 10.5 }}
                            onClick={() => {
                              setSelectedArtifactId(selectedNode.id);
                              setActiveTab('artifacts');
                            }}
                          >
                            {tr('查看产出', 'View Output')}
                          </button>
                        )}
                      </div>
                      {selectedNodeState.error && (
                        <div className="cc-inspector-live-err">{selectedNodeState.error}</div>
                      )}
                      {selectedNodeState.logs.length > 0 && (
                        <pre className="cc-inspector-live-logs">
                          {selectedNodeState.logs.slice(-12).join('\n')}
                        </pre>
                      )}
                    </div>
                  )}

                  <div className="cc-field">
                    <label>{tr('节点标题', 'Node Title')}</label>
                    <input
                      className="input"
                      style={{ padding: '6px 9px', fontSize: 12.5 }}
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                    />
                  </div>

                  <div className="cc-field">
                    <label>{tr('职责说明', 'Description')}</label>
                    <input
                      className="input"
                      style={{ padding: '6px 9px', fontSize: 12 }}
                      value={draftSubtitle}
                      onChange={(e) => setDraftSubtitle(e.target.value)}
                    />
                  </div>

                  {selectedNode.kind !== 'human_input' && (
                    <div className="grid-2" style={{ marginBottom: 10 }}>
                      <div className="cc-field" style={{ marginBottom: 0 }}>
                        <label>{tr('节点类型', 'Node Type')}</label>
                        <select
                          className="select"
                          style={{ padding: '5px 8px', fontSize: 12 }}
                          value={selectedNode.kind}
                          onChange={(e) => {
                            const nextKind = e.target.value as NodeKind;
                            void onSaveNode({
                              ...selectedNode,
                              kind: nextKind,
                              providerId: MODEL_NODE_KINDS.has(nextKind)
                                ? MODEL_NODE_KINDS.has(selectedNode.kind)
                                  ? selectedNode.providerId
                                  : ''
                                : nextKind === 'human_gate'
                                  ? 'human'
                                  : nextKind === 'shell'
                                    ? 'shell'
                                    : 'system',
                            });
                          }}
                        >
                          <option value="llm">{tr('AI 模型节点', 'AI Model Node')}</option>
                          <option value="consensus">{tr('汇总与投票', 'Merge & Judge')}</option>
                          <option value="debate">{tr('双模型辩论', 'Dual-Model Debate')}</option>
                          <option value="review_loop">{tr('审查修复循环', 'Review & Fix Loop')}</option>
                          <option value="condition">{tr('条件分支 IF/ELSE', 'Condition IF/ELSE')}</option>
                          <option value="human_gate">{tr('人工拍板关', 'Human Approval Gate')}</option>
                          <option value="delay">{tr('延时等待', 'Delay')}</option>
                          <option value="file_read">{tr('读取工作区文件', 'Read File')}</option>
                          <option value="file_write">{tr('写入本地文件', 'Write File')}</option>
                          <option value="shell">{tr('Shell 命令', 'Shell Command')}</option>
                          <option value="http">{tr('HTTP / Webhook', 'HTTP / Webhook')}</option>
                        </select>
                      </div>

                      {MODEL_NODE_KINDS.has(selectedNode.kind) && (
                        <div className="cc-field" style={{ marginBottom: 0 }}>
                          <label>
                            {selectedNode.kind === 'debate'
                              ? tr('正方模型', 'Side A Model')
                              : selectedNode.kind === 'review_loop'
                                ? tr('审查模型', 'Reviewer Model')
                                : tr('执行模型', 'Model')}
                          </label>
                          <select
                            className="select"
                            style={{ padding: '5px 8px', fontSize: 12 }}
                            value={selectedNode.providerId || ''}
                            onChange={(e) =>
                              void onSaveNode({ ...selectedNode, providerId: e.target.value })
                            }
                          >
                            <option value="">{tr('自动选择在线模型', 'Auto Select Online')}</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.shortName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Debate / Review Loop partner model & rounds */}
                  {(selectedNode.kind === 'review_loop' || selectedNode.kind === 'debate') && (
                    <div className="grid-2" style={{ marginBottom: 10 }}>
                      <div className="cc-field" style={{ marginBottom: 0 }}>
                        <label>{selectedNode.kind === 'debate' ? tr('反方模型', 'Side B Model') : tr('修复模型', 'Fixer Model')}</label>
                        <select
                          className="select"
                          style={{ padding: '5px 8px', fontSize: 12 }}
                          value={selectedNode.fixProviderId || ''}
                          onChange={(e) =>
                            void onSaveNode({ ...selectedNode, fixProviderId: e.target.value })
                          }
                        >
                          <option value="">{tr('自动选择', 'Auto')}</option>
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.shortName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="cc-field" style={{ marginBottom: 0 }}>
                        <label>{tr('最大轮次', 'Max Rounds')}</label>
                        <input
                          type="number"
                          min={1}
                          max={selectedNode.kind === 'debate' ? 4 : 6}
                          className="input"
                          style={{ padding: '5px 8px', fontSize: 12 }}
                          value={selectedNode.maxRounds ?? 2}
                          onChange={(e) =>
                            void onSaveNode({
                              ...selectedNode,
                              maxRounds: Math.max(1, Math.min(6, Number(e.target.value) || 2)),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* Condition node rules */}
                  {selectedNode.kind === 'condition' && (
                    <>
                      <div className="grid-2" style={{ marginBottom: 10 }}>
                        <div className="cc-field" style={{ marginBottom: 0 }}>
                          <label>判断方式</label>
                          <select
                            className="select"
                            style={{ padding: '5px 8px', fontSize: 12 }}
                            value={selectedNode.conditionMode || 'contains'}
                            onChange={(e) =>
                              void onSaveNode({
                                ...selectedNode,
                                conditionMode: e.target.value as 'contains' | 'not_contains' | 'regex',
                              })
                            }
                          >
                            <option value="contains">上游包含关键词</option>
                            <option value="not_contains">上游不包含关键词</option>
                            <option value="regex">正则表达式匹配</option>
                          </select>
                        </div>
                        <div className="cc-field" style={{ marginBottom: 0 }}>
                          <label>匹配词 / 正则</label>
                          <input
                            className="input"
                            style={{ padding: '5px 8px', fontSize: 12 }}
                            value={draftCondPattern}
                            onChange={(e) => setDraftCondPattern(e.target.value)}
                            placeholder="例如 PASS 或通过"
                          />
                        </div>
                      </div>
                      <div className="cc-info-tip">
                        从节点底部<strong>绿色圆点(满足)</strong>与<strong>橙色圆点(不满足)</strong>分别拉线到不同下游，运行时未命中的分支会自动跳过。
                      </div>
                    </>
                  )}

                  {/* Delay node */}
                  {selectedNode.kind === 'delay' && (
                    <div className="cc-field">
                      <label>等待时长（秒，1–300）</label>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        className="input"
                        style={{ padding: '6px 9px', fontSize: 12 }}
                        value={selectedNode.delaySeconds ?? 5}
                        onChange={(e) =>
                          void onSaveNode({
                            ...selectedNode,
                            delaySeconds: Math.max(1, Math.min(300, Number(e.target.value) || 5)),
                          })
                        }
                      />
                    </div>
                  )}

                  {/* File Read node */}
                  {selectedNode.kind === 'file_read' && (
                    <div className="cc-field">
                      <label>读取的工作区相对路径（每行一个）</label>
                      <textarea
                        className="textarea"
                        rows={4}
                        style={{ fontSize: 12, fontFamily: 'monospace' }}
                        value={draftFilePaths}
                        onChange={(e) => setDraftFilePaths(e.target.value)}
                        placeholder={'package.json\nsrc/App.tsx'}
                      />
                    </div>
                  )}

                  {/* File Write node */}
                  {selectedNode.kind === 'file_write' && (
                    <>
                      <div className="cc-field">
                        <label>写入目标路径（相对于当前工作区）</label>
                        <input
                          className="input"
                          style={{ padding: '6px 9px', fontSize: 12, fontFamily: 'monospace' }}
                          value={draftTargetFile}
                          onChange={(e) => setDraftTargetFile(e.target.value)}
                          placeholder="docs/report.md"
                        />
                      </div>
                      <div className="cc-field">
                        <label>写入内容模板（默认上游产出）</label>
                        <textarea
                          className="textarea"
                          rows={4}
                          style={{ fontSize: 12 }}
                          value={draftPrompt || '{{previousOutput}}'}
                          onChange={(e) => setDraftPrompt(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {/* HTTP / Webhook node */}
                  {selectedNode.kind === 'http' && (
                    <>
                      <div className="grid-2" style={{ marginBottom: 10 }}>
                        <div className="cc-field" style={{ marginBottom: 0 }}>
                          <label>请求方法</label>
                          <select
                            className="select"
                            style={{ padding: '5px 8px', fontSize: 12 }}
                            value={selectedNode.httpMethod || 'POST'}
                            onChange={(e) =>
                              void onSaveNode({
                                ...selectedNode,
                                httpMethod: e.target.value as 'GET' | 'POST' | 'PUT',
                              })
                            }
                          >
                            <option value="POST">POST</option>
                            <option value="GET">GET</option>
                            <option value="PUT">PUT</option>
                          </select>
                        </div>
                        <div className="cc-field" style={{ marginBottom: 0 }}>
                          <label>URL 地址</label>
                          <input
                            className="input"
                            style={{ padding: '5px 8px', fontSize: 12 }}
                            value={draftHttpUrl}
                            onChange={(e) => setDraftHttpUrl(e.target.value)}
                            placeholder="https://..."
                          />
                        </div>
                      </div>
                      <div className="cc-field">
                        <label>请求头（JSON 或 Key: Value，可选）</label>
                        <textarea
                          className="textarea"
                          rows={2}
                          style={{ fontSize: 11.5, fontFamily: 'monospace' }}
                          value={draftHttpHeaders}
                          onChange={(e) => setDraftHttpHeaders(e.target.value)}
                          placeholder="Authorization: Bearer ..."
                        />
                      </div>
                      {selectedNode.httpMethod !== 'GET' && (
                        <div className="cc-field">
                          <label>请求体（支持 {'{{previousOutput}}'}）</label>
                          <textarea
                            className="textarea"
                            rows={3}
                            style={{ fontSize: 11.5, fontFamily: 'monospace' }}
                            value={draftHttpBody}
                            onChange={(e) => setDraftHttpBody(e.target.value)}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {/* Shell node */}
                  {selectedNode.kind === 'shell' && (
                    <div className="cc-field">
                      <label>Shell 命令</label>
                      <input
                        className="input"
                        style={{ padding: '6px 9px', fontSize: 12, fontFamily: 'monospace' }}
                        value={draftShellCmd}
                        onChange={(e) => setDraftShellCmd(e.target.value)}
                        placeholder="如 npm test 或 {{checkCommand}}"
                      />
                    </div>
                  )}

                  {/* Prompt template for LLM / Consensus / Review Loop */}
                  {(selectedNode.kind === 'llm' ||
                    selectedNode.kind === 'consensus' ||
                    selectedNode.kind === 'review_loop') && (
                    <div className="cc-field">
                      <div className="cc-field-row">
                        <label style={{ marginBottom: 0 }}>{tr('提示词模板', 'Prompt Template')}</label>
                        <div className="cc-var-chips">
                          {['{{requirement}}', '{{previousOutput}}', '{{repoContext}}'].map(
                            (tok) => (
                              <button
                                key={tok}
                                type="button"
                                className="cc-var-chip"
                                onClick={() =>
                                  setDraftPrompt((prev) => (prev ? `${prev}\n${tok}` : tok))
                                }
                              >
                                +{tok.replace(/[{}]/g, '')}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                      <textarea
                        className="textarea"
                        rows={5}
                        style={{ fontSize: 12 }}
                        value={draftPrompt}
                        onChange={(e) => setDraftPrompt(e.target.value)}
                      />
                    </div>
                  )}

                  {selectedNode.dependsOn && selectedNode.dependsOn.length > 0 && (
                    <div className="cc-field">
                      <label>{tr('上游依赖（点击 × 断开）', 'Upstream Dependencies (click × to unlink)')}</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {selectedNode.dependsOn.map((depId) => {
                          const depNode = workflow.nodes.find((n) => n.id === depId);
                          return (
                            <span key={depId} className="cc-dep-pill">
                              <span>{depNode?.title || depId}</span>
                              <button
                                type="button"
                                onClick={() => void handleRemoveDependency(selectedNode.id, depId)}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="cc-inspector-foot">
                  <div style={{ display: 'flex', gap: 6 }}>
                    {selectedNode.kind !== 'human_input' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void handleDeleteSelectedNode()}
                        title={tr('删除该节点', 'Delete node')}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                    {run?.requirement && selectedNode.kind !== 'human_input' && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onRerunFromNode(selectedNode.id)}
                        title={tr('从此节点开始重新执行后续画布', 'Rerun canvas starting from this node')}
                      >
                        <RotateCcw size={12} />
                        {tr('重跑', 'Rerun')}
                      </button>
                    )}
                    {run?.nodes[selectedNode.id]?.output?.trim() && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleOpenArtifact(selectedNode.id)}
                      >
                        <FileText size={12} />
                        {tr('看产出', 'Output')}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    onClick={() => void handleSaveInspector()}
                  >
                    <Save size={12} />
                    {tr('保存节点', 'Save Node')}
                  </button>
                </div>
              </aside>
            )}
          </div>
        </div>
      )}

      {/* ===== VIEW 2: CLAUDE ARTIFACTS-STYLE LIVE STAGE OUTPUT PREVIEW ===== */}
      {activeTab === 'artifacts' && (
        <div className="cc-artifacts-wrap">
          {stageArtifacts.length === 0 ? (
            <div className="cc-artifacts-empty">
              <FileText size={28} style={{ opacity: 0.45 }} />
              <div style={{ fontWeight: 650, fontSize: 14 }}>{tr('暂无阶段产出', 'No Stage Artifacts Yet')}</div>
              <p>
                {tr(
                  '在左侧输入需求并点击「运行此画布」后，每个节点的方案、接口定稿、条件判断、文件写入和审查报告都会实时呈现在这里。',
                  'Enter a task and click "Run Canvas" — outputs, decisions, file writes, and review reports from every stage will appear live here.',
                )}
              </p>
              <button
                type="button"
                className="btn btn-ink btn-sm"
                onClick={() => setActiveTab('canvas')}
              >
                {tr('返回工作流画布', 'Back to Canvas')}
              </button>
            </div>
          ) : (
            <div className="cc-artifacts-split">
              <div className="cc-artifacts-list">
                <div className="cc-artifacts-list-head">
                  <span>{tr('阶段产出', 'Artifacts')} ({stageArtifacts.length})</span>
                  <button
                    type="button"
                    className="tl-btn"
                    title={tr('导出全部产出为 Markdown', 'Export all artifacts as Markdown')}
                    onClick={() => void onExportMarkdown()}
                  >
                    <Download size={11} />
                  </button>
                </div>
                {stageArtifacts.map((art) => (
                  <button
                    key={art.id}
                    type="button"
                    className={`cc-art-item ${activeArtifact?.id === art.id ? 'active' : ''}`}
                    onClick={() => setSelectedArtifactId(art.id)}
                  >
                    <div className="cc-art-item-title">{art.title}</div>
                    <div className="cc-art-item-meta">
                      {art.author} · {art.content.length} {tr('字', 'chars')}
                    </div>
                  </button>
                ))}
              </div>

              {activeArtifact && (
                <div className="cc-artifact-doc">
                  <div className="cc-artifact-doc-head">
                    <div>
                      <div className="cc-artifact-doc-title">{activeArtifact.title}</div>
                      <div className="cc-artifact-doc-meta">
                        {tr('产出方：', 'Author: ')}{activeArtifact.author}
                        {activeArtifact.durationMs
                          ? ` · ${tr('耗时', 'Time')} ${(activeArtifact.durationMs / 1000).toFixed(1)}s`
                          : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {onArchiveOutputToKnowledge && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            void onArchiveOutputToKnowledge(
                              activeArtifact.title,
                              activeArtifact.content,
                            )
                          }
                        >
                          <BookOpen size={12} />
                          {tr('存为全局资料', 'Save to KB')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          await navigator.clipboard.writeText(activeArtifact.content);
                          setCopiedArtifact(true);
                          setTimeout(() => setCopiedArtifact(false), 1400);
                        }}
                      >
                        <Copy size={12} />
                        {copiedArtifact ? tr('已复制', 'Copied') : tr('复制', 'Copy')}
                      </button>
                    </div>
                  </div>
                  <div className="cc-artifact-doc-body">
                    <MarkdownView content={activeArtifact.content} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export const WorkflowTemplateCanvas: React.FC<WorkflowTemplateCanvasProps> = (props) => (
  <ReactFlowProvider>
    <InnerWorkflowCanvas {...props} />
  </ReactFlowProvider>
);
