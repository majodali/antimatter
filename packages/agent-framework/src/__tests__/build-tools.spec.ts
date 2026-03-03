import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystem } from '@antimatter/filesystem';
import type { WorkspacePath } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';
import type { BuildRule } from '@antimatter/project-model';
import { createRunBuildTool } from '../tools/build-tools.js';

describe('Build Tools', () => {
  let fs: MemoryFileSystem;
  let runner: MockRunner;
  let rules: BuildRule[];

  beforeEach(async () => {
    fs = new MemoryFileSystem();
    runner = new MockRunner();

    await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

    rules = [
      {
        id: 'compile-ts',
        name: 'Compile TypeScript',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      },
    ];
  });

  describe('runBuild', () => {
    it('should return success results', async () => {
      runner.registerMock('tsc', {
        stdout: 'Compilation successful',
        stderr: '',
        exitCode: 0,
      });

      const tool = createRunBuildTool({
        fs,
        runner,
        rules,
        workspaceRoot: '/',
      });

      const result = await tool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].ruleId).toBe('compile-ts');
      expect(parsed.results[0].status).toBe('success');
      expect(parsed.results[0].diagnostics).toHaveLength(0);
    });

    it('should return failure with diagnostics', async () => {
      runner.registerMock('tsc', {
        stdout: '',
        stderr: "src/index.ts(1,1): error TS1005: ';' expected.",
        exitCode: 1,
      });

      const tool = createRunBuildTool({
        fs,
        runner,
        rules,
        workspaceRoot: '/',
      });

      const result = await tool.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].status).toBe('failure');
      expect(parsed.results[0].diagnostics.length).toBeGreaterThan(0);
    });
  });
});
