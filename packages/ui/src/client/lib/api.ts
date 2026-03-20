/**
 * API facade — backward-compatible function exports for all REST operations.
 *
 * Workspace routing state is now centralized in rest-transport.ts and shared
 * with the ServiceClient. New code should prefer `client` from service-client.ts.
 * These functions remain for existing callers and will be migrated incrementally.
 *
 * SSE streaming functions (chat, build, deploy) are NOT routed through the
 * ServiceClient because they use event-stream responses, not JSON request/response.
 * They will move to a dedicated StreamingTransport in the future.
 */

import type { WorkspacePath } from '@antimatter/filesystem';
import type { BuildResult, BuildRule } from '@antimatter/project-model';
import type { InfraEnvironment, InfraEnvironmentOutputs } from '@antimatter/project-model';
import type { ServiceResponse } from '@antimatter/service-interface';
import { eventLog } from './eventLog';
import { getAccessToken } from './auth';
import { client } from './service-client';
import {
  setActiveWorkspace as _setActiveWorkspace,
  clearActiveWorkspace as _clearActiveWorkspace,
  getActiveWorkspace as _getActiveWorkspace,
  hasActiveWorkspace as _hasActiveWorkspace,
} from './rest-transport';

// ---------------------------------------------------------------------------
// Re-export workspace routing from the shared state in rest-transport
// ---------------------------------------------------------------------------

export const setActiveWorkspace = _setActiveWorkspace;
export const clearActiveWorkspace = _clearActiveWorkspace;
export const getActiveWorkspace = _getActiveWorkspace;
export const hasActiveWorkspace = _hasActiveWorkspace;

// ---------------------------------------------------------------------------
// Types (kept for backward compat — callers import from here)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Low-level fetch helpers (used by streaming + functions not yet on ServiceClient)
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...init, headers });

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
// ServiceClient response unwrapper
// ---------------------------------------------------------------------------

/**
 * Extract data from a ServiceResponse or throw an Error.
 * Preserves the error-throwing behavior that all api.ts callers depend on.
 */
function unwrapOrThrow<T>(response: ServiceResponse<T>, context: string): T {
  if (!response.ok) {
    const msg = response.error?.message ?? `${context} failed`;
    eventLog.error('network', `${context}: ${msg}`);
    throw new Error(msg);
  }
  return response.data as T;
}

// ---------------------------------------------------------------------------
// Workspace-aware base URL helpers (shared routing state from rest-transport)
// ---------------------------------------------------------------------------

function agentBase(projectId?: string): string {
  if (projectId && _hasActiveWorkspace(projectId)) {
    return `/workspace/${projectId}/api/agent`;
  }
  return projectId ? `/api/projects/${projectId}/agent` : '/api/agent';
}

function buildBase(projectId?: string): string {
  if (projectId && _hasActiveWorkspace(projectId)) {
    return `/workspace/${projectId}/api/build`;
  }
  return projectId ? `/api/projects/${projectId}/build` : '/api/build';
}

function deployBase(projectId?: string): string {
  if (projectId && _hasActiveWorkspace(projectId)) {
    return `/workspace/${projectId}/api/deploy`;
  }
  return projectId ? `/api/projects/${projectId}/deploy` : '/api/deploy';
}

function gitBase(projectId?: string): string {
  if (projectId && _hasActiveWorkspace(projectId)) {
    return `/workspace/${projectId}/api/git`;
  }
  return projectId ? `/api/projects/${projectId}/git` : '/api/git';
}

function activityBase(projectId?: string): string {
  if (projectId && _hasActiveWorkspace(projectId)) {
    return `/workspace/${projectId}/api/activity`;
  }
  return projectId ? `/api/projects/${projectId}/activity` : '/api/activity';
}

function eventsBase(projectId?: string): string {
  if (projectId && _hasActiveWorkspace(projectId)) {
    return `/workspace/${projectId}/api/events`;
  }
  return projectId ? `/api/projects/${projectId}/events` : '/api/events';
}

function workflowBase(projectId?: string): string {
  const pid = projectId ?? _getActiveWorkspace();
  if (pid) {
    return `/workspace/${pid}/api/workflow`;
  }
  return '/api/workflow';
}

// ---------------------------------------------------------------------------
// Project API
// ---------------------------------------------------------------------------

export async function fetchProjects(): Promise<ProjectMeta[]> {
  const res = await client.query({ type: 'projects.list' } as any);
  return unwrapOrThrow(res, 'fetchProjects').projects as ProjectMeta[];
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const res = await client.command({ type: 'projects.create', name } as any);
  return unwrapOrThrow(res, 'createProject') as ProjectMeta;
}

export async function deleteProject(id: string): Promise<void> {
  const res = await client.command({ type: 'projects.delete', projectId: id } as any);
  unwrapOrThrow(res, 'deleteProject');
}

export interface ImportGitResult extends ProjectMeta {
  importStats: { totalFiles: number };
}

export async function importGitProject(url: string, name?: string): Promise<ImportGitResult> {
  const res = await client.command({ type: 'projects.import', url, name: name || undefined } as any);
  return unwrapOrThrow(res, 'importGitProject') as ImportGitResult;
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
// File API — routed through ServiceClient for workspace-aware dispatch
// ---------------------------------------------------------------------------

export async function fetchFileTree(path = '/', projectId?: string): Promise<FileNode[]> {
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'files.tree', projectId: pid, path } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'fetchFileTree').tree as FileNode[];
}

