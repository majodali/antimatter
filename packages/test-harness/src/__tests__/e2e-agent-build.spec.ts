import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';
import { setupSuccessfulBuild, setupBuildWithErrors } from '../scenario-factory.js';
import { createRunBuildTool, createRunTestsTool } from '@antimatter/agent-framework';
import type { AgentResponse } from '@antimatter/agent-framework';

describe('E2E: Agent Build & Test', () => {
  let harness: WorkspaceHarness;

  beforeEach(async () => {
    harness = await createWorkspaceHarness();
  });

  describe('runBuild tool', () => {
    it('should return build results as JSON', async () => {
      setupSuccessfulBuild(harness.runner);

      const buildTool = createRunBuildTool({
        fs: harness.fs,
        runner: harness.runner,
        rules: harness.fixture.rules,
        targets: [harness.fixture.targets[0]],
        workspaceRoot: '/',
      });

      const result = await buildTool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].status).toBe('success');
    });

    it('should include diagnostics on build failure', async () => {
      setupBuildWithErrors(harness.runner);

      const buildTool = createRunBuildTool({
        fs: harness.fs,
        runner: harness.runner,
        rules: harness.fixture.rules,
        targets: [harness.fixture.targets[0]],
        workspaceRoot: '/',
      });

      const result = await buildTool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.results[0].status).toBe('failure');
      expect(parsed.results[0].diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('runTests tool', () => {
    it('should invoke ToolRunner and return output', async () => {
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

  describe('agent build flow', () => {
    it('should execute runBuild via agent tool loop', async () => {
      setupSuccessfulBuild(harness.runner);

      const buildTool = createRunBuildTool({
        fs: harness.fs,
        runner: harness.runner,
        rules: harness.fixture.rules,
        targets: [harness.fixture.targets[0]],
        workspaceRoot: '/',
      });

      const toolMap = new Map([['runBuild', buildTool]]);

      const toolCallResponse: AgentResponse = {
        content: 'I will build the project.',
        role: 'assistant',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call-build',
            name: 'runBuild',
            parameters: {},
          },
        ],
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
  });
});
