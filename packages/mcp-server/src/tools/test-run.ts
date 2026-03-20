/**
 * antimatter_test_run — Run functional tests with built-in polling.
 *
 * Fires tests.run (fire-and-forget), then polls tests.results with
 * exponential backoff until tests complete or timeout.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AutomationClient } from '../client.js';

export function registerTestRunTool(server: McpServer, client: AutomationClient): void {
  server.tool(
    'antimatter_test_run',
    'Run functional tests in the Antimatter IDE and wait for results. Fires the test run, polls for completion with exponential backoff, and returns full results including pass/fail status.',
    {
      testIds: z.array(z.string()).optional().describe('Specific test IDs to run (e.g. ["FT-M1-001"]). Omit to run all.'),
      area: z.string().optional().describe('Filter tests by feature area (e.g. "editor", "m1", "file-explorer")'),
      timeoutMs: z.number().optional().describe('Max wait time in ms. Default: 300000 (5 min)'),
      projectId: z.string().optional().describe('Override the default project ID'),
    },
    async ({ testIds, area, timeoutMs, projectId }) => {
      // 1. Fire tests.run
      const fireResult = await client.execute(
        'tests.run',
        {
          fixture: 'browser',
          ...(testIds ? { testIds } : {}),
          ...(area ? { area } : {}),
        },
        projectId,
      );

      if (!fireResult.ok) {
        return {
          content: [{ type: 'text' as const, text: `Failed to start tests: ${fireResult.error?.message}` }],
          isError: true,
        };
      }

      // 2. Poll tests.results with exponential backoff
      const deadline = Date.now() + (timeoutMs ?? 300_000);
      let delay = 2000; // Start at 2s (give orchestrator time to start)
      let lastStatus = '';

      // Wait a beat for orchestrator to initialize
      await sleep(1000);

      while (Date.now() < deadline) {
        await sleep(delay);
        delay = Math.min(delay * 1.5, 10_000);

        const pollResult = await client.execute('tests.results', {}, projectId);
        if (!pollResult.ok) {
          console.error(`[test-run] Poll failed: ${pollResult.error?.message}`);
          continue;
        }

        const data = pollResult.data as TestResultsData;
        const status = `running=${data.isRunning} tests=${data.results?.length ?? 0} current=${data.currentTestId ?? 'none'}`;
        if (status !== lastStatus) {
          console.error(`[test-run] ${status}`);
          lastStatus = status;
        }

        if (!data.isRunning && (data.results?.length ?? 0) > 0) {
          return {
            content: [{ type: 'text' as const, text: formatResults(data, false) }],
          };
        }
      }

      // 3. Timeout — return partial results
      const partial = await client.execute('tests.results', {}, projectId);
      const partialData = partial.ok ? partial.data as TestResultsData : null;

      return {
        content: [{
          type: 'text' as const,
          text: partialData ? formatResults(partialData, true) : 'Test run timed out with no results available.',
        }],
        isError: true,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestResultsData {
  results: Array<{
    id: string;
    name?: string;
    status: string;
    durationMs?: number;
    error?: string;
    assertions?: Array<{
      description: string;
      passed: boolean;
      error?: string;
    }>;
    console?: string[];
    domSnapshot?: string;
  }>;
  runs: Array<{
    id: string;
    startedAt: string;
    completedAt?: string;
    summary?: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
    };
  }>;
  isRunning: boolean;
  currentTestId: string | null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatResults(data: TestResultsData, timedOut: boolean): string {
  const lines: string[] = [];

  if (timedOut) {
    lines.push('⚠️  Test run timed out (still running)\n');
  }

  // Latest run summary
  const latestRun = data.runs?.[data.runs.length - 1];
  if (latestRun?.summary) {
    const s = latestRun.summary;
    const icon = s.failed > 0 ? '❌' : '✅';
    lines.push(`${icon} Run summary: ${s.passed}/${s.total} passed, ${s.failed} failed, ${s.skipped} skipped`);
    if (latestRun.completedAt && latestRun.startedAt) {
      const elapsed = new Date(latestRun.completedAt).getTime() - new Date(latestRun.startedAt).getTime();
      lines.push(`   Duration: ${(elapsed / 1000).toFixed(1)}s`);
    }
    lines.push('');
  }

  // Per-test results
  for (const result of data.results ?? []) {
    const icon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
    const duration = result.durationMs != null ? ` (${(result.durationMs / 1000).toFixed(1)}s)` : '';
    lines.push(`${icon} ${result.id} — ${result.name ?? 'unnamed'}${duration}`);

    if (result.error) {
      lines.push(`   Error: ${result.error}`);
    }

    // Assertions
    if (result.assertions?.length) {
      for (const a of result.assertions) {
        const aIcon = a.passed ? '  ✓' : '  ✗';
        lines.push(`${aIcon} ${a.description}`);
        if (a.error) {
          lines.push(`     ${a.error}`);
        }
      }
    }

    // Console output (truncated)
    if (result.console?.length) {
      const consoleTruncated = result.console.slice(0, 10);
      lines.push('   Console:');
      for (const line of consoleTruncated) {
        lines.push(`     ${line}`);
      }
      if (result.console.length > 10) {
        lines.push(`     ... (${result.console.length - 10} more lines)`);
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
