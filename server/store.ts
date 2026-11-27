import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROVIDERS } from '../shared/defaultProviders.js';
import { DEFAULT_WORKBENCH } from '../shared/defaultWorkbench.js';
import { DEFAULT_WORKFLOW } from '../shared/defaultWorkflow.js';
import { BUILTIN_WORKFLOW_TEMPLATES } from '../shared/defaultWorkflowTemplates.js';
import type {
  ConnectedAgent,
  MemberQuotaConfig,
  MemberUsageRecord,
  ProviderConfig,
  TokenUsage,
  WorkbenchConfig,
  WorkflowDefinition,
  WorkflowPresetTemplate,
  WorkflowRun,
} from '../shared/types.js';
import { estimateTextTokens } from './tokenEstimator.js';

function getDataDir(): string {
  return process.env.AGENT_WORKFLOW_DATA_DIR
    ? path.resolve(process.env.AGENT_WORKFLOW_DATA_DIR)
    : path.resolve(process.cwd(), 'data');
}

function getPaths() {
  const dataDir = getDataDir();
  return {
    dataDir,
    runsDir: path.join(dataDir, 'runs'),
    providersFile: path.join(dataDir, 'providers.json'),
    workflowFile: path.join(dataDir, 'workflow.json'),
    workflowTemplatesFile: path.join(dataDir, 'workflow-templates.json'),
    agentsFile: path.join(dataDir, 'agents.json'),
    workbenchFile: path.join(dataDir, 'workbench.json'),
    usageFile: path.join(dataDir, 'usage.json'),
  };
}

export function loadWorkflowTemplates(): WorkflowPresetTemplate[] {
  ensureDirs();
  const { workflowTemplatesFile } = getPaths();
  let saved: WorkflowPresetTemplate[] = [];
  if (fs.existsSync(workflowTemplatesFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(workflowTemplatesFile, 'utf8')) as WorkflowPresetTemplate[];
      if (Array.isArray(parsed)) saved = parsed;
    } catch {
      saved = [];
    }
  }

  // Merge built-ins (preserve any user edits to built-in model assignments if saved, add missing built-ins)
  const byId = new Map(saved.map((t) => [t.id, t]));
  const merged: WorkflowPresetTemplate[] = [];
  for (const b of BUILTIN_WORKFLOW_TEMPLATES) {
    const existing = byId.get(b.id);
    if (existing) {
      merged.push({ ...existing, builtin: true });
      byId.delete(b.id);
    } else {
      merged.push(structuredClone(b));
    }
  }
  for (const custom of byId.values()) {
    merged.push(custom);
  }
  if (!fs.existsSync(workflowTemplatesFile)) {
    saveWorkflowTemplates(merged);
  }
  return merged;
}

export function saveWorkflowTemplates(templates: WorkflowPresetTemplate[]): void {
  ensureDirs();
  fs.writeFileSync(
    getPaths().workflowTemplatesFile,
    JSON.stringify(templates, null, 2),
    'utf8',
  );
}

export function loadWorkbench(): WorkbenchConfig {
  ensureDirs();
  const { workbenchFile } = getPaths();
  if (!fs.existsSync(workbenchFile)) {
    const fresh = structuredClone(DEFAULT_WORKBENCH);
    saveWorkbench(fresh);
    return fresh;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(workbenchFile, 'utf8')) as Partial<WorkbenchConfig>;
    return {
      skills: Array.isArray(parsed.skills) ? parsed.skills : structuredClone(DEFAULT_WORKBENCH.skills),
      plugins: Array.isArray(parsed.plugins) ? parsed.plugins : structuredClone(DEFAULT_WORKBENCH.plugins),
      knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge : structuredClone(DEFAULT_WORKBENCH.knowledge),
      templates: Array.isArray(parsed.templates) ? parsed.templates : structuredClone(DEFAULT_WORKBENCH.templates),
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : structuredClone(DEFAULT_WORKBENCH.schedules),
    };
  } catch {
    return structuredClone(DEFAULT_WORKBENCH);
  }
}

export function saveWorkbench(config: WorkbenchConfig): void {
  ensureDirs();
  fs.writeFileSync(getPaths().workbenchFile, JSON.stringify(config, null, 2), 'utf8');
}

