import { describe, it, expect } from 'vitest';
import { DependencyResolver } from '../dependency-resolver.js';
import type { BuildRule } from '@antimatter/project-model';
import { BuildExecutionError } from '../types.js';

describe('DependencyResolver', () => {
  describe('simple chains', () => {
    it('should resolve single rule with no dependencies', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: ['dist/**/*.js'],
          command: 'tsc',
        },
      ];

      const resolver = new DependencyResolver(rules);

      const plan = resolver.resolve();
      expect(plan.rules).toHaveLength(1);
      expect(plan.rules[0].id).toBe('A');
    });

    it('should resolve linear dependency chain A -> B -> C', () => {
      const rules: BuildRule[] = [
        {
          id: 'C',
          name: 'C',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['B'],
        },
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
        {
          id: 'B',
          name: 'B',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(rules);
      const plan = resolver.resolve();

      expect(plan.rules).toHaveLength(3);
      expect(plan.rules[0].id).toBe('A');
      expect(plan.rules[1].id).toBe('B');
      expect(plan.rules[2].id).toBe('C');
    });
  });

  describe('diamond patterns', () => {
    it('should resolve diamond dependency: A -> B,C; B,C -> D', () => {
      const rules: BuildRule[] = [
        {
          id: 'D',
          name: 'D',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['B', 'C'],
        },
        {
          id: 'B',
          name: 'B',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
        {
          id: 'C',
          name: 'C',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
      ];

      const resolver = new DependencyResolver(rules);
      const plan = resolver.resolve();

      expect(plan.rules).toHaveLength(4);
      expect(plan.rules[0].id).toBe('A');
      // B and C can be in any order since they don't depend on each other
      expect(['B', 'C']).toContain(plan.rules[1].id);
      expect(['B', 'C']).toContain(plan.rules[2].id);
      expect(plan.rules[3].id).toBe('D');
    });
  });

  describe('circular dependency detection', () => {
    it('should detect simple cycle: A -> B -> A', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['B'],
        },
        {
          id: 'B',
          name: 'B',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(rules);

      expect(() => resolver.resolve()).toThrow(BuildExecutionError);
      expect(() => resolver.resolve()).toThrow(/circular dependency/i);
      expect(() => resolver.resolve()).toThrow(/A.*B.*A/);
    });

    it('should detect longer cycle: A -> B -> C -> A', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['B'],
        },
        {
          id: 'B',
          name: 'B',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['C'],
        },
        {
          id: 'C',
          name: 'C',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(rules);

      expect(() => resolver.resolve()).toThrow(BuildExecutionError);
      expect(() => resolver.resolve()).toThrow(/circular dependency/i);
    });

    it('should detect self-dependency: A -> A', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
      ];

      const resolver = new DependencyResolver(rules);

      expect(() => resolver.resolve()).toThrow(BuildExecutionError);
      expect(() => resolver.resolve()).toThrow(/circular dependency/i);
    });
  });

  describe('complex graphs', () => {
    it('should resolve complex DAG with multiple roots', () => {
      const rules: BuildRule[] = [
        {
          id: 'E',
          name: 'E',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['C', 'D'],
        },
        {
          id: 'C',
          name: 'C',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
        {
          id: 'D',
          name: 'D',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['B'],
        },
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
        {
          id: 'B',
          name: 'B',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
      ];

      const resolver = new DependencyResolver(rules);
      const plan = resolver.resolve();

      expect(plan.rules).toHaveLength(5);

      // A and B should come first (roots)
      expect(['A', 'B']).toContain(plan.rules[0].id);
      expect(['A', 'B']).toContain(plan.rules[1].id);

      // E should come last
      expect(plan.rules[4].id).toBe('E');
    });

    it('should handle independent subgraphs', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
        {
          id: 'B',
          name: 'B',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
        {
          id: 'C',
          name: 'C',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
        },
        {
          id: 'D',
          name: 'D',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['C'],
        },
      ];

      const resolver = new DependencyResolver(rules);
      const plan = resolver.resolve();

      expect(plan.rules).toHaveLength(4);

      // A comes before B
      const aIndex = plan.rules.findIndex((r) => r.id === 'A');
      const bIndex = plan.rules.findIndex((r) => r.id === 'B');
      expect(aIndex).toBeLessThan(bIndex);

      // C comes before D
      const cIndex = plan.rules.findIndex((r) => r.id === 'C');
      const dIndex = plan.rules.findIndex((r) => r.id === 'D');
      expect(cIndex).toBeLessThan(dIndex);
    });
  });

  describe('error handling', () => {
    it('should throw error for missing dependency rule', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['missing-rule'],
        },
      ];

      expect(() => new DependencyResolver(rules)).toThrow(
        BuildExecutionError,
      );
      expect(() => new DependencyResolver(rules)).toThrow(
        /not found/i,
      );
    });

    it('should include error reason in BuildExecutionError', () => {
      const rules: BuildRule[] = [
        {
          id: 'A',
          name: 'A',
          inputs: ['src/**/*.ts'],
          outputs: [],
          command: 'tsc',
          dependsOn: ['A'],
        },
      ];

      try {
        const resolver = new DependencyResolver(rules);
        resolver.resolve();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(BuildExecutionError);
        expect((error as BuildExecutionError).reason).toBe(
          'circular-dependency',
        );
        expect((error as BuildExecutionError).ruleId).toBe('A');
      }
    });
  });
});
