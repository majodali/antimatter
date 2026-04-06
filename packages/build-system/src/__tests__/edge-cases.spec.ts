import { describe, it, beforeEach } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { BuildExecutor } from '../build-executor.js';
import { CacheManager } from '../cache-manager.js';
import { DependencyResolver } from '../dependency-resolver.js';
import type { BuildRule } from '@antimatter/project-model';
import type { BuildContext } from '../types.js';
import { BuildExecutionError, CacheError } from '../types.js';
import { MemoryFileSystem } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';
import type { WorkspacePath } from '@antimatter/filesystem';

describe('Edge Cases', () => {
  let fs: MemoryFileSystem;
  let runner: MockRunner;

  beforeEach(() => {
    fs = new MemoryFileSystem();
    runner = new MockRunner();
  });

  describe('empty rule list', () => {
    it('should handle empty rule list', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);
      const results = await executor.executeBatch([]);

      expect(results.size).toBe(0);
    });
  });

  describe('rules with no inputs', () => {
    it('should handle rule with empty input list', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'generate',
        name: 'Generate',
        inputs: [],
        outputs: ['dist/generated.js'],
        command: 'generate',
      };

      runner.registerMock(
        'generate',
        {
          stdout: 'Generated',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('generate')?.status).toBe('success');
    });

    it('should cache rule with no inputs', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'generate',
        name: 'Generate',
        inputs: [],
        outputs: ['dist/generated.js'],
        command: 'generate',
      };

      runner.registerMock(
        'generate',
        {
          stdout: 'Generated',
          stderr: '',
          exitCode: 0,
        },
      );

      // First build
      await executor.executeBatch([rule]);
      runner.clearHistory();

      // Second build - should be cached
      const results = await executor.executeBatch([rule]);
      expect(results.get('generate')?.status).toBe('cached');
    });
  });

  describe('circular dependency errors', () => {
    it('should throw error for circular dependency', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'Rule A',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['B'],
        },
        {
          id: 'B',
          name: 'Rule B',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(rules);
      expect(() => resolver.resolve()).toThrow(BuildExecutionError);
      const resolver2 = new DependencyResolver(rules);
      expect(() => resolver2.resolve()).toThrow(/circular dependency/i);
    });

    it('should include proper error reason for circular dependency', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'Rule A',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(rules);
      try {
        resolver.resolve();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(BuildExecutionError);
        expect((error as BuildExecutionError).reason).toBe(
          'circular-dependency',
        );
      }
    });
  });

  describe('cache corruption recovery', () => {
    it('should handle corrupted cache gracefully', async () => {
      const cacheManager = new CacheManager(fs);

      // Write invalid JSON to cache
      await fs.mkdir('.antimatter-cache' as WorkspacePath);
      await fs.writeFile(
        '.antimatter-cache/build.json' as WorkspacePath,
        'invalid json{{{',
      );

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      // Should treat corrupted cache as invalid
      const valid = await cacheManager.isCacheValid(rule, '/');
      expect(valid).toBe(false);
    });

    it('should rebuild when cache is corrupted', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      // Corrupt the cache
      await fs.mkdir('.antimatter-cache' as WorkspacePath);
      await fs.writeFile(
        '.antimatter-cache/build.json' as WorkspacePath,
        'corrupted',
      );

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('compile')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });
  });

  describe('missing rules', () => {
    it('should throw error for missing dependency rule', () => {
      const rules: BuildRule[] = [
        {
          id: 'build',
          name: 'Build',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
          dependsOn: ['missing-rule'],
        },
      ];

      expect(() => new DependencyResolver(rules)).toThrow(
        BuildExecutionError,
      );
    });
  });

  describe('very deep dependency chains', () => {
    it('should handle deep dependency chains', async () => {
      const rules: BuildRule[] = Array.from({ length: 20 }, (_, i) => ({
        id: `level-${i}`,
        name: `Level ${i}`,
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
        dependsOn: i > 0 ? [`level-${i - 1}`] : [],
      }));

      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch(rules);

      // All should succeed
      expect(results.size).toBe(20);
      for (let i = 0; i < 20; i++) {
        expect(results.get(`level-${i}`)?.status).toBe('success');
      }

      // Should execute in order level-0, level-1, ..., level-19
      const history = runner.getExecutedCommands();
      expect(history).toHaveLength(20);
    });
  });

  describe('special characters in paths', () => {
    it('should handle paths with spaces', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src with spaces/**/*.ts'],
        outputs: ['dist with spaces/**/*.js'],
        command: 'tsc',
      };

      await fs.writeFile('src with spaces/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('compile')?.status).toBe('success');
    });

    it('should handle paths with hyphens and underscores', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src-main/**/*.ts', 'src_test/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      await fs.writeFile('src-main/index.ts' as WorkspacePath, 'content');
      await fs.writeFile('src_test/test.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('compile')?.status).toBe('success');
    });

    it('should handle paths with dots', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['.config/**/*.ts', 'src/**/*.config.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      await fs.writeFile('.config/webpack.config.ts' as WorkspacePath, 'content');
      await fs.writeFile('src/vite.config.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('compile')?.status).toBe('success');
    });
  });

  describe('unicode in file names', () => {
    it('should handle unicode characters in file names', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      await fs.writeFile('src/fichier-fran\u00e7ais.ts' as WorkspacePath, 'content');
      await fs.writeFile('src/\u0444\u0430\u0439\u043b.ts' as WorkspacePath, 'content');
      await fs.writeFile('src/\u6587\u4ef6.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('compile')?.status).toBe('success');
    });
  });

  describe('rule with no outputs', () => {
    it('should handle rule with empty output list', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'lint',
        name: 'Lint',
        inputs: ['src/**/*.ts'],
        outputs: [], // Linting produces no output files
        command: 'eslint',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'eslint',
        {
          stdout: 'All files passed linting',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('lint')?.status).toBe('success');
    });
  });

  describe('extremely large number of rules', () => {
    it('should handle 100 independent rules', async () => {
      const rules: BuildRule[] = Array.from({ length: 100 }, (_, i) => ({
        id: `build-${i}`,
        name: `Build ${i}`,
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      }));

      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch(rules);

      expect(results.size).toBe(100);
      for (let i = 0; i < 100; i++) {
        expect(results.get(`build-${i}`)?.status).toBe('success');
      }
    });
  });

  describe('negation patterns in globs', () => {
    it('should handle negation patterns correctly', async () => {
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
      };

      const executor = new BuildExecutor(context);

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts', '!src/**/*.spec.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
      await fs.writeFile('src/utils.ts' as WorkspacePath, 'content');
      await fs.writeFile('src/test.spec.ts' as WorkspacePath, 'test content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([rule]);
      expect(results.get('compile')?.status).toBe('success');

      // Verify cache includes only non-test files
      const cacheManager = new CacheManager(fs);
      const cache = await cacheManager.loadCache('compile');
      expect(cache?.inputHashes.size).toBe(2); // index.ts and utils.ts, not test.spec.ts
    });
  });
});
