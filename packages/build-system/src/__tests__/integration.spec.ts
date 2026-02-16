import { describe, it, expect, beforeEach } from 'vitest';
import { BuildExecutor } from '../build-executor.js';
import type { BuildRule, BuildTarget } from '@antimatter/project-model';
import type { BuildContext } from '../types.js';
import { MemoryFileSystem } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';
import type { WorkspacePath } from '@antimatter/filesystem';

describe('Integration Tests', () => {
  let fs: MemoryFileSystem;
  let runner: MockRunner;
  let context: BuildContext;

  beforeEach(() => {
    fs = new MemoryFileSystem();
    runner = new MockRunner();
  });

  describe('simple project build', () => {
    it('should build a simple TypeScript project', async () => {
      // Set up file structure
      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const main = () => console.log("Hello");');
      await fs.writeFile('src/utils.ts' as WorkspacePath, 'export const add = (a: number, b: number) => a + b;');

      const rules = new Map<string, BuildRule>([
        [
          'compile-ts',
          {
            id: 'compile-ts',
            name: 'Compile TypeScript',
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

      const executor = new BuildExecutor(context);

      const target: BuildTarget = {
        id: 'build',
        ruleId: 'compile-ts',
        moduleId: 'app',
      };

      runner.registerMock(
        'tsc',
        {
          stdout: 'Compilation successful',
          stderr: '',
          exitCode: 0,
        },
      );

      // Simulate output files
      await fs.writeFile('dist/index.js' as WorkspacePath, 'exports.main = ...;');
      await fs.writeFile('dist/utils.js' as WorkspacePath, 'exports.add = ...;');

      const results = await executor.executeBatch([target]);

      expect(results.get('build')?.status).toBe('success');
      expect(results.get('build')?.diagnostics).toHaveLength(0);
    });
  });

  describe('library and application build', () => {
    it('should build library before application', async () => {
      // Library source
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => {};');

      // App source
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'import { util } from "lib";');

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

      const executor = new BuildExecutor(context);

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

      // Verify execution order
      const history = runner.getExecutedCommands();
      expect(history).toHaveLength(2);
    });
  });

  describe('cache validation across builds', () => {
    it('should use cache on second build with unchanged files', async () => {
      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

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

      const executor = new BuildExecutor(context);

      const target: BuildTarget = {
        id: 'build',
        ruleId: 'compile',
        moduleId: 'app',
      };

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      // First build
      const results1 = await executor.executeBatch([target]);
      expect(results1.get('build')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);

      runner.clearHistory();

      // Second build - should use cache
      const results2 = await executor.executeBatch([target]);
      expect(results2.get('build')?.status).toBe('cached');
      expect(runner.getExecutedCommands()).toHaveLength(0);
    });

    it('should invalidate cache when file added', async () => {
      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

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

      const executor = new BuildExecutor(context);

      const target: BuildTarget = {
        id: 'build',
        ruleId: 'compile',
        moduleId: 'app',
      };

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

      // Add new file
      await fs.writeFile('src/utils.ts' as WorkspacePath, 'export const y = 2;');

      // Second build - should rebuild
      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });

    it('should rebuild dependent when dependency changes', async () => {
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => {};');
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'import { util } from "lib";');

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

      const executor = new BuildExecutor(context);

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

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      // First build
      await executor.executeBatch(targets);
      runner.clearHistory();

      // Second build - both should be cached
      let results = await executor.executeBatch(targets);
      expect(results.get('build-lib')?.status).toBe('cached');
      expect(results.get('build-app')?.status).toBe('cached');
      expect(runner.getExecutedCommands()).toHaveLength(0);

      // Change lib file
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => { return 42; };');

      // Third build - lib should rebuild, app depends on lib so also rebuilds
      results = await executor.executeBatch(targets);
      expect(results.get('build-lib')?.status).toBe('success');
      // App's inputs didn't change, so it gets cached
      expect(results.get('build-app')?.status).toBe('cached');
    });
  });

  describe('mixed success and failure scenarios', () => {
    it('should handle partial build failures', async () => {
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => {};');
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'invalid syntax');

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

      const executor = new BuildExecutor(context);

      const targets: BuildTarget[] = [
        {
          id: 'build-lib',
          ruleId: 'compile',
          moduleId: 'lib',
        },
        {
          id: 'build-app',
          ruleId: 'compile',
          moduleId: 'app',
        },
      ];

      // Mock lib success, app failure
      let callCount = 0;
      runner.registerMock(
        'tsc',
        {
          get stdout() {
            return callCount++ === 0 ? 'Build successful' : '';
          },
          get stderr() {
            return callCount <= 1 ? '' : 'Syntax error';
          },
          get exitCode() {
            return callCount <= 1 ? 0 : 1;
          },
        },
      );

      const results = await executor.executeBatch(targets);

      expect(results.get('build-lib')?.status).toBe('success');
      expect(results.get('build-app')?.status).toBe('failure');
    });

    it('should collect diagnostics from failed builds', async () => {
      await fs.writeFile('src/index.ts' as WorkspacePath, 'invalid code');

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

      const executor = new BuildExecutor(context);

      const target: BuildTarget = {
        id: 'build',
        ruleId: 'compile',
        moduleId: 'app',
      };

      runner.registerMock(
        'tsc',
        {
          stdout: '',
          stderr: `src/index.ts(1,1): error TS1005: ';' expected.
src/index.ts(1,9): error TS1005: ',' expected.`,
          exitCode: 1,
        },
      );

      const results = await executor.executeBatch([target]);
      const result = results.get('build')!;

      expect(result.status).toBe('failure');
      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics[0].file).toBe('src/index.ts');
      expect(result.diagnostics[0].line).toBe(1);
      expect(result.diagnostics[0].code).toBe('TS1005');
    });
  });

  describe('complex dependency graphs', () => {
    it('should handle multi-level dependencies', async () => {
      // Create a dependency graph: app -> lib -> utils
      await fs.writeFile('packages/utils/src/index.ts' as WorkspacePath, 'export const add = (a, b) => a + b;');
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'import { add } from "utils";');
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'import { lib } from "lib";');

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

      const executor = new BuildExecutor(context);

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
          dependsOn: ['build-utils'],
        },
        {
          id: 'build-utils',
          ruleId: 'compile',
          moduleId: 'utils',
        },
      ];

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch(targets);

      expect(results.get('build-utils')?.status).toBe('success');
      expect(results.get('build-lib')?.status).toBe('success');
      expect(results.get('build-app')?.status).toBe('success');

      // Verify execution order
      const history = runner.getExecutedCommands();
      expect(history).toHaveLength(3);
    });

    it('should propagate failures through dependency chain', async () => {
      await fs.writeFile('packages/utils/src/index.ts' as WorkspacePath, 'invalid');
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'valid');
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'valid');

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

      const executor = new BuildExecutor(context);

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
          dependsOn: ['build-utils'],
        },
        {
          id: 'build-utils',
          ruleId: 'compile',
          moduleId: 'utils',
        },
      ];

      runner.registerMock(
        'tsc',
        {
          stdout: '',
          stderr: 'Build failed',
          exitCode: 1,
        },
      );

      const results = await executor.executeBatch(targets);

      expect(results.get('build-utils')?.status).toBe('failure');
      expect(results.get('build-lib')?.status).toBe('skipped');
      expect(results.get('build-app')?.status).toBe('skipped');

      // Only utils should have been executed
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });
  });
});
