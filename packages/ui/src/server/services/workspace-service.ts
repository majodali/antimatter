import { LocalFileSystem } from '@antimatter/filesystem';
import type { FileSystem, WorkspacePath, FileEntry } from '@antimatter/filesystem';
import { SubprocessRunner } from '@antimatter/tool-integration';
import type { ToolRunner } from '@antimatter/tool-integration';
import { BuildExecutor } from '@antimatter/build-system';
import type { BuildContext } from '@antimatter/build-system';
import {
  Agent,
  AgentConfigBuilder,
  MockProvider,
  createFileTools,
  createRunBuildTool,
  createRunTestsTool,
  createRunLintTool,
} from '@antimatter/agent-framework';
import type { AgentResult, AgentTool } from '@antimatter/agent-framework';
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
  private readonly workspaceRoot: string;
  private readonly buildResults = new Map<string, BuildResult>();

  constructor(options: WorkspaceServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.fs = options.fs ?? new LocalFileSystem();
    this.runner = options.runner ?? new SubprocessRunner();

    // Build agent tools
    const tools: AgentTool[] = [
      ...createFileTools(this.fs),
      createRunTestsTool({ runner: this.runner, workspaceRoot: this.workspaceRoot }),
      createRunLintTool({ runner: this.runner, workspaceRoot: this.workspaceRoot }),
    ];

    // Create agent
    const builder = AgentConfigBuilder.create('workspace-agent', 'Workspace Agent')
      .withRole('implementer')
      .withSystemPrompt(
        'You are an AI assistant for a development workspace. You can read and write files, run builds, tests, and lint.',
      )
      .withTools(tools);

    if (options.anthropicApiKey) {
      builder.withClaudeProvider({ apiKey: options.anthropicApiKey });
    } else {
      builder.withMockProvider();
    }

    this.agent = builder.build();

    // Set up mock responses if no API key
    if (!options.anthropicApiKey) {
      this.setupMockResponses();
    }
  }

  // --- File operations ---

  async getDirectoryTree(path: string): Promise<readonly FileEntry[]> {
    return this.fs.readDirectory(path as WorkspacePath);
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

  // --- Build operations ---

  async executeBuild(
    targets: readonly BuildTarget[],
    rules: ReadonlyMap<Identifier, BuildRule>,
  ): Promise<ReadonlyMap<Identifier, BuildResult>> {
    const context: BuildContext = {
      workspaceRoot: this.workspaceRoot,
      fs: this.fs,
      runner: this.runner,
      rules,
    };

    const executor = new BuildExecutor(context);
    const results = await executor.executeBatch(targets);

    // Store results
    for (const [id, result] of results) {
      this.buildResults.set(id, result);
    }

    return results;
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

  async chat(message: string): Promise<AgentResult> {
    return this.agent.chat(message);
  }

  getConversationHistory() {
    return this.agent.getContext().conversationHistory;
  }

  clearConversationHistory(): void {
    this.agent.clearHistory();
  }

  // --- Private ---

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