export function loadSavedAgents(): ConnectedAgent[] {
  ensureDirs();
  const { agentsFile } = getPaths();
  if (!fs.existsSync(agentsFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(agentsFile, 'utf8')) as ConnectedAgent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAgentsList(agents: ConnectedAgent[]): void {
  ensureDirs();
  fs.writeFileSync(getPaths().agentsFile, JSON.stringify(agents, null, 2), 'utf8');
}

export function loadMemberUsage(): Record<string, MemberUsageRecord> {
  ensureDirs();
  const { usageFile } = getPaths();
  if (fs.existsSync(usageFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(usageFile, 'utf8')) as Record<
        string,
        MemberUsageRecord
      >;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // fall through to rebuild
    }
  }

  // First-time backfill from existing saved runs so current members show historical estimates right away
  const backfilled: Record<string, MemberUsageRecord> = {};
  try {
    for (const run of listRuns()) {
      for (const msg of run.messages || []) {
        if (msg.role !== 'assistant' || msg.status !== 'done' || !msg.senderId) continue;
        const outTok = msg.usage?.outputTokens ?? estimateTextTokens(msg.content || '');
        const inTok = msg.usage?.inputTokens ?? Math.max(60, Math.round(outTok * 1.4));
        const total = msg.usage?.totalTokens ?? inTok + outTok;
        const isEst = msg.usage ? Boolean(msg.usage.estimated) : true;
        const cur = backfilled[msg.senderId] || {
          memberId: msg.senderId,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          exactTokens: 0,
          estimatedTokens: 0,
        };
        cur.calls += 1;
        cur.inputTokens += inTok;
        cur.outputTokens += outTok;
        cur.totalTokens += total;
        if (isEst) cur.estimatedTokens += total;
        else cur.exactTokens += total;
        if (!cur.lastUsedAt || (msg.createdAt && msg.createdAt > cur.lastUsedAt)) {
          cur.lastUsedAt = msg.createdAt;
        }
        backfilled[msg.senderId] = cur;
      }
    }
  } catch {
    // ignore backfill errors
  }
  saveMemberUsage(backfilled);
  return backfilled;
}

export function saveMemberUsage(map: Record<string, MemberUsageRecord>): void {
  ensureDirs();
  fs.writeFileSync(getPaths().usageFile, JSON.stringify(map, null, 2), 'utf8');
}

export function recordMemberUsage(memberId: string, usage: TokenUsage): MemberUsageRecord {
  const all = loadMemberUsage();
  const cur = all[memberId] || {
    memberId,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    exactTokens: 0,
    estimatedTokens: 0,
  };
  cur.calls += 1;
  cur.inputTokens += Math.max(0, Math.round(usage.inputTokens || 0));
  cur.outputTokens += Math.max(0, Math.round(usage.outputTokens || 0));
  const total = Math.max(0, Math.round(usage.totalTokens || 0));
  cur.totalTokens += total;
  if (usage.estimated) cur.estimatedTokens += total;
  else cur.exactTokens += total;
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd) && usage.costUsd > 0) {
    cur.totalCostUsd = Number(((cur.totalCostUsd || 0) + usage.costUsd).toFixed(6));
  }
  if (cur.quota && typeof cur.quota.creditRemaining === 'number' && Number.isFinite(cur.quota.creditRemaining)) {
    const deduct =
      typeof usage.creditsUsed === 'number' && Number.isFinite(usage.creditsUsed) && usage.creditsUsed > 0
        ? usage.creditsUsed
        : typeof cur.quota.creditPerCall === 'number' && Number.isFinite(cur.quota.creditPerCall) && cur.quota.creditPerCall > 0
          ? cur.quota.creditPerCall
          : 0;
    if (deduct > 0) {
      cur.quota.creditRemaining = Math.max(0, Number((cur.quota.creditRemaining - deduct).toFixed(2)));
      cur.quota.updatedAt = new Date().toISOString();
    }
  }
  cur.lastUsedAt = new Date().toISOString();
  all[memberId] = cur;
  saveMemberUsage(all);
  return cur;
}

export function updateMemberQuota(
  memberId: string,
  quotaPatch: Partial<MemberQuotaConfig>,
): MemberUsageRecord {
  const all = loadMemberUsage();
  const cur = all[memberId] || {
    memberId,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    exactTokens: 0,
    estimatedTokens: 0,
  };
  const nextQuota: MemberQuotaConfig = {
    ...(cur.quota || {}),
    ...quotaPatch,
    updatedAt: new Date().toISOString(),
  };
  if (nextQuota.tokenLimit !== undefined && (!Number.isFinite(nextQuota.tokenLimit) || nextQuota.tokenLimit <= 0)) {
    delete nextQuota.tokenLimit;
  }
  if (nextQuota.callLimit !== undefined && (!Number.isFinite(nextQuota.callLimit) || nextQuota.callLimit <= 0)) {
    delete nextQuota.callLimit;
  }
  if (nextQuota.usedPercent !== undefined) {
    if (!Number.isFinite(nextQuota.usedPercent) || nextQuota.usedPercent < 0) {
      delete nextQuota.usedPercent;
    } else {
      nextQuota.usedPercent = Math.min(100, Math.max(0, Number(nextQuota.usedPercent.toFixed(1))));
    }
  }
  if (nextQuota.secondaryUsedPercent !== undefined) {
    if (!Number.isFinite(nextQuota.secondaryUsedPercent) || nextQuota.secondaryUsedPercent < 0) {
      delete nextQuota.secondaryUsedPercent;
    } else {
      nextQuota.secondaryUsedPercent = Math.min(100, Math.max(0, Number(nextQuota.secondaryUsedPercent.toFixed(1))));
    }
  }
  if (nextQuota.creditTotal !== undefined && (!Number.isFinite(nextQuota.creditTotal) || nextQuota.creditTotal <= 0)) {
    delete nextQuota.creditTotal;
  }
  if (nextQuota.creditRemaining !== undefined && (!Number.isFinite(nextQuota.creditRemaining) || nextQuota.creditRemaining < 0)) {
    delete nextQuota.creditRemaining;
  }
  if (nextQuota.creditPerCall !== undefined && (!Number.isFinite(nextQuota.creditPerCall) || nextQuota.creditPerCall <= 0)) {
    delete nextQuota.creditPerCall;
  }
  cur.quota = nextQuota;
  all[memberId] = cur;
  saveMemberUsage(all);
  return cur;
}

