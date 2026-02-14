import { MemoryFileSystem } from '@antimatter/filesystem';
import type { FileSystem, WorkspacePath } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';
import { BuildExecutor } from '@antimatter/build-system';
import type { BuildContext } from '@antimatter/build-system';
import {
  Agent,
  AgentConfigBuilder,
  MockProvider,
} from '@antimatter/agent-framework';
import type { AgentTool, AgentResult } from '@antimatter/agent-framework';
import type { BuildRule, BuildTarget, BuildResult, Identifier } from '@antimatter/project-model';
import { createTypeScriptProjectFixture, type ProjectFixture } from './fixtures.js';

export interface WorkspaceHarness {
  readonly fs: MemoryFileSystem;
  readonly runner: MockRunner;
  readonly provider: MockProvider;
  readonly agent: Agent;
  readonly fixture: ProjectFixture;

  /** Run the build using BuildExecutor with fixture targets. */
  executeBuild(targets?: readonly BuildTarget[]): Promise<ReadonlyMap<Identifier, BuildResult>>;

  /** Send a chat message to the agent. */
  chat(message: string): Promise<AgentResult>;

  /** Read a text file from the in-memory FS. */
  readFile(path: string): Promise<string>;

  /** Write a text file to the in-memory FS. */
  writeFile(path: string, content: string): Promise<void>;

  /** Check if a file exists. */
  fileExists(path: string): Promise<boolean>;
}

/**
 * Create a fully-wired workspace harness.
 *
 * Combines MemoryFileSystem + MockRunner + MockProvider + BuildExecutor
 * + Agent with registered tools into a single object with convenience methods.
 *
 * @param tools - Optional extra agent tools to register
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

  // Build agent from config + inject our provider so we can control responses
  const config = builder.buildConfig();
  const agent = new Agent(config, provider);

  const executeBuild = async (
    targets?: readonly BuildTarget[],
  ): Promise<ReadonlyMap<Identifier, BuildResult>> => {
    const ctx: BuildContext = {
      workspaceRoot: '/',
      fs,
      runner,
      rules: fixture.rules,
    };
    const executor = new BuildExecutor(ctx);
    return executor.executeBatch(targets ?? fixture.targets);
  };

  return {
    fs,
    runner,
    provider,
    agent,
    fixture,
    executeBuild,
    chat: (message: string) => agent.chat(message),
    readFile: (path: string) => fs.readTextFile(path as WorkspacePath),
    writeFile: (path: string, content: string) =>
      fs.writeFile(path as WorkspacePath, content),
    fileExists: (path: string) => fs.exists(path as WorkspacePath),
  };
}
