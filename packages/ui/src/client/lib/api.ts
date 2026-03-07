import type { WorkspacePath } from '@antimatter/filesystem';
import type { BuildResult, BuildRule } from '@antimatter/project-model';
import { eventLog } from './eventLog';
import { getAccessToken } from './auth';

export interface FileNode {
  name: string;
  path: WorkspacePath;
  isDirectory: boolean;
  children?: FileNode[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
}

interface ApiError {
  error: string;
  message?: string;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  // Inject Cognito access token for authenticated API calls
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...init, headers });

  // Guard against non-JSON responses (e.g. CloudFront serving index.html for 404s)
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    const method = init?.method ?? 'GET';
    eventLog.error('network', `API ${method} ${url} returned non-JSON (${contentType || 'no content-type'})`);
    throw new Error(`Server returned an unexpected response. You may need to restart your workspace.`);
  }

  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: res.statusText }));
    const msg = body.message ?? body.error;
    eventLog.error('network', `API ${init?.method ?? 'GET'} ${url} failed: ${msg}`);
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Build headers with auth token for direct fetch() calls (SSE streaming, etc.) */
async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { ...extra };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Project API
// ---------------------------------------------------------------------------

export async function fetchProjects(): Promise<ProjectMeta[]> {
  const { projects } = await apiFetch<{ projects: ProjectMeta[] }>('/api/projects');
  return projects;
}

export async function createProject(name: string): Promise<ProjectMeta> {
  return apiFetch<ProjectMeta>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface ImportGitResult extends ProjectMeta {
  importStats: { totalFiles: number };
}

export async function importGitProject(url: string, name?: string): Promise<ImportGitResult> {
  return apiFetch<ImportGitResult>('/api/projects/import/git', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name: name || undefined }),
  });
}

export function readBrowserFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsText(file, 'utf-8');
  });
}

// ---------------------------------------------------------------------------
// Workspace-aware API routing
// ---------------------------------------------------------------------------
// When a workspace EC2 instance is active for a project, project-scoped
// API calls are routed through /workspace/{projectId}/api/* (EC2 via ALB)
// instead of /api/projects/{projectId}/* (Lambda via API Gateway).

let activeWorkspaceProjectId: string | null = null;

export function setActiveWorkspace(projectId: string | null) {
  activeWorkspaceProjectId = projectId;
}

export function getActiveWorkspace(): string | null {
  return activeWorkspaceProjectId;
}

// ---------------------------------------------------------------------------
// File API — project-scoped when projectId is provided
// ---------------------------------------------------------------------------

function fileBase(projectId?: string): string {
  if (projectId && activeWorkspaceProjectId === projectId) {
    return `/workspace/${projectId}/api/files`;
  }
  return projectId ? `/api/projects/${projectId}/files` : '/api/files';
}

export async function fetchFileTree(path = '/', projectId?: string): Promise<FileNode[]> {
  const { tree } = await apiFetch<{ tree: FileNode[] }>(
    `${fileBase(projectId)}/tree?path=${encodeURIComponent(path)}`,
  );
  return tree;
}

export async function fetchFileContent(path: string, projectId?: string): Promise<string> {
  const { content } = await apiFetch<{ path: string; content: string }>(
    `${fileBase(projectId)}/read?path=${encodeURIComponent(path)}`,
  );
  return content;
}

export async function saveFile(path: string, content: string, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${fileBase(projectId)}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}

