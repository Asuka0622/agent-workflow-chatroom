import React, { useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Hand,
  Loader2,
  Terminal,
  User,
} from 'lucide-react';
import type {
  NodeExecutionState,
  ProviderConfig,
  WorkflowDefinition,
  WorkflowNodeConfig,
  WorkflowRun,
} from '../../shared/types';

interface StepNodeData extends Record<string, unknown> {
  config: WorkflowNodeConfig;
  state?: NodeExecutionState;
  provider?: ProviderConfig;
  selectedNodeId: string | null;
}

interface LaneBackdropData extends Record<string, unknown> {
  title: string;
  laneClass: string;
  isRelease?: boolean;
}

const LaneBackdropNode: React.FC<NodeProps<Node<LaneBackdropData>>> = ({ data }) => {
  if (data.isRelease) {
    return (
      <div className="release-zone">
        <div className="release-zone-title">{data.title}</div>
      </div>
    );
  }
  return (
    <div className={`lane-backdrop ${data.laneClass}`}>
      <div className="lane-header">{data.title}</div>
    </div>
  );
};

const StepNode: React.FC<NodeProps<Node<StepNodeData>>> = ({ data }) => {
  const { config, state, provider, selectedNodeId } = data;
  const status = state?.status || 'idle';
  const isSelected = selectedNodeId === config.id;

  const statusMeta = (() => {
    switch (status) {
      case 'running':
        return { icon: <Loader2 size={13} className="spin" />, text: state?.round ? `第${state.round}轮运行中` : '运行中' };
      case 'waiting_approval':
        return { icon: <Hand size={13} />, text: '待你拍板' };
      case 'completed':
        return {
          icon: <CheckCircle2 size={13} />,
          text:
            state?.durationMs !== undefined
              ? `完成 ${(state.durationMs / 1000).toFixed(1)}s`
              : '已完成',
        };
      case 'failed':
        return { icon: <AlertCircle size={13} />, text: '失败' };
      default:
        return { icon: <Clock size={12} />, text: '待执行' };
    }
  })();

  const providerLabel =
    config.providerId === 'human'
      ? '人工'
      : config.providerId === 'shell'
        ? 'Shell / Git'
        : provider?.shortName || config.providerId;

  const providerDotColor =
    config.providerId === 'human'
      ? '#0284c7'
      : config.providerId === 'shell'
        ? '#475569'
        : provider?.accentColor || '#64748b';

  return (
    <div
      className={`wf-node lane-${config.lane} status-${status} ${isSelected ? 'selected' : ''}`}
      style={{ width: config.width || 240 }}
    >
      <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="right" style={{ opacity: 0 }} />

      <div className="wf-node-top">
        <div className="wf-node-title">{config.title}</div>
        <div className={`status-badge ${status}`}>
          {statusMeta.icon}
          <span>{statusMeta.text}</span>
        </div>
      </div>

      {config.subtitle && (
        <div className="wf-node-subtitle">{config.subtitle}</div>
      )}

      <div className="wf-node-footer">
        <span className="provider-chip">
          {config.providerId === 'human' ? (
            <User size={11} color={providerDotColor} />
          ) : config.providerId === 'shell' ? (
            <Terminal size={11} color={providerDotColor} />
          ) : (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: providerDotColor,
                display: 'inline-block',
              }}
            />
          )}
          {providerLabel}
        </span>

        {state?.usedMock && status !== 'idle' && (
          <span style={{ color: '#b45309', fontSize: 10.5, fontWeight: 600 }}>
            演练
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="left" style={{ opacity: 0 }} />
    </div>
  );
};

const nodeTypes = {
  laneBackdrop: LaneBackdropNode,
  stepNode: StepNode,
};

