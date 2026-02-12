import { describe, it, expect, beforeEach } from 'vitest';
import { BuildExecutor } from '../build-executor.js';
import { CacheManager } from '../cache-manager.js';
import { DependencyResolver } from '../dependency-resolver.js';
import type { BuildRule, BuildTarget } from '@antimatter/project-model';
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

  describe('empty target list', () => {
    it('should handle empty target list', async () => {
      const rules = new Map<string, BuildRule>();
      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
        rules,
      };

      const executor = new BuildExecutor(context);
      const results = await executor.executeBatch([]);

      expect(results.size).toBe(0);
    });
  });

  describe('targets with no inputs', () => {
    it('should handle target with empty input list', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'generate',
          {
            id: 'generate',
            name: 'Generate',
            inputs: [],
            outputs: ['dist/generated.js'],
            command: 'generate',
          },
        ],
      ]);

      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
        rules,
      };

      const executor = new BuildExecutor(context);

      const target: BuildTarget = {
        id: 'build',
        ruleId: 'generate',
        moduleId: 'app',
      };

      runner.registerMock(
        'generate',
        {
          stdout: 'Generated',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');
    });

    it('should cache target with no inputs', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'generate',
          {
            id: 'generate',
            name: 'Generate',
            inputs: [],
            outputs: ['dist/generated.js'],
            command: 'generate',
          },
        ],
      ]);

      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
        rules,
      };

      const executor = new BuildExecutor(context);

      const target: BuildTarget = {
        id: 'build',
        ruleId: 'generate',
        moduleId: 'app',
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
      await executor.executeBatch([target]);
      runner.clearHistory();

      // Second build - should be cached
      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('cached');
    });
  });

  describe('circular dependency errors', () => {
    it('should throw error for circular dependency', () => {
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
          dependsOn: ['B'],
        },
        {
          id: 'B',
          ruleId: 'compile',
          moduleId: 'b',
          dependsOn: ['A'],
        },
      ];

      expect(() => new DependencyResolver(targets, rules)).toThrow(
        BuildExecutionError,
      );
      expect(() => new DependencyResolver(targets, rules)).toThrow(
        /circular dependency/i,
      );
    });

    it('should include proper error reason for circular dependency', () => {
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
          dependsOn: ['A'],
        },
      ];

      try {
        new DependencyResolver(targets, rules);
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

      const target: BuildTarget = {
        id: 'build',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      // Should treat corrupted cache as invalid
      const valid = await cacheManager.isCacheValid(target, rule, '/');
      expect(valid).toBe(false);
    });

    it('should rebuild when cache is corrupted', async () => {
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

      const context: BuildContext = {
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

      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');
      expect(runner.getExecutedCommands()).toHaveLength(1);
    });
  });

  describe('missing rules', () => {
    it('should throw error for missing build rule', () => {
      const rules = new Map<string, BuildRule>();

      const targets: BuildTarget[] = [
        {
          id: 'build',
          ruleId: 'missing-rule',
          moduleId: 'app',
        },
      ];

      expect(() => new DependencyResolver(targets, rules)).toThrow(
        BuildExecutionError,
      );
      expect(() => new DependencyResolver(targets, rules)).toThrow(
        /no build rule found/i,
      );
    });
  });

  describe('very deep dependency chains', () => {
    it('should handle deep dependency chains', async () => {
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

      // Create chain of 20 targets: A -> B -> C -> ... -> T
      const targets: BuildTarget[] = [];
      const letters = 'ABCDEFGHIJKLMNOPQRST'.split('');

      for (let i = 0; i < letters.length; i++) {
        const dependsOn = i > 0 ? [letters[i - 1]] : undefined;
        targets.push({
          id: letters[i],
          ruleId: 'compile',
          moduleId: letters[i].toLowerCase(),
          dependsOn,
        });
      }

      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
        rules,
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

      const results = await executor.executeBatch(targets);

      // All should succeed
      expect(results.size).toBe(20);
      for (const letter of letters) {
        expect(results.get(letter)?.status).toBe('success');
      }

      // Should execute in order A, B, C, ..., T
      const history = runner.getExecutedCommands();
      expect(history).toHaveLength(20);
    });
  });

  describe('special characters in paths', () => {
    it('should handle paths with spaces', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'compile',
          {
            id: 'compile',
            name: 'Compile',
            inputs: ['src with spaces/**/*.ts'],
            outputs: ['dist with spaces/**/*.js'],
            command: 'tsc',
          },
        ],
      ]);

      const context: BuildContext = {
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

      await fs.writeFile('src with spaces/index.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');
    });

    it('should handle paths with hyphens and underscores', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'compile',
          {
            id: 'compile',
            name: 'Compile',
            inputs: ['src-main/**/*.ts', 'src_test/**/*.ts'],
            outputs: ['dist/**/*.js'],
            command: 'tsc',
          },
        ],
      ]);

      const context: BuildContext = {
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

      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');
    });

    it('should handle paths with dots', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'compile',
          {
            id: 'compile',
            name: 'Compile',
            inputs: ['.config/**/*.ts', 'src/**/*.config.ts'],
            outputs: ['dist/**/*.js'],
            command: 'tsc',
          },
        ],
      ]);

      const context: BuildContext = {
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

      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');
    });
  });

  describe('unicode in file names', () => {
    it('should handle unicode characters in file names', async () => {
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

      const context: BuildContext = {
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

      await fs.writeFile('src/fichier-français.ts' as WorkspacePath, 'content');
      await fs.writeFile('src/файл.ts' as WorkspacePath, 'content');
      await fs.writeFile('src/文件.ts' as WorkspacePath, 'content');

      runner.registerMock(
        'tsc',
        {
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        },
      );

      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');
    });
  });

  describe('target with no outputs', () => {
    it('should handle target with empty output list', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'lint',
          {
            id: 'lint',
            name: 'Lint',
            inputs: ['src/**/*.ts'],
            outputs: [], // Linting produces no output files
            command: 'eslint',
          },
        ],
      ]);

      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
        rules,
      };

      const executor = new BuildExecutor(context);

      const target: BuildTarget = {
        id: 'lint',
        ruleId: 'lint',
        moduleId: 'app',
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

      const results = await executor.executeBatch([target]);
      expect(results.get('lint')?.status).toBe('success');
    });
  });

  describe('extremely large number of targets', () => {
    it('should handle 100 independent targets', async () => {
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

      const targets: BuildTarget[] = [];
      for (let i = 0; i < 100; i++) {
        targets.push({
          id: `build-${i}`,
          ruleId: 'compile',
          moduleId: `app-${i}`,
        });
      }

      const context: BuildContext = {
        workspaceRoot: '/',
        fs,
        runner,
        rules,
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

      const results = await executor.executeBatch(targets);

      expect(results.size).toBe(100);
      for (let i = 0; i < 100; i++) {
        expect(results.get(`build-${i}`)?.status).toBe('success');
      }
    });
  });

  describe('negation patterns in globs', () => {
    it('should handle negation patterns correctly', async () => {
      const rules = new Map<string, BuildRule>([
        [
          'compile',
          {
            id: 'compile',
            name: 'Compile',
            inputs: ['src/**/*.ts', '!src/**/*.spec.ts'],
            outputs: ['dist/**/*.js'],
            command: 'tsc',
          },
        ],
      ]);

      const context: BuildContext = {
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

      const results = await executor.executeBatch([target]);
      expect(results.get('build')?.status).toBe('success');

      // Verify cache includes only non-test files
      const cacheManager = new CacheManager(fs);
      const cache = await cacheManager.loadCache('build');
      expect(cache?.inputHashes.size).toBe(2); // index.ts and utils.ts, not test.spec.ts
    });
  });
});
