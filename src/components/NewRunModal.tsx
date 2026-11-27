import React, { useState } from 'react';
import { FolderOpen, Play, Sparkles, X } from 'lucide-react';
import type { CreateRunPayload, ExecutionMode } from '../../shared/types';

interface NewRunModalProps {
  defaultRepoPath: string;
  onClose: () => void;
  onCreate: (payload: CreateRunPayload) => Promise<void>;
}

const PRESETS = [
  {
    title: '新增 Markdown 报告导出功能',
    requirement:
      '给当前本地项目新增「一键导出完整 Markdown 报告」功能：前端提供导出按钮，后端汇总运行记录与节点产出生成 Markdown 文件下载，并补齐单元测试与异常提示。',
  },
  {
    title: '订单列表多条件筛选与导出',
    requirement:
      '在管理后台中实现订单多条件筛选（状态、时间区间、关键词）、后端分页优化与 CSV 导出，要求前后端接口清晰、空态和报错文案友好。',
  },
];

export const NewRunModal: React.FC<NewRunModalProps> = ({
  defaultRepoPath,
  onClose,
  onCreate,
}) => {
  const [requirement, setRequirement] = useState('');
  const [repoPath, setRepoPath] = useState(defaultRepoPath);
  const [branchName, setBranchName] = useState('');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('mock');
  const [checkCommand, setCheckCommand] = useState('npm run typecheck');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requirement.trim()) {
      setError('请先填写需求描述');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onCreate({
        requirement: requirement.trim(),
        repoPath: repoPath.trim() || defaultRepoPath,
        branchName: branchName.trim() || undefined,
        executionMode,
        checkCommand,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>新建需求</h2>
          <button className="btn btn-sm" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>运行模式</label>
              <div className="grid-2">
                <button
                  type="button"
                  className={`btn ${executionMode === 'mock' ? 'btn-primary' : ''}`}
                  style={{ height: 38 }}
                  onClick={() => setExecutionMode('mock')}
                >
                  模拟演练（不耗额度）
                </button>
                <button
                  type="button"
                  className={`btn ${executionMode === 'real' ? 'btn-success' : ''}`}
                  style={{ height: 38 }}
                  onClick={() => setExecutionMode('real')}
                >
                  真实订阅 CLI
                </button>
              </div>
            </div>

            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ margin: 0 }}>需求描述 *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="preset-chip"
                      onClick={() => setRequirement(p.requirement)}
                    >
                      <Sparkles size={11} style={{ marginRight: 3, verticalAlign: -1 }} />
                      示例 {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                className="textarea"
                rows={4}
                placeholder="直接描述你想让这几个模型协作完成的功能或改造目标..."
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
              />
            </div>

            <div className="field">
              <label>本地项目目录</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                />
                {window.desktopApi?.isDesktop && (
                  <button
                    type="button"
                    className="btn"
                    style={{ flexShrink: 0 }}
                    onClick={async () => {
                      const picked = await window.desktopApi?.pickFolder(repoPath);
                      if (picked) setRepoPath(picked);
                    }}
                  >
                    <FolderOpen size={14} />
                    选择
                  </button>
                )}
              </div>
            </div>

            <details className="advanced-details">
              <summary>高级选项（分支名 / 检查命令）</summary>
              <div className="grid-2" style={{ marginTop: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>开发分支（可选）</label>
                  <input
                    className="input"
                    placeholder="自动生成"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>自动检查命令</label>
                  <input
                    className="input"
                    value={checkCommand}
                    onChange={(e) => setCheckCommand(e.target.value)}
                  />
                </div>
              </div>
            </details>

            {error && (
              <div style={{ color: '#dc2626', fontSize: 12.5, marginTop: 10, fontWeight: 600 }}>
                {error}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <Play size={14} />
              {submitting ? '启动中...' : '开始运行'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
