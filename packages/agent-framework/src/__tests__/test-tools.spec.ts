import { describe, it, expect, beforeEach } from 'vitest';
import { MockRunner } from '@antimatter/tool-integration';
import { createRunTestsTool, createRunLintTool } from '../tools/test-tools.js';

describe('Test Tools', () => {
  let runner: MockRunner;

  beforeEach(() => {
    runner = new MockRunner();
  });

  describe('runTests', () => {
    it('should return test results on success', async () => {
      runner.registerMock(/vitest/, {
        stdout: 'Tests: 5 passed, 5 total',
        stderr: '',
        exitCode: 0,
      });

      const tool = createRunTestsTool({ runner, workspaceRoot: '/' });
      const result = await tool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toContain('5 passed');
    });

    it('should return test failure results', async () => {
      runner.registerMock(/vitest/, {
        stdout: 'Tests: 1 failed, 4 passed, 5 total',
        stderr: '',
        exitCode: 1,
      });

      const tool = createRunTestsTool({ runner, workspaceRoot: '/' });
      const result = await tool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.exitCode).toBe(1);
      expect(parsed.stdout).toContain('1 failed');
    });
  });

  describe('runLint', () => {
    it('should return lint results on success', async () => {
      runner.registerMock(/eslint/, {
        stdout: 'No problems found',
        stderr: '',
        exitCode: 0,
      });

      const tool = createRunLintTool({ runner, workspaceRoot: '/' });
      const result = await tool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toContain('No problems found');
    });

    it('should return lint errors', async () => {
      runner.registerMock(/eslint/, {
        stdout: '',
        stderr: 'src/index.ts: Unexpected var',
        exitCode: 1,
      });

      const tool = createRunLintTool({ runner, workspaceRoot: '/' });
      const result = await tool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.exitCode).toBe(1);
      expect(parsed.stderr).toContain('Unexpected var');
    });
  });
});
