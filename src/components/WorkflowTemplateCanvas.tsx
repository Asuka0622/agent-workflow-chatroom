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
  Terminal,
  Trash2,
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

type CanvasTab = 'canvas' | 'artifacts';

interface CanvasNodeData extends Record<string, unknown> {
  config: WorkflowNodeConfig;
  state?: NodeExecutionState;
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

const KIND_META: Record<NodeKind, { label: string; color: string }> = {
  human_input: { label: '输入', color: '#0284c7' },
  llm: { label: 'AI 节点', color: '#8b5cf6' },
  consensus: { label: '汇总投票', color: '#6366f1' },
  debate: { label: '双模型辩论', color: '#ec4899' },
  review_loop: { label: '审查循环', color: '#059669' },
  condition: { label: '条件分支', color: '#f59e0b' },
  human_gate: { label: '人工拍板', color: '#d97706' },
  delay: { label: '延时等待', color: '#64748b' },
  file_read: { label: '读取文件', color: '#0ea5e9' },
  file_write: { label: '写入文件', color: '#10b981' },
  shell: { label: 'Shell 命令', color: '#475569' },
  http: { label: 'HTTP 请求', color: '#2563eb' },
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
  desc: string;
}

const NODE_PALETTE_GROUPS: Array<{ title: string; items: PaletteItem[] }> = [
  {
    title: 'AI 协作节点',
    items: [
      { kind: 'llm', mode: 'child', label: 'AI 模型节点', desc: '单模型完成分析、编码或文案' },
      { kind: 'llm', mode: 'parallel', label: '并行分支节点', desc: '与当前节点同时跑多视角' },
      { kind: 'consensus', mode: 'child', label: '汇总与投票', desc: '对比多路产出并输出唯一结论' },
      { kind: 'debate', mode: 'child', label: '双模型辩论', desc: '正反两模型互评质询 N 轮' },
      { kind: 'review_loop', mode: 'child', label: '审查修复循环', desc: '审查找问题 → 自动修复循环' },
    ],
  },
  {
    title: '流程控制',
    items: [
      { kind: 'condition', mode: 'child', label: '条件分支 IF/ELSE', desc: '按关键词/正则分流走不同路径' },
      { kind: 'human_gate', mode: 'child', label: '人工拍板关', desc: '暂停等待人工通过或打回重议' },
      { kind: 'delay', mode: 'child', label: '延时等待', desc: '暂停指定秒数后再继续下游' },
    ],
  },
  {
    title: '工具与文件读写',
    items: [
      { kind: 'file_read', mode: 'child', label: '读取工作区文件', desc: '读取本地代码/文档喂给下游' },
      { kind: 'file_write', mode: 'child', label: '写入本地文件', desc: '将上游产出自动落盘保存' },
      { kind: 'shell', mode: 'child', label: 'Shell 命令', desc: '执行测试、构建或 Git 脚本' },
      { kind: 'http', mode: 'child', label: 'HTTP / Webhook', desc: '调接口或推送飞书/企微通知' },
    ],
  },
];

const MODEL_NODE_KINDS = new Set<NodeKind>(['llm', 'consensus', 'debate', 'review_loop']);

const CanvasStepNode: React.FC<NodeProps<Node<CanvasNodeData>>> = ({ data }) => {
  const {
    config,
    state,
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

  const statusPill = (() => {
    switch (status) {
      case 'running':
        return {
          icon: <Loader2 size={11} className="spin" />,
          text: state?.round ? `第${state.round}轮` : '运行中',
          cls: 'is-running',
        };
      case 'waiting_approval':
        return { icon: <Hand size={11} />, text: '待拍板', cls: 'is-waiting' };
      case 'completed':
        return {
          icon: <CheckCircle2 size={11} />,
          text:
            isCondition && state?.branchResult
              ? state.branchResult === 'true'
                ? '满足'
                : '不满足'
              : state?.durationMs !== undefined
                ? `${(state.durationMs / 1000).toFixed(1)}s`
                : '完成',
          cls: 'is-done',
        };
      case 'failed':
        return { icon: <AlertCircle size={11} />, text: '失败', cls: 'is-failed' };
      case 'skipped':
        return { icon: <SkipForward size={11} />, text: '跳过', cls: 'is-skipped' };
      default:
        return { icon: <Circle size={10} />, text: '待命', cls: 'is-idle' };
    }
  })();

  const footerMeta = (() => {
    switch (config.kind) {
      case 'human_input':
        return { icon: <User size={11} />, text: '任务起点' };
      case 'human_gate':
        return { icon: <Hand size={11} />, text: '人工确认关卡' };
      case 'condition': {
        const modeText =
          config.conditionMode === 'regex'
            ? '正则'
            : config.conditionMode === 'not_contains'
              ? '不含'
              : '包含';
        return {
          icon: <GitFork size={11} />,
          text: `${modeText} "${config.conditionPattern || 'PASS'}"`,
        };
      }
      case 'file_read':
        return {
          icon: <FileInput size={11} />,
          text: config.filePaths?.split(/[\r\n,]+/)[0]?.trim() || '配置读取路径',
        };
      case 'file_write':
        return {
          icon: <FileDown size={11} />,
          text: config.targetFilePath?.trim() || '输出文件.md',
        };
      case 'http':
        return {
          icon: <Globe size={11} />,
          text: `${config.httpMethod || 'POST'} ${config.httpUrl ? config.httpUrl.replace(/^https?:\/\//, '').slice(0, 18) : '配置 URL'}`,
        };
      case 'delay':
        return {
          icon: <Clock size={11} />,
          text: `等待 ${config.delaySeconds ?? 5} 秒`,
        };
      case 'shell':
        return {
          icon: <Terminal size={11} />,
          text: config.shellCommand?.slice(0, 20) || '本地命令',
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
          <span>{kindMeta.label}</span>
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
              title="为当前画布节点指派模型"
            >
              <option value="">自动选择模型</option>
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
              title="查看本节点产出预览"
              onClick={() => onOpenArtifact(config.id)}
            >
              <FileText size={11} />
            </button>
          )}
          {config.kind !== 'human_input' && (
            <button
              type="button"
              className="cc-mini-btn"
              title={disabled ? '启用该节点' : '跳过该节点'}
              onClick={() => onQuickToggleEnabled(config.id)}
            >
              <SkipForward size={11} />
            </button>
          )}
          <button
            type="button"
            className="cc-mini-btn"
            title="在此节点后追加下游节点"
            onClick={() => onQuickAddChild(config.id)}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {isCondition ? (
        <>
          <div className="cc-cond-handle-labels">
            <span className="is-true">满足</span>
            <span className="is-false">不满足</span>
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
  onDeleteTemplate: (templateId: string) => Promise<void>;
  onRunWorkflow: (promptText?: string) => void;
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
  onDeleteTemplate,
  onRunWorkflow,
  onRerunFromNode,
  onOpenApproval,
  onExportMarkdown,
  onArchiveOutputToKnowledge,
  hasComposerInput,
}) => {
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
    return workflow.nodes.map((cfg) => ({
      id: cfg.id,
      type: 'canvasStep',
      position: resolvedPositions[cfg.id] || { x: 240, y: 40 },
      draggable: true,
      data: {
        config: cfg,
        state: run?.nodes[cfg.id],
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
    }));
  }, [
    workflow.nodes,
    resolvedPositions,
    run,
    providers,
    selectedNodeId,
    handleQuickModelChange,
    handleQuickToggleEnabled,
    handleQuickAddChild,
    handleOpenArtifact,
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
  const progressDone = workflow.nodes.filter(
    (n) => n.enabled !== false && run?.nodes[n.id]?.status === 'completed',
  ).length;
  const progressTotal = workflow.nodes.filter((n) => n.enabled !== false).length || 1;

  return (
    <section className={`claude-canvas-pane ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* Claude Canvas Minimalist Header */}
      <header className="cc-header">
        <div className="cc-header-left">
          <span className="cc-brand-icon" title="可视化工作流画布">
            <Layers size={14} />
          </span>

          <select
            className="cc-tpl-select"
            value={activeTemplate ? activeTemplate.id : '__custom__'}
            onChange={(e) => {
              const id = e.target.value;
              if (id !== '__custom__') void onApplyTemplate(id);
            }}
            title="切换工作流模板"
          >
            {!activeTemplate && <option value="__custom__">{workflow.name}</option>}
            {workflowTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（{t.workflow.nodes.length}步）{t.builtin ? '' : ' · 自定义'}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="studio-icon-btn"
            title="另存当前画布为新模板"
            onClick={() => {
              setTplNameDraft(`${workflow.name}（自定义）`);
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
              title="删除此自定义模板"
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
              <span>画布</span>
            </button>
            <button
              type="button"
              className={activeTab === 'artifacts' ? 'active' : ''}
              onClick={() => setActiveTab('artifacts')}
            >
              <FileText size={12} />
              <span>产出{stageArtifacts.length > 0 ? ` (${stageArtifacts.length})` : ''}</span>
            </button>
          </div>

          <button
            type="button"
            className="studio-icon-btn"
            title={isFullscreen ? '恢复左右分屏' : '全屏展开画布'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          <button
            type="button"
            className="studio-icon-btn"
            title="关闭画布"
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
            placeholder="新模板名称"
            value={tplNameDraft}
            onChange={(e) => setTplNameDraft(e.target.value)}
            autoFocus
          />
          <input
            className="input"
            style={{ flex: 1, padding: '5px 9px', fontSize: 12 }}
            placeholder="简短说明（可选）"
            value={tplDescDraft}
            onChange={(e) => setTplDescDraft(e.target.value)}
          />
          <button type="button" className="btn btn-sm" onClick={() => setShowSaveTpl(false)}>
            取消
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
            保存模板
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
                title="打开全套常用节点库（AI 协作 / 流程控制 / 文件与工具）"
              >
                <Plus size={12} />
                <span>添加节点</span>
                <ChevronDown size={11} />
              </button>

              {showNodePalette && (
                <div className="cc-node-palette" onClick={(e) => e.stopPropagation()}>
                  {NODE_PALETTE_GROUPS.map((grp) => (
                    <div key={grp.title} className="cc-palette-group">
                      <div className="cc-palette-group-title">{grp.title}</div>
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
                                <div className="cc-palette-name">{item.label}</div>
                                <div className="cc-palette-desc">{item.desc}</div>
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
              title="在当前节点旁添加一个并行分支节点"
            >
              <GitBranch size={12} />
              <span>并行</span>
            </button>

            <button
              type="button"
              className="cc-tool-btn"
              onClick={() => void addNodeToCanvas('condition', 'child')}
              title="快速添加条件分支 IF/ELSE 节点"
            >
              <GitFork size={12} />
              <span>条件</span>
            </button>

            <button
              type="button"
              className="cc-tool-btn"
              onClick={() => void handleAutoLayout()}
              title="按上下游依赖自动整齐排布所有节点"
            >
              <LayoutGrid size={12} />
              <span>自动排布</span>
            </button>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              {isWaitingApproval && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ borderColor: '#d97706', color: '#d97706' }}
                  onClick={onOpenApproval}
                >
                  <Hand size={12} />
                  <span>去拍板</span>
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
                <span>运行此画布</span>
              </button>
            </div>
          </div>

          {showQuickRunPrompt && (
            <div className="cc-quick-run-bar">
              <input
                className="input"
                style={{ flex: 1, padding: '6px 10px', fontSize: 12.5 }}
                placeholder="输入任务需求，回车直接按当前画布模板运行..."
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
                  onRunWorkflow(quickRunText.trim());
                  setQuickRunText('');
                  setShowQuickRunPrompt(false);
                }}
              >
                启动
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
              拖拽排版 · 从底部圆点拖线连下游 · 条件节点支持绿(满足)/橙(不满足)双出口 · 进度 {progressDone}/{progressTotal}
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
                    title="收起属性面板"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="cc-inspector-body">
                  <div className="cc-field">
                    <label>节点标题</label>
                    <input
                      className="input"
                      style={{ padding: '6px 9px', fontSize: 12.5 }}
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                    />
                  </div>

                  <div className="cc-field">
                    <label>职责说明</label>
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
                        <label>节点类型</label>
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
                          <option value="llm">AI 模型节点</option>
                          <option value="consensus">汇总与投票</option>
                          <option value="debate">双模型辩论</option>
                          <option value="review_loop">审查修复循环</option>
                          <option value="condition">条件分支 IF/ELSE</option>
                          <option value="human_gate">人工拍板关</option>
                          <option value="delay">延时等待</option>
                          <option value="file_read">读取工作区文件</option>
                          <option value="file_write">写入本地文件</option>
                          <option value="shell">Shell 命令</option>
                          <option value="http">HTTP / Webhook</option>
                        </select>
                      </div>

                      {MODEL_NODE_KINDS.has(selectedNode.kind) && (
                        <div className="cc-field" style={{ marginBottom: 0 }}>
                          <label>
                            {selectedNode.kind === 'debate'
                              ? '正方模型'
                              : selectedNode.kind === 'review_loop'
                                ? '审查模型'
                                : '执行模型'}
                          </label>
                          <select
                            className="select"
                            style={{ padding: '5px 8px', fontSize: 12 }}
                            value={selectedNode.providerId || ''}
                            onChange={(e) =>
                              void onSaveNode({ ...selectedNode, providerId: e.target.value })
                            }
                          >
                            <option value="">自动选择在线模型</option>
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
                        <label>{selectedNode.kind === 'debate' ? '反方模型' : '修复模型'}</label>
                        <select
                          className="select"
                          style={{ padding: '5px 8px', fontSize: 12 }}
                          value={selectedNode.fixProviderId || ''}
                          onChange={(e) =>
                            void onSaveNode({ ...selectedNode, fixProviderId: e.target.value })
                          }
                        >
                          <option value="">自动选择</option>
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.shortName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="cc-field" style={{ marginBottom: 0 }}>
                        <label>最大轮次</label>
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
                        <label style={{ marginBottom: 0 }}>提示词模板</label>
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
                      <label>上游依赖（点击 × 断开）</label>
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
                        title="删除该节点"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                    {run?.requirement && selectedNode.kind !== 'human_input' && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onRerunFromNode(selectedNode.id)}
                        title="从此节点开始重新执行后续画布"
                      >
                        <RotateCcw size={12} />
                        重跑
                      </button>
                    )}
                    {run?.nodes[selectedNode.id]?.output?.trim() && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleOpenArtifact(selectedNode.id)}
                      >
                        <FileText size={12} />
                        看产出
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    onClick={() => void handleSaveInspector()}
                  >
                    <Save size={12} />
                    保存节点
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
              <div style={{ fontWeight: 650, fontSize: 14 }}>暂无阶段产出</div>
              <p>
                在左侧输入需求并点击「运行此画布」后，每个节点的方案、接口定稿、条件判断、文件写入和审查报告都会实时呈现在这里。
              </p>
              <button
                type="button"
                className="btn btn-ink btn-sm"
                onClick={() => setActiveTab('canvas')}
              >
                返回工作流画布
              </button>
            </div>
          ) : (
            <div className="cc-artifacts-split">
              <div className="cc-artifacts-list">
                <div className="cc-artifacts-list-head">
                  <span>阶段产出 ({stageArtifacts.length})</span>
                  <button
                    type="button"
                    className="tl-btn"
                    title="导出全部产出为 Markdown"
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
                      {art.author} · {art.content.length} 字
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
                        产出方：{activeArtifact.author}
                        {activeArtifact.durationMs
                          ? ` · 耗时 ${(activeArtifact.durationMs / 1000).toFixed(1)}s`
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
                          存为全局资料
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
                        {copiedArtifact ? '已复制' : '复制'}
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
