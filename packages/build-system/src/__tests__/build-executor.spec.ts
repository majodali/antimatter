import { describe, it, expect, beforeEach } from 'vitest';
import { BuildExecutor } from '../build-executor.js';
import type { BuildRule, BuildTarget } from '@antimatter/project-model';
import type { BuildContext } from '../types.js';
import { MemoryFileSystem } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';
import type { WorkspacePath } from '@antimatter/filesystem';

describe('BuildExecutor', () => {
  let fs: MemoryFileSystem;
  let runner: MockRunner;
  let context: BuildContext;
  let executor: BuildExecutor;

  beforeEach(() => {
    fs = new MemoryFileSystem();
    runner = new MockRunner();

    const rules = new Map<string, BuildRule>([
      [
        'compile',
        {
          id: 'compile',
          name: 'Compile',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
        },
      ],
    ]);

    context = {
      workspaceRoot: '/',
      fs,
      runner,
      rules,
    };

    executor = new BuildExecutor(context);
  });

  describe('single target execution', () => {
    it('should execute single target successfully', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([target]);

      expect(results.size).toBe(1);
      expect(results.get('build-app')?.status).toBe('success');
      expect(results.get('build-app')?.diagnostics).toHaveLength(0);
      expect(results.get('build-app')?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle build failure', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'invalid code');

      runner.registerMock(
        'tsc',
        {
          stdout: '',
          stderr: 'src/index.ts:1:1 - error: Syntax error',
          exitCode: 1,
        },
      );

      const results = await executor.executeBatch([target]);

      expect(results.get('build-app')?.status).toBe('failed');
      expect(results.get('build-app')?.diagnostics.length).toBeGreaterThan(0);
    });

    it('should track timing correctly', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([target]);
      const result = results.get('build-app')!;

      expect(result.startedAt).toBeDefined();
      expect(result.finishedAt).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      const started = new Date(result.startedAt);
      const finished = new Date(result.finishedAt);
      expect(finished.getTime()).toBeGreaterThanOrEqual(started.getTime());
    });
  });

  describe('caching', () => {
    it('should use cache when inputs are unchanged', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      // First build - should execute
      let results = await executor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);

      runner.clearHistory();

      // Second build - should use cache
      results = await executor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('cached');
      expect(runner.getExecutedCommands()).toHaveLength(0); // No execution
    });

    it('should invalidate cache when input file changes', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      // First build
      await executor.executeBatch([target]);
      runner.clearHistory();

      // Change input file
      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 2;');

      // Second build - should re-execute
      const results = await executor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });

    it('should not cache failed builds', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'invalid code');

      runner.registerMock(
        'tsc',
        {
          stdout: '',
          stderr: 'Error',
          exitCode: 1,
        },
      );

      // First build - should fail
      let results = await executor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('failed');

      runner.clearHistory();

      // Second build - should re-execute (not cached)
      results = await executor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('failed');
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });
  });

  describe('dependency handling', () => {
    it('should execute dependencies before dependents', async () => {
      const targets: BuildTarget[] = [
        {
          id: 'build-app',
          ruleId: 'compile',
          moduleId: 'app',
          dependsOn: ['build-lib'],
        },
        {
          id: 'build-lib',
          ruleId: 'compile',
          moduleId: 'lib',
        },
      ];

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch(targets);

      expect(results.get('build-lib')?.status).toBe('success');
      expect(results.get('build-app')?.status).toBe('success');

      const history = runner.getExecutedCommands();
      const libIndex = history.findIndex((r) => r.command === 'tsc');
      const appIndex = history.findIndex(
        (r, i) => i > libIndex && r.command === 'tsc',
      );
      expect(libIndex).toBeGreaterThanOrEqual(0);
      expect(appIndex).toBeGreaterThanOrEqual(0);
    });

    it('should skip dependent targets when dependency fails', async () => {
      const targets: BuildTarget[] = [
        {
          id: 'build-app',
          ruleId: 'compile',
          moduleId: 'app',
          dependsOn: ['build-lib'],
        },
        {
          id: 'build-lib',
          ruleId: 'compile',
          moduleId: 'lib',
        },
      ];

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      // Mock lib to fail
      runner.registerMock(
        'tsc',
        {
          stdout: '',
          stderr: 'Build failed',
          exitCode: 1,
        },
      );

      const results = await executor.executeBatch(targets);

      expect(results.get('build-lib')?.status).toBe('failed');
      expect(results.get('build-app')?.status).toBe('skipped');

      // Only lib should have been executed
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });

    it('should skip all transitive dependents', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'compile',
          {
            id: 'compile',
            name: 'Compile',
            inputs: ['src/**/*.ts'],
            outputs: ['dist/**/*.js'],
            command: 'tsc',
          },
        ],
      ]);

      const targets: BuildTarget[] = [
        {
          id: 'A',
          ruleId: 'compile',
          moduleId: 'a',
        },
        {
          id: 'B',
          ruleId: 'compile',
          moduleId: 'b',
          dependsOn: ['A'],
        },
        {
          id: 'C',
          ruleId: 'compile',
          moduleId: 'c',
          dependsOn: ['B'],
        },
      ];

      context.rules = rules;
      executor = new BuildExecutor(context);

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      // Mock A to fail
      runner.registerMock(
        'tsc',
        {
          stdout: '',
          stderr: 'Build failed',
          exitCode: 1,
        },
      );

      const results = await executor.executeBatch(targets);

      expect(results.get('A')?.status).toBe('failed');
      expect(results.get('B')?.status).toBe('skipped');
      expect(results.get('C')?.status).toBe('skipped');
    });
  });

  describe('diagnostic extraction', () => {
    it('should extract diagnostics from build output', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'invalid code');

      runner.registerMock(
        'tsc',
        {
          stdout: '',
          stderr: 'src/index.ts:10:5 - error: Type error message',
          exitCode: 1,
        },
      );

      const results = await executor.executeBatch([target]);
      const result = results.get('build-app')!;

      expect(result.status).toBe('failed');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].file).toBe('src/index.ts');
      expect(result.diagnostics[0].line).toBe(10);
      expect(result.diagnostics[0].column).toBe(5);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('should combine stdout and stderr for diagnostic parsing', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'src/file1.ts:1:1 - warning: Warning message',
          stderr: 'src/file2.ts:2:2 - error: Error message',
          exitCode: 1,
        },
      );

      const results = await executor.executeBatch([target]);
      const result = results.get('build-app')!;

      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
      expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      // Don't register a mock - will cause an error
      runner.clearMocks();

      const results = await executor.executeBatch([target]);
      const result = results.get('build-app')!;

      expect(result.status).toBe('failed');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
    });
  });

  describe('environment variables', () => {
    it('should pass environment variables to tool runner', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
        env: {
          NODE_ENV: 'production',
        },
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('success');
    });
  });

  describe('multiple independent targets', () => {
    it('should execute multiple independent targets', async () => {
      const targets: BuildTarget[] = [
        {
          id: 'build-app1',
          ruleId: 'compile',
          moduleId: 'app1',
        },
        {
          id: 'build-app2',
          ruleId: 'compile',
          moduleId: 'app2',
        },
      ];

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch(targets);

      expect(results.get('build-app1')?.status).toBe('success');
      expect(results.get('build-app2')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(2);
    });
  });
});
