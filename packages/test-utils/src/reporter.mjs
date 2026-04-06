/**
 * Custom Node.js test reporter that outputs vitest-compatible JSON.
 *
 * Usage: node --test --test-reporter=@antimatter/test-utils/reporter
 *
 * Processes Node test runner events and outputs JSON matching the schema
 * that parseVitestJson() in test-output-parser.ts already handles.
 */

const results = new Map(); // file -> assertionResults[]
let startTime = Date.now();
let total = 0, passed = 0, failed = 0, pending = 0;

export default async function* reporter(source) {
  for await (const event of source) {
    switch (event.type) {
      case 'test:start':
        startTime = startTime || Date.now();
        break;

      case 'test:pass': {
        if (event.data.details?.type === 'suite') break; // skip suite-level events
        total++;
        passed++;
        const file = event.data.file || 'unknown';
        if (!results.has(file)) results.set(file, []);
        results.get(file).push({
          ancestorTitles: extractAncestors(event.data),
          title: event.data.name,
          fullName: event.data.name,
          status: 'passed',
          duration: event.data.duration_ms ?? 0,
          failureMessages: [],
        });
        break;
      }

      case 'test:fail': {
        if (event.data.nesting === 0 && event.data.details?.type === 'suite') break;
        total++;
        failed++;
        const file = event.data.file || 'unknown';
        if (!results.has(file)) results.set(file, []);
        const failMsg = event.data.details?.error?.message
          || event.data.details?.error?.toString()
          || 'Test failed';
        results.get(file).push({
          ancestorTitles: extractAncestors(event.data),
          title: event.data.name,
          fullName: event.data.name,
          status: 'failed',
          duration: event.data.duration_ms ?? 0,
          failureMessages: [failMsg],
        });
        break;
      }

      case 'test:skip':
      case 'test:todo':
        total++;
        pending++;
        break;
    }
  }

  // Output vitest-compatible JSON
  const testResults = [];
  for (const [file, assertions] of results) {
    testResults.push({
      name: file,
      assertionResults: assertions,
    });
  }

  const output = {
    numTotalTests: total,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    testResults,
    startTime,
    success: failed === 0,
  };

  yield JSON.stringify(output);
}

function extractAncestors(data) {
  // Node test events don't provide ancestor chain directly.
  // We can only get the immediate test name. For grouped tests,
  // the describe name is part of the parent's test:pass/fail.
  return [];
}
