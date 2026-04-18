/**
 * Parse test runner output into ProjectTestRunSummary.
 *
 * Supports:
 * - node:test with custom JSON reporter (@antimatter/test-utils/reporter)
 * - vitest `--reporter=json`
 * - jest `--json`
 */

import { randomUUID } from 'crypto';
import type { ProjectTestResult, ProjectTestRunSummary } from '../../shared/test-types.js';

// ---------------------------------------------------------------------------
// Runner detection
// ---------------------------------------------------------------------------

/** Detect the test runner from package.json content. */
export function detectTestRunner(packageJsonContent: string): 'node' | 'vitest' | 'jest' | null {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    const scripts = pkg.scripts ?? {};

    // Check for node:test (our primary runner)
    for (const cmd of Object.values(scripts) as string[]) {
      if (cmd.includes('node --import tsx --test') || cmd.includes('node:test') || cmd.includes('node --test')) return 'node';
    }
    // Check scripts for runner hints
    for (const cmd of Object.values(scripts) as string[]) {
      if (cmd.includes('vitest')) return 'vitest';
      if (cmd.includes('jest')) return 'jest';
    }

    if (allDeps['vitest']) return 'vitest';
    if (allDeps['jest']) return 'jest';

    // npm workspaces monorepo — test script delegates to children.
    // Assume node:test since that's our convention; detect workspaces via `workspaces` array.
    if (Array.isArray(pkg.workspaces) && scripts.test?.includes('--workspaces')) {
      return 'node';
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Failure line extraction
// ---------------------------------------------------------------------------

/** Extract the line number in `testFile` from a stack trace string. */
export function extractFailureLine(stack: string, testFile: string): number | undefined {
  if (!stack || !testFile) return undefined;
  // Match patterns like "at /path/to/file.test.ts:42:5" or "file.test.ts:42"
  const escaped = testFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}:(\\d+)`);
  const match = stack.match(re);
  if (match) return parseInt(match[1], 10);

  // Fallback: look for any line number in the first stack frame
  const lineMatch = stack.match(/:(\d+):\d+/);
  return lineMatch ? parseInt(lineMatch[1], 10) : undefined;
}

// ---------------------------------------------------------------------------
// Node test JSON parser (our custom reporter format)
// ---------------------------------------------------------------------------

/**
 * Parse output from @antimatter/test-utils/reporter.
 *
 * Format matches vitest JSON for compatibility with parseVitestJson,
 * so the same downstream code (test results panel) works for both.
 */
export function parseNodeTestJson(stdout: string, projectRoot?: string): ProjectTestRunSummary {
  return { ...parseVitestJson(stdout, projectRoot), runner: 'node' };
}

// ---------------------------------------------------------------------------
// Vitest JSON parser
// ---------------------------------------------------------------------------

/**
 * Parse vitest `--reporter=json` output.
 *
 * Vitest JSON format (simplified):
 * {
 *   "numTotalTests": N,
 *   "numPassedTests": N,
 *   "numFailedTests": N,
 *   "numPendingTests": N,
 *   "testResults": [{
 *     "name": "/abs/path/to/file.test.ts",
 *     "assertionResults": [{
 *       "ancestorTitles": ["describe1", "describe2"],
 *       "title": "test name",
 *       "status": "passed" | "failed" | "pending" | "todo",
 *       "duration": 42,
 *       "failureMessages": ["Error: ..."]
 *     }]
 *   }],
 *   "startTime": 1234567890,
 *   "success": true
 * }
 */
export function parseVitestJson(stdout: string, projectRoot?: string): ProjectTestRunSummary {
  const data = extractJson(stdout);
  const runId = randomUUID().slice(0, 8);
  const results: ProjectTestResult[] = [];

  for (const file of data.testResults ?? []) {
    let filePath = file.name ?? '';
    // Convert absolute paths to relative
    if (projectRoot && filePath.startsWith(projectRoot)) {
      filePath = filePath.slice(projectRoot.length).replace(/^\//, '');
    }

    for (const assertion of file.assertionResults ?? []) {
      const suite = (assertion.ancestorTitles ?? []).join(' > ');
      const name = assertion.title ?? assertion.fullName ?? 'unknown';
      const id = `${filePath} > ${suite ? suite + ' > ' : ''}${name}`;
      const failureMessage = (assertion.failureMessages ?? []).join('\n');
      const status = mapStatus(assertion.status);

      results.push({
        id,
        name,
        file: filePath,
        suite: suite || undefined,
        status,
        durationMs: assertion.duration ?? 0,
        failureMessage: failureMessage || undefined,
        failureLine: failureMessage ? extractFailureLine(failureMessage, filePath) : undefined,
        failureStack: failureMessage || undefined,
      });
    }
  }

  return {
    runId,
    timestamp: new Date().toISOString(),
    runner: 'vitest',
    total: data.numTotalTests ?? results.length,
    passed: data.numPassedTests ?? results.filter(r => r.status === 'pass').length,
    failed: data.numFailedTests ?? results.filter(r => r.status === 'fail').length,
    skipped: data.numPendingTests ?? results.filter(r => r.status === 'skip').length,
    durationMs: Date.now() - (data.startTime ?? Date.now()),
    results,
  };
}

// ---------------------------------------------------------------------------
// Jest JSON parser
// ---------------------------------------------------------------------------

/**
 * Parse jest `--json` output.
 *
 * Jest JSON format is identical to vitest's (vitest intentionally matches it).
 */
export function parseJestJson(stdout: string, projectRoot?: string): ProjectTestRunSummary {
  // Jest and vitest use the same JSON format
  return { ...parseVitestJson(stdout, projectRoot), runner: 'jest' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStatus(status: string): 'pass' | 'fail' | 'skip' | 'todo' {
  switch (status) {
    case 'passed': return 'pass';
    case 'failed': return 'fail';
    case 'pending': case 'skipped': case 'disabled': return 'skip';
    case 'todo': return 'todo';
    default: return 'fail';
  }
}

/** Extract JSON from stdout that may contain non-JSON preamble (e.g., vitest banner). */
function extractJson(stdout: string): any {
  // Try parsing the whole string first
  try { return JSON.parse(stdout); } catch { /* continue */ }

  // Find the first { and last } — vitest sometimes prints banner text before JSON
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(stdout.slice(start, end + 1)); } catch { /* continue */ }
  }

  throw new Error('Could not parse test runner JSON output');
}
