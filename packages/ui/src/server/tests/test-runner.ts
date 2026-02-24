import type { TestDef, TestResult, TestRunResponse } from './test-types.js';
import { getSmokeTests } from './smoke-tests.js';
import { getFunctionalTests } from './functional-tests.js';
import { FetchActionContext } from './action-context.js';

const DEFAULT_API_BASE = 'https://cxpofzihnl.execute-api.us-west-2.amazonaws.com/prod';
const DEFAULT_FRONTEND_BASE = 'https://d33wyunpiwy2df.cloudfront.net';

type SuiteFilter = 'smoke' | 'functional' | 'all';

export async function runTests(
  suite: SuiteFilter = 'all',
  apiBase?: string,
  frontendBase?: string,
): Promise<TestRunResponse> {
  const api = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const frontend = (frontendBase || DEFAULT_FRONTEND_BASE).replace(/\/+$/, '');

  const tests: TestDef[] = [];
  const ctx: Record<string, string> = {};

  // Collect smoke tests
  if (suite === 'smoke' || suite === 'all') {
    tests.push(...getSmokeTests(api, frontend));
  }

  // Collect functional tests (needs a dedicated project)
  if (suite === 'functional' || suite === 'all') {
    // Create the test project
    const createRes = await fetch(`${api}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '_functional_test_project' }),
    });
    const createBody = await createRes.json();
    if (!createRes.ok || !createBody.id) {
      // Return a single failure result if project creation fails
      return {
        results: [{
          name: 'FT: Create Test Project',
          pass: false,
          durationMs: 0,
          detail: `Failed to create test project: ${JSON.stringify(createBody)}`,
          suite: 'functional',
        }],
        summary: { total: 1, passed: 0, failed: 1, durationMs: 0 },
      };
    }

    const projectId = createBody.id;
    ctx.__functionalProjectId = projectId;

    const actions = new FetchActionContext(api, frontend, projectId);
    tests.push(...getFunctionalTests(actions, api, frontend));
  }

  // Execute all tests sequentially
  const results: TestResult[] = [];
  const overallStart = Date.now();

  for (const test of tests) {
    const start = Date.now();
    try {
      const { pass, detail } = await test.run(ctx);
      results.push({ name: test.name, pass, durationMs: Date.now() - start, detail, suite: test.suite });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: test.name, pass: false, durationMs: Date.now() - start, detail: `Error: ${message}`, suite: test.suite });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      durationMs: Date.now() - overallStart,
    },
  };
}
