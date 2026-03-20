/**
 * Cross-tab communication protocol for the browser test framework.
 *
 * Uses BroadcastChannel API for same-origin tab-to-tab messaging.
 * The orchestrator (original tab) manages test lifecycle;
 * the executor (test tab) runs tests and reports results.
 */

import type { StoredTestResult, TestRunSummary, FeatureArea } from './test-types.js';

/** BroadcastChannel name. */
export const TEST_CHANNEL_NAME = 'antimatter-test-framework';

// ---- Run options (subset safe for cross-tab serialization) ----

export interface CrossTabRunOptions {
  testIds?: string[];
  area?: FeatureArea;
  failedOnly?: boolean;
  delayMs?: number;
  keepTabOpen?: boolean;
  /**
   * When provided, the orchestrator opens the test tab with this project
   * instead of creating a disposable one. The project is NOT deleted on cleanup.
   * Used by tests that need a specific persistent project (e.g. FT-M1-001).
   */
  projectId?: string;
  /**
   * Orchestrator completion timeout in milliseconds. Default: 600_000 (10 min).
   * Must exceed the longest individual test timeout plus overhead.
   */
  timeoutMs?: number;
}

// ---- Orchestrator → Executor messages ----

export type OrchestratorMessage =
  | { type: 'ping' }
  | { type: 'run-tests'; testIds?: string[]; options?: CrossTabRunOptions }
  | { type: 'abort' }
  | { type: 'cleanup'; keepOpen?: boolean }
  | { type: 'discover-runner' };

// ---- Executor → Orchestrator messages ----

export type ExecutorMessage =
  | { type: 'pong'; projectId: string }
  | { type: 'ready'; projectId: string }
  | { type: 'test-start'; testId: string }
  | { type: 'test-result'; result: StoredTestResult }
  | { type: 'run-complete'; summary: TestRunSummary }
  | { type: 'error'; message: string }
  | { type: 'closing' }
  /** Incremental log lines from the test tab (flushed periodically during execution). */
  | { type: 'test-log'; testId: string; logs: string[] }
  /** Sent by persistent test runner tab to announce availability. */
  | { type: 'runner-available'; runnerId: string };
