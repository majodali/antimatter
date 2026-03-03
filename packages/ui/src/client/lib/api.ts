import type { WorkspacePath } from '@antimatter/filesystem';
import type { BuildResult, BuildTarget, BuildRule } from '@antimatter/project-model';
import { eventLog } from './eventLog';

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
  const res = await fetch(url, init);
  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: res.statusText }));
    const msg = body.message ?? body.error;
    eventLog.error('network', `API ${init?.method ?? 'GET'} ${url} failed: ${msg}`);
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
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
// File API — project-scoped when projectId is provided
// ---------------------------------------------------------------------------

function fileBase(projectId?: string): string {
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
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
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
  return projectId ? `/api/projects/${projectId}/build` : '/api/build';
}

export async function executeBuild(
  targets: BuildTarget[],
  rules: BuildRule[],
  projectId?: string,
): Promise<BuildResult[]> {
  const { results } = await apiFetch<{ results: BuildResult[] }>(`${buildBase(projectId)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets, rules }),
  });
  return results;
}

export interface BuildProgressEvent {
  type: 'target-started' | 'target-output' | 'target-completed' | 'build-complete' | 'build-error';
  targetId?: string;
  timestamp?: string;
  line?: string;
  result?: BuildResult;
  results?: BuildResult[];
  error?: string;
}

export async function executeBuildStreaming(
  targets: BuildTarget[],
  rules: BuildRule[],
  onEvent: (event: BuildProgressEvent) => void,
  projectId?: string,
): Promise<void> {
  const res = await fetch(`${buildBase(projectId)}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ targets, rules }),
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
  targets: BuildTarget[];
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

export async function clearBuildCache(targetId?: string, projectId?: string): Promise<void> {
  const query = targetId ? `?targetId=${encodeURIComponent(targetId)}` : '';
  await apiFetch<{ success: boolean }>(`${buildBase(projectId)}/cache${query}`, {
    method: 'DELETE',
  });
}

export async function fetchBuildChanges(projectId?: string): Promise<string[]> {
  const { staleTargetIds } = await apiFetch<{ staleTargetIds: string[] }>(`${buildBase(projectId)}/changes`);
  return staleTargetIds;
}

// ---------------------------------------------------------------------------
// Deploy API — project-scoped when projectId is provided
// ---------------------------------------------------------------------------

function deployBase(projectId?: string): string {
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
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
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
    headers: { 'Content-Type': 'application/json' },
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
// Workspace Container API — manages Fargate workspace lifecycle
// ---------------------------------------------------------------------------

export interface WorkspaceContainerInfo {
  projectId: string;
  taskArn: string;
  status: 'PROVISIONING' | 'PENDING' | 'RUNNING' | 'DEPROVISIONING' | 'STOPPED' | 'UNKNOWN';
  privateIp?: string;
  port: number;
  sessionToken: string;
  startedAt?: string;
}

export async function startWorkspace(projectId: string): Promise<WorkspaceContainerInfo> {
  return apiFetch<WorkspaceContainerInfo>(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/start`,
    { method: 'POST' },
  );
}

export async function getWorkspaceStatus(projectId: string): Promise<WorkspaceContainerInfo> {
  return apiFetch<WorkspaceContainerInfo>(
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
  // WebSocket goes through CloudFront /ws/* → ALB → container
  // Using relative URL so it automatically uses the CloudFront host
  return `/ws/terminal/${encodeURIComponent(projectId)}?token=${encodeURIComponent(sessionToken)}`;
}