interface WorkflowCanvasProps {
  workflow: WorkflowDefinition;
  providers: ProviderConfig[];
  run: WorkflowRun | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  workflow,
  providers,
  run,
  selectedNodeId,
  onSelectNode,
}) => {
  const nodes = useMemo<Node[]>(() => {
    const providerMap = new Map(providers.map((p) => [p.id, p]));

    const backdrops: Node<LaneBackdropData>[] = [
      {
        id: 'bg-human',
        type: 'laneBackdrop',
        position: { x: 16, y: 12 },
        style: { width: 238, height: 910, zIndex: -1 },
        draggable: false,
        selectable: false,
        focusable: false,
        data: { title: '我（需求 & 拍板）', laneClass: 'lane-human' },
      },
      {
        id: 'bg-claude',
        type: 'laneBackdrop',
        position: { x: 278, y: 12 },
        style: { width: 344, height: 910, zIndex: -1 },
        draggable: false,
        selectable: false,
        focusable: false,
        data: { title: 'Claude（主控）', laneClass: 'lane-claude' },
      },
      {
        id: 'bg-gemini',
        type: 'laneBackdrop',
        position: { x: 642, y: 12 },
        style: { width: 258, height: 910, zIndex: -1 },
        draggable: false,
        selectable: false,
        focusable: false,
        data: { title: 'Gemini（方案 & 审稿）', laneClass: 'lane-gemini' },
      },
      {
        id: 'bg-codex',
        type: 'laneBackdrop',
        position: { x: 920, y: 12 },
        style: { width: 266, height: 910, zIndex: -1 },
        draggable: false,
        selectable: false,
        focusable: false,
        data: { title: 'Codex (GPT 后端)', laneClass: 'lane-codex' },
      },
      {
        id: 'bg-release',
        type: 'laneBackdrop',
        position: { x: 16, y: 952 },
        style: { width: 1170, height: 165, zIndex: -1 },
        draggable: false,
        selectable: false,
        focusable: false,
        data: {
          title: '开合并请求以后，一路自动到上线',
          laneClass: 'lane-release',
          isRelease: true,
        },
      },
    ];

    const stepNodes: Node<StepNodeData>[] = workflow.nodes.map((cfg) => ({
      id: cfg.id,
      type: 'stepNode',
      position: cfg.position,
      draggable: false,
      data: {
        config: cfg,
        state: run?.nodes[cfg.id],
        provider: providerMap.get(cfg.providerId),
        selectedNodeId,
      },
    }));

    return [...backdrops, ...stepNodes];
  }, [workflow, providers, run, selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    return workflow.edges.map((e) => {
      const srcStatus = run?.nodes[e.source]?.status;
      const dstStatus = run?.nodes[e.target]?.status;
      const active =
        dstStatus === 'running' ||
        dstStatus === 'waiting_approval' ||
        (srcStatus === 'completed' && dstStatus === 'completed');

      const stroke =
        dstStatus === 'running'
          ? '#2563eb'
          : dstStatus === 'waiting_approval'
            ? '#d97706'
            : srcStatus === 'completed' && dstStatus === 'completed'
              ? '#16a34a'
              : '#94a3b8';

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: 'smoothstep',
        label: e.label,
        animated: dstStatus === 'running' || dstStatus === 'waiting_approval',
        labelStyle: {
          fontSize: 11.5,
          fontWeight: 600,
          fill: '#334155',
        },
        labelBgStyle: {
          fill: '#ffffff',
          fillOpacity: 0.92,
        },
        style: {
          stroke,
          strokeWidth: active ? 2.2 : 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 16,
          height: 16,
        },
      };
    });
  }, [workflow, run]);

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.35}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_evt, node) => {
          if (node.type === 'stepNode') {
            onSelectNode(node.id);
          }
        }}
      >
        <Background color="#cbd5e1" gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            if (n.type !== 'stepNode') return 'transparent';
            const st = (n.data as StepNodeData).state?.status;
            if (st === 'completed') return '#16a34a';
            if (st === 'running') return '#2563eb';
            if (st === 'waiting_approval') return '#d97706';
            if (st === 'failed') return '#dc2626';
            return '#94a3b8';
          }}
        />
      </ReactFlow>
    </div>
  );
};
