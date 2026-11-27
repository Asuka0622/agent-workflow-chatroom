import React from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Circle,
  Hand,
  Loader2,
  SkipForward,
} from 'lucide-react';
import type {
  NodeExecutionState,
  ProviderConfig,
  WorkflowDefinition,
  WorkflowRun,
} from '../../shared/types';

interface SimpleFlowProps {
  workflow: WorkflowDefinition;
  providers: ProviderConfig[];
  run: WorkflowRun | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onChangeNodeProvider: (nodeId: string, providerId: string) => void;
}

export const SimpleFlow: React.FC<SimpleFlowProps> = ({
  workflow,
  providers,
  run,
  selectedNodeId,
  onSelectNode,
  onChangeNodeProvider,
}) => {
  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const renderCard = (nodeId: string, compact = false) => {
    const cfg = nodeMap.get(nodeId);
    if (!cfg) return null;
    const state: NodeExecutionState | undefined = run?.nodes[nodeId];
    const isDisabled = cfg.enabled === false;
    const status = isDisabled ? 'skipped' : state?.status || 'idle';
    const isSelected = selectedNodeId === nodeId;
    const isHuman = cfg.kind === 'human_input' || cfg.kind === 'human_gate';
    const provider = providerMap.get(cfg.providerId);
    const dotColor = isDisabled
      ? '#9ca3af'
      : isHuman
        ? '#0284c7'
        : provider?.accentColor || '#64748b';

    const statusEl = (() => {
      switch (status) {
        case 'running':
          return (
            <span className="sf-status running">
              <Loader2 size={12} className="spin" />
              {state?.round ? `第${state.round}轮` : '运行中'}
            </span>
          );
        case 'waiting_approval':
          return (
            <span className="sf-status waiting">
              <Hand size={12} />
              待拍板
            </span>
          );
        case 'completed':
          return (
            <span className="sf-status done">
              <CheckCircle2 size={12} />
              {state?.durationMs !== undefined && state.durationMs > 0
                ? `${(state.durationMs / 1000).toFixed(1)}s`
                : '完成'}
            </span>
          );
        case 'failed':
          return (
            <span className="sf-status fail">
              <AlertCircle size={12} />
              失败
            </span>
          );
        case 'skipped':
          return (
            <span className="sf-status skipped">
              <SkipForward size={12} />
              已跳过
            </span>
          );
        default:
          return (
            <span className="sf-status idle">
              <Circle size={9} />
              待执行
            </span>
          );
      }
    })();

    return (
      <div
        role="button"
        tabIndex={0}
        className={`sf-card status-${status} ${isSelected ? 'selected' : ''} ${compact ? 'compact' : ''} ${isDisabled ? 'disabled' : ''}`}
        onClick={() => onSelectNode(cfg.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectNode(cfg.id);
          }
        }}
      >
        <div className="sf-card-row">
          <div className="sf-title-group">
            <span className="sf-dot" style={{ background: dotColor }} />
            <span className="sf-title">{cfg.title}</span>
          </div>
          <div className="sf-meta">{statusEl}</div>
        </div>

        <div className="sf-card-bottom">
          {cfg.subtitle && <div className="sf-sub">{cfg.subtitle}</div>}

          {isHuman ? (
            <span className="sf-human-tag">人工</span>
          ) : (
            <select
              className="sf-model-select"
              value={cfg.providerId}
              disabled={isDisabled}
              title="切换该板块使用的订阅模型"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                onChangeNodeProvider(cfg.id, e.target.value);
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.shortName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    );
  };

  const isActiveLine = (fromId: string, toId: string) => {
    const s = run?.nodes[fromId]?.status;
    const t = run?.nodes[toId]?.status;
    return (
      t === 'running' ||
      t === 'waiting_approval' ||
      (s === 'completed' && t === 'completed')
    );
  };

  return (
    <div className="sf-board">
      <div className="sf-column">
        {renderCard('user_requirement')}

        <div
          className={`sf-connector ${isActiveLine('user_requirement', 'proposal_a') ? 'active' : ''}`}
        >
          <span className="sf-conn-label">并行各出一份</span>
          <ArrowDown size={14} />
        </div>

        <div className="sf-pair">
          {renderCard('proposal_a', true)}
          {renderCard('proposal_b', true)}
        </div>

        <div
          className={`sf-connector ${isActiveLine('proposal_a', 'synthesize') ? 'active' : ''}`}
        >
          <ArrowDown size={14} />
        </div>

        {renderCard('synthesize')}

        <div
          className={`sf-connector ${isActiveLine('synthesize', 'user_approve') ? 'active' : ''}`}
        >
          <ArrowDown size={14} />
        </div>

        {renderCard('user_approve')}

        <div
          className={`sf-connector ${isActiveLine('user_approve', 'design_spec') ? 'active' : ''}`}
        >
          <ArrowDown size={14} />
        </div>

        {renderCard('design_spec')}

        <div
          className={`sf-connector ${isActiveLine('design_spec', 'backend_dev') ? 'active' : ''}`}
        >
          <span className="sf-conn-label">派活单</span>
          <ArrowDown size={14} />
        </div>

        <div className="sf-pair-arrow">
          {renderCard('backend_dev', true)}
          <div
            className={`sf-h-arrow ${isActiveLine('backend_dev', 'frontend_test') ? 'active' : ''}`}
          >
            <span>回执</span>
            <ArrowRight size={14} />
          </div>
          {renderCard('frontend_test', true)}
        </div>

        <div
          className={`sf-connector ${isActiveLine('frontend_test', 'code_review') ? 'active' : ''}`}
        >
          <ArrowDown size={14} />
        </div>

        {renderCard('code_review')}
      </div>
    </div>
  );
};
