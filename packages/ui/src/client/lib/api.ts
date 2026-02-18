import type { WorkspacePath } from '@antimatter/filesystem';
import type { BuildResult, BuildTarget, BuildRule } from '@antimatter/project-model';

export interface FileNode {
  name: string;
  path: WorkspacePath;
  isDirectory: boolean;
  children?: FileNode[];
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

export async function fetchFileTree(path = '/'): Promise<FileNode[]> {
  const { tree } = await apiFetch<{ tree: FileNode[] }>(
    `/api/files/tree?path=${encodeURIComponent(path)}`,
  );
  return tree;
}

export async function fetchFileContent(path: string): Promise<string> {
  const { content } = await apiFetch<{ path: string; content: string }>(
    `/api/files/read?path=${encodeURIComponent(path)}`,
  );
  return content;
}

export async function saveFile(path: string, content: string): Promise<void> {
  await apiFetch<{ success: boolean }>('/api/files/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}

export async function sendChatMessage(message: string): Promise<{ response: string }> {
  return apiFetch<{ response: string }>('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

export async function clearChatHistory(): Promise<void> {
  await apiFetch<{ success: boolean }>('/api/agent/history', {
    method: 'DELETE',
  });
}

export async function executeBuild(
  targets: BuildTarget[],
  rules: BuildRule[],
): Promise<BuildResult[]> {
  const { results } = await apiFetch<{ results: BuildResult[] }>('/api/build/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets, rules }),
  });
  return results;
}

export async function fetchBuildResults(): Promise<BuildResult[]> {
  const { results } = await apiFetch<{ results: BuildResult[] }>('/api/build/results');
  return results;
}
