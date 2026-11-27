import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import type {
  ProviderConfig,
  WorkflowDefinition,
  WorkflowNodeConfig,
  WorkflowRun,
} from '../../shared/types';

interface StageDrawerProps {
  workflow: WorkflowDefinition;
  providers: ProviderConfig[];
  run: WorkflowRun | null;
  onClose: () => void;
  onSaveNode: (updated: WorkflowNodeConfig) => Promise<void>;
  onRerunFromNode: (nodeId: string) => void;
}

export const StageDrawer: React.FC<StageDrawerProps> = ({
  workflow,
  providers,
  run,
  onClose,
  onSaveNode,
  onRerunFromNode,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});

  const providerMap = new Map(providers.map((p) => [p.id, p]));

  return (
    <aside className="stage-drawer">
      <div className="stage-drawer-head">
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>板块编排与模型分工</div>
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
            每个板块可自由换模型、跳过或改提示词
          </div>
        </div>
        <button className="btn btn-sm" onClick={onClose} title="收起">
          <X size={14} />
        </button>
      </div>

      <div className="stage-drawer-body">
        {workflow.nodes.map((node, index) => {
          const isHuman = node.kind === 'human_input' || node.kind === 'human_gate';
          const isEnabled = node.enabled !== false;
          const isExpanded = expandedId === node.id;
          const state = run?.nodes[node.id];
          const prov = providerMap.get(node.providerId);
          const dotColor = !isEnabled
            ? '#9ca3af'
            : isHuman
              ? '#0284c7'
              : prov?.accentColor || '#64748b';

          const promptVal =
            promptDrafts[node.id] !== undefined
              ? promptDrafts[node.id]
              : node.promptTemplate || '';

          return (
            <div
              key={node.id}
              className={`stage-item ${!isEnabled ? 'is-disabled' : ''}`}
            >
              <div className="stage-item-top">
                <button
                  type="button"
                  className="stage-expand-btn"
                  onClick={() => setExpandedId(isExpanded ? null : node.id)}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="sf-dot" style={{ background: dotColor }} />
                  <span className="stage-item-name">
                    {index + 1}. {node.title}
                  </span>
                </button>

                <div className="stage-item-controls">
                  {!isHuman ? (
                    <select
                      className="sf-model-select"
                      value={node.providerId}
                      disabled={!isEnabled}
                      onChange={(e) =>
                        void onSaveNode({ ...node, providerId: e.target.value })
                      }
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.shortName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="sf-human-tag">人工</span>
                  )}

                  {node.kind !== 'human_input' && (
                    <label className="stage-switch" title={isEnabled ? '点击跳过此板块' : '点击启用此板块'}>
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) =>
                          void onSaveNode({ ...node, enabled: e.target.checked })
                        }
                      />
                    </label>
                  )}
                </div>
              </div>

              {node.subtitle && (
                <div className="stage-item-sub">
                  {node.subtitle}
                  {state?.status === 'completed' && (
                    <span style={{ color: '#16a34a', marginLeft: 6 }}>✓ 已完成</span>
                  )}
                  {state?.status === 'running' && (
                    <span style={{ color: '#2563eb', marginLeft: 6 }}>● 运行中</span>
                  )}
                </div>
              )}

              {isExpanded && (
                <div className="stage-item-detail">
                  {node.kind === 'review_loop' && (
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>自动修复模型</label>
                      <select
                        className="select"
                        value={node.fixProviderId || providers[0]?.id || 'claude'}
                        onChange={(e) =>
                          void onSaveNode({ ...node, fixProviderId: e.target.value })
                        }
                      >
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.shortName}（{p.command}）
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(node.kind === 'llm' || node.kind === 'review_loop') && (
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>提示词模板</label>
                      <textarea
                        className="textarea"
                        rows={6}
                        value={promptVal}
                        onChange={(e) =>
                          setPromptDrafts((prev) => ({
                            ...prev,
                            [node.id]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {run && node.id !== 'user_requirement' && run.requirement && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onRerunFromNode(node.id)}
                      >
                        <RotateCcw size={12} />
                        从此重跑
                      </button>
                    )}
                    {(node.kind === 'llm' || node.kind === 'review_loop') && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() =>
                          void onSaveNode({ ...node, promptTemplate: promptVal })
                        }
                      >
                        <Save size={12} />
                        保存提示词
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
