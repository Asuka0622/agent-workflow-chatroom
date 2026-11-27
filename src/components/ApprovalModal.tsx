import React, { useState } from 'react';
import { CheckCircle2, RotateCcw, X } from 'lucide-react';
import type {
  ApprovalPayload,
  ProviderConfig,
  WorkflowDefinition,
  WorkflowRun,
} from '../../shared/types';
import { MarkdownView } from './MarkdownView';

interface ApprovalModalProps {
  run: WorkflowRun;
  workflow: WorkflowDefinition;
  providers: ProviderConfig[];
  onClose: () => void;
  onSubmit: (payload: ApprovalPayload) => Promise<void>;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  run,
  workflow,
  providers,
  onClose,
  onSubmit,
}) => {
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const providerMap = new Map(providers.map((p) => [p.id, p.shortName]));
  const getLabel = (nodeId: string, fallback: string) => {
    const used = run.nodes[nodeId]?.providerUsed;
    if (used) return used;
    const cfg = workflow.nodes.find((n) => n.id === nodeId);
    return (cfg && providerMap.get(cfg.providerId)) || fallback;
  };

  const labelA = getLabel('proposal_a', '模型 A');
  const labelB = getLabel('proposal_b', '模型 B');
  const labelSynth = getLabel('synthesize', '合成模型');

  const proposalA = run.nodes.proposal_a?.output || '（暂无方案 A 产出）';
  const proposalB = run.nodes.proposal_b?.output || '（暂无方案 B 产出）';
  const synthesis = run.nodes.synthesize?.output || '（暂无合成方案）';

  const handleAction = async (decision: 'approved' | 'rejected') => {
    setError('');
    if (decision === 'rejected' && !feedback.trim()) {
      setError('打回重议时请先填写修改意见，方案板块会按你的意见重出一轮。');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ decision, feedback: feedback.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>人工拍板：双方案对比与合成定稿</h2>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
              方案 A（{labelA}）与方案 B（{labelB}）已完成对比合成，确认后继续推进后续板块。
            </div>
          </div>
          <button className="btn btn-sm" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="compare-grid">
            <div className="compare-col">
              <div className="compare-col-head">方案 A · {labelA}</div>
              <div className="compare-col-body">
                <MarkdownView content={proposalA} />
              </div>
            </div>

            <div className="compare-col">
              <div className="compare-col-head">方案 B · {labelB}</div>
              <div className="compare-col-body">
                <MarkdownView content={proposalB} />
              </div>
            </div>

            <div className="compare-col" style={{ borderColor: '#93c5fd', background: '#fff' }}>
              <div className="compare-col-head" style={{ background: '#eff6ff' }}>
                合成定稿 · {labelSynth}
              </div>
              <div className="compare-col-body">
                <MarkdownView content={synthesis} />
              </div>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 6 }}>
            <label>补充说明 / 打回修改意见（打回时必填，通过时可选）</label>
            <textarea
              className="textarea"
              rows={3}
              placeholder="例如：按合成方案执行；或打回重议，改用更轻量的本地存储方案..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: 12.5, fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-danger"
            disabled={submitting}
            onClick={() => handleAction('rejected')}
          >
            <RotateCcw size={14} />
            打回重议
          </button>
          <button
            className="btn btn-success"
            disabled={submitting}
            onClick={() => handleAction('approved')}
          >
            <CheckCircle2 size={14} />
            拍板通过，继续推进
          </button>
        </div>
      </div>
    </div>
  );
};
