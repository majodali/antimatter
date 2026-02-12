import type {
  Identifier,
  BuildTarget,
  BuildResult,
} from '@antimatter/project-model';
import type { BuildContext } from './types.js';
import { DependencyResolver } from './dependency-resolver.js';

/**
 * Mock implementation of BuildExecutor for testing.
 *
 * Allows registering expected results for specific targets without
 * actually executing builds. Still performs dependency resolution
 * to test that logic.
 *
 * Usage:
 * ```typescript
 * const mock = new MockBuildExecutor(context);
 * mock.registerMock('build-app', {
 *   targetId: 'build-app',
 *   status: 'success',
 *   ...
 * });
 * const results = await mock.executeBatch([target]);
 * ```
 */
export class MockBuildExecutor {
  private readonly mocks = new Map<Identifier, BuildResult>();
  private readonly executionHistory: Identifier[] = [];

  constructor(private readonly context: BuildContext) {}

  /**
   * Register a mock result for a specific target.
   */
  registerMock(targetId: Identifier, result: BuildResult): void {
    this.mocks.set(targetId, result);
  }

  /**
   * Execute batch of targets, returning mocked results.
   *
   * Still performs dependency resolution to verify that logic works.
   */
  async executeBatch(
    targets: readonly BuildTarget[],
  ): Promise<ReadonlyMap<Identifier, BuildResult>> {
    // Resolve dependencies to get execution order
    const resolver = new DependencyResolver(targets, this.context.rules);
    const plan = resolver.resolve();

    const results = new Map<Identifier, BuildResult>();

    for (const target of plan.targets) {
      this.executionHistory.push(target.id);

      // Check if target has a mock result
      const mockResult = this.mocks.get(target.id);
      if (mockResult) {
        results.set(target.id, mockResult);
      } else {
        // Default to success if no mock registered
        results.set(target.id, {
          targetId: target.id,
          status: 'success',
          diagnostics: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
        });
      }
    }

    return results;
  }

  /**
   * Get list of targets that were executed (in order).
   */
  getExecutedTargets(): readonly Identifier[] {
    return [...this.executionHistory];
  }

  /**
   * Clear execution history.
   */
  clearHistory(): void {
    this.executionHistory.length = 0;
  }

  /**
   * Clear all registered mocks.
   */
  clearMocks(): void {
    this.mocks.clear();
  }

  /**
   * Clear both history and mocks.
   */
  reset(): void {
    this.clearHistory();
    this.clearMocks();
  }
}
