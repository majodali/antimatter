import { LocalFileSystem } from '@antimatter/filesystem';
import type { FileSystem, WorkspacePath, FileEntry } from '@antimatter/filesystem';
import { SubprocessRunner } from '@antimatter/tool-integration';
import type { ToolRunner } from '@antimatter/tool-integration';
import { BuildExecutor, CacheManager } from '@antimatter/build-system';
import type { BuildContext, BuildProgressEvent } from '@antimatter/build-system';
import {
  Agent,
  AgentConfigBuilder,
  MockProvider,
  MemoryStore,
  Orchestrator,
  createFileTools,
  createRunBuildTool,
  createRunTestsTool,
  createRunLintTool,
  createCustomTool,
} from '@antimatter/agent-framework';
import type { AgentResult, AgentTool, StreamCallbacks, CustomToolDefinition } from '@antimatter/agent-framework';
import type { BuildRule, BuildTarget, BuildResult, Identifier } from '@antimatter/project-model';

export interface WorkspaceServiceOptions {
  readonly workspaceRoot?: string;
  readonly anthropicApiKey?: string;
  readonly fs?: FileSystem;
  readonly runner?: ToolRunner;
}

export class WorkspaceService {
  readonly fs: FileSystem;
  readonly runner: ToolRunner;
  readonly agent: Agent;
  private readonly orchestrator: Orchestrator | null = null;
  private readonly workspaceRoot: string;
  private readonly buildResults = new Map<string, BuildResult>();
  private readonly memoryStore: MemoryStore;
  private customToolsLoaded = false;

  constructor(options: WorkspaceServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.fs = options.fs ?? new LocalFileSystem(this.workspaceRoot);
    this.runner = options.runner ?? new SubprocessRunner();

    // Build agent tools
    const tools: AgentTool[] = [
      ...createFileTools(this.fs),
      createRunTestsTool({ runner: this.runner, workspaceRoot: this.workspaceRoot }),
      createRunLintTool({ runner: this.runner, workspaceRoot: this.workspaceRoot }),
      this.createAgentRunBuildTool(),
      this.createAgentGetDiagnosticsTool(),
      this.createRememberTool(),
    ];

    const systemPrompt = `You are an AI assistant for a development workspace. You can read and write files, run builds, tests, and lint.

When asked to fix build errors:
1. Run the build (runBuild) to get diagnostics
2. Read files with errors (readFile)
3. Fix the issues (writeFile)
4. Run the build again to verify

When asked to fix code, explain code, or refactor code, read the relevant files first.`;

    // Create agent
    const builder = AgentConfigBuilder.create('workspace-agent', 'Workspace Agent')
      .withRole('implementer')
      .withSystemPrompt(systemPrompt)
      .withTools(tools);

    if (options.anthropicApiKey) {
      builder.withClaudeProvider({ apiKey: options.anthropicApiKey });
    } else {
      builder.withMockProvider();
    }

    this.agent = builder.build();
    this.memoryStore = new MemoryStore(this.fs);

    // Create multi-agent orchestrator when API key is available
    if (options.anthropicApiKey) {
      this.orchestrator = this.createOrchestrator(options.anthropicApiKey, tools);
    } else {
      this.setupMockResponses();
    }
  }

  // --- File operations ---

  async getDirectoryTree(path: string): Promise<readonly FileEntry[]> {
    return this.fs.readDirectory(path as WorkspacePath);
  }

  async getDirectoryTreeRecursive(dirPath: string): Promise<{ name: string; path: string; isDirectory: boolean; children?: any[] }[]> {
    const entries = await this.fs.readDirectory(dirPath as WorkspacePath);
    const nodes = [];
    for (const entry of entries) {
      const fullPath = dirPath === '/' || dirPath === '' ? entry.name : `${dirPath}/${entry.name}`;
      const node: { name: string; path: string; isDirectory: boolean; children?: any[] } = {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory,
      };
      if (entry.isDirectory) {
        node.children = await this.getDirectoryTreeRecursive(fullPath);
      }
      nodes.push(node);
    }
    return nodes;
  }

