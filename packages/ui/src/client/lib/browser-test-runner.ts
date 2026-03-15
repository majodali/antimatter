/**
 * In-browser test runner.
 *
 * Discovers test modules from the shared barrel, runs them sequentially
 * using BrowserActionContext, updates testResultStore incrementally,
 * and POSTs the final summary to /api/test-results.
 *
 * Usage (from browser console or Test Results panel):
 *   import { runBrowserTests } from './browser-test-runner';
 *   await runBrowserTests();            // run all
 *   await runBrowserTests(['FT-FILE-001', 'FT-EDIT-002']); // run specific
 *   await runBrowserTests(undefined, { area: 'editor' });   // run by area
 */

import type { TestModule, StoredTestResult, TestRunSummary, FeatureArea, TestTrace } from '../../shared/test-types.js';
import { allTestModules } from '../../shared/test-modules/index.js';
import { BrowserActionContext } from './browser-action-context.js';
import type { BrowserActionContextOptions } from './browser-action-context.js';
import { UINotSupportedError } from './dom-helpers.js';
import { useTestResultStore } from '../stores/testResultStore.js';
import { useProjectStore } from '../stores/projectStore.js';
import { getAccessToken } from './auth.js';
import { hasActiveWorkspace } from './api.js';

// ---------------------------------------------------------------------------
// Console capture (shared with test-executor.ts)
// ---------------------------------------------------------------------------

interface ConsoleCapture {
  getLogs(): string[];
  restore(): void;
}

