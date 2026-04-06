/**
 * Service-level functional tests: Agent Integration
 *
 * These tests correspond to the deployed functional tests for the agent
 * system (FT: DEMO 2.1–2.7). They exercise the same logical operations
 * but call the service layer directly instead of going through REST.
 *
 * Correspondence with deployed tests:
 *   Agent chat              ↔ FT: Agent Chat
 *   Agent history           ↔ FT: Agent History
 *   Save/load custom tools  ↔ FT: Save/Load Custom Tools
 *   Clear history           ↔ FT: Clear Agent History
 *   Agent tool execution    ↔ (additional service-level coverage)
 *   Multi-turn agent flow   ↔ (additional service-level coverage)
 */
import { describe, it, beforeEach } from 'node:test';
import { expect } from '@antimatter/test-utils';
import type { FileEntry, WorkspacePath } from '@antimatter/filesystem';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';
import { setupSuccessfulBuild, setupBuildWithErrors } from '../scenario-factory.js';
import {
  createFileTools,
  createRunBuildTool,
  createRunTestsTool,
} from '@antimatter/agent-framework';
import type { AgentResponse, AgentTool } from '@antimatter/agent-framework';

describe('Functional: Agent Integration', () => {
  let harness: WorkspaceHarness;

  beforeEach(async () => {
    harness = await createWorkspaceHarness();
  });

  // ↔ FT: Agent Chat
  describe('agent chat', () => {
    it('should return a response to a message', async () => {
      const result = await harness.sendChat('Hello from functional test');
      expect(result.response.content).toBeDefined();
      expect(typeof result.response.content).toBe('string');
      expect(result.response.content.length).toBeGreaterThan(0);
    });
  });

  // ↔ FT: Agent History
  describe('agent history', () => {
    it('should track conversation history after chat', async () => {
      await harness.sendChat('Hello');
      const history = harness.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ↔ FT: Save Custom Tools
  describe('custom tools', () => {
    const testTool = {
      name: 'ft-tool',
      description: 'Functional test tool',
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
    };

    it('should save custom tools', async () => {
      await harness.saveCustomTools([testTool]);
      expect(await harness.fileExists('.antimatter/tools.json')).toBe(true);
    });

    // ↔ FT: Load Custom Tools
    it('should load saved custom tools', async () => {
      await harness.saveCustomTools([testTool]);
      const tools = await harness.getCustomTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('ft-tool');
    });

    it('should return empty array when no tools saved', async () => {
      const tools = await harness.getCustomTools();
      expect(tools).toEqual([]);
    });
  });

  // ↔ FT: Clear Agent History
  describe('clear history', () => {
    it('should clear conversation history', async () => {
      await harness.sendChat('Hello');
      expect(harness.getHistory().length).toBeGreaterThanOrEqual(1);
      harness.clearHistory();
      const after = harness.getHistory();
      // After clear, history should be empty or only contain system prompt
      expect(after.length).toBeLessThanOrEqual(1);
    });
  });

  // --- Additional service-level coverage: Agent tool execution ---

  describe('file tools', () => {
    it('should read files via readFile tool', async () => {
      const tools = createFileTools(harness.fs);
      const readTool = tools.find((t) => t.name === 'readFile')!;
      const content = await readTool.execute({ path: 'src/math.ts' });
      expect(content).toContain('export function add');
      expect(content).toContain('export function subtract');
    });

    it('should handle non-existent file gracefully', async () => {
      const tools = createFileTools(harness.fs);
      const readTool = tools.find((t) => t.name === 'readFile')!;
      const result = await readTool.execute({ path: 'src/nonexistent.ts' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });

    it('should create files via writeFile tool', async () => {
      const tools = createFileTools(harness.fs);
      const writeTool = tools.find((t) => t.name === 'writeFile')!;
      await writeTool.execute({
        path: 'src/new-module.ts',
        content: 'export const greeting = "hello";',
      });
      expect(await harness.fileExists('src/new-module.ts')).toBe(true);
      const content = await harness.readFile('src/new-module.ts');
      expect(content).toBe('export const greeting = "hello";');
    });

    it('should list directory via listFiles tool', async () => {
      const tools = createFileTools(harness.fs);
      const listTool = tools.find((t) => t.name === 'listFiles')!;
      const result = await listTool.execute({ path: 'src' });
      const entries = JSON.parse(result);
      const names = entries.map((e: { name: string }) => e.name).sort();
      expect(names).toContain('index.ts');
      expect(names).toContain('math.ts');
    });
  });

  describe('build tools', () => {
    it('should return build results as JSON via runBuild tool', async () => {
      setupSuccessfulBuild(harness.runner);
      const buildTool = createRunBuildTool({
        fs: harness.fs,
        runner: harness.runner,
        rules: [harness.fixture.rules[0]],
        workspaceRoot: '/',
      });
      const result = await buildTool.execute({});
      const parsed = JSON.parse(result);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].status).toBe('success');
    });

    it('should include diagnostics on build failure via runBuild tool', async () => {
      setupBuildWithErrors(harness.runner);
      const buildTool = createRunBuildTool({
        fs: harness.fs,
        runner: harness.runner,
        rules: [harness.fixture.rules[0]],
        workspaceRoot: '/',
      });
      const result = await buildTool.execute({});
      const parsed = JSON.parse(result);
      expect(parsed.results[0].status).toBe('failure');
      expect(parsed.results[0].diagnostics.length).toBeGreaterThan(0);
    });

    it('should run tests via runTests tool', async () => {
      harness.runner.registerMock(/vitest/, {
        stdout: 'Tests: 5 passed, 5 total',
        stderr: '',
        exitCode: 0,
      });
      const testTool = createRunTestsTool({
        runner: harness.runner,
        workspaceRoot: '/',
      });
      const result = await testTool.execute({});
      const parsed = JSON.parse(result);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toContain('5 passed');
    });
  });

  describe('agent tool-use flow', () => {
    it('should execute readFile tool via agent loop', async () => {
      const tools = createFileTools(harness.fs);
      const toolMap = new Map(tools.map((t) => [t.name, t] as const));

      const toolCallResponse: AgentResponse = {
        content: 'Let me read that file.',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          { id: 'call-1', name: 'readFile', parameters: { path: 'src/math.ts' } },
        ],
      };
      const finalResponse: AgentResponse = {
        content: 'The file contains arithmetic functions.',
        role: 'assistant',
        finishReason: 'stop',
      };

      harness.provider.registerResponse('read src/math.ts', toolCallResponse);
      harness.provider.setDefaultResponse(finalResponse);

      const result = await harness.agent.chat({
        message: 'read src/math.ts',
        tools: toolMap,
      });

      expect(result.response.content).toBe('The file contains arithmetic functions.');
      expect(result.toolResults).toBeDefined();
      expect(result.toolResults!.length).toBeGreaterThan(0);
      expect(result.toolResults![0].isError).toBe(false);
      expect(result.toolResults![0].content).toContain('export function add');
    });

    it('should execute runBuild tool via agent loop', async () => {
      setupSuccessfulBuild(harness.runner);
      const buildTool = createRunBuildTool({
        fs: harness.fs,
        runner: harness.runner,
        rules: [harness.fixture.rules[0]],
        workspaceRoot: '/',
      });
      const toolMap = new Map([['runBuild', buildTool]]);

      const toolCallResponse: AgentResponse = {
        content: 'I will build the project.',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [{ id: 'call-build', name: 'runBuild', parameters: {} }],
      };
      const finalResponse: AgentResponse = {
        content: 'Build completed successfully.',
        role: 'assistant',
        finishReason: 'stop',
      };

      harness.provider.registerResponse('build the project', toolCallResponse);
      harness.provider.setDefaultResponse(finalResponse);

      const result = await harness.agent.chat({
        message: 'build the project',
        tools: toolMap,
      });

      expect(result.response.content).toBe('Build completed successfully.');
      expect(result.toolResults).toBeDefined();
      const toolResult = result.toolResults![0];
      expect(toolResult.isError).toBe(false);
      const parsed = JSON.parse(toolResult.content);
      expect(parsed.results[0].status).toBe('success');
    });

    it('should handle multi-turn create-files-then-test flow', async () => {
      const fileTools = createFileTools(harness.fs);
      const testTool = createRunTestsTool({
        runner: harness.runner,
        workspaceRoot: '/',
      });
      const tools = new Map<string, AgentTool>([
        ...fileTools.map((t) => [t.name, t] as const),
        [testTool.name, testTool],
      ]);

      // Sequence: create file → create test → run tests
      const responses: AgentResponse[] = [
        {
          content: 'Creating the new module.',
          role: 'assistant',
          finishReason: 'tool_use',
          toolCalls: [{
            id: 'call-write-1',
            name: 'writeFile',
            parameters: {
              path: 'src/greeter.ts',
              content: 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n',
            },
          }],
        },
        {
          content: 'Creating the test file.',
          role: 'assistant',
          finishReason: 'tool_use',
          toolCalls: [{
            id: 'call-write-2',
            name: 'writeFile',
            parameters: {
              path: 'tests/greeter.spec.ts',
              content: "import { greet } from '../src/greeter.js';\ndescribe('greet', () => {\n  it('should greet', () => { expect(greet('World')).toBe('Hello, World!'); });\n});\n",
            },
          }],
        },
        {
          content: 'Running the tests.',
          role: 'assistant',
          finishReason: 'tool_use',
          toolCalls: [{ id: 'call-test', name: 'runTests', parameters: {} }],
        },
        {
          content: 'All done! The greeter module and its tests are ready.',
          role: 'assistant',
          finishReason: 'stop',
        },
      ];

      let callCount = 0;
      harness.provider.chat = async () => {
        const response = responses[callCount] ?? responses[responses.length - 1];
        callCount++;
        return response;
      };

      harness.runner.registerMock(/vitest/, {
        stdout: 'Tests: 1 passed, 1 total',
        stderr: '',
        exitCode: 0,
      });

      const result = await harness.agent.chat({
        message: 'Create a greeter module with tests and run them',
        tools,
        maxIterations: 5,
      });

      // Verify files were created
      expect(await harness.fileExists('src/greeter.ts')).toBe(true);
      expect(await harness.fileExists('tests/greeter.spec.ts')).toBe(true);

      const greeterContent = await harness.readFile('src/greeter.ts');
      expect(greeterContent).toContain('export function greet');

      // Verify final response
      expect(result.response.finishReason).toBe('stop');
      expect(result.toolResults).toBeDefined();
      expect(result.toolResults!.length).toBe(3);
    });
  });
});
