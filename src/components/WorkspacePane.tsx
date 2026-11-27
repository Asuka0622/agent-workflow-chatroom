import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  File,
  FileCode2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Paperclip,
  RefreshCw,
  Save,
  Search,
  Send,
  X,
} from 'lucide-react';
import { api } from '../api';
import { MarkdownView } from './MarkdownView';

interface TreeEntry {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size: number;
  ext: string;
  mtime: string;
}

interface LoadedFile {
  absPath: string;
  relPath: string;
  name: string;
  size: number;
  ext: string;
  isBinary: boolean;
  isImage: boolean;
  truncated?: boolean;
  mimeType: string;
  content: string;
  dataUrl?: string;
}

interface GitChangeItem {
  code: string;
  statusLabel: string;
  relPath: string;
  absPath: string;
  gitPath: string;
}

export interface WorkspacePaneProps {
  repoPath: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onChangeRepoPath: (nextPath: string) => void;
  onPickFolderDesktop?: () => Promise<void>;
  onAttachFileToChat: (absPath: string) => Promise<void>;
  onInsertPromptToChat: (text: string) => void;
  onToast: (msg: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'cpp',
  'h', 'cs', 'css', 'scss', 'html', 'json', 'yaml', 'yml', 'toml', 'sql', 'sh', 'ps1',
]);

function renderFileIcon(ext: string) {
  if (IMAGE_EXTS.has(ext)) return <ImageIcon size={13} className="ws-ico-img" />;
  if (CODE_EXTS.has(ext)) return <FileCode2 size={13} className="ws-ico-code" />;
  if (ext === 'md' || ext === 'txt') return <FileText size={13} className="ws-ico-doc" />;
  return <File size={13} className="ws-ico-file" />;
}

