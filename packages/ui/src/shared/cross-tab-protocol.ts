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
// All messages include an optional `runId` to scope communication to a specific
// test run. Stale test tabs from previous runs will have a different runId and
// should be ignored by the orchestrator.

export type OrchestratorMessage =
  | { type: 'ping'; runId?: string }
  | { type: 'run-tests'; runId?: string; testIds?: string[]; options?: CrossTabRunOptions }
  | { type: 'abort'; runId?: string }
  | { type: 'cleanup'; runId?: string; keepOpen?: boolean }
  | { type: 'discover-runner' };

// ---- Executor → Orchestrator messages ----
// All messages include an optional `runId` echoed from the orchestrator's command.
// The orchestrator filters by runId to ignore responses from stale test tabs.

export type ExecutorMessage =
  | { type: 'pong'; projectId: string; runId?: string }
  | { type: 'ready'; projectId: string; runId?: string }
  | { type: 'test-start'; testId: string; runId?: string }
  | { type: 'test-result'; result: StoredTestResult; runId?: string }
  | { type: 'run-complete'; summary: TestRunSummary; runId?: string }
  | { type: 'error'; message: string; runId?: string }
  | { type: 'closing'; runId?: string }
  /** Incremental log lines from the test tab (flushed periodically during execution). */
  | { type: 'test-log'; testId: string; logs: string[]; runId?: string }
  /** Sent by persistent test runner tab to announce availability. */
  | { type: 'runner-available'; runnerId: string };
