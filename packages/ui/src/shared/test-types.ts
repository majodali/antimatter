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
  | 'cross-tab'
  | 'test-infra'
  | 'projects'
  | 'm1';

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
  /**
   * Optional setup that runs in the orchestrator context (main IDE tab)
   * BEFORE the test tab is opened. Use this to create/find a specific project
   * and start its workspace. If provided, the returned projectId is used
   * to open the test tab with that project (instead of a disposable one).
   */
  readonly setup?: () => Promise<{ projectId: string }>;
  /** The test body. Returns pass/fail + detail string. */
  readonly run: (ctx: ActionContext) => Promise<TestModuleResult>;
}

export interface TestModuleResult {
  readonly pass: boolean;
  readonly detail: string;
}

/**
 * Diagnostic trace captured during test execution.
 * Populated on failure to aid remote debugging without keeping the tab open.
 */
export interface TestTrace {
  /** Console output (log/warn/error) captured during the test. */
  readonly consoleLogs: readonly string[];
  /** Snapshot of key DOM state at the moment of failure. */
  readonly domSnapshot?: string;
  /** Error stack trace if the test threw. */
  readonly errorStack?: string;
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
  readonly fixture: 'api' | 'service' | 'browser' | 'headless';
  readonly timestamp: string;
  /**
   * Result classification:
   * - 'tested' — test ran to completion (pass or fail)
   * - 'unsupported' — UI capability doesn't exist (UINotSupportedError)
   * - 'error' — uncaught error during test execution
   */
  readonly status?: 'tested' | 'unsupported' | 'error';
  /** Diagnostic trace captured on failure (console logs, DOM state, stack). */
  readonly trace?: TestTrace;
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

// ---------------------------------------------------------------------------
// Project test types (vitest/jest CLI-based)
// ---------------------------------------------------------------------------

/** Result of a single project test from JSON reporter output. */
export interface ProjectTestResult {
  readonly id: string;            // "file > suite > name"
  readonly name: string;          // innermost test name
  readonly file: string;          // relative file path
  readonly suite?: string;        // describe block chain
  readonly status: 'pass' | 'fail' | 'skip' | 'todo';
  readonly durationMs: number;
  readonly failureMessage?: string;
  readonly failureLine?: number;  // line in test file where assertion failed
  readonly failureStack?: string;
}

/** Summary of a project test run (from vitest/jest --json output). */
export interface ProjectTestRunSummary {
  readonly runId: string;
  readonly timestamp: string;
  readonly runner: 'node' | 'vitest' | 'jest' | 'unknown';
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly results: readonly ProjectTestResult[];
}
