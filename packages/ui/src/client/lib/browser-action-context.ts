/**
 * BrowserActionContext — ActionContext implementation for in-browser testing.
 *
 * Drives the UI through a combination of:
 * - Zustand store actions (same code path as user clicks)
 * - Client API calls (for operations that go through HTTP)
 *
 * Includes configurable delay between actions for observability —
 * watching tests execute in real-time.
 */

import type { WorkspacePath } from '@antimatter/filesystem';
import type { ActionContext, GitStatusResult } from '../../shared/action-context.js';
import { useFileStore } from '../stores/fileStore.js';
import { useEditorStore } from '../stores/editorStore.js';
import { useGitStore } from '../stores/gitStore.js';
import { useBuildStore } from '../stores/buildStore.js';
import { useApplicationStore } from '../stores/applicationStore.js';
import { detectLanguage } from './languageDetection.js';
import { getAccessToken } from './auth.js';
import {
  fetchFileTree,
  fetchFileContent,
  saveFile,
  createFolder,
  fetchBuildConfig,
  saveBuildConfig as saveBuildConfigApi,
  fetchDeployConfig,
  saveDeployConfig as saveDeployConfigApi,
  fetchDeployResults,
  executeDeployStreaming,
  fetchGitStatus,
  gitStage,
  gitUnstage,
  gitCommit as apiGitCommit,
  gitPush as apiGitPush,
  gitPull as apiGitPull,
  emitWorkflowEvent as apiEmitWorkflowEvent,
  runWorkflowRule as apiRunWorkflowRule,
  sendChatMessage,
  clearChatHistory,
} from './api.js';

export interface BrowserActionContextOptions {
  /** Delay in ms between actions (default: 200). Set to 0 for full speed. */
  delayMs?: number;
  /** Project ID for API calls (optional, uses active project if not set). */
  projectId?: string;
}

export class BrowserActionContext implements ActionContext {
  private readonly delayMs: number;
  private readonly projectId?: string;

  constructor(options: BrowserActionContextOptions = {}) {
    this.delayMs = options.delayMs ?? 200;
    this.projectId = options.projectId;
  }