  async readFile(path: string): Promise<string> {
    return this.fs.readTextFile(path as WorkspacePath);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.fs.writeFile(path as WorkspacePath, content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.fs.deleteFile(path as WorkspacePath);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.fs.exists(path as WorkspacePath);
  }

  async mkdir(path: string): Promise<void> {
    await this.fs.mkdir(path as WorkspacePath);
  }

  // --- Build operations ---

  async executeBuild(
    targets: readonly BuildTarget[],
    rules: ReadonlyMap<Identifier, BuildRule>,
    onProgress?: (event: BuildProgressEvent) => void,
  ): Promise<ReadonlyMap<Identifier, BuildResult>> {
    const context: BuildContext = {
      workspaceRoot: this.workspaceRoot,
      fs: this.fs,
      runner: this.runner,
      rules,
      onProgress,
    };

    const executor = new BuildExecutor(context);
    const results = await executor.executeBatch(targets);

    // Store results
    for (const [id, result] of results) {
      this.buildResults.set(id, result);
    }

    return results;
  }

  async clearBuildCache(targetId?: string): Promise<void> {
    const cacheManager = new CacheManager(this.fs);
    if (targetId) {
      await cacheManager.clearCache(targetId);
    } else {
      // Clear cache for all known targets
      for (const id of this.buildResults.keys()) {
        await cacheManager.clearCache(id);
      }
    }
  }

  async getStaleTargets(
    targets: readonly BuildTarget[],
    rules: ReadonlyMap<Identifier, BuildRule>,
  ): Promise<Identifier[]> {
    const cacheManager = new CacheManager(this.fs);
    return cacheManager.getStaleTargets(targets, rules, this.workspaceRoot);
  }

  async loadBuildConfig(): Promise<{ rules: BuildRule[]; targets: BuildTarget[] }> {
    const configPath = '.antimatter/build.json';
    try {
      const content = await this.fs.readTextFile(configPath as any);
      return JSON.parse(content);
    } catch {
      return { rules: [], targets: [] };
    }
  }

  async saveBuildConfig(config: { rules: BuildRule[]; targets: BuildTarget[] }): Promise<void> {
    const configPath = '.antimatter/build.json';
    try {
      await this.fs.mkdir('.antimatter' as any);
    } catch { /* already exists */ }
    await this.fs.writeFile(configPath as any, JSON.stringify(config, null, 2));
  }

  getBuildResult(targetId: string): BuildResult | undefined {
    return this.buildResults.get(targetId);
  }

  getAllBuildResults(): BuildResult[] {
    return Array.from(this.buildResults.values());
  }

  clearBuildResults(): void {
    this.buildResults.clear();
  }

  // --- Agent operations ---

  private async prepareAgent(): Promise<void> {
    // Load persistent memory on first call
    const memory = await this.memoryStore.load();
    if (memory) {
      for (const [key, value] of Object.entries(memory.workingMemory)) {
        this.agent.setMemory(key, value);
      }
    }

    // Load custom tools on first call
    if (!this.customToolsLoaded) {
      this.customToolsLoaded = true;
      await this.loadCustomTools();
    }
  }

  private async saveMemory(): Promise<void> {
    const context = this.agent.getContext();
    await this.memoryStore.save({
      workingMemory: context.workingMemory as Record<string, unknown>,
      lastUpdated: new Date().toISOString(),
    });
  }

  async chat(message: string): Promise<AgentResult> {
    await this.prepareAgent();
    const result = await this.agent.chat(message);
    await this.saveMemory();
    return result;
  }

  async chatStream(
    message: string,
    callbacks: StreamCallbacks & { onHandoff?: (fromRole: string, toRole: string) => void },
    abortSignal?: AbortSignal,
  ): Promise<AgentResult & { agentRole?: string }> {
    await this.prepareAgent();
    let result: AgentResult & { agentRole?: string };
    if (this.orchestrator) {
      result = await this.orchestrator.chatStream(message, callbacks, abortSignal);
    } else {
      result = await this.agent.chat({
        message,
        stream: callbacks,
        abortSignal,
      });
    }
    await this.saveMemory();
    return result;
  }

  getConversationHistory() {
    return this.agent.getContext().conversationHistory;
  }

  clearConversationHistory(): void {
    this.agent.clearHistory();
  }

  // --- Private ---

  private createAgentRunBuildTool(): AgentTool {
    return {
      name: 'runBuild',
      description: 'Run the project build and return results with diagnostics',
      parameters: [],
      execute: async () => {
        const config = await this.loadBuildConfig();
        if (config.targets.length === 0) {
          return JSON.stringify({ error: 'No build targets configured' });
        }
        const rulesMap = new Map<Identifier, BuildRule>();
        for (const rule of config.rules) {
          rulesMap.set(rule.id, rule);
        }
        const results = await this.executeBuild(config.targets, rulesMap);
        const summary = Array.from(results.entries()).map(([id, result]) => ({
          targetId: id,
          status: result.status,
          durationMs: result.durationMs,
          diagnostics: result.diagnostics ?? [],
        }));
        return JSON.stringify({ results: summary });
      },
    };
  }

  private createAgentGetDiagnosticsTool(): AgentTool {
    return {
      name: 'getBuildDiagnostics',
      description: 'Get diagnostics from the last build. Optionally filter by target ID.',
      parameters: [
        { name: 'targetId', type: 'string' as const, description: 'Target ID to filter diagnostics', required: false },
      ],
      execute: async (params) => {
        const targetId = params.targetId as string | undefined;
        if (targetId) {
          const result = this.getBuildResult(targetId);
          return JSON.stringify({ diagnostics: result?.diagnostics ?? [] });
        }
        const allDiags = this.getAllBuildResults().flatMap((r) => r.diagnostics ?? []);
        return JSON.stringify({ diagnostics: allDiags });
      },
    };
  }

  private createRememberTool(): AgentTool {
    return {
      name: 'remember',
      description: 'Persist a fact in working memory so it survives across sessions',
      parameters: [
        { name: 'key', type: 'string' as const, description: 'Memory key', required: true },
        { name: 'value', type: 'string' as const, description: 'Value to remember', required: true },
      ],
      execute: async (params) => {
        const key = params.key as string;
        const value = params.value as string;
        this.agent.setMemory(key, value);
        return JSON.stringify({ success: true, key, value });
      },
    };
  }

  private async loadCustomTools(): Promise<void> {
    try {
      const content = await this.fs.readTextFile('.antimatter/tools.json' as WorkspacePath);
      const config = JSON.parse(content) as { tools: CustomToolDefinition[] };
      if (!config.tools?.length) return;

      // We can't add tools to an already-built agent's tool map directly,
      // but we can store them in working memory for the agent to reference.
      // Instead, we register them via setMemory so the system knows about them.
      for (const def of config.tools) {
        const tool = createCustomTool(def, this.runner, this.workspaceRoot);
        // Store the tool reference — the agent framework doesn't support
        // adding tools post-construction, so we note them in memory.
        this.agent.setMemory(`customTool:${def.name}`, def.description);
      }
    } catch {
      // No custom tools file — that's fine
    }
  }

  async getCustomToolDefinitions(): Promise<CustomToolDefinition[]> {
    try {
      const content = await this.fs.readTextFile('.antimatter/tools.json' as WorkspacePath);
      const config = JSON.parse(content) as { tools: CustomToolDefinition[] };
      return config.tools ?? [];
    } catch {
      return [];
    }
  }

  async saveCustomToolDefinitions(tools: CustomToolDefinition[]): Promise<void> {
    try {
      await this.fs.mkdir('.antimatter' as WorkspacePath);
    } catch { /* already exists */ }
    await this.fs.writeFile(
      '.antimatter/tools.json' as WorkspacePath,
      JSON.stringify({ tools }, null, 2),
    );
    this.customToolsLoaded = false; // Reload on next chat
  }

  private createOrchestrator(apiKey: string, implementerTools: AgentTool[]): Orchestrator {
    // Reviewer agent — read-only tools
    const reviewerTools = implementerTools.filter((t) =>
      ['readFile', 'listFiles', 'getBuildDiagnostics'].includes(t.name),
    );
    const reviewer = AgentConfigBuilder.create('reviewer-agent', 'Code Reviewer')
      .withRole('reviewer')
      .withSystemPrompt(
        `You are a code reviewer. Analyze code for bugs, style issues, and improvements.
If the code needs implementation changes, respond with [HANDOFF:implementer] at the end.
If the code needs testing, respond with [HANDOFF:tester] at the end.`,
      )
      .withClaudeProvider({ apiKey })
      .withTools(reviewerTools)
      .build();

    // Tester agent — read + test/lint tools
    const testerTools = implementerTools.filter((t) =>
      ['readFile', 'listFiles', 'runTests', 'runLint'].includes(t.name),
    );
    const tester = AgentConfigBuilder.create('tester-agent', 'Test Runner')
      .withRole('tester')
      .withSystemPrompt(
        `You are a testing specialist. Run tests, analyze results, and suggest fixes.
If tests fail and code changes are needed, respond with [HANDOFF:implementer] at the end.`,
      )
      .withClaudeProvider({ apiKey })
      .withTools(testerTools)
      .build();

    return new Orchestrator(
      [
        { role: 'implementer', agent: this.agent },
        { role: 'reviewer', agent: reviewer },
        { role: 'tester', agent: tester },
      ],
      'implementer',
    );
  }

  private setupMockResponses(): void {
    // Access the provider for mock setup
    // The agent was built with MockProvider, access it through config
    const config = this.agent.getConfig();
    if (config.provider.type !== 'mock') return;

    // We can't directly access the provider on the built agent,
    // so we set up via the builder pattern. The mock provider
    // already returns default responses.
  }
}
