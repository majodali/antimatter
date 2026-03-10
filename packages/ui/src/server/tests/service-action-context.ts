import { MemoryWorkspaceEnvironment } from '@antimatter/workspace';
import { WorkspaceService } from '../services/workspace-service.js';
import type { ActionContext as ExpandedActionContext, GitStatusResult } from '../../shared/action-context.js';

/**
 * ActionContext implementation that calls WorkspaceService directly.
 * No HTTP — exercises the same code paths as the REST routes but
 * without network overhead. Used for local functional testing (Vitest).
 *
 * Editor methods use in-memory tracking (no real UI).
 * Git/workflow methods return sensible defaults (MemoryFileSystem has no git).
 */
export class ServiceActionContext implements ExpandedActionContext {
  private readonly workspace: WorkspaceService;
  readonly env: MemoryWorkspaceEnvironment;

  constructor() {
    this.env = new MemoryWorkspaceEnvironment();
    this.workspace = new WorkspaceService({ env: this.env });
  }

  // ---- Files ----

  async writeFile(path: string, content: string): Promise<void> {
    await this.workspace.writeFile(path, content);
  }

  async readFile(path: string): Promise<string> {
    return this.workspace.readFile(path);
  }

  async deleteFile(path: string): Promise<void> {
    await this.workspace.deleteFile(path);
  }

  async mkdir(path: string): Promise<void> {
    await this.workspace.mkdir(path);
  }

  async getFileTree(path?: string): Promise<any[]> {
    return this.workspace.getDirectoryTreeRecursive(path ?? '');
  }

  // ---- Build ----

  async saveBuildConfig(config: { rules: any[]; targets: any[] }): Promise<void> {
    await this.workspace.saveBuildConfig(config);
  }

  async loadBuildConfig(): Promise<{ rules: any[]; targets: any[] }> {
    return this.workspace.loadBuildConfig();
  }

  async executeBuild(): Promise<any[]> {
    const config = await this.workspace.loadBuildConfig();
    if (config.targets.length === 0) return [];
    const rulesMap = new Map<string, any>();
    for (const rule of config.rules) {
      rulesMap.set(rule.id, rule);
    }
    const results = await this.workspace.executeBuild(config.targets, rulesMap);
    return Array.from(results.entries()).map(([id, result]) => ({
      targetId: id,
      status: result.status,
      durationMs: result.durationMs,
      diagnostics: result.diagnostics ?? [],
    }));
  }

  async getBuildResults(): Promise<any[]> {
    return this.workspace.getAllBuildResults();
  }

  async clearBuildResults(): Promise<void> {
    this.workspace.clearBuildResults();
  }

  async clearBuildCache(targetId?: string): Promise<void> {
    await this.workspace.clearBuildCache(targetId);
  }

  async getStaleTargets(): Promise<string[]> {
    const config = await this.workspace.loadBuildConfig();
    const rulesMap = new Map<string, any>();
    for (const rule of config.rules) {
      rulesMap.set(rule.id, rule);
    }
    return this.workspace.getStaleTargets(config.targets, rulesMap);
  }

  // ---- Deploy ----

  private _deployResults: any[] = [];

  async saveDeployConfig(config: { modules: any[]; packaging: any[]; targets: any[] }): Promise<void> {
    await this.workspace.saveDeployConfig(config);
  }

  async loadDeployConfig(): Promise<{ modules: any[]; packaging: any[]; targets: any[] }> {
    return this.workspace.loadDeployConfig();
  }

  async executeDeploy(options?: { targetIds?: string[]; dryRun?: boolean }): Promise<any[]> {
    // In service context with MemoryFileSystem, deploy execution is simulated.
    // Config is stored; execution returns mock results based on configured targets.
    const config = await this.workspace.loadDeployConfig();
    const targets = options?.targetIds
      ? config.targets.filter((t: any) => options.targetIds!.includes(t.id))
      : config.targets;
    const results = targets.map((t: any) => ({
      targetId: t.id,
      status: options?.dryRun ? 'dry-run' : 'success',
      durationMs: 0,
    }));
    this._deployResults = results;
    return results;
  }

  async getDeployResults(): Promise<any[]> {
    return this._deployResults;
  }

