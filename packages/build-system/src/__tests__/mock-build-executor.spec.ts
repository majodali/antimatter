import { describe, it, expect, beforeEach } from 'vitest';
import { MockBuildExecutor } from '../mock-build-executor.js';
import type { BuildRule, BuildResult } from '@antimatter/project-model';

describe('MockBuildExecutor', () => {
  let mockExecutor: MockBuildExecutor;

  beforeEach(() => {
    mockExecutor = new MockBuildExecutor();
  });

  describe('registerMock and executeBatch', () => {
    it('should return mocked result for registered rule', async () => {
      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      const mockResult: BuildResult = {
        ruleId: 'compile-app',
        status: 'success',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };

      mockExecutor.registerMock('compile-app', mockResult);

      const results = await mockExecutor.executeBatch([rule]);

      expect(results.get('compile-app')).toEqual(mockResult);
    });

    it('should return default success result for non-mocked rule', async () => {
      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      const results = await mockExecutor.executeBatch([rule]);

      expect(results.get('compile-app')).toBeDefined();
      expect(results.get('compile-app')?.status).toBe('success');
      expect(results.get('compile-app')?.ruleId).toBe('compile-app');
    });

    it('should handle multiple rules with mixed mocks', async () => {
      const rules: BuildRule[] = [
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
      ];

      const mockResult: BuildResult = {
        ruleId: 'compile-app',
        status: 'failure',
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

      mockExecutor.registerMock('compile-app', mockResult);

      const results = await mockExecutor.executeBatch(rules);

      expect(results.get('compile-lib')?.status).toBe('success');
      expect(results.get('compile-app')?.status).toBe('failure');
      expect(results.get('compile-app')?.diagnostics).toHaveLength(1);
    });
  });

  describe('dependency resolution', () => {
    it('should execute rules in dependency order', async () => {
      const rules: BuildRule[] = [
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['compile-lib'],
        },
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
      ];

      await mockExecutor.executeBatch(rules);

      const executed = mockExecutor.getExecutedRules();
      expect(executed).toEqual(['compile-lib', 'compile-app']);
    });

    it('should handle complex dependency graph', async () => {
      const rules: BuildRule[] = [
        {
          id: 'E',
          name: 'Rule E',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['C', 'D'],
        },
        {
          id: 'C',
          name: 'Rule C',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
        {
          id: 'D',
          name: 'Rule D',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['B'],
        },
        {
          id: 'A',
          name: 'Rule A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
        {
          id: 'B',
          name: 'Rule B',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
      ];

      await mockExecutor.executeBatch(rules);

      const executed = mockExecutor.getExecutedRules();

      // A and B should come first
      expect(['A', 'B']).toContain(executed[0]);
      expect(['A', 'B']).toContain(executed[1]);

      // E should come last
      expect(executed[4]).toBe('E');
    });
  });

  describe('execution history', () => {
    it('should track execution history', async () => {
      const rules: BuildRule[] = [
        {
          id: 'compile-lib',
          name: 'Compile Lib',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
        {
          id: 'compile-app',
          name: 'Compile App',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
      ];

      expect(mockExecutor.getExecutedRules()).toHaveLength(0);

      await mockExecutor.executeBatch(rules);

      const executed = mockExecutor.getExecutedRules();
      expect(executed).toHaveLength(2);
      expect(executed).toContain('compile-lib');
      expect(executed).toContain('compile-app');
    });

    it('should accumulate history across multiple executions', async () => {
      const rule1: BuildRule = {
        id: 'compile-lib',
        name: 'Compile Lib',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      const rule2: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      await mockExecutor.executeBatch([rule1]);
      await mockExecutor.executeBatch([rule2]);

      const executed = mockExecutor.getExecutedRules();
      expect(executed).toEqual(['compile-lib', 'compile-app']);
    });

    it('should clear history when requested', async () => {
      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      await mockExecutor.executeBatch([rule]);
      expect(mockExecutor.getExecutedRules()).toHaveLength(1);

      mockExecutor.clearHistory();
      expect(mockExecutor.getExecutedRules()).toHaveLength(0);
    });
  });

  describe('mock management', () => {
    it('should clear mocks when requested', async () => {
      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      const mockResult: BuildResult = {
        ruleId: 'compile-app',
        status: 'failure',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };

      mockExecutor.registerMock('compile-app', mockResult);

      let results = await mockExecutor.executeBatch([rule]);
      expect(results.get('compile-app')?.status).toBe('failure');

      mockExecutor.clearMocks();

      results = await mockExecutor.executeBatch([rule]);
      expect(results.get('compile-app')?.status).toBe('success'); // Default
    });

    it('should reset both history and mocks', async () => {
      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      const mockResult: BuildResult = {
        ruleId: 'compile-app',
        status: 'failure',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };

      mockExecutor.registerMock('compile-app', mockResult);
      await mockExecutor.executeBatch([rule]);

      expect(mockExecutor.getExecutedRules()).toHaveLength(1);

      mockExecutor.reset();

      expect(mockExecutor.getExecutedRules()).toHaveLength(0);

      const results = await mockExecutor.executeBatch([rule]);
      expect(results.get('compile-app')?.status).toBe('success'); // Default
    });
  });

  describe('status variants', () => {
    it('should support cached status', async () => {
      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      const mockResult: BuildResult = {
        ruleId: 'compile-app',
        status: 'cached',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:00Z',
        durationMs: 0,
      };

      mockExecutor.registerMock('compile-app', mockResult);

      const results = await mockExecutor.executeBatch([rule]);
      expect(results.get('compile-app')?.status).toBe('cached');
    });

    it('should support skipped status', async () => {
      const rule: BuildRule = {
        id: 'compile-app',
        name: 'Compile App',
        inputs: ['src/**/*.ts'],
        outputs: [],
        command: 'tsc',
      };

      const mockResult: BuildResult = {
        ruleId: 'compile-app',
        status: 'skipped',
        diagnostics: [],
        startedAt: '2024-01-01T00:00:00Z',
        finishedAt: '2024-01-01T00:00:00Z',
        durationMs: 0,
      };

      mockExecutor.registerMock('compile-app', mockResult);

      const results = await mockExecutor.executeBatch([rule]);
      expect(results.get('compile-app')?.status).toBe('skipped');
    });
  });
});
