export type LaneId = 'human' | 'claude' | 'gemini' | 'codex' | 'release';

export type NodeKind =
  | 'human_input'
  | 'human_gate'
  | 'llm'
  | 'shell'
  | 'review_loop'
  | 'condition'
  | 'consensus'
  | 'debate'
  | 'file_read'
  | 'file_write'
  | 'http'
  | 'delay';

export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped';

export type ExecutionMode = 'mock' | 'real';

export type ThinkingLevel =
  | 'default'
  | 'off'
  | 'on'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export type ProviderConnectionType =
  | 'cli'
  | 'openai_api'
  | 'anthropic_api'
  | 'gemini_api';

export interface ProviderConfig {
  id: string;
  name: string;
  shortName: string;
  relayName?: string;
  avatar?: string;
  offline?: boolean;
  thinkingLevel?: ThinkingLevel;
  accentColor: string;
  connectionType?: ProviderConnectionType;
  subscriptionHint: string;
  command: string;
  args: string[];
  inputMode: 'stdin' | 'arg';
  modelFlag?: string;
  model?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  systemPrompt?: string;
  installCmd: string;
  loginCmd: string;
  docsHint: string;
  timeoutSec: number;
  forceMock?: boolean;
}

export interface ProviderHealth {
  id: string;
  command: string;
  installed: boolean;
  resolvedPath?: string;
  version?: string;
  checkedAt: string;
}

export interface WorkflowNodeConfig {
  id: string;
  title: string;
  subtitle?: string;
  lane: LaneId;
  kind: NodeKind;
  providerId: string;
  enabled?: boolean;
  dependsOn: string[];
  promptTemplate?: string;
  shellCommand?: string;
  maxRounds?: number;
  fixProviderId?: string;
  fixPromptTemplate?: string;
  /** Condition node settings */
  conditionMode?: 'contains' | 'not_contains' | 'regex';
  conditionPattern?: string;
  /** File read / write node settings */
  filePaths?: string;
  targetFilePath?: string;
  /** HTTP / Webhook node settings */
  httpMethod?: 'GET' | 'POST' | 'PUT';
  httpUrl?: string;
  httpHeaders?: string;
  httpBody?: string;
  /** Delay node settings */
  delaySeconds?: number;
  position: { x: number; y: number };
  width?: number;
}

export interface WorkflowEdgeConfig {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
  dashed?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNodeConfig[];
  edges: WorkflowEdgeConfig[];
}

export interface WorkflowPresetTemplate {
  id: string;
  name: string;
  description: string;
  builtin?: boolean;
  workflow: WorkflowDefinition;
  updatedAt: string;
}

export interface NodeExecutionState {
  nodeId: string;
  status: NodeStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output: string;
  logs: string[];
  error?: string;
  commandPreview?: string;
  providerUsed?: string;
  usedMock?: boolean;
  round?: number;
  maxRounds?: number;
  decision?: 'approved' | 'rejected';
  humanFeedback?: string;
  branchResult?: 'true' | 'false';
}

export interface RunEvent {
  id: string;
  timestamp: string;
  type:
    | 'run_started'
    | 'run_completed'
    | 'run_failed'
    | 'run_aborted'
    | 'node_started'
    | 'node_log'
    | 'node_waiting'
    | 'node_completed'
    | 'node_failed'
    | 'node_skipped'
    | 'approval_submitted';
  nodeId?: string;
  message: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  savedPath?: string;
  url?: string;
  textContent?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  senderId: string;
  senderName: string;
  avatar?: string;
  accentColor: string;
  stageId?: string;
  stageTitle?: string;
  content: string;
  attachments?: ChatAttachment[];
  logs: string[];
  commandPreview?: string;
  wakePrompt?: string;
  status: 'streaming' | 'done' | 'error';
  durationMs?: number;
  createdAt: string;
}

export interface TaskMaterial {
  id: string;
  title: string;
  content: string;
  source: 'manual' | 'file';
  createdAt: string;
}

export interface WorkflowRun {
  id: string;
  title: string;
  requirement: string;
  repoPath: string;
  branchName: string;
  executionMode: ExecutionMode;
  autoMergeEnabled: boolean;
  autoDeployEnabled: boolean;
  checkCommand: string;
  deployCommand: string;
  status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'aborted';
  createdAt: string;
  updatedAt: string;
  nodes: Record<string, NodeExecutionState>;
  messages: ChatMessage[];
  materials?: TaskMaterial[];
  events: RunEvent[];
}

export interface CreateRunPayload {
  title?: string;
  requirement?: string;
  repoPath: string;
  branchName?: string;
  executionMode: ExecutionMode;
  startWorkflow?: boolean;
  autoMergeEnabled?: boolean;
  autoDeployEnabled?: boolean;
  checkCommand?: string;
  deployCommand?: string;
}

export interface ChatSendPayload {
  content: string;
  attachments?: ChatAttachment[];
  targetProviderIds?: string[];
  mode?: 'chat' | 'workflow';
  workflowTemplateId?: string;
  executionMode?: ExecutionMode;
  repoPath?: string;
}

export type AgentTrigger =
  | { type: 'manual' }
  | { type: 'cli'; command: string; args?: string[]; inputMode?: 'stdin' | 'arg' }
  | { type: 'webhook'; url: string };

export interface ConnectedAgent {
  id: string;
  name: string;
  modelName?: string;
  relayName?: string;
  avatar?: string;
  thinkingLevel?: ThinkingLevel;
  thinkingOptions?: ThinkingLevel[];
  trigger?: AgentTrigger;
  role?: string;
  accentColor: string;
  online: boolean;
  busy: boolean;
  listening?: boolean;
  roomId?: string;
  joinedAt: string;
  lastSeenAt: string;
  activeTaskId?: string;
}

export interface AgentTask {
  taskId: string;
  agentId: string;
  roomId: string;
  kind: 'chat' | 'workflow';
  stageId?: string;
  stageTitle?: string;
  thinkingLevel?: ThinkingLevel;
  repoPath: string;
  prompt: string;
  recentHistory?: string;
  createdAt: string;
}

export interface ApprovalPayload {
  decision: 'approved' | 'rejected';
  feedback?: string;
  overrideSynthesis?: string;
}

export interface WorkbenchSkill {
  id: string;
  name: string;
  trigger?: string;
  description: string;
  prompt: string;
  autoInject: boolean;
  enabled: boolean;
  category?: string;
  updatedAt: string;
}

export type PluginKind = 'mcp_stdio' | 'mcp_http' | 'cli_tool' | 'webhook';

export interface WorkbenchPlugin {
  id: string;
  name: string;
  kind: PluginKind;
  description: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  lastTestOk?: boolean;
  lastTestMessage?: string;
  lastTestedAt?: string;
  updatedAt: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  pinned: boolean;
  source: 'manual' | 'file';
  updatedAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  mode: 'chat' | 'workflow';
  prompt: string;
  targetIds?: string[];
  updatedAt: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  mode: 'chat' | 'workflow';
  prompt: string;
  targetIds?: string[];
  roomId?: string;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error';
  lastSummary?: string;
  nextRunAt?: string;
  updatedAt: string;
}

export interface WorkbenchConfig {
  skills: WorkbenchSkill[];
  plugins: WorkbenchPlugin[];
  knowledge: KnowledgeDoc[];
  templates: WorkflowTemplate[];
  schedules: ScheduledTask[];
}