export async function fetchFileContent(path: string, projectId?: string): Promise<string> {
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'files.read', projectId: pid, path } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'fetchFileContent').content;
}

export async function saveFile(path: string, content: string, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'files.write', projectId: pid, path, content } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'saveFile');
}

export async function createFolder(path: string, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'files.mkdir', projectId: pid, path } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'createFolder');
}

export async function deleteFile(path: string, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'files.delete', projectId: pid, path } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'deleteFile');
}

export async function fileExists(path: string, projectId?: string): Promise<boolean> {
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'files.exists', projectId: pid, path } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'fileExists').exists;
}

export async function moveFiles(
  entries: { src: string; dest: string }[],
  projectId?: string,
): Promise<{ moved: number; errors: string[] }> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'files.move', projectId: pid, entries } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'moveFiles') as { moved: number; errors: string[] };
}

export async function copyFiles(
  entries: { src: string; dest: string }[],
  projectId?: string,
): Promise<{ copied: number; errors: string[] }> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'files.copy', projectId: pid, entries } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'copyFiles') as { copied: number; errors: string[] };
}

// ---------------------------------------------------------------------------
// Agent/Chat API
// ---------------------------------------------------------------------------

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
// Build API
// ---------------------------------------------------------------------------

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
// Deploy API
// ---------------------------------------------------------------------------

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
// Command Execution API
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
// Workspace Instance API
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
  const res = await client.command({ type: 'workspaces.start', projectId } as any);
  return unwrapOrThrow(res, 'startWorkspace') as WorkspaceInstanceInfo;
}

export async function getWorkspaceStatus(projectId: string): Promise<WorkspaceInstanceInfo> {
  const res = await client.query({ type: 'workspaces.status', projectId } as any);
  return unwrapOrThrow(res, 'getWorkspaceStatus') as WorkspaceInstanceInfo;
}

export async function getWorkspaceWsUrl(projectId: string, sessionToken: string): Promise<string> {
  return `/ws/terminal/${encodeURIComponent(projectId)}?token=${encodeURIComponent(sessionToken)}`;
}

// ---------------------------------------------------------------------------
// Chat History Persistence API
// ---------------------------------------------------------------------------

export async function fetchChatHistory(projectId?: string): Promise<any[]> {
  const { messages } = await apiFetch<{ messages: any[] }>(`${agentBase(projectId)}/chat/history`);
  return messages;
}

export async function saveChatHistory(messages: any[], projectId?: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`${agentBase(projectId)}/chat/history`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
}

// ---------------------------------------------------------------------------
// Activity Log Persistence API
// ---------------------------------------------------------------------------

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
// System Events API
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
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'projects.status', projectId: pid } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'fetchGitStatus') as GitStatus;
}

export async function gitInit(projectId?: string): Promise<void> {
  // gitInit is not in the service-interface — keep as direct fetch for now
  await apiFetch<{ success: boolean }>(`${gitBase(projectId)}/init`, { method: 'POST' });
}

export async function gitStage(files: string[], projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'projects.stage', projectId: pid, files } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'gitStage');
}

export async function gitUnstage(files: string[], projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'projects.unstage', projectId: pid, files } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'gitUnstage');
}

export async function gitCommit(message: string, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'projects.commit', projectId: pid, message } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'gitCommit');
}

export async function gitPush(remote?: string, branch?: string, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'projects.push', projectId: pid, remote, branch } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'gitPush');
}

export async function gitPull(remote?: string, branch?: string, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'projects.pull', projectId: pid, remote, branch } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'gitPull');
}

export async function gitAddRemote(name: string, url: string, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'projects.setRemote', projectId: pid, url } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'gitAddRemote');
}

export async function fetchGitRemotes(projectId?: string): Promise<{ name: string; url: string; type: string }[]> {
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'projects.remote', projectId: pid } as any,
    pid || undefined,
  );
  const data = unwrapOrThrow(res, 'fetchGitRemotes');
  // Server returns { remotes: [...] } but service-interface returns { url: string | null }
  // Handle both shapes for backward compat
  if ('remotes' in data) return (data as any).remotes;
  return data.url ? [{ name: 'origin', url: data.url, type: 'fetch' }] : [];
}

export async function fetchGitLog(limit = 20, projectId?: string): Promise<{ hash: string; message: string }[]> {
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'projects.log', projectId: pid, limit } as any,
    pid || undefined,
  );
  const data = unwrapOrThrow(res, 'fetchGitLog');
  // Server returns { commits: [...] } but service-interface type is { entries: [...] }
  if ('commits' in data) return (data as any).commits;
  return (data as any).entries ?? [];
}

// ---------------------------------------------------------------------------
// Infrastructure Environment Registry
// ---------------------------------------------------------------------------

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
  await apiFetch<{ success: boolean }>(`/workspace/${projectId}/api/refresh`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Workflow / Pipeline API (workspace-scoped)
// ---------------------------------------------------------------------------

export interface EnvironmentActionDeclaration {
  event: { type: string; [key: string]: unknown };
  icon?: string;
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

export async function runWorkflowRule(
  ruleId: string,
  projectId?: string,
): Promise<any> {
  return apiFetch<any>(`${workflowBase(projectId)}/run-rule/${encodeURIComponent(ruleId)}`, {
    method: 'POST',
  });
}
