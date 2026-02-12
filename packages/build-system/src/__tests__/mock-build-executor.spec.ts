import { describe, it, expect, beforeEach } from 'vitest';
import { MockBuildExecutor } from '../mock-build-executor.js';
import type { BuildRule, BuildTarget, BuildResult } from '@antimatter/project-model';
import type { BuildContext } from '../types.js';
import { MemoryFileSystem } from '@antimatter/filesystem';
import { MockRunner } from '@antimatter/tool-integration';

describe('MockBuildExecutor', () => {
  let context: BuildContext;
  let mockExecutor: MockBuildExecutor;

  beforeEach(() => {
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
      fs: new MemoryFileSystem(),
      runner: new MockRunner(),
      rules,
    };

    mockExecutor = new MockBuildExecutor(context);
  });

  describe('registerMock and executeBatch', () => {
    it('should return mocked result for registered target', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      const mockResult: BuildResult = {
        targetId: 'build-app',
        status: 'success',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };

      mockExecutor.registerMock('build-app', mockResult);

      const results = await mockExecutor.executeBatch([target]);

      expect(results.get('build-app')).toEqual(mockResult);
    });

    it('should return default success result for non-mocked target', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      const results = await mockExecutor.executeBatch([target]);

      expect(results.get('build-app')).toBeDefined();
      expect(results.get('build-app')?.status).toBe('success');
      expect(results.get('build-app')?.targetId).toBe('build-app');
    });

    it('should handle multiple targets with mixed mocks', async () => {
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

      const mockResult: BuildResult = {
        targetId: 'build-app',
        status: 'failed',
        diagnostics: [
          {
            file: 'src/index.ts',
            line: 10,
            column: 5,
            severity: 'error',
            message: 'Type error',
          },
        ],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };

      mockExecutor.registerMock('build-app', mockResult);

      const results = await mockExecutor.executeBatch(targets);

      expect(results.get('build-lib')?.status).toBe('success');
      expect(results.get('build-app')?.status).toBe('failed');
      expect(results.get('build-app')?.diagnostics).toHaveLength(1);
    });
  });

  describe('dependency resolution', () => {
    it('should execute targets in dependency order', async () => {
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

      await mockExecutor.executeBatch(targets);

      const executed = mockExecutor.getExecutedTargets();
      expect(executed).toEqual(['build-lib', 'build-app']);
    });

    it('should handle complex dependency graph', async () => {
      const targets: BuildTarget[] = [
        {
          id: 'E',
          ruleId: 'compile',
          moduleId: 'e',
          dependsOn: ['C', 'D'],
        },
        {
          id: 'C',
          ruleId: 'compile',
          moduleId: 'c',
          dependsOn: ['A'],
        },
        {
          id: 'D',
          ruleId: 'compile',
          moduleId: 'd',
          dependsOn: ['B'],
        },
        {
          id: 'A',
          ruleId: 'compile',
          moduleId: 'a',
        },
        {
          id: 'B',
          ruleId: 'compile',
          moduleId: 'b',
        },
      ];

      await mockExecutor.executeBatch(targets);

      const executed = mockExecutor.getExecutedTargets();

      // A and B should come first
      expect(['A', 'B']).toContain(executed[0]);
      expect(['A', 'B']).toContain(executed[1]);

      // E should come last
      expect(executed[4]).toBe('E');
    });
  });

  describe('execution history', () => {
    it('should track execution history', async () => {
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

      expect(mockExecutor.getExecutedTargets()).toHaveLength(0);

      await mockExecutor.executeBatch(targets);

      const executed = mockExecutor.getExecutedTargets();
      expect(executed).toHaveLength(2);
      expect(executed).toContain('build-lib');
      expect(executed).toContain('build-app');
    });

    it('should accumulate history across multiple executions', async () => {
      const target1: BuildTarget = {
        id: 'build-lib',
        ruleId: 'compile',
        moduleId: 'lib',
      };

      const target2: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await mockExecutor.executeBatch([target1]);
      await mockExecutor.executeBatch([target2]);

      const executed = mockExecutor.getExecutedTargets();
      expect(executed).toEqual(['build-lib', 'build-app']);
    });

    it('should clear history when requested', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await mockExecutor.executeBatch([target]);
      expect(mockExecutor.getExecutedTargets()).toHaveLength(1);

      mockExecutor.clearHistory();
      expect(mockExecutor.getExecutedTargets()).toHaveLength(0);
    });
  });

  describe('mock management', () => {
    it('should clear mocks when requested', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      const mockResult: BuildResult = {
        targetId: 'build-app',
        status: 'failed',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };

      mockExecutor.registerMock('build-app', mockResult);

      let results = await mockExecutor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('failed');

      mockExecutor.clearMocks();

      results = await mockExecutor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('success'); // Default
    });

    it('should reset both history and mocks', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      const mockResult: BuildResult = {
        targetId: 'build-app',
        status: 'failed',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };

      mockExecutor.registerMock('build-app', mockResult);
      await mockExecutor.executeBatch([target]);

      expect(mockExecutor.getExecutedTargets()).toHaveLength(1);

      mockExecutor.reset();

      expect(mockExecutor.getExecutedTargets()).toHaveLength(0);

      const results = await mockExecutor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('success'); // Default
    });
  });

  describe('status variants', () => {
    it('should support cached status', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      const mockResult: BuildResult = {
        targetId: 'build-app',
        status: 'cached',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:00Z',
        durationMs: 0,
      };

      mockExecutor.registerMock('build-app', mockResult);

      const results = await mockExecutor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('cached');
    });

    it('should support skipped status', async () => {
      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      const mockResult: BuildResult = {
        targetId: 'build-app',
        status: 'skipped',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:00Z',
        durationMs: 0,
      };

      mockExecutor.registerMock('build-app', mockResult);

      const results = await mockExecutor.executeBatch([target]);
      expect(results.get('build-app')?.status).toBe('skipped');
    });
  });
});
