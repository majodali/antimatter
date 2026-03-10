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

import type { TestModule, StoredTestResult, TestRunSummary, FeatureArea } from '../../shared/test-types.js';
import { allTestModules } from '../../shared/test-modules/index.js';
import { BrowserActionContext } from './browser-action-context.js';
import type { BrowserActionContextOptions } from './browser-action-context.js';
import { useTestResultStore } from '../stores/testResultStore.js';

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

      try {
        const result = await test.run(ctx);
        pass = result.pass;
        detail = result.detail;
      } catch (err) {
        pass = false;
        detail = `Uncaught error: ${err instanceof Error ? err.message : String(err)}`;
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
      };

      results.push(storedResult);
      store.addResult(storedResult);
    }
  } finally {
    store.setCurrentTest(null);
    store.setRunning(false);
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

  // POST results to workspace server (best-effort)
  try {
    await fetch('/api/test-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
    });
  } catch {
    console.warn('[test-runner] Failed to POST test results to server');
  }

  // Report failures as ProjectErrors → appears in Problems panel
  try {
    const failedErrors = results
      .filter((r) => !r.pass)
      .map((r) => ({
        errorType: { name: 'TestFailure', icon: 'test-tube-diagonal', color: '#ef4444', highlightStyle: 'dotted' },
        toolId: 'test-runner',
        file: `tests/${r.area}/${r.id}`,
        message: `${r.id}: ${r.name} — ${r.detail}`,
      }));

    await fetch('/api/workflow/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'test-runner', errors: failedErrors }),
    });
  } catch {
    console.warn('[test-runner] Failed to POST test errors to workflow');
  }

  return summary;
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