  async clearDeployResults(): Promise<void> {
    this._deployResults = [];
  }

  // ---- Environments ----

  private _environments: any[] = [];
  private _nextEnvId = 1;

  async saveEnvironmentConfig(config: { pipeline: any; environments: any[]; transitions: any[] }): Promise<void> {
    await this.workspace.saveEnvironmentConfig(config);
  }

  async loadEnvironmentConfig(): Promise<{ pipeline: any; environments: any[]; transitions: any[] }> {
    return this.workspace.loadEnvironmentConfig();
  }

  async createEnvironment(name: string, stageId?: string): Promise<any> {
    const env = {
      id: `env-${this._nextEnvId++}`,
      name,
      stageId: stageId ?? null,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this._environments.push(env);
    return env;
  }

  async listEnvironments(): Promise<any[]> {
    return [...this._environments];
  }

  async getEnvironment(envId: string): Promise<any> {
    const env = this._environments.find(e => e.id === envId);
    if (!env) throw new Error(`Environment not found: ${envId}`);
    return env;
  }

  async destroyEnvironment(envId: string): Promise<void> {
    const idx = this._environments.findIndex(e => e.id === envId);
    if (idx === -1) throw new Error(`Environment not found: ${envId}`);
    this._environments.splice(idx, 1);
  }

  // ---- Agent ----

  async sendChat(message: string): Promise<{ response: string }> {
    const result = await this.workspace.chat(message);
    return { response: result.response.content };
  }

  async getHistory(): Promise<any[]> {
    return this.workspace.getConversationHistory();
  }

  async clearHistory(): Promise<void> {
    this.workspace.clearConversationHistory();
  }

  async getCustomTools(): Promise<any[]> {
    return this.workspace.getCustomToolDefinitions();
  }

  async saveCustomTools(tools: any[]): Promise<void> {
    await this.workspace.saveCustomToolDefinitions(tools);
  }

  // ---- Editor (in-memory tracking — no real UI present) ----

  private _openTabs: string[] = [];
  private _activeFile: string | null = null;

  async openFileInEditor(path: string): Promise<void> {
    // Verify file exists by reading it, then track as open
    await this.readFile(path);
    if (!this._openTabs.includes(path)) this._openTabs.push(path);
    this._activeFile = path;
  }

  async getActiveFile(): Promise<string | null> {
    return this._activeFile;
  }

  async getOpenTabs(): Promise<string[]> {
    return [...this._openTabs];
  }

  async closeTab(path: string): Promise<void> {
    this._openTabs = this._openTabs.filter(p => p !== path);
    if (this._activeFile === path) {
      this._activeFile = this._openTabs.length > 0 ? this._openTabs[this._openTabs.length - 1] : null;
    }
  }

  async editFileContent(path: string, content: string): Promise<void> {
    // In service context, editing = writing the file
    await this.writeFile(path, content);
  }

  async saveActiveFile(): Promise<void> {
    // In service context, files are saved immediately on write — no-op
  }

  // ---- Git (not available with MemoryFileSystem) ----

  async getGitStatus(): Promise<GitStatusResult> {
    return { initialized: false, staged: [], unstaged: [], untracked: [] };
  }

  async stageFiles(_files: string[]): Promise<void> {
    // No-op in service context (no git)
  }

  async unstageFiles(_files: string[]): Promise<void> {
    // No-op in service context (no git)
  }

  async gitCommit(_message: string): Promise<void> {
    // No-op in service context (no git)
  }

  async gitPush(): Promise<void> {
    // No-op in service context (no git)
  }

  async gitPull(): Promise<void> {
    // No-op in service context (no git)
  }

  // ---- Workflow (not available in service context) ----

  async emitWorkflowEvent(_event: { type: string; [key: string]: unknown }): Promise<any> {
    return { handled: false };
  }

  async runWorkflowRule(_ruleId: string): Promise<any> {
    return { handled: false };
  }

  async getWorkflowState(): Promise<unknown> {
    return {};
  }

  async getWorkflowDeclarations(): Promise<any> {
    return { rules: [], widgets: [], eventTypes: [] };
  }

  async getProjectErrors(): Promise<any[]> {
    return [];
  }
}