  private async delay(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  // ---- Files ----
  // Use API calls (same as UI file operations) + refresh file store

  async writeFile(path: string, content: string): Promise<void> {
    await saveFile(path, content, this.projectId);
    // Refresh file tree in store so UI updates
    const tree = await fetchFileTree('/', this.projectId);
    useFileStore.getState().setFiles(tree);
    await this.delay();
  }

  async readFile(path: string): Promise<string> {
    return fetchFileContent(path, this.projectId);
  }

  async deleteFile(path: string): Promise<void> {
    // No dedicated delete API function in client — call directly
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/files`
      : '/api/files';
    const res = await fetch(`${base}/delete?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.message ?? body.error ?? `Delete failed: ${res.status}`);
    }
    // Refresh file tree + close editor tab if open
    const tree = await fetchFileTree('/', this.projectId);
    useFileStore.getState().setFiles(tree);
    const editorState = useEditorStore.getState();
    if (editorState.openFiles.has(path as WorkspacePath)) {
      editorState.closeFile(path as WorkspacePath);
    }
    await this.delay();
  }

  async mkdir(path: string): Promise<void> {
    await createFolder(path, this.projectId);
    const tree = await fetchFileTree('/', this.projectId);
    useFileStore.getState().setFiles(tree);
    await this.delay();
  }

  async getFileTree(path?: string): Promise<any[]> {
    return fetchFileTree(path ?? '/', this.projectId);
  }

  // ---- Build ----

  async saveBuildConfig(config: { rules: any[]; targets: any[] }): Promise<void> {
    await saveBuildConfigApi(config as any, this.projectId);
    useBuildStore.getState().setRules(config.rules);
    await this.delay();
  }

  async loadBuildConfig(): Promise<{ rules: any[]; targets: any[] }> {
    const config = await fetchBuildConfig(this.projectId);
    return { rules: config.rules ?? [], targets: (config as any).targets ?? [] };
  }

  async executeBuild(): Promise<any[]> {
    // Trigger build via workflow event (same as Build All button)
    const result = await apiRunWorkflowRule('build', this.projectId);
    await this.delay();
    return result?.results ?? [];
  }

  async getBuildResults(): Promise<any[]> {
    return Array.from(useBuildStore.getState().results.values());
  }

  async clearBuildResults(): Promise<void> {
    useBuildStore.getState().clearResults();
    await this.delay();
  }

  async clearBuildCache(targetId?: string): Promise<void> {
    // Call API directly
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/build`
      : '/api/build';
    const qs = targetId ? `?targetId=${encodeURIComponent(targetId)}` : '';
    await fetch(`${base}/cache${qs}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await this.delay();
  }

  async getStaleTargets(): Promise<string[]> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/build`
      : '/api/build';
    const res = await fetch(`${base}/changes`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await res.json();
    return body.staleTargetIds ?? [];
  }

  // ---- Deploy ----

  async saveDeployConfig(config: { modules: any[]; packaging: any[]; targets: any[] }): Promise<void> {
    await saveDeployConfigApi(config as any, this.projectId);
    await this.delay();
  }

  async loadDeployConfig(): Promise<{ modules: any[]; packaging: any[]; targets: any[] }> {
    return fetchDeployConfig(this.projectId) as any;
  }

  async executeDeploy(options?: { targetIds?: string[]; dryRun?: boolean }): Promise<any[]> {
    // Use streaming deploy API, collect results
    const results: any[] = [];
    await executeDeployStreaming(
      options?.targetIds,
      (event) => {
        if (event.type === 'deploy-complete' && event.results) {
          results.push(...event.results);
        }
      },
      this.projectId,
      options?.dryRun,
    );
    await this.delay();
    return results;
  }

  async getDeployResults(): Promise<any[]> {
    return fetchDeployResults(this.projectId);
  }

  async clearDeployResults(): Promise<void> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/deploy`
      : '/api/deploy';
    await fetch(`${base}/results`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await this.delay();
  }

  // ---- Environments ----

  async saveEnvironmentConfig(config: { pipeline: any; environments: any[]; transitions: any[] }): Promise<void> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/environments`
      : '/api/environments';
    await fetch(`${base}/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });
    await this.delay();
  }

  async loadEnvironmentConfig(): Promise<{ pipeline: any; environments: any[]; transitions: any[] }> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/environments`
      : '/api/environments';
    const res = await fetch(`${base}/config`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  }

  async createEnvironment(name: string, stageId?: string): Promise<any> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/environments`
      : '/api/environments';
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ name, stageId }),
    });
    await this.delay();
    return res.json();
  }

  async listEnvironments(): Promise<any[]> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/environments`
      : '/api/environments';
    const res = await fetch(base, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await res.json();
    return body.environments ?? [];
  }

  async getEnvironment(envId: string): Promise<any> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/environments`
      : '/api/environments';
    const res = await fetch(`${base}/${envId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  }

  async destroyEnvironment(envId: string): Promise<void> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/environments`
      : '/api/environments';
    await fetch(`${base}/${envId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await this.delay();
  }

  // ---- Agent ----

  async sendChat(message: string): Promise<{ response: string }> {
    const result = await sendChatMessage(message, this.projectId);
    await this.delay();
    return result;
  }

  async getHistory(): Promise<any[]> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/agent`
      : '/api/agent';
    const res = await fetch(`${base}/history`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await res.json();
    return body.history ?? [];
  }

  async clearHistory(): Promise<void> {
    await clearChatHistory(this.projectId);
    await this.delay();
  }

  async getCustomTools(): Promise<any[]> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/agent`
      : '/api/agent';
    const res = await fetch(`${base}/tools`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await res.json();
    return body.tools ?? [];
  }

  async saveCustomTools(tools: any[]): Promise<void> {
    const token = await this.getToken();
    const base = this.projectId
      ? `/api/projects/${this.projectId}/agent`
      : '/api/agent';
    await fetch(`${base}/tools`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ tools }),
    });
    await this.delay();
  }

  // ---- Editor (via Zustand store — same code path as UI) ----

  async openFileInEditor(path: string): Promise<void> {
    const content = await this.readFile(path);
    const language = detectLanguage(path);
    const editorStore = useEditorStore.getState();
    editorStore.openFile(path as WorkspacePath, content, language);
    // Also select in file store for tree highlight
    useFileStore.getState().selectFile(path as WorkspacePath);
    await this.delay();
  }

  async getActiveFile(): Promise<string | null> {
    return useEditorStore.getState().activeFile;
  }

  async getOpenTabs(): Promise<string[]> {
    return Array.from(useEditorStore.getState().openFiles.keys());
  }

  async closeTab(path: string): Promise<void> {
    useEditorStore.getState().closeFile(path as WorkspacePath);
    await this.delay();
  }

  async editFileContent(path: string, content: string): Promise<void> {
    useEditorStore.getState().updateFileContent(path as WorkspacePath, content);
    await this.delay();
  }

  async saveActiveFile(): Promise<void> {
    await useEditorStore.getState().saveActiveFile(this.projectId);
    await this.delay();
  }

  // ---- Git (via client API — triggers store updates through UI refresh) ----

  async getGitStatus(): Promise<GitStatusResult> {
    const status = await fetchGitStatus(this.projectId);
    // Update git store so UI reflects
    // Note: gitStore.loadStatus does the same but we already have the data
    return {
      initialized: status.initialized,
      branch: status.branch,
      staged: status.staged.map((f) => ({ path: f.path, status: f.status })),
      unstaged: status.unstaged.map((f) => ({ path: f.path, status: f.status })),
      untracked: status.untracked,
    };
  }

  async stageFiles(files: string[]): Promise<void> {
    await gitStage(files, this.projectId);
    await useGitStore.getState().loadStatus(this.projectId);
    await this.delay();
  }

  async unstageFiles(files: string[]): Promise<void> {
    await gitUnstage(files, this.projectId);
    await useGitStore.getState().loadStatus(this.projectId);
    await this.delay();
  }

  async gitCommit(message: string): Promise<void> {
    await apiGitCommit(message, this.projectId);
    await useGitStore.getState().loadStatus(this.projectId);
    await this.delay();
  }

  async gitPush(): Promise<void> {
    await apiGitPush(undefined, undefined, this.projectId);
    await this.delay();
  }

  async gitPull(): Promise<void> {
    await apiGitPull(undefined, undefined, this.projectId);
    await useGitStore.getState().loadStatus(this.projectId);
    await this.delay();
  }

  // ---- Workflow (via client API + application store) ----

  async emitWorkflowEvent(event: { type: string; [key: string]: unknown }): Promise<any> {
    const result = await apiEmitWorkflowEvent(event, this.projectId);
    await this.delay();
    return result;
  }

  async runWorkflowRule(ruleId: string): Promise<any> {
    const result = await useApplicationStore.getState().runRule(ruleId, this.projectId);
    await this.delay();
    return result;
  }

  async getWorkflowState(): Promise<unknown> {
    return useApplicationStore.getState().getWorkflowState();
  }

  async getWorkflowDeclarations(): Promise<any> {
    return useApplicationStore.getState().getDeclarations();
  }

  async getProjectErrors(): Promise<any[]> {
    return useApplicationStore.getState().getErrors();
  }

  // ---- Auth helper ----

  private async getToken(): Promise<string | null> {
    try {
      return await getAccessToken();
    } catch {
      return null;
    }
  }
}
