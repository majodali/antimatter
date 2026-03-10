/**
 * Framework-agnostic functional test types.
 *
 * These types are shared between Node.js (Vitest) and browser (in-IDE runner).
 * Test modules use the ActionContext abstraction so the same test body
 * runs against any implementation: ServiceActionContext, FetchActionContext,
 * or BrowserActionContext.
 */

import type { ActionContext } from './action-context.js';

/** Feature area for grouping in UI and filtering. */
export type FeatureArea =
  | 'editor'
  | 'file-explorer'
  | 'problems'
  | 'workflow'
  | 'build'
  | 'deploy'
  | 'git'
  | 'chat'
  | 'terminal'
  | 'widget'
  | 'auth'
  | 'secrets'
  | 'infra'
  | 'workspace'
  | 'logging'
  | 'test-infra';

/**
 * A single functional test.
 * Test body is a plain async function — no framework-specific APIs (no describe/it/expect).
 */
export interface TestModule {
  /** BACKLOG.md test case ID, e.g. 'FT-FILE-001' */
  readonly id: string;
  /** Human-readable test name */
  readonly name: string;
  /** Feature area for grouping */
  readonly area: FeatureArea;
  /** The test body. Returns pass/fail + detail string. */
  readonly run: (ctx: ActionContext) => Promise<TestModuleResult>;
}

export interface TestModuleResult {
  readonly pass: boolean;
  readonly detail: string;
}

/** Extended test result with timing and metadata (stored on server). */
export interface StoredTestResult {
  readonly id: string;
  readonly name: string;
  readonly area: FeatureArea;
  readonly pass: boolean;
  readonly durationMs: number;
  readonly detail: string;
  readonly runId: string;
  readonly fixture: 'api' | 'service' | 'browser';
  readonly timestamp: string;
  /**
   * Result classification:
   * - 'tested' — test ran to completion (pass or fail)
   * - 'unsupported' — UI capability doesn't exist (UINotSupportedError)
   * - 'error' — uncaught error during test execution
   */
  readonly status?: 'tested' | 'unsupported' | 'error';
}

/** Summary of a complete test run. */
export interface TestRunSummary {
  readonly runId: string;
  readonly fixture: string;
  readonly timestamp: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly durationMs: number;
  readonly results: readonly StoredTestResult[];
}
