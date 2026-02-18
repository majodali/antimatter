import type { Identifier, BuildRule, BuildTarget } from '@antimatter/project-model';
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
  private readonly targets: readonly BuildTarget[];
  private readonly rules: ReadonlyMap<Identifier, BuildRule>;
  private readonly graph: Map<Identifier, Set<Identifier>>;
  private readonly reverseGraph: Map<Identifier, Set<Identifier>>;

  constructor(
    targets: readonly BuildTarget[],
    rules: ReadonlyMap<Identifier, BuildRule>,
  ) {
    this.targets = targets;
    this.rules = rules;
    this.graph = new Map();
    this.reverseGraph = new Map();

    this.buildGraph();
  }

  /**
   * Build dependency graph from build rules.
   */
  private buildGraph(): void {
    for (const target of this.targets) {
      const rule = this.rules.get(target.ruleId);
      if (!rule) {
        throw new BuildExecutionError(
          `No build rule found for target '${target.id}' (ruleId: '${target.ruleId}')`,
          target.id,
          'execution-failed',
        );
      }

      // Initialize adjacency lists
      if (!this.graph.has(target.id)) {
        this.graph.set(target.id, new Set());
      }
      if (!this.reverseGraph.has(target.id)) {
        this.reverseGraph.set(target.id, new Set());
      }

      // Add edges for dependencies
      const dependencies = target.dependsOn || [];
      for (const depId of dependencies) {
        // Find the target with this dependency
        const depTarget = this.targets.find((t) => t.id === depId);
        if (!depTarget) {
          throw new BuildExecutionError(
            `Dependency '${depId}' not found in target list for target '${target.id}'`,
            target.id,
            'execution-failed',
          );
        }

        // target depends on depId
        this.graph.get(target.id)!.add(depId);
        // depId is depended upon by target
        if (!this.reverseGraph.has(depId)) {
          this.reverseGraph.set(depId, new Set());
        }
        this.reverseGraph.get(depId)!.add(target.id);
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

    for (const target of this.targets) {
      if (!visited.has(target.id)) {
        visit(target.id);
      }
    }
  }

  /**
   * Perform topological sort using Kahn's algorithm.
   * @returns Targets in execution order (dependencies first)
   */
  private topologicalSort(): readonly BuildTarget[] {
    // Calculate in-degrees
    const inDegree = new Map<Identifier, number>();
    for (const target of this.targets) {
      inDegree.set(target.id, this.graph.get(target.id)?.size || 0);
    }

    // Queue of nodes with in-degree 0
    const queue: BuildTarget[] = [];
    for (const target of this.targets) {
      if (inDegree.get(target.id) === 0) {
        queue.push(target);
      }
    }

    const sorted: BuildTarget[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      // Reduce in-degree for dependents
      const dependents = this.reverseGraph.get(current.id) || new Set();
      for (const depId of dependents) {
        const newInDegree = inDegree.get(depId)! - 1;
        inDegree.set(depId, newInDegree);

        if (newInDegree === 0) {
          const target = this.targets.find((t) => t.id === depId)!;
          queue.push(target);
        }
      }
    }

    return sorted;
  }

  /**
   * Resolve dependencies and return execution plan.
   * @returns Execution plan with topologically sorted targets
   */
  resolve(): ExecutionPlan {
    this.detectCycles();
    const targets = this.topologicalSort();

    return { targets };
  }
}
