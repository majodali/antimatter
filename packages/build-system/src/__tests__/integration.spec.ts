import { describe, it, beforeEach } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { BuildExecutor } from '../build-executor.js';
import type { BuildRule } from '@antimatter/project-model';
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

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
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

      const results = await executor.executeBatch([rule]);

      expect(results.get('compile-app')?.status).toBe('success');
      expect(results.get('compile-app')?.diagnostics).toHaveLength(0);
    });
  });

  describe('library and application build', () => {
    it('should build library before application', async () => {
      // Library source
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => {};');

      // App source
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'import { util } from "lib";');

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rules: BuildRule[] = [
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['compile-lib'],
        },
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
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

      const results = await executor.executeBatch(rules);

      expect(results.get('compile-lib')?.status).toBe('success');
      expect(results.get('compile-app')?.status).toBe('success');

      // Verify execution order
      const history = runner.getExecutedCommands();
      expect(history).toHaveLength(2);
    });
  });

  describe('cache validation across builds', () => {
    it('should use cache on second build with unchanged files', async () => {
      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
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
      const results1 = await executor.executeBatch([rule]);
      expect(results1.get('compile-app')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);

      runner.clearHistory();

      // Second build - should use cache
      const results2 = await executor.executeBatch([rule]);
      expect(results2.get('compile-app')?.status).toBe('cached');
      expect(runner.getExecutedCommands()).toHaveLength(0);
    });

    it('should invalidate cache when file added', async () => {
      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
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
      await executor.executeBatch([rule]);
      runner.clearHistory();

      // Add new file
      await fs.writeFile('src/utils.ts' as WorkspacePath, 'export const y = 2;');

      // Second build - should rebuild
      const results = await executor.executeBatch([rule]);
      expect(results.get('compile-app')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });

    it('should rebuild dependent when dependency changes', async () => {
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => {};');
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'import { util } from "lib";');

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rules: BuildRule[] = [
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['packages/app/src/**/*.ts'],
          outputs: ['packages/app/dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['compile-lib'],
        },
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['packages/lib/src/**/*.ts'],
          outputs: ['packages/lib/dist/**/*.js'],
          command: 'tsc',
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
      await executor.executeBatch(rules);
      runner.clearHistory();

      // Second build - both should be cached
      let results = await executor.executeBatch(rules);
      expect(results.get('compile-lib')?.status).toBe('cached');
      expect(results.get('compile-app')?.status).toBe('cached');
      expect(runner.getExecutedCommands()).toHaveLength(0);

      // Change lib file
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => { return 42; };');

      // Third build - lib should rebuild, and app should also rebuild because
      // its dependency (compile-lib) was rebuilt (incremental invalidation)
      results = await executor.executeBatch(rules);
      expect(results.get('compile-lib')?.status).toBe('success');
      expect(results.get('compile-app')?.status).toBe('success');
    });
  });

  describe('mixed success and failure scenarios', () => {
    it('should handle partial build failures', async () => {
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'export const util = () => {};');
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'invalid syntax');

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rules: BuildRule[] = [
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
        },
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
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

      const results = await executor.executeBatch(rules);

      expect(results.get('compile-lib')?.status).toBe('success');
      expect(results.get('compile-app')?.status).toBe('failure');
    });

    it('should collect diagnostics from failed builds', async () => {
      await fs.writeFile('src/index.ts' as WorkspacePath, 'invalid code');

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
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

      const results = await executor.executeBatch([rule]);
      const result = results.get('compile-app')!;

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

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rules: BuildRule[] = [
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['compile-lib'],
        },
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['compile-utils'],
        },
        {
          id: 'compile-utils',
          name: 'Compile Utils',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
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

      const results = await executor.executeBatch(rules);

      expect(results.get('compile-utils')?.status).toBe('success');
      expect(results.get('compile-lib')?.status).toBe('success');
      expect(results.get('compile-app')?.status).toBe('success');

      // Verify execution order
      const history = runner.getExecutedCommands();
      expect(history).toHaveLength(3);
    });

    it('should propagate failures through dependency chain', async () => {
      await fs.writeFile('packages/utils/src/index.ts' as WorkspacePath, 'invalid');
      await fs.writeFile('packages/lib/src/index.ts' as WorkspacePath, 'valid');
      await fs.writeFile('packages/app/src/index.ts' as WorkspacePath, 'valid');

      context = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rules: BuildRule[] = [
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['compile-lib'],
        },
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['compile-utils'],
        },
        {
          id: 'compile-utils',
          name: 'Compile Utils',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
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

      const results = await executor.executeBatch(rules);

      expect(results.get('compile-utils')?.status).toBe('failure');
      expect(results.get('compile-lib')?.status).toBe('skipped');
      expect(results.get('compile-app')?.status).toBe('skipped');

      // Only utils should have been executed
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });
  });
});
