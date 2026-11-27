import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Hand,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  SkipForward,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  NodeKind,
  ProviderConfig,
  WorkflowDefinition,
  WorkflowEdgeConfig,
  WorkflowNodeConfig,
  WorkflowPresetTemplate,
  WorkflowRun,
} from '../../shared/types';
import { MarkdownView } from './MarkdownView';

export type WorkspaceTab = 'progress' | 'materials' | 'stages';

interface TaskWorkspaceDrawerProps {
  workflow: WorkflowDefinition;
  workflowTemplates: WorkflowPresetTemplate[];
  providers: ProviderConfig[];
  run: WorkflowRun | null;
  activeTab: WorkspaceTab;
  onChangeTab: (tab: WorkspaceTab) => void;
  onClose: () => void;
  onSaveNode: (updated: WorkflowNodeConfig) => Promise<void>;
  onSaveWorkflow: (updated: WorkflowDefinition, toastMsg?: string) => Promise<void>;
  onApplyTemplate: (templateId: string) => Promise<void>;
  onSaveAsTemplate: (name: string, description: string) => Promise<void>;
  onDeleteTemplate: (templateId: string) => Promise<void>;
  onRerunFromNode: (nodeId: string) => void;
  onOpenApproval: () => void;
  onAddMaterial: (payload: {
    title: string;
    content: string;
    source?: 'manual' | 'file';
  }) => Promise<void>;
  onDeleteMaterial: (materialId: string) => Promise<void>;
  onExportMarkdown: () => Promise<void>;
}

/** Rebuild clean DAG dependencies and edges after add/delete/reorder while preserving parallel groups */
function rebuildWorkflowEdges(nodes: WorkflowNodeConfig[]): WorkflowDefinition['edges'] {
  const edges: WorkflowEdgeConfig[] = [];
  let idx = 1;
  for (const n of nodes) {
    for (const dep of n.dependsOn || []) {
      edges.push({ id: `e${idx++}`, source: dep, target: n.id });
    }
  }
  return edges;
}

function rewireSequentialDeps(nodes: WorkflowNodeConfig[]): WorkflowNodeConfig[] {
  const result: WorkflowNodeConfig[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const cur = { ...nodes[i] };
    if (i === 0 || cur.kind === 'human_input') {
      cur.dependsOn = [];
      cur.position = { x: 0, y: 0 };
      result.push(cur);
      continue;
    }
    const prev = result[i - 1];
    const existingValidDeps = (cur.dependsOn || []).filter((d) =>
      result.some((r) => r.id === d),
    );
    // Preserve explicit parallel group when previous node shares exact same parent(s)
    const isParallelSibling =
      existingValidDeps.length > 0 &&
      prev.dependsOn.length > 0 &&
      existingValidDeps.length === prev.dependsOn.length &&
      existingValidDeps.every((d) => prev.dependsOn.includes(d));

    if (isParallelSibling) {
      cur.dependsOn = [...prev.dependsOn];
      cur.position = { x: 1, y: prev.position.y };
    } else if (existingValidDeps.length > 1) {
      // Join node waiting on multiple preceding parallel branches
      cur.dependsOn = existingValidDeps;
      cur.position = { x: 0, y: i };
    } else {
      // Collect any parallel siblings directly before this stage
      const prevRowY = prev.position.y;
      const parallelGroup = result.filter(
        (r) => r.position.y === prevRowY && r.kind !== 'human_input',
      );
      cur.dependsOn =
        parallelGroup.length > 1 ? parallelGroup.map((r) => r.id) : [prev.id];
      cur.position = { x: 0, y: i };
    }
    result.push(cur);
  }
  return result;
}

interface PreviewDoc {
  title: string;
  subtitle?: string;
  content: string;
}

