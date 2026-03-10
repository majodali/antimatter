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
}

// ---- Orchestrator → Executor messages ----

export type OrchestratorMessage =
  | { type: 'ping' }
  | { type: 'run-tests'; testIds?: string[]; options?: CrossTabRunOptions }
  | { type: 'abort' }
  | { type: 'cleanup' };

// ---- Executor → Orchestrator messages ----

export type ExecutorMessage =
  | { type: 'pong'; projectId: string }
  | { type: 'ready'; projectId: string }
  | { type: 'test-start'; testId: string }
  | { type: 'test-result'; result: StoredTestResult }
  | { type: 'run-complete'; summary: TestRunSummary }
  | { type: 'error'; message: string }
  | { type: 'closing' };