export async function createFolder(path: string, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${fileBase(projectId)}/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

// ---------------------------------------------------------------------------
// Agent/Chat API — project-scoped when projectId is provided
// ---------------------------------------------------------------------------

function agentBase(projectId?: string): string {
  if (projectId && activeWorkspaceProjectId === projectId) {
    return `/workspace/${projectId}/api/agent`;
  }
  return projectId ? `/api/projects/${projectId}/agent` : '/api/agent';
}

export async function sendChatMessage(message: string, projectId?: string): Promise<{ response: string }> {
  return apiFetch<{ response: string }>(`${agentBase(projectId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

export async function clearChatHistory(projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${agentBase(projectId)}/history`, {
    method: 'DELETE',
  });
}

export interface ChatStreamEvent {
  type: 'text' | 'tool-call' | 'tool-result' | 'done' | 'error' | 'handoff';
  delta?: string;
  toolCall?: { id: string; name: string; parameters: Record<string, unknown> };
  toolResult?: { toolCallId: string; content: string; isError?: boolean };
  response?: string;
  usage?: { inputTokens: number; outputTokens: number };
  agentRole?: string;
  fromRole?: string;
  toRole?: string;
  error?: string;
}

export async function sendChatMessageStreaming(
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  projectId?: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${agentBase(projectId)}/chat`, {
    method: 'POST',
    headers: await authHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }),
    body: JSON.stringify({ message }),
    signal: abortSignal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
          onEvent(event);
        } catch { /* skip malformed */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Build API — project-scoped when projectId is provided
// ---------------------------------------------------------------------------

function buildBase(projectId?: string): string {
  if (projectId && activeWorkspaceProjectId === projectId) {
    return `/workspace/${projectId}/api/build`;
  }
  return projectId ? `/api/projects/${projectId}/build` : '/api/build';
}

export async function executeBuild(
  rules: BuildRule[],
  projectId?: string,
): Promise<BuildResult[]> {
  const { results } = await apiFetch<{ results: BuildResult[] }>(`${buildBase(projectId)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
  return results;
}

export interface BuildProgressEvent {
  type: 'rule-started' | 'rule-output' | 'rule-completed' | 'build-complete' | 'build-error';
  ruleId?: string;
  timestamp?: string;
  line?: string;
  result?: BuildResult;
  results?: BuildResult[];
  error?: string;
}

export async function executeBuildStreaming(
  rules: BuildRule[],
  onEvent: (event: BuildProgressEvent) => void,
  projectId?: string,
): Promise<void> {
  const res = await fetch(`${buildBase(projectId)}/execute`, {
    method: 'POST',
    headers: await authHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }),
    body: JSON.stringify({ rules }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as BuildProgressEvent;
          onEvent(event);
        } catch { /* skip malformed */ }
      }
    }
  }
}

export async function fetchBuildResults(projectId?: string): Promise<BuildResult[]> {
  const { results } = await apiFetch<{ results: BuildResult[] }>(`${buildBase(projectId)}/results`);
  return results;
}

export interface BuildConfig {
  rules: BuildRule[];
}

export async function fetchBuildConfig(projectId?: string): Promise<BuildConfig> {
  return apiFetch<BuildConfig>(`${buildBase(projectId)}/config`);
}

