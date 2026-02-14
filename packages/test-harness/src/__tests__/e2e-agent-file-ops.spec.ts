import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';
import { createFileTools } from '@antimatter/agent-framework';
import type { AgentResponse } from '@antimatter/agent-framework';

describe('E2E: Agent File Operations', () => {
  let harness: WorkspaceHarness;

  beforeEach(async () => {
    // Create harness with file tools registered
    harness = await createWorkspaceHarness();

    // Register file tools on the agent by re-creating with tools
    const { MemoryFileSystem } = await import('@antimatter/filesystem');
    // We use the harness's fs directly — the tools were created at harness time
    // Instead, we register them via the harness pattern
  });

  describe('readFile tool', () => {
    it('should read actual MemoryFileSystem content', async () => {
      const tools = createFileTools(harness.fs);
      const readTool = tools.find((t) => t.name === 'readFile')!;

      const content = await readTool.execute({ path: 'src/math.ts' });
      expect(content).toContain('export function add');
      expect(content).toContain('export function subtract');
    });

    it('should return error for non-existent file without crashing', async () => {
      const tools = createFileTools(harness.fs);
      const readTool = tools.find((t) => t.name === 'readFile')!;

      const result = await readTool.execute({ path: 'src/nonexistent.ts' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Failed to read file');
    });
  });

  describe('writeFile tool', () => {
    it('should create a file in MemoryFileSystem', async () => {
      const tools = createFileTools(harness.fs);
      const writeTool = tools.find((t) => t.name === 'writeFile')!;

      await writeTool.execute({
        path: 'src/new-module.ts',
        content: 'export const greeting = "hello";',
      });

      const exists = await harness.fileExists('src/new-module.ts');
      expect(exists).toBe(true);

      const content = await harness.readFile('src/new-module.ts');
      expect(content).toBe('export const greeting = "hello";');
    });
  });

  describe('listFiles tool', () => {
    it('should return directory entries', async () => {
      const tools = createFileTools(harness.fs);
      const listTool = tools.find((t) => t.name === 'listFiles')!;

      const result = await listTool.execute({ path: 'src' });
      const entries = JSON.parse(result);
      const names = entries.map((e: { name: string }) => e.name).sort();
      expect(names).toContain('index.ts');
      expect(names).toContain('math.ts');
      expect(names).toContain('utils.ts');
    });
  });

  describe('agent tool-use flow', () => {
    it('should execute readFile tool via agent loop', async () => {
      const tools = createFileTools(harness.fs);
      const toolMap = new Map(tools.map((t) => [t.name, t]));

      // Register a response that calls the readFile tool
      const toolCallResponse: AgentResponse = {
        content: 'Let me read that file.',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-1',
            name: 'readFile',
            parameters: { path: 'src/math.ts' },
          },
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
  });
});
