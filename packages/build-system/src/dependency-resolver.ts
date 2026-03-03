import type { Identifier, BuildRule } from '@antimatter/project-model';
import type { ExecutionPlan } from './types.js';
import { BuildExecutionError } from './types.js';

/**
 * Resolves build dependencies and computes execution order.
 *
 * Uses topological sorting (Kahn's algorithm) to determine the correct
 * execution order, ensuring dependencies are built before dependents.
 * Detects circular dependencies using depth-first search.
 */
export class DependencyResolver {
  private readonly rules: readonly BuildRule[];
  private readonly graph: Map<Identifier, Set<Identifier>>;
  private readonly reverseGraph: Map<Identifier, Set<Identifier>>;

  constructor(rules: readonly BuildRule[]) {
    this.rules = rules;
    this.graph = new Map();
    this.reverseGraph = new Map();

    this.buildGraph();
  }

  /**
   * Build dependency graph from build rules.
   */
  private buildGraph(): void {
    for (const rule of this.rules) {
      // Initialize adjacency lists
      if (!this.graph.has(rule.id)) {
        this.graph.set(rule.id, new Set());
      }
      if (!this.reverseGraph.has(rule.id)) {
        this.reverseGraph.set(rule.id, new Set());
      }

      // Add edges for dependencies
      const dependencies = rule.dependsOn || [];
      for (const depId of dependencies) {
        // Find the rule with this dependency
        const depRule = this.rules.find((r) => r.id === depId);
        if (!depRule) {
          throw new BuildExecutionError(
            `Dependency '${depId}' not found in rule list for rule '${rule.id}'`,
            rule.id,
            'execution-failed',
          );
        }

        // rule depends on depId
        this.graph.get(rule.id)!.add(depId);
        // depId is depended upon by rule
        if (!this.reverseGraph.has(depId)) {
          this.reverseGraph.set(depId, new Set());
        }
        this.reverseGraph.get(depId)!.add(rule.id);
      }
    }
  }

  /**
   * Detect circular dependencies using depth-first search.
   * @throws BuildExecutionError if a cycle is detected
   */
  private detectCycles(): void {
    const visiting = new Set<Identifier>();
    const visited = new Set<Identifier>();
    const path: Identifier[] = [];

    const visit = (nodeId: Identifier): void => {
      if (visiting.has(nodeId)) {
        // Found a cycle - build cycle path
        const cycleStart = path.indexOf(nodeId);
        const cyclePath = [...path.slice(cycleStart), nodeId];
        throw new BuildExecutionError(
          `Circular dependency detected: ${cyclePath.join(' -> ')}`,
          nodeId,
          'circular-dependency',
        );
      }

      if (visited.has(nodeId)) {
        return;
      }

      visiting.add(nodeId);
      path.push(nodeId);

      const dependencies = this.graph.get(nodeId) || new Set();
      for (const depId of dependencies) {
        visit(depId);
      }

      visiting.delete(nodeId);
      path.pop();
      visited.add(nodeId);
    };

    for (const rule of this.rules) {
      if (!visited.has(rule.id)) {
        visit(rule.id);
      }
    }
  }

  /**
   * Perform topological sort using Kahn's algorithm, grouping into levels.
   * All rules in the same level have no dependencies on each other
   * and can be executed in parallel.
   * @returns Object with flat sorted list and level-grouped arrays
   */
  private topologicalSort(): { sorted: readonly BuildRule[]; levels: readonly (readonly BuildRule[])[] } {
    // Calculate in-degrees
    const inDegree = new Map<Identifier, number>();
    for (const rule of this.rules) {
      inDegree.set(rule.id, this.graph.get(rule.id)?.size || 0);
    }

    // Queue of nodes with in-degree 0 (first wave)
    let currentWave: BuildRule[] = [];
    for (const rule of this.rules) {
      if (inDegree.get(rule.id) === 0) {
        currentWave.push(rule);
      }
    }

    const sorted: BuildRule[] = [];
    const levels: BuildRule[][] = [];

    while (currentWave.length > 0) {
      levels.push([...currentWave]);
      const nextWave: BuildRule[] = [];

      for (const current of currentWave) {
        sorted.push(current);

        // Reduce in-degree for dependents
        const dependents = this.reverseGraph.get(current.id) || new Set();
        for (const depId of dependents) {
          const newInDegree = inDegree.get(depId)! - 1;
          inDegree.set(depId, newInDegree);

          if (newInDegree === 0) {
            const rule = this.rules.find((r) => r.id === depId)!;
            nextWave.push(rule);
          }
        }
      }

      currentWave = nextWave;
    }

    return { sorted, levels };
  }

  /**
   * Resolve dependencies and return execution plan.
   * @returns Execution plan with topologically sorted rules
   */
  resolve(): ExecutionPlan {
    this.detectCycles();
    const { sorted, levels } = this.topologicalSort();

    return { rules: sorted, levels };
  }
}
