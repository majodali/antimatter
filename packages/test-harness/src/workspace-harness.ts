import { MemoryFileSystem } from '@antimatter/filesystem';
import type { WorkspacePath, FileEntry } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';
import { BuildExecutor, CacheManager } from '@antimatter/build-system';
import type { BuildContext } from '@antimatter/build-system';
import {
  Agent,
  AgentConfigBuilder,
  MockProvider,
} from '@antimatter/agent-framework';
import type { AgentTool, AgentResult } from '@antimatter/agent-framework';
import type { BuildRule, BuildResult, Identifier } from '@antimatter/project-model';
import { createTypeScriptProjectFixture, type ProjectFixture } from './fixtures.js';

const BUILD_CONFIG_PATH = '.antimatter/build.json' as WorkspacePath;
const CUSTOM_TOOLS_PATH = '.antimatter/tools.json' as WorkspacePath;

/**
 * Test harness that provides service-level access to workspace operations.
 *
 * This interface mirrors the operations available via the REST API (ActionContext)
 * but calls the underlying packages directly. In Step 1 of the EFS migration,
 * this will be replaced by ServiceActionContext wrapping WorkspaceService.
 */
export interface WorkspaceHarness {
  // Core components — exposed for test setup (mock configuration, assertions)
  readonly fs: MemoryFileSystem;
  readonly runner: MockRunner;
  readonly provider: MockProvider;
  readonly agent: Agent;
  readonly fixture: ProjectFixture;

  // --- File operations (↔ ActionContext file methods) ---
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  getFileTree(path?: string): Promise<FileEntry[]>;

  // --- Build operations (↔ ActionContext build methods) ---
  saveBuildConfig(config: { rules: any[] }): Promise<void>;
  loadBuildConfig(): Promise<{ rules: any[] }>;
  executeBuild(rules?: readonly BuildRule[]): Promise<ReadonlyMap<Identifier, BuildResult>>;
  getBuildResults(): any[];
  clearBuildResults(): void;
  clearBuildCache(ruleId?: string): Promise<void>;
  getStaleRules(): Promise<string[]>;

  // --- Agent operations (↔ ActionContext agent methods) ---
  sendChat(message: string): Promise<AgentResult>;
  getHistory(): any[];
  clearHistory(): void;
  getCustomTools(): Promise<any[]>;
  saveCustomTools(tools: any[]): Promise<void>;
}

/**
 * Create a fully-wired workspace harness for service-level functional testing.
 *
 * Combines MemoryFileSystem + MockRunner + MockProvider + BuildExecutor
 * + Agent with registered tools into a single object that mirrors the
 * operations available through the REST API.
 */
export async function createWorkspaceHarness(
  tools: readonly AgentTool[] = [],
): Promise<WorkspaceHarness> {
  const fs = new MemoryFileSystem();
  const runner = new MockRunner();
  const fixture = await createTypeScriptProjectFixture(fs);

  // Create the agent with a MockProvider
  const provider = new MockProvider();
  provider.setDefaultResponse({
    content: 'Understood.',
    role: 'assistant',
    finishReason: 'stop',
  });

  const builder = AgentConfigBuilder.create('test-agent', 'Test Agent')
    .withRole('implementer')
    .withMockProvider()
    .withSystemPrompt('You are a test agent with access to file and build tools.');

  for (const tool of tools) {
    builder.withTool(tool);
  }

  const config = builder.buildConfig();
  const agent = new Agent(config, provider);

  // Internal state for tracking build results across calls
  let buildResults: any[] = [];

  // --- Build helpers ---

  const buildContext = (): BuildContext => ({
    workspaceRoot: '/',
    fs,
    runner,
  });

  const executeBuild = async (
    rules?: readonly BuildRule[],
  ): Promise<ReadonlyMap<Identifier, BuildResult>> => {
    const executor = new BuildExecutor(buildContext());
    const results = await executor.executeBatch(rules ?? fixture.rules);
    // Store results as array for getBuildResults()
    const newResults = Array.from(results.values());
    buildResults = [...buildResults, ...newResults];
    return results;
  };

  return {
    fs,
    runner,
    provider,
    agent,
    fixture,

    // --- File operations ---
    readFile: (path: string) => fs.readTextFile(path as WorkspacePath),
    writeFile: (path: string, content: string) =>
      fs.writeFile(path as WorkspacePath, content),
    deleteFile: (path: string) => fs.deleteFile(path as WorkspacePath),
    fileExists: (path: string) => fs.exists(path as WorkspacePath),
    mkdir: (path: string) => fs.mkdir(path as WorkspacePath),
    getFileTree: async (path?: string) => [...await fs.readDirectory((path ?? '') as WorkspacePath)],

    // --- Build operations ---
    saveBuildConfig: async (config: { rules: any[] }) => {
      await fs.writeFile(BUILD_CONFIG_PATH, JSON.stringify(config, null, 2));
    },
    loadBuildConfig: async () => {
      const content = await fs.readTextFile(BUILD_CONFIG_PATH);
      return JSON.parse(content);
    },
    executeBuild,
    getBuildResults: () => buildResults,
    clearBuildResults: () => { buildResults = []; },
    clearBuildCache: async (ruleId?: string) => {
      const cache = new CacheManager(fs, '/');
      if (ruleId) {
        cache.clearCache(ruleId);
      } else {
        // Clear cache for all known rules
        for (const rule of fixture.rules) {
          cache.clearCache(rule.id);
        }
      }
    },
    getStaleRules: async () => {
      const cache = new CacheManager(fs, '/');
      return cache.getStaleRules(fixture.rules, '/');
    },

    // --- Agent operations ---
    sendChat: (message: string) => agent.chat(message),
    getHistory: () => {
      const ctx = agent.getContext();
      return ctx.conversationHistory;
    },
    clearHistory: () => { agent.clearHistory(); },
    getCustomTools: async () => {
      try {
        const content = await fs.readTextFile(CUSTOM_TOOLS_PATH);
        return JSON.parse(content).tools ?? [];
      } catch {
        return [];
      }
    },
    saveCustomTools: async (toolDefs: any[]) => {
      await fs.writeFile(CUSTOM_TOOLS_PATH, JSON.stringify({ tools: toolDefs }));
    },
  };
}