export const TaskWorkspaceDrawer: React.FC<TaskWorkspaceDrawerProps> = ({
  workflow,
  workflowTemplates,
  providers,
  run,
  activeTab,
  onChangeTab,
  onClose,
  onSaveNode,
  onSaveWorkflow,
  onApplyTemplate,
  onSaveAsTemplate,
  onDeleteTemplate,
  onRerunFromNode,
  onOpenApproval,
  onAddMaterial,
  onDeleteMaterial,
  onExportMarkdown,
}) => {
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [subtitleDrafts, setSubtitleDrafts] = useState<Record<string, string>>({});
  const [previewDoc, setPreviewDoc] = useState<PreviewDoc | null>(null);
  const [copiedDoc, setCopiedDoc] = useState(false);

  // Add custom stage form
  const [addingStage, setAddingStage] = useState(false);
  const [newStageTitle, setNewStageTitle] = useState('');
  const [newStageSubtitle, setNewStageSubtitle] = useState('');
  const [newStageKind, setNewStageKind] = useState<NodeKind>('llm');
  const [newStageProvider, setNewStageProvider] = useState('');
  const [newStageParallel, setNewStageParallel] = useState(false);
  const [newStagePrompt, setNewStagePrompt] = useState(
    '你是当前阶段负责专家（当前模型：{{providerName}}）。请结合原始需求与前序阶段产出完成本阶段工作。\n\n【用户需求】\n{{requirement}}\n\n【前序产出】\n{{previousOutput}}',
  );

  // Save as new template form
  const [savingTplMode, setSavingTplMode] = useState(false);
  const [tplNameDraft, setTplNameDraft] = useState('');
  const [tplDescDraft, setTplDescDraft] = useState('');

  // Add material form
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [matTitle, setMatTitle] = useState('');
  const [matContent, setMatContent] = useState('');
  const [savingMat, setSavingMat] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeTemplate = useMemo(
    () => workflowTemplates.find((t) => t.id === workflow.id),
    [workflowTemplates, workflow.id],
  );

  const handleMoveStage = async (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (index <= 0 || targetIdx <= 0 || targetIdx >= workflow.nodes.length) return;
    const copy = workflow.nodes.map((n) => ({ ...n, dependsOn: [] as string[] }));
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    const rewired = rewireSequentialDeps(copy);
    await onSaveWorkflow(
      { ...workflow, nodes: rewired, edges: rebuildWorkflowEdges(rewired) },
      `已调整「${moved.title}」顺序`,
    );
  };

  const handleDeleteStage = async (nodeId: string, title: string) => {
    const remaining = workflow.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({
        ...n,
        dependsOn: (n.dependsOn || []).filter((d) => d !== nodeId),
      }));
    const rewired = rewireSequentialDeps(remaining);
    await onSaveWorkflow(
      { ...workflow, nodes: rewired, edges: rebuildWorkflowEdges(rewired) },
      `已删除阶段「${title}」`,
    );
    if (expandedStageId === nodeId) setExpandedStageId(null);
  };

  const handleCreateStage = async () => {
    const title = newStageTitle.trim();
    if (!title) return;
    const id = `stage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    const prevNode = workflow.nodes[workflow.nodes.length - 1];
    const dependsOn =
      newStageParallel && prevNode && prevNode.dependsOn.length > 0
        ? [...prevNode.dependsOn]
        : prevNode
          ? [prevNode.id]
          : [];
    const newNode: WorkflowNodeConfig = {
      id,
      title,
      subtitle: newStageSubtitle.trim() || (newStageKind === 'human_gate' ? '人工确认或打回' : '自定义协作阶段'),
      lane: newStageKind === 'human_gate' ? 'human' : 'claude',
      kind: newStageKind,
      providerId: newStageKind === 'human_gate' ? 'human' : newStageProvider,
      fixProviderId: newStageKind === 'review_loop' ? '' : undefined,
      maxRounds: newStageKind === 'review_loop' ? 2 : undefined,
      enabled: true,
      dependsOn,
      position: { x: newStageParallel ? 1 : 0, y: workflow.nodes.length },
      promptTemplate: newStageKind === 'human_gate' ? undefined : newStagePrompt.trim(),
    };
    const nextNodes = rewireSequentialDeps([...workflow.nodes, newNode]);
    await onSaveWorkflow(
      { ...workflow, nodes: nextNodes, edges: rebuildWorkflowEdges(nextNodes) },
      `已新增阶段「${title}」`,
    );
    setNewStageTitle('');
    setNewStageSubtitle('');
    setNewStageKind('llm');
    setNewStageProvider('');
    setNewStageParallel(false);
    setAddingStage(false);
  };

  const handleToggleParallel = async (index: number, parallel: boolean) => {
    if (index <= 1) return;
    const copy = workflow.nodes.map((n) => ({ ...n }));
    const prev = copy[index - 1];
    copy[index] = {
      ...copy[index],
      dependsOn: parallel ? [...prev.dependsOn] : [prev.id],
    };
    const rewired = rewireSequentialDeps(copy);
    await onSaveWorkflow(
      { ...workflow, nodes: rewired, edges: rebuildWorkflowEdges(rewired) },
      parallel ? `已设为与「${prev.title}」并行` : '已改为顺序执行',
    );
  };

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  // Progress calculation
  const progressStats = useMemo(() => {
    const activeNodes = workflow.nodes.filter((n) => n.enabled !== false);
    const total = activeNodes.length || 1;
    const completed = activeNodes.filter(
      (n) => run?.nodes[n.id]?.status === 'completed',
    ).length;
    const running = activeNodes.find(
      (n) => run?.nodes[n.id]?.status === 'running',
    );
    const waiting = activeNodes.find(
      (n) => run?.nodes[n.id]?.status === 'waiting_approval',
    );
    const pct = Math.round((completed / total) * 100);
    return { total, completed, pct, running, waiting };
  }, [workflow, run]);

  // Produced stage artifacts
  const stageArtifacts = useMemo(() => {
    if (!run) return [];
    return workflow.nodes
      .map((n) => {
        const st = run.nodes[n.id];
        if (!st?.output?.trim()) return null;
        return {
          id: n.id,
          title: n.title,
          author: st.providerUsed || providerMap.get(n.providerId)?.shortName || '人工',
          content: st.output,
          status: st.status,
          updatedAt: st.finishedAt || st.startedAt || run.updatedAt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [workflow, run, providerMap]);

  const manualMaterials = run?.materials || [];

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matContent.trim()) return;
    setSavingMat(true);
    try {
      await onAddMaterial({
        title: matTitle.trim() || '参考资料',
        content: matContent.trim(),
        source: 'manual',
      });
      setMatTitle('');
      setMatContent('');
      setAddingMaterial(false);
    } finally {
      setSavingMat(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await onAddMaterial({
        title: file.name,
        content: text.slice(0, 40000),
        source: 'file',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleCopyPreview = async () => {
    if (!previewDoc) return;
    await navigator.clipboard.writeText(previewDoc.content);
    setCopiedDoc(true);
    setTimeout(() => setCopiedDoc(false), 1400);
  };

  return (
    <aside className="task-drawer">
      <div className="stage-drawer-head">
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>任务看板与资料库</div>
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 1 }}>
            进度 {progressStats.completed}/{progressStats.total} · 资料{' '}
            {manualMaterials.length + stageArtifacts.length} 份
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {window.desktopApi?.isDesktop && (
            <button
              className="btn btn-sm"
              title="在资源管理器打开本机资料目录"
              onClick={() => void window.desktopApi?.openDataDir()}
            >
              <FolderOpen size={13} />
            </button>
          )}
          <button className="btn btn-sm" onClick={onClose} title="收起">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 3 Clean Visual Tabs */}
      <div className="ws-tabs">
        <button
          type="button"
          className={`ws-tab ${activeTab === 'progress' ? 'active' : ''}`}
          onClick={() => {
            setPreviewDoc(null);
            onChangeTab('progress');
          }}
        >
          任务进度
        </button>
        <button
          type="button"
          className={`ws-tab ${activeTab === 'materials' ? 'active' : ''}`}
          onClick={() => onChangeTab('materials')}
        >
          任务资料 ({manualMaterials.length + stageArtifacts.length})
        </button>
        <button
          type="button"
          className={`ws-tab ${activeTab === 'stages' ? 'active' : ''}`}
          onClick={() => {
            setPreviewDoc(null);
            onChangeTab('stages');
          }}
        >
          板块编排
        </button>
      </div>

      <div className="stage-drawer-body">
        {/* ===== TAB 1: Visual Task Progress ===== */}
        {activeTab === 'progress' && (
          <div className="progress-panel">
            <div className="progress-summary-card">
              <div className="progress-summary-top">
                <span style={{ fontWeight: 700, fontSize: 13 }}>
                  {progressStats.waiting
                    ? '等待人工拍板'
                    : progressStats.running
                      ? `执行中：${progressStats.running.title}`
                      : progressStats.pct === 100
                        ? '全部板块已完成'
                        : progressStats.completed > 0
                          ? '任务进行中'
                          : '尚未启动板块流程'}
                </span>
                <span className="progress-pct">{progressStats.pct}%</span>
              </div>

              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressStats.pct}%` }}
                />
              </div>

              {run?.requirement ? (
                <div className="progress-req-box">
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
                    当前任务目标
                  </div>
                  <div style={{ fontSize: 12.5, color: '#1f2937', lineHeight: 1.45 }}>
                    {run.requirement}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                  在群聊输入框写需求并点「按板块跑流程」，这里会实时可视化追踪每一步进度。
                </div>
              )}

              {progressStats.waiting && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 10, width: '100%' }}
                  onClick={onOpenApproval}
                >
                  <Hand size={13} />
                  打开三栏方案对比并拍板
                </button>
              )}
            </div>

            {/* Visual Timeline */}
            <div className="timeline">
              {workflow.nodes.map((node, idx) => {
                const disabled = node.enabled === false;
                const st = run?.nodes[node.id];
                const status = disabled ? 'skipped' : st?.status || 'idle';
                const provName =
                  st?.providerUsed ||
                  (node.providerId === 'human'
                    ? '人工'
                    : providerMap.get(node.providerId)?.shortName || node.providerId);
                const hasOutput = Boolean(st?.output?.trim());

                const icon = (() => {
                  switch (status) {
                    case 'completed':
                      return <CheckCircle2 size={15} color="#16a34a" />;
                    case 'running':
                      return <Loader2 size={15} color="#2563eb" className="spin" />;
                    case 'waiting_approval':
                      return <Hand size={15} color="#d97706" />;
                    case 'failed':
                      return <AlertCircle size={15} color="#dc2626" />;
                    case 'skipped':
                      return <SkipForward size={14} color="#9ca3af" />;
                    default:
                      return <Circle size={13} color="#cbd5e1" />;
                  }
                })();

                return (
                  <div key={node.id} className={`tl-item status-${status}`}>
                    <div className="tl-rail">
                      <div className="tl-icon">{icon}</div>
                      {idx < workflow.nodes.length - 1 && <div className="tl-line" />}
                    </div>

                    <div className="tl-content">
                      <div className="tl-top">
                        <span className="tl-title">{node.title}</span>
                        <span className="tl-model">{provName}</span>
                      </div>

                      <div className="tl-bottom">
                        <span className="tl-meta">
                          {status === 'completed' && st?.durationMs !== undefined
                            ? `完成 · ${(st.durationMs / 1000).toFixed(1)}s`
                            : status === 'running'
                              ? '运行中...'
                              : status === 'waiting_approval'
                                ? '等待拍板'
                                : status === 'failed'
                                  ? '失败'
                                  : status === 'skipped'
                                    ? '已跳过'
                                    : '待执行'}
                        </span>

                        <div style={{ display: 'flex', gap: 4 }}>
                          {hasOutput && (
                            <button
                              type="button"
                              className="tl-btn"
                              onClick={() => {
                                setPreviewDoc({
                                  title: node.title,
                                  subtitle: `由 ${provName} 产出`,
                                  content: st!.output,
                                });
                                onChangeTab('materials');
                              }}
                            >
                              看资料
                            </button>
                          )}
                          {run?.requirement && node.id !== 'user_requirement' && (
                            <button
                              type="button"
                              className="tl-btn"
                              onClick={() => onRerunFromNode(node.id)}
                            >
                              重跑
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== TAB 2: Visual Task Materials & Artifacts ===== */}
        {activeTab === 'materials' && (
          <div>
            {previewDoc ? (
              <div className="doc-preview">
                <div className="doc-preview-bar">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setPreviewDoc(null)}
                  >
                    <ArrowLeft size={13} />
                    返回列表
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void handleCopyPreview()}
                  >
                    <Copy size={12} />
                    {copiedDoc ? '已复制' : '复制全文'}
                  </button>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 10 }}>
                  {previewDoc.title}
                </div>
                {previewDoc.subtitle && (
                  <div style={{ fontSize: 11.5, color: '#6b7280', marginBottom: 10 }}>
                    {previewDoc.subtitle}
                  </div>
                )}
                <div className="doc-preview-content">
                  <MarkdownView content={previewDoc.content} />
                </div>
              </div>
            ) : (
              <div>
                {/* Action Bar */}
                <div className="mat-toolbar">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setAddingMaterial((v) => !v)}
                  >
                    <Plus size={13} />
                    添加参考资料
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={12} />
                    导入文件
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void onExportMarkdown()}
                    title="导出整份任务进度与所有资料为 Markdown"
                  >
                    <Download size={12} />
                    导出 .md
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.txt,.json,.yaml,.yml,.ts,.tsx,.js,.py,.sql,.csv"
                    style={{ display: 'none' }}
                    onChange={(e) => void handleFileImport(e)}
                  />
                </div>

                {/* Inline Add Material Form */}
                {addingMaterial && (
                  <form className="mat-add-form" onSubmit={handleSaveMaterial}>
                    <input
                      className="input"
                      style={{ marginBottom: 8 }}
                      placeholder="资料标题（例如：数据库表结构 / 接口规范 / 设计要求）"
                      value={matTitle}
                      onChange={(e) => setMatTitle(e.target.value)}
                    />
                    <textarea
                      className="textarea"
                      rows={4}
                      placeholder="粘贴参考资料内容，保存后会自动共享给群聊里所有模型..."
                      value={matContent}
                      onChange={(e) => setMatContent(e.target.value)}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setAddingMaterial(false)}
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={savingMat || !matContent.trim()}
                      >
                        {savingMat ? '保存中...' : '保存并共享给全群'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Group A: User Shared Reference Materials */}
                <div className="mat-section-title">
                  共享参考资料（全群模型自动可见 · {manualMaterials.length}）
                </div>
                {manualMaterials.length === 0 ? (
                  <div className="mat-empty">
                    暂无手动资料。点上方「添加参考资料」或「导入文件」，群里所有模型都会自动读到。
                  </div>
                ) : (
                  <div className="mat-list">
                    {manualMaterials.map((m) => (
                      <div
                        key={m.id}
                        className="mat-card"
                        onClick={() =>
                          setPreviewDoc({
                            title: m.title,
                            subtitle: m.source === 'file' ? '本地导入文件 · 全群共享' : '手动补充资料 · 全群共享',
                            content: m.content,
                          })
                        }
                      >
                        <FileText size={15} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
                        <div className="mat-card-info">
                          <div className="mat-card-title">{m.title}</div>
                          <div className="mat-card-meta">
                            {m.content.length} 字 · 点击预览
                          </div>
                        </div>
                        <button
                          type="button"
                          className="room-del-btn"
                          style={{ opacity: 1 }}
                          title="删除资料"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDeleteMaterial(m.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Group B: Auto-archived Stage Outputs */}
                <div className="mat-section-title" style={{ marginTop: 14 }}>
                  各板块产出归档（{stageArtifacts.length}）
                </div>
                {stageArtifacts.length === 0 ? (
                  <div className="mat-empty">
                    暂无板块产出。在聊天室启动「按板块跑流程」后，每个板块的方案、接口、回执和审查报告会自动归档在这里。
                  </div>
                ) : (
                  <div className="mat-list">
                    {stageArtifacts.map((doc) => (
                      <div
                        key={doc.id}
                        className="mat-card"
                        onClick={() =>
                          setPreviewDoc({
                            title: doc.title,
                            subtitle: `产出方：${doc.author}`,
                            content: doc.content,
                          })
                        }
                      >
                        <FileText size={15} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                        <div className="mat-card-info">
                          <div className="mat-card-title">{doc.title}</div>
                          <div className="mat-card-meta">
                            {doc.author} · {doc.content.length} 字
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== TAB 3: Modular Stage Configuration & Workflow Templates ===== */}
        {activeTab === 'stages' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Template Switcher Bar */}
            <div className="wf-tpl-bar">
              <div className="wf-tpl-bar-head">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 650, color: 'var(--text-secondary)' }}>
                  <Layers size={12} />
                  当前模板
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className="tl-btn"
                    onClick={() => {
                      setTplNameDraft(`${workflow.name}（副本）`);
                      setTplDescDraft(workflow.description || '');
                      setSavingTplMode((v) => !v);
                    }}
                  >
                    另存为模板
                  </button>
                  {activeTemplate && !activeTemplate.builtin && (
                    <button
                      type="button"
                      className="tl-btn"
                      title="删除此自定义模板"
                      onClick={() => void onDeleteTemplate(activeTemplate.id)}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>

              <select
                className="select"
                style={{ marginTop: 6, padding: '6px 9px', fontSize: 12.5 }}
                value={activeTemplate ? activeTemplate.id : '__custom__'}
                onChange={(e) => {
                  const nextId = e.target.value;
                  if (nextId !== '__custom__') {
                    void onApplyTemplate(nextId);
                  }
                }}
              >
                {!activeTemplate && <option value="__custom__">{workflow.name}</option>}
                {workflowTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（{t.workflow.nodes.length}步）{t.builtin ? '' : ' · 自定义'}
                  </option>
                ))}
              </select>

              {savingTplMode && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    className="input"
                    style={{ padding: '6px 9px', fontSize: 12 }}
                    placeholder="新模板名称"
                    value={tplNameDraft}
                    onChange={(e) => setTplNameDraft(e.target.value)}
                  />
                  <input
                    className="input"
                    style={{ padding: '6px 9px', fontSize: 12 }}
                    placeholder="一句话说明（可选）"
                    value={tplDescDraft}
                    onChange={(e) => setTplDescDraft(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setSavingTplMode(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="btn btn-ink btn-sm"
                      disabled={!tplNameDraft.trim()}
                      onClick={async () => {
                        await onSaveAsTemplate(tplNameDraft.trim(), tplDescDraft.trim());
                        setSavingTplMode(false);
                      }}
                    >
                      保存模板
                    </button>
                  </div>
                </div>
              )}
            </div>

            {workflow.nodes.map((node, index) => {
              const isHuman = node.kind === 'human_input' || node.kind === 'human_gate';
              const isInput = node.kind === 'human_input' || index === 0;
              const isEnabled = node.enabled !== false;
              const isExpanded = expandedStageId === node.id;
              const state = run?.nodes[node.id];
              const prov = node.providerId ? providerMap.get(node.providerId) : undefined;
              const dotColor = !isEnabled
                ? '#9ca3af'
                : isHuman
                  ? '#0284c7'
                  : prov?.accentColor || '#94a3b8';

              const prevNode = index > 0 ? workflow.nodes[index - 1] : undefined;
              const isParallelWithPrev = Boolean(
                index > 1 &&
                  prevNode &&
                  prevNode.dependsOn.length > 0 &&
                  node.dependsOn.length === prevNode.dependsOn.length &&
                  node.dependsOn.every((d) => prevNode.dependsOn.includes(d)),
              );

              const promptVal =
                promptDrafts[node.id] !== undefined
                  ? promptDrafts[node.id]
                  : node.promptTemplate || '';
              const titleVal =
                titleDrafts[node.id] !== undefined ? titleDrafts[node.id] : node.title;
              const subtitleVal =
                subtitleDrafts[node.id] !== undefined
                  ? subtitleDrafts[node.id]
                  : node.subtitle || '';

              return (
                <div
                  key={node.id}
                  className={`stage-item ${!isEnabled ? 'is-disabled' : ''}`}
                >
                  <div className="stage-item-top">
                    <button
                      type="button"
                      className="stage-expand-btn"
                      onClick={() => setExpandedStageId(isExpanded ? null : node.id)}
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
                          className={`sf-model-select ${!node.providerId ? 'is-unassigned' : ''}`}
                          value={node.providerId || ''}
                          disabled={!isEnabled}
                          title="为该节点选择负责模型"
                          onChange={(e) =>
                            void onSaveNode({ ...node, providerId: e.target.value })
                          }
                        >
                          <option value="">选择模型</option>
                          {providers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.shortName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="sf-human-tag">人工</span>
                      )}

                      {!isInput && (
                        <>
                          <button
                            type="button"
                            className="stage-order-btn"
                            disabled={index <= 1}
                            title="上移阶段"
                            onClick={() => void handleMoveStage(index, -1)}
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            type="button"
                            className="stage-order-btn"
                            disabled={index >= workflow.nodes.length - 1}
                            title="下移阶段"
                            onClick={() => void handleMoveStage(index, 1)}
                          >
                            <ArrowDown size={11} />
                          </button>
                          <label
                            className="stage-switch"
                            title={isEnabled ? '点击跳过此板块' : '点击启用此板块'}
                          >
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) =>
                                void onSaveNode({ ...node, enabled: e.target.checked })
                              }
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="stage-item-sub">
                    {isParallelWithPrev && (
                      <span className="wb-mini-tag accent" style={{ marginRight: 5 }}>
                        并行
                      </span>
                    )}
                    {node.subtitle}
                    {state?.status === 'completed' && (
                      <span style={{ color: '#16a34a', marginLeft: 6 }}>✓ 已完成</span>
                    )}
                    {state?.status === 'running' && (
                      <span style={{ color: '#2563eb', marginLeft: 6 }}>● 运行中</span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="stage-item-detail">
                      {!isInput && (
                        <div className="grid-2" style={{ marginBottom: 8 }}>
                          <input
                            className="input"
                            style={{ padding: '6px 9px', fontSize: 12 }}
                            placeholder="阶段名称"
                            value={titleVal}
                            onChange={(e) =>
                              setTitleDrafts((prev) => ({ ...prev, [node.id]: e.target.value }))
                            }
                          />
                          <input
                            className="input"
                            style={{ padding: '6px 9px', fontSize: 12 }}
                            placeholder="简短说明"
                            value={subtitleVal}
                            onChange={(e) =>
                              setSubtitleDrafts((prev) => ({
                                ...prev,
                                [node.id]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      )}

                      {index > 1 && (
                        <label className="wb-check" style={{ marginBottom: 8 }}>
                          <input
                            type="checkbox"
                            checked={isParallelWithPrev}
                            onChange={(e) =>
                              void handleToggleParallel(index, e.target.checked)
                            }
                          />
                          <span>与上一阶段（{prevNode?.title}）并行执行</span>
                        </label>
                      )}

                      {node.kind === 'review_loop' && (
                        <div className="field" style={{ marginBottom: 8 }}>
                          <label>自动修复模型</label>
                          <select
                            className="select"
                            value={node.fixProviderId || ''}
                            onChange={(e) =>
                              void onSaveNode({ ...node, fixProviderId: e.target.value })
                            }
                          >
                            <option value="">自动选择模型</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.shortName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(node.kind === 'llm' || node.kind === 'review_loop') && (
                        <div className="field" style={{ marginBottom: 8 }}>
                          <label>提示词模板（支持 {'{{requirement}}'} / {'{{previousOutput}}'}）</label>
                          <textarea
                            className="textarea"
                            rows={5}
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

                      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}>
                        {!isInput ? (
                          <button
                            type="button"
                            className="wb-del-link"
                            onClick={() => void handleDeleteStage(node.id, node.title)}
                          >
                            <Trash2 size={12} />
                            删除阶段
                          </button>
                        ) : (
                          <span />
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          {run && !isInput && run.requirement && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => onRerunFromNode(node.id)}
                            >
                              <RotateCcw size={12} />
                              从此重跑
                            </button>
                          )}
                          {!isInput && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() =>
                                void onSaveNode({
                                  ...node,
                                  title: titleVal.trim() || node.title,
                                  subtitle: subtitleVal.trim(),
                                  promptTemplate:
                                    node.kind === 'llm' || node.kind === 'review_loop'
                                      ? promptVal
                                      : node.promptTemplate,
                                })
                              }
                            >
                              <Save size={12} />
                              保存阶段
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add Custom Stage Drawer */}
            {addingStage ? (
              <div className="wf-add-stage-card">
                <div style={{ fontWeight: 650, fontSize: 12.5, marginBottom: 8 }}>
                  新增自定义阶段
                </div>
                <input
                  className="input"
                  autoFocus
                  style={{ marginBottom: 7, padding: '6px 9px', fontSize: 12.5 }}
                  placeholder="阶段名称，如：安全审计 / 单元测试 / 性能评估"
                  value={newStageTitle}
                  onChange={(e) => setNewStageTitle(e.target.value)}
                />
                <input
                  className="input"
                  style={{ marginBottom: 7, padding: '6px 9px', fontSize: 12 }}
                  placeholder="简短说明（可选）"
                  value={newStageSubtitle}
                  onChange={(e) => setNewStageSubtitle(e.target.value)}
                />
                <div className="grid-2" style={{ marginBottom: 7 }}>
                  <select
                    className="select"
                    style={{ padding: '6px 8px', fontSize: 12 }}
                    value={newStageKind}
                    onChange={(e) => setNewStageKind(e.target.value as NodeKind)}
                  >
                    <option value="llm">AI 模型执行阶段</option>
                    <option value="human_gate">人工拍板卡点</option>
                    <option value="review_loop">多轮审查循环</option>
                  </select>
                  {newStageKind !== 'human_gate' && (
                    <select
                      className="select"
                      style={{ padding: '6px 8px', fontSize: 12 }}
                      value={newStageProvider}
                      onChange={(e) => setNewStageProvider(e.target.value)}
                    >
                      <option value="">稍后决定模型</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.shortName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {workflow.nodes.length > 1 && (
                  <label className="wb-check" style={{ marginBottom: 7 }}>
                    <input
                      type="checkbox"
                      checked={newStageParallel}
                      onChange={(e) => setNewStageParallel(e.target.checked)}
                    />
                    <span>与上一个阶段并行执行</span>
                  </label>
                )}
                {newStageKind !== 'human_gate' && (
                  <textarea
                    className="textarea"
                    rows={3}
                    style={{ fontSize: 12 }}
                    value={newStagePrompt}
                    onChange={(e) => setNewStagePrompt(e.target.value)}
                  />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setAddingStage(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    disabled={!newStageTitle.trim()}
                    onClick={() => void handleCreateStage()}
                  >
                    添加阶段
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="wf-add-stage-btn"
                onClick={() => setAddingStage(true)}
              >
                <Plus size={13} />
                新增自定义阶段
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
