import { describe, it, expect, beforeEach } from 'vitest';
import type { FileEntry, WorkspacePath } from '@antimatter/filesystem';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';
import { createFileTools, createRunTestsTool } from '@antimatter/agent-framework';
import type { AgentResponse, AgentTool } from '@antimatter/agent-framework';

describe('E2E: Agent Creates Files & Runs Tests', () => {
  let harness: WorkspaceHarness;
  let tools: Map<string, AgentTool>;

  beforeEach(async () => {
    harness = await createWorkspaceHarness();

    const fileTools = createFileTools(harness.fs);
    const testTool = createRunTestsTool({
      runner: harness.runner,
      workspaceRoot: '/',
    });

    tools = new Map([
      ...fileTools.map((t) => [t.name, t] as const),
      [testTool.name, testTool],
    ]);
  });

  describe('multi-turn: create files then run tests', () => {
    it('should create source and test files, then run tests', async () => {
      // Turn 1: Agent creates a new source file
      const createFileResponse: AgentResponse = {
        content: 'Creating the new module.',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-write-1',
            name: 'writeFile',
            parameters: {
              path: 'src/greeter.ts',
              content: 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n',
            },
          },
        ],
      };

      // Turn 2: Agent creates a test file
      const createTestResponse: AgentResponse = {
        content: 'Creating the test file.',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-write-2',
            name: 'writeFile',
            parameters: {
              path: 'tests/greeter.spec.ts',
              content: "import { greet } from '../src/greeter.js';\nimport { describe, it, expect } from 'vitest';\n\ndescribe('greet', () => {\n  it('should greet by name', () => {\n    expect(greet('World')).toBe('Hello, World!');\n  });\n});\n",
            },
          },
        ],
      };

      // Turn 3: Agent runs tests
      const runTestsResponse: AgentResponse = {
        content: 'Running the tests.',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-test',
            name: 'runTests',
            parameters: {},
          },
        ],
      };

      const finalResponse: AgentResponse = {
        content: 'All done! The greeter module and its tests are ready.',
        role: 'assistant',
        finishReason: 'stop',
      };

      // Set up mock responses in sequence
      // MockProvider matches on last user message, so we use default responses
      // to chain through the tool calls
      let callCount = 0;
      const responses = [
        createFileResponse,
        createTestResponse,
        runTestsResponse,
        finalResponse,
      ];

      // Override the provider's chat to return responses in sequence
      const originalChat = harness.provider.chat.bind(harness.provider);
      harness.provider.chat = async (messages, options) => {
        const response = responses[callCount] ?? finalResponse;
        callCount++;
        return response;
      };

      // Mock test runner
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

      // Verify the files were created
      const greeterExists = await harness.fileExists('src/greeter.ts');
      expect(greeterExists).toBe(true);

      const testExists = await harness.fileExists('tests/greeter.spec.ts');
      expect(testExists).toBe(true);

      // Verify file contents
      const greeterContent = await harness.readFile('src/greeter.ts');
      expect(greeterContent).toContain('export function greet');

      const testContent = await harness.readFile('tests/greeter.spec.ts');
      expect(testContent).toContain("describe('greet'");

      // Verify directory listing reflects new files
      const srcEntries = await harness.fs.readDirectory('src' as WorkspacePath);
      const srcNames = srcEntries.map((e: FileEntry) => e.name);
      expect(srcNames).toContain('greeter.ts');

      const testEntries = await harness.fs.readDirectory('tests' as WorkspacePath);
      const testNames = testEntries.map((e: FileEntry) => e.name);
      expect(testNames).toContain('greeter.spec.ts');

      // Verify final response
      expect(result.response.finishReason).toBe('stop');
      expect(result.toolResults).toBeDefined();
      expect(result.toolResults!.length).toBe(3);
    });
  });
});
