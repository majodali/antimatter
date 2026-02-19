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

export async function fetchBuildResults(projectId?: string): Promise<BuildResult[]> {
  const { results } = await apiFetch<{ results: BuildResult[] }>(`${buildBase(projectId)}/results`);
  return results;
}
