import type {
  Identifier,
  BuildRule,
  BuildResult,
} from '@antimatter/project-model';
import { DependencyResolver } from './dependency-resolver.js';

/**
 * Mock implementation of BuildExecutor for testing.
 *
 * Allows registering expected results for specific rules without
 * actually executing builds. Still performs dependency resolution
 * to test that logic.
 *
 * Usage:
 * ```typescript
 * const mock = new MockBuildExecutor();
 * mock.registerMock('compile-ts', {
 *   ruleId: 'compile-ts',
 *   status: 'success',
 *   ...
 * });
 * const results = await mock.executeBatch([rule]);
 * ```
 */
export class MockBuildExecutor {
  private readonly mocks = new Map<Identifier, BuildResult>();
  private readonly executionHistory: Identifier[] = [];

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor() {}

  /**
   * Register a mock result for a specific rule.
   */
  registerMock(ruleId: Identifier, result: BuildResult): void {
    this.mocks.set(ruleId, result);
  }

  /**
   * Execute batch of rules, returning mocked results.
   *
   * Still performs dependency resolution to verify that logic works.
   */
  async executeBatch(
    rules: readonly BuildRule[],
  ): Promise<ReadonlyMap<Identifier, BuildResult>> {
    // Resolve dependencies to get execution order
    const resolver = new DependencyResolver(rules);
    const plan = resolver.resolve();

    const results = new Map<Identifier, BuildResult>();

    for (const rule of plan.rules) {
      this.executionHistory.push(rule.id);

      // Check if rule has a mock result
      const mockResult = this.mocks.get(rule.id);
      if (mockResult) {
        results.set(rule.id, mockResult);
      } else {
        // Default to success if no mock registered
        results.set(rule.id, {
          ruleId: rule.id,
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
   * Get list of rules that were executed (in order).
   */
  getExecutedRules(): readonly Identifier[] {
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
