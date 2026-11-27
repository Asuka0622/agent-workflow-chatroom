import type {
  ApprovalPayload,
  ChatAttachment,
  ChatSendPayload,
  ConnectedAgent,
  CreateRunPayload,
  ProviderConfig,
  ProviderHealth,
  WorkbenchConfig,
  WorkbenchPlugin,
  WorkflowDefinition,
  WorkflowPresetTemplate,
  WorkflowRun,
} from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  getHealth: () =>
    request<{ ok: boolean; host: string; port: number; cwd: string }>('/api/health'),

  getProviders: () => request<{ providers: ProviderConfig[] }>('/api/providers'),

  saveProviders: (providers: ProviderConfig[]) =>
    request<{ providers: ProviderConfig[] }>('/api/providers', {
      method: 'PUT',
      body: JSON.stringify({ providers }),
    }),

  patchProvider: (id: string, patch: Partial<ProviderConfig>) =>
    request<{ provider: ProviderConfig; providers: ProviderConfig[] }>(
      `/api/providers/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    ),

  checkProviders: () =>
    request<{ health: ProviderHealth[] }>('/api/providers/check', {
      method: 'POST',
    }),

  testProvider: (provider: ProviderConfig) =>
    request<{ ok: boolean; latencyMs: number; message: string }>(
      '/api/providers/test',
      {
        method: 'POST',
        body: JSON.stringify({ provider }),
      },
    ),

  getWorkflow: () => request<{ workflow: WorkflowDefinition }>('/api/workflow'),

  saveWorkflow: (workflow: WorkflowDefinition) =>
    request<{ workflow: WorkflowDefinition; templates?: WorkflowPresetTemplate[] }>('/api/workflow', {
      method: 'PUT',
      body: JSON.stringify({ workflow }),
    }),

  resetWorkflow: () =>
    request<{ workflow: WorkflowDefinition }>('/api/workflow/reset', {
      method: 'POST',
    }),

  listWorkflowTemplates: () =>
    request<{ templates: WorkflowPresetTemplate[] }>('/api/workflow-templates'),

  saveWorkflowTemplate: (payload: {
    id?: string;
    name: string;
    description?: string;
    workflow: WorkflowDefinition;
  }) =>
    request<{ template: WorkflowPresetTemplate; templates: WorkflowPresetTemplate[] }>(
      '/api/workflow-templates',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  applyWorkflowTemplate: (id: string) =>
    request<{ workflow: WorkflowDefinition; template: WorkflowPresetTemplate }>(
      `/api/workflow-templates/${encodeURIComponent(id)}/apply`,
      {
        method: 'POST',
      },
    ),

  deleteWorkflowTemplate: (id: string) =>
    request<{ removed: boolean; templates: WorkflowPresetTemplate[] }>(
      `/api/workflow-templates/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
    ),

  listRuns: () => request<{ runs: WorkflowRun[] }>('/api/runs'),

  createRun: (payload: CreateRunPayload) =>
    request<{ run: WorkflowRun }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendChat: (id: string, payload: ChatSendPayload) =>
    request<{ run: WorkflowRun }>(`/api/runs/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRun: (id: string) => request<{ run: WorkflowRun }>(`/api/runs/${id}`),

  deleteRun: (id: string) =>
    request<{ removed: boolean }>(`/api/runs/${id}`, { method: 'DELETE' }),

  submitApproval: (id: string, payload: ApprovalPayload) =>
    request<{ run: WorkflowRun }>(`/api/runs/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  rerunFromNode: (id: string, nodeId: string) =>
    request<{ run: WorkflowRun }>(`/api/runs/${id}/rerun`, {
      method: 'POST',
      body: JSON.stringify({ nodeId }),
    }),

  abortRun: (id: string) =>
    request<{ run: WorkflowRun }>(`/api/runs/${id}/abort`, {
      method: 'POST',
    }),

  uploadFile: (
    id: string,
    payload: {
      name: string;
      mimeType: string;
      dataBase64: string;
      textContent?: string;
    },
  ) =>
    request<{ attachment: ChatAttachment }>(`/api/runs/${id}/upload`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listWorkspaceFiles: (cwd: string, q = '') =>
    request<{
      rootDir: string;
      files: Array<{
        relPath: string;
        absPath: string;
        name: string;
        size: number;
        ext: string;
      }>;
    }>(
      `/api/workspace/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}`,
    ),

  getWorkspaceTree: (cwd: string, dir = '', showHidden = false) =>
    request<{
      rootDir: string;
      dir: string;
      entries: Array<{
        name: string;
        relPath: string;
        absPath: string;
        isDir: boolean;
        size: number;
        ext: string;
        mtime: string;
      }>;
    }>(
      `/api/workspace/tree?cwd=${encodeURIComponent(cwd)}&dir=${encodeURIComponent(dir)}&hidden=${showHidden ? '1' : '0'}`,
    ),

  readWorkspaceFile: (cwd: string, file: string) =>
    request<{
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
    }>(
      `/api/workspace/read?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}`,
    ),

  writeWorkspaceFile: (cwd: string, file: string, content: string) =>
    request<{ ok: boolean; absPath: string; relPath: string; size: number }>(
      '/api/workspace/write',
      {
        method: 'PUT',
        body: JSON.stringify({ cwd, file, content }),
      },
    ),

  createWorkspaceEntry: (cwd: string, relPath: string, kind: 'file' | 'dir') =>
    request<{ ok: boolean; absPath: string; relPath: string; kind: 'file' | 'dir' }>(
      '/api/workspace/create',
      {
        method: 'POST',
        body: JSON.stringify({ cwd, relPath, kind }),
      },
    ),

  getWorkspaceGitStatus: (cwd: string) =>
    request<{
      isGitRepo: boolean;
      branch: string;
      changes: Array<{
        code: string;
        statusLabel: string;
        relPath: string;
        absPath: string;
        gitPath: string;
      }>;
    }>(`/api/workspace/git-status?cwd=${encodeURIComponent(cwd)}`),

  getWorkspaceGitDiff: (cwd: string, file: string) =>
    request<{ file: string; diff: string }>(
      `/api/workspace/git-diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}`,
    ),

  openInExplorer: (targetPath: string) =>
    request<{ ok: boolean }>('/api/workspace/open-explorer', {
      method: 'POST',
      body: JSON.stringify({ targetPath }),
    }),

  attachLocalFile: (id: string, absPath: string) =>
    request<{ attachment: ChatAttachment }>(`/api/runs/${id}/attach-local`, {
      method: 'POST',
      body: JSON.stringify({ absPath }),
    }),

  addMaterial: (
    id: string,
    payload: { title: string; content: string; source?: 'manual' | 'file' },
  ) =>
    request<{ run: WorkflowRun }>(`/api/runs/${id}/materials`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteMaterial: (id: string, materialId: string) =>
    request<{ run: WorkflowRun }>(`/api/runs/${id}/materials/${materialId}`, {
      method: 'DELETE',
    }),

  exportRunMarkdown: async (id: string): Promise<string> => {
    const res = await fetch(`/api/runs/${id}/export`);
    if (!res.ok) throw new Error('导出失败');
    return res.text();
  },

  listAgents: () => request<{ agents: ConnectedAgent[] }>('/api/agents'),

  renameAgent: (
    id: string,
    payload: {
      displayName?: string;
      modelName?: string;
      relayName?: string;
      avatar?: string;
      accentColor?: string;
      online?: boolean;
      trigger?: ConnectedAgent['trigger'];
      thinkingLevel?: ConnectedAgent['thinkingLevel'];
    },
  ) =>
    request<{ agent: ConnectedAgent }>(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteAgent: (id: string) =>
    request<{ removed: boolean }>(`/api/agents/${id}`, {
      method: 'DELETE',
    }),

  detectAgentCli: (id: string) =>
    request<{
      ok: boolean;
      found: boolean;
      agent: ConnectedAgent;
      message: string;
      suggestion?: {
        command: string;
        args: string[];
        installCmd: string;
        loginCmd: string;
        note?: string;
      };
    }>(`/api/agents/${id}/detect-cli`, {
      method: 'POST',
    }),

  stopAgentStandby: (id: string) =>
    request<{ ok: boolean; stopped: boolean }>(`/api/agents/${id}/stop-standby`, {
      method: 'POST',
    }),

  getWorkbench: () => request<{ workbench: WorkbenchConfig }>('/api/workbench'),

  saveWorkbench: (workbench: WorkbenchConfig) =>
    request<{ workbench: WorkbenchConfig }>('/api/workbench', {
      method: 'PUT',
      body: JSON.stringify({ workbench }),
    }),

  testWorkbenchPlugin: (id: string, cwd?: string) =>
    request<{
      result: { ok: boolean; latencyMs: number; message: string };
      plugin: WorkbenchPlugin;
      workbench: WorkbenchConfig;
    }>(`/api/workbench/plugins/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ cwd }),
    }),

  runScheduledTask: (id: string, roomId?: string) =>
    request<{ ok: boolean; workbench: WorkbenchConfig; message: string }>(
      `/api/workbench/schedules/${id}/run`,
      {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      },
    ),
};

export function subscribeAgents(
  onUpdate: (agents: ConnectedAgent[]) => void,
): () => void {
  const es = new EventSource('/api/agents/stream');
  es.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as { agents?: ConnectedAgent[] };
      if (Array.isArray(parsed.agents)) {
        onUpdate(parsed.agents);
      }
    } catch {
      // ignore
    }
  };
  return () => es.close();
}

export function subscribeRun(
  runId: string,
  onUpdate: (run: WorkflowRun) => void,
): () => void {
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as WorkflowRun;
      onUpdate(parsed);
    } catch {
      // ignore malformed heartbeat
    }
  };
  return () => es.close();
}