export const WorkspacePane: React.FC<WorkspacePaneProps> = ({
  repoPath,
  isFullscreen,
  onToggleFullscreen,
  onClose,
  onChangeRepoPath,
  onPickFolderDesktop,
  onAttachFileToChat,
  onInsertPromptToChat,
  onToast,
}) => {
  const [tab, setTab] = useState<'files' | 'git'>('files');
  const [showHidden, setShowHidden] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState(repoPath);

  // Lazy tree state: dirRelPath -> entries
  const [treeCache, setTreeCache] = useState<Record<string, TreeEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});

  // Quick search across workspace
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ relPath: string; absPath: string; name: string; size: number; ext: string }>
  >([]);
  const [searching, setSearching] = useState(false);

  // New file / folder inline bar
  const [creatingKind, setCreatingKind] = useState<'file' | 'dir' | null>(null);
  const [createDraft, setCreateDraft] = useState('');

  // File viewer / editor
  const [selectedFile, setSelectedFile] = useState<LoadedFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [copiedFile, setCopiedFile] = useState(false);
  const [mdRendered, setMdRendered] = useState(true);

  // Git status & diff
  const [gitInfo, setGitInfo] = useState<{
    isGitRepo: boolean;
    branch: string;
    changes: GitChangeItem[];
  }>({ isGitRepo: false, branch: '', changes: [] });
  const [loadingGit, setLoadingGit] = useState(false);
  const [selectedGitFile, setSelectedGitFile] = useState<GitChangeItem | null>(null);
  const [gitDiffText, setGitDiffText] = useState('');
  const [loadingDiff, setLoadingDiff] = useState(false);

  useEffect(() => {
    setPathDraft(repoPath);
  }, [repoPath]);

  const loadDir = useCallback(
    async (dirRel: string, hidden = showHidden) => {
      setLoadingDirs((prev) => ({ ...prev, [dirRel]: true }));
      try {
        const res = await api.getWorkspaceTree(repoPath, dirRel, hidden);
        setTreeCache((prev) => ({ ...prev, [dirRel]: res.entries }));
      } catch (err) {
        onToast(err instanceof Error ? err.message : '读取目录失败');
      } finally {
        setLoadingDirs((prev) => ({ ...prev, [dirRel]: false }));
      }
    },
    [repoPath, showHidden, onToast],
  );

  const loadGitStatus = useCallback(async () => {
    setLoadingGit(true);
    try {
      const res = await api.getWorkspaceGitStatus(repoPath);
      setGitInfo(res);
    } catch {
      setGitInfo({ isGitRepo: false, branch: '', changes: [] });
    } finally {
      setLoadingGit(false);
    }
  }, [repoPath]);

  // Initial load & reload when repoPath or showHidden changes
  useEffect(() => {
    setTreeCache({});
    setExpandedDirs({});
    setSelectedFile(null);
    setSelectedGitFile(null);
    setGitDiffText('');
    void loadDir('', showHidden);
    void loadGitStatus();
  }, [repoPath, showHidden, loadDir, loadGitStatus]);

  // Debounced workspace search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      void api
        .listWorkspaceFiles(repoPath, q)
        .then((res) => setSearchResults(res.files))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, repoPath]);

  const handleToggleDir = async (relPath: string) => {
    const next = !expandedDirs[relPath];
    setExpandedDirs((prev) => ({ ...prev, [relPath]: next }));
    if (next && !treeCache[relPath]) {
      await loadDir(relPath);
    }
  };

  const handleOpenFile = async (relOrAbs: string) => {
    setLoadingFile(true);
    setIsEditingFile(false);
    try {
      const data = await api.readWorkspaceFile(repoPath, relOrAbs);
      setSelectedFile(data);
      setEditBuffer(data.content || '');
      setMdRendered(data.ext === 'md');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setLoadingFile(false);
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    setSavingFile(true);
    try {
      const res = await api.writeWorkspaceFile(repoPath, selectedFile.relPath, editBuffer);
      setSelectedFile({ ...selectedFile, content: editBuffer, size: res.size });
      setIsEditingFile(false);
      onToast(`已保存 ${selectedFile.relPath}`);
      void loadGitStatus();
    } catch (err) {
      onToast(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingFile(false);
    }
  };

  const handleCreateEntry = async () => {
    const rel = createDraft.trim();
    if (!rel || !creatingKind) return;
    try {
      const res = await api.createWorkspaceEntry(repoPath, rel, creatingKind);
      onToast(creatingKind === 'dir' ? `已创建文件夹 ${res.relPath}` : `已创建文件 ${res.relPath}`);
      setCreateDraft('');
      setCreatingKind(null);
      await loadDir('');
      if (res.kind === 'file') {
        await handleOpenFile(res.relPath);
        setIsEditingFile(true);
      }
      void loadGitStatus();
    } catch (err) {
      onToast(err instanceof Error ? err.message : '创建失败');
    }
  };

  const handleSelectGitChange = async (item: GitChangeItem) => {
    setSelectedGitFile(item);
    setLoadingDiff(true);
    try {
      const res = await api.getWorkspaceGitDiff(repoPath, item.gitPath);
      setGitDiffText(res.diff || '（无文本 Diff 内容，可能是二进制文件或空文件）');
    } catch (err) {
      setGitDiffText(err instanceof Error ? err.message : '获取 Diff 失败');
    } finally {
      setLoadingDiff(false);
    }
  };

  const handleSendDiffToChat = () => {
    if (!selectedGitFile) return;
    const clipped = gitDiffText.slice(0, 6000);
    onInsertPromptToChat(
      `请帮我审查工作区文件 \`${selectedGitFile.relPath}\` 的最新改动（${selectedGitFile.statusLabel}），指出潜在 Bug、边界问题与优化建议：\n\n\`\`\`diff\n${clipped}\n\`\`\``,
    );
    onToast('已将 Diff 填入聊天框，点名模型即可审查');
  };

  const handleRefreshAll = () => {
    void loadDir('');
    for (const dir of Object.keys(expandedDirs)) {
      if (expandedDirs[dir]) void loadDir(dir);
    }
    if (selectedFile && !isEditingFile) {
      void handleOpenFile(selectedFile.relPath);
    }
    void loadGitStatus();
  };

  const rootName = useMemo(
    () => repoPath.split(/[/\\]/).filter(Boolean).pop() || repoPath,
    [repoPath],
  );

  const renderTreeNodes = (dirRel: string, depth: number): React.ReactNode => {
    const entries = treeCache[dirRel] || [];
    if (entries.length === 0 && !loadingDirs[dirRel]) {
      return depth === 0 ? (
        <div className="ws-tree-empty">当前目录为空</div>
      ) : null;
    }

    return entries.map((entry) => {
      const isExpanded = Boolean(expandedDirs[entry.relPath]);
      const isSelected = !entry.isDir && selectedFile?.relPath === entry.relPath;
      return (
        <React.Fragment key={entry.relPath}>
          <div
            className={`ws-tree-row ${isSelected ? 'active' : ''}`}
            style={{ paddingLeft: 8 + depth * 13 }}
            onClick={() => {
              if (entry.isDir) {
                void handleToggleDir(entry.relPath);
              } else {
                void handleOpenFile(entry.relPath);
              }
            }}
            title={entry.relPath}
          >
            {entry.isDir ? (
              <>
                <span className="ws-tree-chev">
                  {loadingDirs[entry.relPath] ? (
                    <Loader2 size={11} className="spin" />
                  ) : isExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                {isExpanded ? (
                  <FolderOpen size={13} className="ws-ico-dir" />
                ) : (
                  <Folder size={13} className="ws-ico-dir" />
                )}
              </>
            ) : (
              <>
                <span className="ws-tree-chev" />
                {renderFileIcon(entry.ext)}
              </>
            )}
            <span className="ws-tree-name">{entry.name}</span>
            {!entry.isDir && (
              <button
                type="button"
                className="ws-tree-attach-btn"
                title="附带此文件到左侧对话"
                onClick={(e) => {
                  e.stopPropagation();
                  void onAttachFileToChat(entry.absPath);
                }}
              >
                <Paperclip size={11} />
              </button>
            )}
          </div>
          {entry.isDir && isExpanded && renderTreeNodes(entry.relPath, depth + 1)}
        </React.Fragment>
      );
    });
  };

  const codeLines = useMemo(
    () => (selectedFile?.content ? selectedFile.content.split(/\r?\n/) : []),
    [selectedFile?.content],
  );

  return (
    <section className={`claude-canvas-pane ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* Header matching Claude Canvas */}
      <header className="cc-header">
        <div className="cc-header-left">
          <span className="cc-brand-icon" title={`当前工作区：${repoPath}`}>
            <FolderOpen size={14} />
          </span>

          {editingPath ? (
            <form
              style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (pathDraft.trim()) {
                  onChangeRepoPath(pathDraft.trim());
                }
                setEditingPath(false);
              }}
            >
              <input
                className="input"
                style={{ padding: '3px 7px', fontSize: 12, height: 27 }}
                value={pathDraft}
                autoFocus
                onChange={(e) => setPathDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingPath(false);
                }}
              />
              <button type="submit" className="studio-icon-btn" title="应用路径">
                <Check size={13} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="ws-root-chip"
              title={`当前工作区：${repoPath}（点击切换目录）`}
              onClick={() => {
                if (window.desktopApi?.isDesktop && onPickFolderDesktop) {
                  void onPickFolderDesktop();
                } else {
                  setEditingPath(true);
                }
              }}
            >
              <span className="ws-root-name">{rootName}</span>
              <span className="ws-root-switch">切换</span>
            </button>
          )}

          <button
            type="button"
            className="studio-icon-btn"
            title="刷新工作区与 Git 状态"
            onClick={handleRefreshAll}
          >
            <RefreshCw size={13} />
          </button>

          <button
            type="button"
            className="studio-icon-btn"
            title="在系统资源管理器打开当前目录"
            onClick={() => void api.openInExplorer(selectedFile?.absPath || repoPath)}
          >
            <Folder size={13} />
          </button>
        </div>

        <div className="cc-header-right">
          <div className="cc-seg-switch">
            <button
              type="button"
              className={tab === 'files' ? 'active' : ''}
              onClick={() => setTab('files')}
            >
              <FileCode2 size={12} />
              <span>文件</span>
            </button>
            <button
              type="button"
              className={tab === 'git' ? 'active' : ''}
              onClick={() => {
                setTab('git');
                void loadGitStatus();
              }}
            >
              <GitBranch size={12} />
              <span>
                变更{gitInfo.changes.length > 0 ? ` (${gitInfo.changes.length})` : ''}
              </span>
            </button>
          </div>

          <button
            type="button"
            className="studio-icon-btn"
            title={isFullscreen ? '恢复左右分屏' : '全屏展开工作区'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          <button
            type="button"
            className="studio-icon-btn"
            title="关闭工作区"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {/* ===== TAB 1: WORKSPACE FILE TREE + CODE/PREVIEW EDITOR ===== */}
      {tab === 'files' && (
        <div className="ws-split-body">
          {/* Left Directory Tree Column */}
          <div className="ws-tree-col">
            <div className="ws-tree-toolbar">
              <div className="ws-search-box">
                <Search size={12} />
                <input
                  className="ws-search-input"
                  placeholder="搜索文件..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="mini-icon-btn"
                    style={{ width: 16, height: 16 }}
                    onClick={() => setSearchQuery('')}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              <div className="ws-tree-actions">
                <button
                  type="button"
                  className="mini-icon-btn"
                  title="新建文件"
                  onClick={() => {
                    setCreatingKind((k) => (k === 'file' ? null : 'file'));
                    setCreateDraft('');
                  }}
                >
                  <FilePlus size={13} />
                </button>
                <button
                  type="button"
                  className="mini-icon-btn"
                  title="新建文件夹"
                  onClick={() => {
                    setCreatingKind((k) => (k === 'dir' ? null : 'dir'));
                    setCreateDraft('');
                  }}
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  type="button"
                  className={`mini-icon-btn ${showHidden ? 'active' : ''}`}
                  title={showHidden ? '隐藏忽略目录与点文件' : '显示隐藏文件与忽略目录'}
                  onClick={() => setShowHidden((v) => !v)}
                >
                  <Eye size={13} />
                </button>
              </div>
            </div>

            {creatingKind && (
              <div className="ws-create-bar">
                <input
                  className="input"
                  style={{ padding: '4px 7px', fontSize: 11.5 }}
                  autoFocus
                  placeholder={creatingKind === 'dir' ? '文件夹相对路径...' : '文件相对路径，如 notes.md'}
                  value={createDraft}
                  onChange={(e) => setCreateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreateEntry();
                    if (e.key === 'Escape') setCreatingKind(null);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ink btn-sm"
                  style={{ height: 24, padding: '0 7px', fontSize: 11 }}
                  onClick={() => void handleCreateEntry()}
                >
                  创建
                </button>
              </div>
            )}

            <div className="ws-tree-scroll">
              {searchQuery.trim() ? (
                searching ? (
                  <div className="ws-tree-empty">
                    <Loader2 size={12} className="spin" /> 搜索中...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="ws-tree-empty">未找到匹配文件</div>
                ) : (
                  searchResults.map((f) => (
                    <div
                      key={f.absPath}
                      className={`ws-tree-row ${selectedFile?.relPath === f.relPath ? 'active' : ''}`}
                      style={{ paddingLeft: 10 }}
                      onClick={() => void handleOpenFile(f.relPath)}
                      title={f.relPath}
                    >
                      {renderFileIcon(f.ext.toLowerCase())}
                      <div className="ws-search-row-text">
                        <span className="ws-tree-name">{f.name}</span>
                        <span className="ws-search-rel">{f.relPath}</span>
                      </div>
                      <button
                        type="button"
                        className="ws-tree-attach-btn"
                        title="附带此文件到左侧对话"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onAttachFileToChat(f.absPath);
                        }}
                      >
                        <Paperclip size={11} />
                      </button>
                    </div>
                  ))
                )
              ) : (
                renderTreeNodes('', 0)
              )}
            </div>
          </div>

          {/* Right File Preview / Editor Column */}
          <div className="ws-viewer-col">
            {loadingFile ? (
              <div className="ws-viewer-empty">
                <Loader2 size={18} className="spin" />
                <span>读取文件中...</span>
              </div>
            ) : !selectedFile ? (
              <div className="ws-viewer-empty">
                <FolderOpen size={28} style={{ opacity: 0.4 }} />
                <div style={{ fontWeight: 650, fontSize: 13.5, color: 'var(--text)' }}>
                  工作区：{rootName}
                </div>
                <p>
                  点击左侧文件树可即时预览或在线编辑代码/文档；悬停文件点回形针，即可一键附带到左侧多模型对话中。
                </p>
              </div>
            ) : (
              <>
                <div className="ws-file-bar">
                  <div className="ws-file-path" title={selectedFile.absPath}>
                    {renderFileIcon(selectedFile.ext)}
                    <span>{selectedFile.relPath}</span>
                    <span className="ws-file-size">{formatBytes(selectedFile.size)}</span>
                  </div>

                  <div className="ws-file-ops">
                    <button
                      type="button"
                      className="cc-tool-btn"
                      title="将该文件附带到左侧聊天框供模型读取"
                      onClick={() => void onAttachFileToChat(selectedFile.absPath)}
                    >
                      <Paperclip size={11} />
                      <span>引用到对话</span>
                    </button>

                    {!selectedFile.isBinary && (
                      <>
                        {selectedFile.ext === 'md' && !isEditingFile && (
                          <button
                            type="button"
                            className="cc-tool-btn"
                            onClick={() => setMdRendered((v) => !v)}
                          >
                            {mdRendered ? '源码' : '渲染'}
                          </button>
                        )}
                        {isEditingFile ? (
                          <>
                            <button
                              type="button"
                              className="cc-tool-btn"
                              onClick={() => {
                                setIsEditingFile(false);
                                setEditBuffer(selectedFile.content);
                              }}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="btn btn-ink btn-sm"
                              style={{ height: 26, fontSize: 11.5 }}
                              disabled={savingFile}
                              onClick={() => void handleSaveFile()}
                            >
                              <Save size={11} />
                              {savingFile ? '保存中' : '保存'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="mini-icon-btn"
                            title="在线编辑文件"
                            onClick={() => {
                              setEditBuffer(selectedFile.content);
                              setIsEditingFile(true);
                            }}
                          >
                            <Edit3 size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="mini-icon-btn"
                          title="复制文件内容"
                          onClick={async () => {
                            await navigator.clipboard.writeText(selectedFile.content);
                            setCopiedFile(true);
                            setTimeout(() => setCopiedFile(false), 1400);
                          }}
                        >
                          {copiedFile ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="ws-file-body">
                  {selectedFile.isImage && selectedFile.dataUrl ? (
                    <div className="ws-img-preview-box">
                      <img src={selectedFile.dataUrl} alt={selectedFile.name} />
                    </div>
                  ) : selectedFile.isBinary ? (
                    <div className="ws-viewer-empty">
                      <File size={26} style={{ opacity: 0.45 }} />
                      <div>二进制文件（{formatBytes(selectedFile.size)}）</div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void api.openInExplorer(selectedFile.absPath)}
                      >
                        在资源管理器中定位
                      </button>
                    </div>
                  ) : isEditingFile ? (
                    <textarea
                      className="ws-code-editor"
                      value={editBuffer}
                      spellCheck={false}
                      onChange={(e) => setEditBuffer(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                          e.preventDefault();
                          void handleSaveFile();
                        }
                      }}
                    />
                  ) : selectedFile.ext === 'md' && mdRendered ? (
                    <div className="ws-md-preview">
                      <MarkdownView content={selectedFile.content} />
                    </div>
                  ) : (
                    <div className="ws-code-view">
                      {selectedFile.truncated && (
                        <div className="ws-trunc-banner">
                          文件超过 512 KB，当前仅预览前 512 KB 内容。
                        </div>
                      )}
                      <table className="ws-code-table">
                        <tbody>
                          {codeLines.map((line, i) => (
                            <tr key={i}>
                              <td className="ws-ln">{i + 1}</td>
                              <td className="ws-lc">{line || ' '}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB 2: LIVE GIT STATUS & DIFF ===== */}
      {tab === 'git' && (
        <div className="ws-split-body">
          <div className="ws-tree-col">
            <div className="ws-git-head">
              <span className="ws-git-branch">
                <GitBranch size={12} />
                {gitInfo.isGitRepo ? gitInfo.branch : '非 Git 仓库'}
              </span>
              <button
                type="button"
                className="mini-icon-btn"
                title="刷新 Git 状态"
                onClick={() => void loadGitStatus()}
              >
                <RefreshCw size={12} className={loadingGit ? 'spin' : ''} />
              </button>
            </div>

            <div className="ws-tree-scroll">
              {!gitInfo.isGitRepo ? (
                <div className="ws-tree-empty">
                  当前目录不是 Git 仓库。切换到一个 Git 项目目录后可实时查看改动与 Diff。
                </div>
              ) : gitInfo.changes.length === 0 ? (
                <div className="ws-tree-empty">工作树干净，暂无未提交改动。</div>
              ) : (
                gitInfo.changes.map((item) => (
                  <div
                    key={item.gitPath}
                    className={`ws-tree-row ${selectedGitFile?.gitPath === item.gitPath ? 'active' : ''}`}
                    style={{ paddingLeft: 10 }}
                    onClick={() => void handleSelectGitChange(item)}
                    title={item.relPath}
                  >
                    <span className={`ws-git-badge code-${item.code.replace(/[^A-Z?]/g, '')}`}>
                      {item.code === '??' ? 'U' : item.code[0]}
                    </span>
                    <span className="ws-tree-name">{item.relPath}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="ws-viewer-col">
            {loadingDiff ? (
              <div className="ws-viewer-empty">
                <Loader2 size={18} className="spin" />
                <span>计算 Diff...</span>
              </div>
            ) : !selectedGitFile ? (
              <div className="ws-viewer-empty">
                <GitBranch size={26} style={{ opacity: 0.4 }} />
                <div style={{ fontWeight: 650, fontSize: 13.5, color: 'var(--text)' }}>
                  Git 变更审查
                </div>
                <p>点击左侧任一改动文件即可查看着色 Diff，并一键发给群里模型做交叉代码审查。</p>
              </div>
            ) : (
              <>
                <div className="ws-file-bar">
                  <div className="ws-file-path" title={selectedGitFile.relPath}>
                    <GitBranch size={12} />
                    <span>{selectedGitFile.relPath}</span>
                    <span className="ws-file-size">{selectedGitFile.statusLabel}</span>
                  </div>
                  <div className="ws-file-ops">
                    <button
                      type="button"
                      className="btn btn-ink btn-sm"
                      style={{ height: 26, fontSize: 11.5 }}
                      onClick={handleSendDiffToChat}
                    >
                      <Send size={11} />
                      <span>发给群聊审查</span>
                    </button>
                  </div>
                </div>
                <div className="ws-diff-body">
                  {gitDiffText.split(/\r?\n/).map((line, i) => {
                    const cls = line.startsWith('+++') || line.startsWith('---')
                      ? 'diff-meta'
                      : line.startsWith('@@')
                        ? 'diff-hunk'
                        : line.startsWith('+')
                          ? 'diff-add'
                          : line.startsWith('-')
                            ? 'diff-del'
                            : 'diff-ctx';
                    return (
                      <div key={i} className={`ws-diff-line ${cls}`}>
                        {line || ' '}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
