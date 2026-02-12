import { describe, it, expect } from 'vitest';
import { DependencyResolver } from '../dependency-resolver.js';
import type { BuildRule, BuildTarget } from '@antimatter/project-model';
import { BuildExecutionError } from '../types.js';

describe('DependencyResolver', () => {
  describe('simple chains', () => {
    it('should resolve single target with no dependencies', () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      const resolver = new DependencyResolver(
        [target],
        new Map([['compile', rule]]),
      );

      const plan = resolver.resolve();
      expect(plan.targets).toHaveLength(1);
      expect(plan.targets[0].id).toBe('build-app');
    });

    it('should resolve linear dependency chain A -> B -> C', () => {
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
          id: 'C',
          ruleId: 'compile',
          moduleId: 'c',
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
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(targets, rules);
      const plan = resolver.resolve();

      expect(plan.targets).toHaveLength(3);
      expect(plan.targets[0].id).toBe('A');
      expect(plan.targets[1].id).toBe('B');
      expect(plan.targets[2].id).toBe('C');
    });
  });

  describe('diamond patterns', () => {
    it('should resolve diamond dependency: A -> B,C; B,C -> D', () => {
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
          id: 'D',
          ruleId: 'compile',
          moduleId: 'd',
          dependsOn: ['B', 'C'],
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
          dependsOn: ['A'],
        },
        {
          id: 'A',
          ruleId: 'compile',
          moduleId: 'a',
        },
      ];

      const resolver = new DependencyResolver(targets, rules);
      const plan = resolver.resolve();

      expect(plan.targets).toHaveLength(4);
      expect(plan.targets[0].id).toBe('A');
      // B and C can be in any order since they don't depend on each other
      expect(['B', 'C']).toContain(plan.targets[1].id);
      expect(['B', 'C']).toContain(plan.targets[2].id);
      expect(plan.targets[3].id).toBe('D');
    });
  });

  describe('circular dependency detection', () => {
    it('should detect simple cycle: A -> B -> A', () => {
      const rules = new Map<string, BuildRule>([
        [
          'compile',
          {
            id: 'compile',
            name: 'Compile',
            inputs: ['src/**/*.ts'],
            outputs: ['dist/**/*.js'],
            command: 'tsc',
            dependsOn: [],
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

      const resolver = new DependencyResolver(targets, rules);

      expect(() => resolver.resolve()).toThrow(BuildExecutionError);
      expect(() => resolver.resolve()).toThrow(/circular dependency/i);
      expect(() => resolver.resolve()).toThrow(/A.*B.*A/);
    });

    it('should detect longer cycle: A -> B -> C -> A', () => {
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
          dependsOn: ['C'],
        },
        {
          id: 'C',
          ruleId: 'compile',
          moduleId: 'c',
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(targets, rules);

      expect(() => resolver.resolve()).toThrow(BuildExecutionError);
      expect(() => resolver.resolve()).toThrow(/circular dependency/i);
    });

    it('should detect self-dependency: A -> A', () => {
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

      const resolver = new DependencyResolver(targets, rules);

      expect(() => resolver.resolve()).toThrow(BuildExecutionError);
      expect(() => resolver.resolve()).toThrow(/circular dependency/i);
    });
  });

  describe('complex graphs', () => {
    it('should resolve complex DAG with multiple roots', () => {
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

      const resolver = new DependencyResolver(targets, rules);
      const plan = resolver.resolve();

      expect(plan.targets).toHaveLength(5);

      // A and B should come first (roots)
      expect(['A', 'B']).toContain(plan.targets[0].id);
      expect(['A', 'B']).toContain(plan.targets[1].id);

      // E should come last
      expect(plan.targets[4].id).toBe('E');
    });

    it('should handle independent subgraphs', () => {
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
        },
        {
          id: 'D',
          ruleId: 'compile',
          moduleId: 'd',
          dependsOn: ['C'],
        },
      ];

      const resolver = new DependencyResolver(targets, rules);
      const plan = resolver.resolve();

      expect(plan.targets).toHaveLength(4);

      // A comes before B
      const aIndex = plan.targets.findIndex((t) => t.id === 'A');
      const bIndex = plan.targets.findIndex((t) => t.id === 'B');
      expect(aIndex).toBeLessThan(bIndex);

      // C comes before D
      const cIndex = plan.targets.findIndex((t) => t.id === 'C');
      const dIndex = plan.targets.findIndex((t) => t.id === 'D');
      expect(cIndex).toBeLessThan(dIndex);
    });
  });

  describe('error handling', () => {
    it('should throw error for missing build rule', () => {
      const targets: BuildTarget[] = [
        {
          id: 'A',
          ruleId: 'missing-rule',
          moduleId: 'a',
        },
      ];

      expect(() => new DependencyResolver(targets, new Map())).toThrow(
        BuildExecutionError,
      );
      expect(() => new DependencyResolver(targets, new Map())).toThrow(
        /no build rule found/i,
      );
    });

    it('should throw error for missing dependency target', () => {
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
          dependsOn: ['missing-target'],
        },
      ];

      expect(() => new DependencyResolver(targets, rules)).toThrow(
        BuildExecutionError,
      );
      expect(() => new DependencyResolver(targets, rules)).toThrow(
        /dependency.*not found/i,
      );
    });

    it('should include error reason in BuildExecutionError', () => {
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
        const resolver = new DependencyResolver(targets, rules);
        resolver.resolve();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(BuildExecutionError);
        expect((error as BuildExecutionError).reason).toBe(
          'circular-dependency',
        );
        expect((error as BuildExecutionError).targetId).toBe('A');
      }
    });
  });
});
