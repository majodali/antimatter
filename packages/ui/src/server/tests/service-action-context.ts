import { MemoryWorkspaceEnvironment } from '@antimatter/workspace';
import { WorkspaceService } from '../services/workspace-service.js';
import type { ActionContext } from './action-context.js';

/**
 * ActionContext implementation that calls WorkspaceService directly.
 * No HTTP — exercises the same code paths as the REST routes but
 * without network overhead. Used for local functional testing.
 */
export class ServiceActionContext implements ActionContext {
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
    const entries = await this.workspace.getDirectoryTree(path ?? '');
    return [...entries];
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
}
