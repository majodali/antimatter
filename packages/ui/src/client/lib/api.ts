import type { WorkspacePath } from '@antimatter/filesystem';
import type { BuildResult, BuildTarget, BuildRule } from '@antimatter/project-model';

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
    throw new Error(body.message ?? body.error);
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