export function resetMemberUsage(memberId: string): MemberUsageRecord {
  const all = loadMemberUsage();
  const prevQuota = all[memberId]?.quota;
  const resetRec: MemberUsageRecord = {
    memberId,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    exactTokens: 0,
    estimatedTokens: 0,
    quota: prevQuota,
  };
  all[memberId] = resetRec;
  saveMemberUsage(all);
  return resetRec;
}

function ensureDirs(): void {
  fs.mkdirSync(getPaths().runsDir, { recursive: true });
}

export function loadProviders(): ProviderConfig[] {
  ensureDirs();
  const { providersFile } = getPaths();
  if (!fs.existsSync(providersFile)) {
    saveProviders(DEFAULT_PROVIDERS);
    return structuredClone(DEFAULT_PROVIDERS);
  }
  try {
    const raw = fs.readFileSync(providersFile, 'utf8');
    const parsed = JSON.parse(raw) as ProviderConfig[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Fallback to defaults if corrupted
  }
  return structuredClone(DEFAULT_PROVIDERS);
}

export function saveProviders(providers: ProviderConfig[]): void {
  ensureDirs();
  fs.writeFileSync(getPaths().providersFile, JSON.stringify(providers, null, 2), 'utf8');
}

export function loadWorkflow(): WorkflowDefinition {
  ensureDirs();
  const { workflowFile } = getPaths();
  if (!fs.existsSync(workflowFile)) {
    saveWorkflow(DEFAULT_WORKFLOW);
    return structuredClone(DEFAULT_WORKFLOW);
  }
  try {
    const raw = fs.readFileSync(workflowFile, 'utf8');
    const parsed = JSON.parse(raw) as WorkflowDefinition;
    if (
      parsed &&
      Array.isArray(parsed.nodes) &&
      parsed.nodes.length > 0
    ) {
      return parsed;
    }
  } catch {
    // Fallback to defaults
  }
  const fresh = structuredClone(DEFAULT_WORKFLOW);
  saveWorkflow(fresh);
  return fresh;
}

export function saveWorkflow(workflow: WorkflowDefinition): void {
  ensureDirs();
  fs.writeFileSync(getPaths().workflowFile, JSON.stringify(workflow, null, 2), 'utf8');
}

export function resetWorkflow(): WorkflowDefinition {
  const def = structuredClone(DEFAULT_WORKFLOW);
  saveWorkflow(def);
  return def;
}

export function getRunDir(runId: string): string {
  return path.join(getPaths().runsDir, runId);
}

export function saveRun(run: WorkflowRun): void {
  ensureDirs();
  const dir = getRunDir(run.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'run.json'),
    JSON.stringify(run, null, 2),
    'utf8',
  );
}

export function saveArtifact(
  runId: string,
  filename: string,
  content: string,
): string {
  const artifactsDir = path.join(getRunDir(runId), 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const filePath = path.join(artifactsDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function getUploadsDir(runId: string): string {
  const dir = path.join(getRunDir(runId), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveUploadedFile(
  runId: string,
  originalName: string,
  buffer: Buffer,
): { storedName: string; savedPath: string } {
  const dir = getUploadsDir(runId);
  const base = path.basename(originalName || 'file').replace(/[\\/:*?"<>|]+/g, '_');
  const stamp = Date.now().toString(36);
  const storedName = `${stamp}_${base}`.slice(0, 120);
  const savedPath = path.join(dir, storedName);
  fs.writeFileSync(savedPath, buffer);
  return { storedName, savedPath };
}

export function loadRun(runId: string): WorkflowRun | null {
  ensureDirs();
  const filePath = path.join(getRunDir(runId), 'run.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as WorkflowRun;
  } catch {
    return null;
  }
}

export function listRuns(): WorkflowRun[] {
  ensureDirs();
  const { runsDir } = getPaths();
  if (!fs.existsSync(runsDir)) return [];
  const entries = fs.readdirSync(runsDir, { withFileTypes: true });
  const runs: WorkflowRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const run = loadRun(entry.name);
    if (run) runs.push(run);
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return runs;
}

export function deleteRun(runId: string): boolean {
  const dir = getRunDir(runId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