function startConsoleCapture(): ConsoleCapture {
  const logs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  const fmt = (args: unknown[]) =>
    args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

  console.log = (...args: unknown[]) => {
    logs.push(`[log] ${fmt(args)}`);
    origLog.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    logs.push(`[warn] ${fmt(args)}`);
    origWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    logs.push(`[error] ${fmt(args)}`);
    origError.apply(console, args);
  };

  return {
    getLogs: () => [...logs],
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

function captureDomSnapshot(): string {
  const parts: string[] = [];
  const fileTree = document.querySelectorAll('[data-testid^="file-tree-item-"]');
  parts.push(`file-tree: ${fileTree.length} items`);
  const tabs = document.querySelectorAll('[data-testid^="editor-tab-"]');
  const tabPaths = Array.from(tabs).map(
    (t) => (t as HTMLElement).dataset.testid?.replace('editor-tab-', '') ?? '?',
  );
  parts.push(`editor-tabs: [${tabPaths.join(', ')}]`);
  const activeTab = document.querySelector('[data-testid^="editor-tab-"][data-active="true"]');
  parts.push(`active-tab: ${(activeTab as HTMLElement)?.dataset.path ?? 'none'}`);
  const mainLayout = document.querySelector('[data-testid="main-layout"]');
  parts.push(`main-layout: ${mainLayout ? 'present' : 'MISSING'}`);
  return parts.join('\n');
}

export interface RunOptions {
  /** Only run tests matching these IDs. */
  testIds?: string[];
  /** Only run tests in this area. */
  area?: FeatureArea;
  /** Only re-run previously failed tests. */
  failedOnly?: boolean;
  /** BrowserActionContext options (delay, projectId). */
  contextOptions?: BrowserActionContextOptions;
}

/**
 * Run functional tests in the browser.
 * Returns the test run summary.
 */
export async function runBrowserTests(
  testIds?: string[],
  options: RunOptions = {},
): Promise<TestRunSummary> {
  const store = useTestResultStore.getState();

  // Prevent concurrent runs
  if (store.isRunning) {
    throw new Error('A test run is already in progress');
  }

  // Determine which tests to run
  let tests: TestModule[] = [...allTestModules];

  if (testIds && testIds.length > 0) {
    tests = tests.filter((t) => testIds.includes(t.id));
  }
  if (options.area) {
    tests = tests.filter((t) => t.area === options.area);
  }
  if (options.failedOnly) {
    const previousResults = store.results;
    const failedIds = new Set(previousResults.filter((r) => !r.pass).map((r) => r.id));
    tests = tests.filter((t) => failedIds.has(t.id));
  }

  if (tests.length === 0) {
    throw new Error('No tests match the given criteria');
  }

  // Start run
  const runId = `run-${Date.now().toString(36)}`;
  const startTime = Date.now();
  store.setRunning(true);

  const results: StoredTestResult[] = [];

  try {
    for (const test of tests) {
      store.setCurrentTest(test.id);

      // Each test gets a fresh BrowserActionContext
      const ctx = new BrowserActionContext(options.contextOptions);
      const testStart = Date.now();

      let pass = false;
      let detail = '';
      let status: 'tested' | 'unsupported' | 'error' = 'tested';
      let trace: TestTrace | undefined;

      // Capture console output during the test
      const capture = startConsoleCapture();

      try {
        const result = await test.run(ctx);
        pass = result.pass;
        detail = result.detail;
        if (!pass) {
          trace = {
            consoleLogs: capture.getLogs(),
            domSnapshot: captureDomSnapshot(),
          };
        }
      } catch (err) {
        if (err instanceof UINotSupportedError) {
          pass = false;
          detail = `UI NOT SUPPORTED: ${err.message}`;
          status = 'unsupported';
        } else {
          pass = false;
          detail = `Uncaught error: ${err instanceof Error ? err.message : String(err)}`;
          status = 'error';
        }
        trace = {
          consoleLogs: capture.getLogs(),
          domSnapshot: captureDomSnapshot(),
          errorStack: err instanceof Error ? err.stack : undefined,
        };
      } finally {
        capture.restore();
      }

      const storedResult: StoredTestResult = {
        id: test.id,
        name: test.name,
        area: test.area,
        pass,
        durationMs: Date.now() - testStart,
        detail,
        runId,
        fixture: 'browser',
        timestamp: new Date().toISOString(),
        status,
        trace,
      };

      results.push(storedResult);
      store.addResult(storedResult);
    }

    // Build summary
    const summary: TestRunSummary = {
      runId,
      fixture: 'browser',
      timestamp: new Date().toISOString(),
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      durationMs: Date.now() - startTime,
      results,
    };

    store.addRun(summary);

    // POST results to server (best-effort, inside try/finally to prevent hanging)
    await postTestResults(summary, results);

    return summary;
  } finally {
    store.setCurrentTest(null);
    store.setRunning(false);
  }
}

/**
 * POST test results + errors to the workspace/Lambda server (best-effort).
 */
async function postTestResults(summary: TestRunSummary, results: StoredTestResult[]): Promise<void> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const projectId = useProjectStore.getState().currentProjectId;
  const urlBase = projectId && hasActiveWorkspace(projectId)
    ? `/workspace/${projectId}/api`
    : '/api';

  try {
    await fetch(`${urlBase}/test-results`, {
      method: 'POST',
      headers,
      body: JSON.stringify(summary),
    });
  } catch {
    console.warn('[test-runner] Failed to POST test results to server');
  }

  try {
    const failedErrors = results
      .filter((r) => !r.pass)
      .map((r) => ({
        errorType: { name: 'TestFailure', icon: 'test-tube-diagonal', color: '#ef4444', highlightStyle: 'dotted' },
        toolId: 'test-runner',
        file: `tests/${r.area}/${r.id}`,
        message: `${r.id}: ${r.name} — ${r.detail}`,
      }));

    await fetch(`${urlBase}/workflow/errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toolId: 'test-runner', errors: failedErrors }),
    });
  } catch {
    console.warn('[test-runner] Failed to POST test errors to workflow');
  }
}

/**
 * Get all registered test modules.
 * Useful for the Test Results panel to show the full test list.
 */
export function getAllTestModules(): readonly TestModule[] {
  return allTestModules;
}

/**
 * Get test modules grouped by area.
 */
export function getTestModulesByArea(): Map<string, readonly TestModule[]> {
  const byArea = new Map<string, TestModule[]>();
  for (const test of allTestModules) {
    const list = byArea.get(test.area) ?? [];
    list.push(test);
    byArea.set(test.area, list);
  }
  return byArea;
}

// Expose on window for console access
if (typeof window !== 'undefined') {
  (window as any).__runTests = runBrowserTests;
  (window as any).__getTests = getAllTestModules;
}