export async function saveBuildConfig(config: BuildConfig, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${buildBase(projectId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function clearBuildCache(ruleId?: string, projectId?: string): Promise<void> {
  const query = ruleId ? `?ruleId=${encodeURIComponent(ruleId)}` : '';
  await apiFetch<{ success: boolean }>(`${buildBase(projectId)}/cache${query}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Deploy API — project-scoped when projectId is provided
// ---------------------------------------------------------------------------

function deployBase(projectId?: string): string {
  if (projectId && activeWorkspaceProjectId === projectId) {
    return `/workspace/${projectId}/api/deploy`;
  }
  return projectId ? `/api/projects/${projectId}/deploy` : '/api/deploy';
}

export interface DeployConfig {
  modules: any[];
  packaging: any[];
  targets: any[];
}

export async function fetchDeployConfig(projectId?: string): Promise<DeployConfig> {
  return apiFetch<DeployConfig>(`${deployBase(projectId)}/config`);
}

export async function saveDeployConfig(config: DeployConfig, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${deployBase(projectId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export interface DeployProgressEvent {
  type: 'step-started' | 'step-output' | 'step-completed' | 'deploy-complete' | 'deploy-error';
  targetId?: string;
  moduleId?: string;
  step?: string;
  output?: string;
  result?: any;
  results?: any[];
  error?: string;
  timestamp?: string;
}

export async function executeDeployStreaming(
  targetIds: string[] | undefined,
  onEvent: (event: DeployProgressEvent) => void,
  projectId?: string,
  dryRun?: boolean,
): Promise<void> {
  const res = await fetch(`${deployBase(projectId)}/execute`, {
    method: 'POST',
    headers: await authHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }),
    body: JSON.stringify({ targetIds, dryRun }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as DeployProgressEvent;
          onEvent(event);
        } catch { /* skip malformed */ }
      }
    }
  }
}

export async function fetchDeployResults(projectId?: string): Promise<any[]> {
  const { results } = await apiFetch<{ results: any[] }>(`${deployBase(projectId)}/results`);
  return results;
}

// ---------------------------------------------------------------------------
// Runtime Config — fetched once to get direct Lambda URLs
// ---------------------------------------------------------------------------

interface RuntimeConfig {
  commandUrl: string | null;
  wsBaseUrl: string | null;
}

let cachedConfig: RuntimeConfig | undefined;

async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    const config = await apiFetch<RuntimeConfig>('/api/config');
    cachedConfig = {
      commandUrl: config.commandUrl ?? null,
      wsBaseUrl: config.wsBaseUrl ?? null,
    };
  } catch {
    cachedConfig = { commandUrl: null, wsBaseUrl: null };
  }
  return cachedConfig;
}

async function getCommandUrl(): Promise<string | null> {
  return (await getRuntimeConfig()).commandUrl;
}

// ---------------------------------------------------------------------------
// Command Execution API — runs commands on the Command Lambda via EFS
// ---------------------------------------------------------------------------

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function executeProjectCommand(
  projectId: string,
  command: string,
  options?: { syncAfter?: boolean },
): Promise<CommandResult> {
  // Use direct Lambda Function URL (15-min timeout) when available,
  // fall back to API Gateway path (29-second timeout).
  const commandUrl = await getCommandUrl();
  const baseUrl = commandUrl
    ? `${commandUrl}projects/${encodeURIComponent(projectId)}/exec`
    : `/api/commands/projects/${encodeURIComponent(projectId)}/exec`;

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      command,
      syncBefore: true,
      syncAfter: options?.syncAfter ?? true,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = (body as any).message ?? (body as any).error ?? res.statusText;
    throw new Error(msg);
  }

  return res.json() as Promise<CommandResult>;
}

// ---------------------------------------------------------------------------
// Workspace Instance API — manages EC2 workspace lifecycle
// ---------------------------------------------------------------------------

export interface WorkspaceInstanceInfo {
  projectId: string;
  instanceId: string;
  status: 'PENDING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'TERMINATED' | 'UNKNOWN';
  privateIp?: string;
  port: number;
  sessionToken: string;
  startedAt?: string;
  volumeId?: string;
}

export async function startWorkspace(projectId: string): Promise<WorkspaceInstanceInfo> {
  return apiFetch<WorkspaceInstanceInfo>(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/start`,
    { method: 'POST' },
  );
}

export async function getWorkspaceStatus(projectId: string): Promise<WorkspaceInstanceInfo> {
  return apiFetch<WorkspaceInstanceInfo>(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/status`,
  );
}

export async function stopWorkspace(projectId: string): Promise<void> {
  await apiFetch<{ success: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/stop`,
    { method: 'POST' },
  );
}

/**
 * Get the WebSocket URL for connecting to a workspace terminal.
 * Uses the CloudFront distribution which proxies /ws/* to the ALB.
 */
export async function getWorkspaceWsUrl(projectId: string, sessionToken: string): Promise<string> {
  // WebSocket goes through CloudFront /ws/* → ALB → EC2 instance
  // Using relative URL so it automatically uses the CloudFront host
  return `/ws/terminal/${encodeURIComponent(projectId)}?token=${encodeURIComponent(sessionToken)}`;
}

// ---------------------------------------------------------------------------
// Chat History Persistence API
// ---------------------------------------------------------------------------

function chatHistoryBase(projectId?: string): string {
  return `${agentBase(projectId)}/chat/history`;
}

export async function fetchChatHistory(projectId?: string): Promise<any[]> {
  const { messages } = await apiFetch<{ messages: any[] }>(chatHistoryBase(projectId));
  return messages;
}

export async function saveChatHistory(messages: any[], projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(chatHistoryBase(projectId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
}

// ---------------------------------------------------------------------------
// Activity Log Persistence API
// ---------------------------------------------------------------------------

function activityBase(projectId?: string): string {
  if (projectId && activeWorkspaceProjectId === projectId) {
    return `/workspace/${projectId}/api/activity`;
  }
  return projectId ? `/api/projects/${projectId}/activity` : '/api/activity';
}

export async function fetchActivityLog(projectId?: string): Promise<any[]> {
  const { events } = await apiFetch<{ events: any[] }>(activityBase(projectId));
  return events;
}

export async function saveActivityLog(events: any[], projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(activityBase(projectId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
}

// ---------------------------------------------------------------------------
// System Events API — centralized event log from S3
// ---------------------------------------------------------------------------

export interface SystemEvent {
  id: string;
  timestamp: string;
  projectId: string;
  source: 'lambda' | 'workspace';
  category: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: Record<string, unknown>;
}

function eventsBase(projectId?: string): string {
  if (projectId && activeWorkspaceProjectId === projectId) {
    return `/workspace/${projectId}/api/events`;
  }
  return projectId ? `/api/projects/${projectId}/events` : '/api/events';
}

export async function fetchSystemEvents(
  projectId?: string,
  days = 1,
  limit = 200,
): Promise<SystemEvent[]> {
  const { events } = await apiFetch<{ events: SystemEvent[] }>(
    `${eventsBase(projectId)}?days=${days}&limit=${limit}`,
  );
  return events;
}

// ---------------------------------------------------------------------------
// Git API
// ---------------------------------------------------------------------------

function gitBase(projectId?: string): string {
  if (projectId && activeWorkspaceProjectId === projectId) {
    return `/workspace/${projectId}/api/git`;
  }
  return projectId ? `/api/projects/${projectId}/git` : '/api/git';
}

export interface GitStatus {
  initialized: boolean;
  branch?: string;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
}

export interface GitFileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
}

export async function fetchGitStatus(projectId?: string): Promise<GitStatus> {
  return apiFetch<GitStatus>(`${gitBase(projectId)}/status`);
}

export async function gitInit(projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/init`, { method: 'POST' });
}

export async function gitStage(files: string[], projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
}

export async function gitUnstage(files: string[], projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/unstage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
}

export async function gitCommit(message: string, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

export async function gitPush(remote?: string, branch?: string, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remote, branch }),
  });
}

export async function gitPull(remote?: string, branch?: string, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remote, branch }),
  });
}

export async function gitAddRemote(name: string, url: string, projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/remote/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url }),
  });
}

export async function fetchGitRemotes(projectId?: string): Promise<{ name: string; url: string; type: string }[]> {
  const { remotes } = await apiFetch<{ remotes: { name: string; url: string; type: string }[] }>(`${gitBase(projectId)}/remotes`);
  return remotes;
}

export async function fetchGitLog(limit = 20, projectId?: string): Promise<{ hash: string; message: string }[]> {
  const { commits } = await apiFetch<{ commits: { hash: string; message: string }[] }>(`${gitBase(projectId)}/log?limit=${limit}`);
  return commits;
}

// ---------------------------------------------------------------------------
// Infrastructure Environment Registry
// ---------------------------------------------------------------------------

import type { InfraEnvironment, InfraEnvironmentOutputs } from '@antimatter/project-model';

export async function fetchInfraEnvironments(): Promise<InfraEnvironment[]> {
  const { environments } = await apiFetch<{ environments: InfraEnvironment[] }>('/api/infra-environments');
  return environments;
}

export async function registerInfraEnvironment(input: {
  envId: string;
  stackName: string;
  outputs: InfraEnvironmentOutputs;
  description?: string;
}): Promise<InfraEnvironment> {
  return apiFetch<InfraEnvironment>('/api/infra-environments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function terminateInfraEnvironment(envId: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/infra-environments/${envId}/terminate`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Secrets Management (SSM Parameter Store)
// ---------------------------------------------------------------------------

export interface SecretStatus {
  name: string;
  description: string;
  hasValue: boolean;
}

export async function fetchSecrets(): Promise<SecretStatus[]> {
  const { secrets } = await apiFetch<{ secrets: SecretStatus[] }>('/api/secrets');
  return secrets;
}

export async function setSecret(name: string, value: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/secrets/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

export async function deleteSecret(name: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/secrets/${name}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Workspace Refresh
// ---------------------------------------------------------------------------

export async function refreshWorkspace(projectId: string): Promise<void> {
  // This goes directly to the workspace EC2 via CloudFront → ALB
  await apiFetch<{ success: boolean }>(`/workspace/${projectId}/api/refresh`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Workflow / Pipeline API (workspace-scoped)
// ---------------------------------------------------------------------------

function workflowBase(projectId?: string): string {
  const pid = projectId ?? activeWorkspaceProjectId;
  if (pid) {
    return `/workspace/${pid}/api/workflow`;
  }
  return '/api/workflow';
}

export interface PipelineDeclarations {
  modules: {
    name: string;
    type: string;
    build: string;
    test?: string;
    cwd?: string;
    output: string;
    outputType: string;
  }[];
  targets: {
    name: string;
    module: string;
    type: string;
    config: Record<string, unknown>;
  }[];
  environments: {
    name: string;
    stackName?: string;
    domain?: string;
  }[];
}

export async function fetchPipelineDeclarations(projectId?: string): Promise<PipelineDeclarations> {
  return apiFetch<PipelineDeclarations>(`${workflowBase(projectId)}/declarations`);
}

export async function emitWorkflowEvent(
  event: { type: string; [key: string]: unknown },
  projectId?: string,
): Promise<any> {
  return apiFetch<any>(`${workflowBase(projectId)}/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });
}
