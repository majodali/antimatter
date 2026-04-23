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
    throw new Error(`Server returned an unexpected response. You may need to restart your workspace.`);
  }

  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: res.statusText }));
    const msg = body.message ?? body.error;
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
    throw new Error(msg);
  }
  return response.data as T;
}

// ---------------------------------------------------------------------------
// Workspace-aware base URL helpers (shared routing state from rest-transport)
// ---------------------------------------------------------------------------

// agentBase removed — agent operations wired through ServiceClient + WebSocket.

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

// gitBase removed — git operations wired through ServiceClient.
// gitInit still uses apiFetch (not yet in service-interface).

function activityBase(projectId?: string): string {
  if (projectId && _hasActiveWorkspace(projectId)) {
    return `/workspace/${projectId}/api/activity`;
  }
  return projectId ? `/api/projects/${projectId}/activity` : '/api/activity';
}

// eventsBase removed — observability.events.list wired through ServiceClient.

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

export async function clearChatHistory(projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'agents.chats.delete', projectId: pid } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'clearChatHistory');
}

// ChatStreamEvent removed — events use canonical service-interface types
// (agents.chats.message, agents.chats.toolCall, agents.chats.done, etc.)
// delivered over WebSocket. Subscribe via:
//   workspaceConnection.onMessage(handler, { type: 'agents.chats.*' })

/**
 * Send a chat message to the agent via WebSocket.
 *
 * The server processes it asynchronously and broadcasts incremental events
 * over the WebSocket as `agents.chats.*` messages. Falls back to REST POST
 * when the WebSocket is not connected.
 */
export async function sendChatMessage(message: string, projectId?: string): Promise<void> {
  // TODO: Enable WebSocket send once server-side handler is verified
  // const { workspaceConnection } = await import('./workspace-connection.js');
  // if (workspaceConnection.isConnected()) {
  //   workspaceConnection.send({ type: 'agents.chats.send', message });
  //   return;
  // }

  // REST POST — server processes async, broadcasts events via WebSocket
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'agents.chats.send', projectId: pid, message } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'sendChatMessage');
}

// ---------------------------------------------------------------------------
// Build API
// ---------------------------------------------------------------------------

// executeBuild, executeBuildStreaming, BuildProgressEvent removed — build execution driven by workflow engine,
// progress delivered via WebSocket application-state broadcasts.

export async function fetchBuildResults(projectId?: string): Promise<BuildResult[]> {
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'builds.results.list', projectId: pid } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'fetchBuildResults').results as BuildResult[];
}

export interface BuildConfig {
  rules: BuildRule[];
}

export async function fetchBuildConfig(projectId?: string): Promise<BuildConfig> {
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'builds.configurations.list', projectId: pid } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'fetchBuildConfig') as BuildConfig;
}

export async function saveBuildConfig(config: BuildConfig, projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'builds.configurations.set', projectId: pid, ...config } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'saveBuildConfig');
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

// executeDeployStreaming + DeployProgressEvent removed — deploy execution
// driven by workflow engine, progress via WebSocket application-state broadcasts.

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
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'agents.chats.history', projectId: pid } as any,
    pid || undefined,
  );
  const data = unwrapOrThrow(res, 'fetchChatHistory');
  return (data as any).messages ?? [];
}

export async function saveChatHistory(messages: any[], projectId?: string): Promise<void> {
  const pid = projectId ?? '';
  const res = await client.command(
    { type: 'agents.chats.history', projectId: pid, messages } as any,
    pid || undefined,
  );
  unwrapOrThrow(res, 'saveChatHistory');
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
  const pid = projectId ?? '';
  const res = await client.query(
    { type: 'observability.events.list', projectId: pid, days, limit } as any,
    pid || undefined,
  );
  return unwrapOrThrow(res, 'fetchSystemEvents').events as SystemEvent[];
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
  // gitInit is not yet in the service-interface — use direct workspace/project URL
  const base = projectId && _hasActiveWorkspace(projectId)
    ? `/workspace/${projectId}/api/git`
    : projectId ? `/api/projects/${projectId}/git` : '/api/git';
  await apiFetch<{ success: boolean }>(`${base}/init`, { method: 'POST' });
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
