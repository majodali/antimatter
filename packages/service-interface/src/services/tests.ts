/**
 * Tests Service
 *
 * Manages test definitions, execution, and results.
 *
 * Tests are resources configured by each project. When a project is loaded
 * (or its configuration updated), it registers tests with the Tests service.
 * Each test can have multiple runners configured (e.g., browser, headless,
 * service-level). The runner's key responsibility is integration with the
 * platform (when and where to run), not with the target system.
 *
 * Tests can be run by users through the UI or by build rules. Results are
 * emitted as events, may be written as annotations to files (via Files
 * service), and are maintained by the Tests service for querying.
 */

import type { ProjectScoped, ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface TestDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Module or file containing this test. */
  readonly module?: string;
  /** Available runners for this test. */
  readonly runners: readonly TestRunnerRef[];
}

export interface TestRunnerRef {
  readonly runnerId: string;
  readonly name: string;
  readonly description?: string;
}

export type TestResultStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface TestResult {
  readonly testId: string;
  readonly runnerId: string;
  readonly status: TestResultStatus;
  readonly message?: string;
  readonly durationMs: number;
  readonly timestamp: string;
  /** File path if the failure relates to a specific location. */
  readonly path?: string;
  readonly line?: number;
}

export interface TestRunSummary {
  readonly runId: string;
  readonly projectId: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs?: number;
  readonly startedAt: string;
  readonly completedAt?: string;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface TestsRunCommand extends ProjectScoped {
  readonly type: 'tests.run';
  /** Specific test IDs to run. If omitted, runs all. */
  readonly testIds?: readonly string[];
  /** Specific runner(s) to use. If omitted, uses defaults. */
  readonly runnerIds?: readonly string[];
}

export interface TestsRegisterCommand extends ProjectScoped {
  readonly type: 'tests.register';
  readonly tests: readonly TestDefinition[];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface TestsListQuery extends ProjectScoped {
  readonly type: 'tests.list';
}

export interface TestsResultsQuery extends ProjectScoped {
  readonly type: 'tests.results';
  /** Filter to a specific run. If omitted, returns latest. */
  readonly runId?: string;
}

export interface TestsRunnersQuery extends ProjectScoped {
  readonly type: 'tests.runners';
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface TestsStartedEvent extends ServiceEventBase {
  readonly type: 'tests.started';
  readonly runId: string;
  readonly testIds: readonly string[];
}

export interface TestsResultEvent extends ServiceEventBase {
  readonly type: 'tests.result';
  readonly runId: string;
  readonly result: TestResult;
}

export interface TestsCompletedEvent extends ServiceEventBase {
  readonly type: 'tests.completed';
  readonly summary: TestRunSummary;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type TestsCommand =
  | TestsRunCommand
  | TestsRegisterCommand;

export type TestsQuery =
  | TestsListQuery
  | TestsResultsQuery
  | TestsRunnersQuery;

export type TestsEvent =
  | TestsStartedEvent
  | TestsResultEvent
  | TestsCompletedEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface TestsCommandResponseMap {
  'tests.run': { runId: string };
  'tests.register': { registered: number };
}

export interface TestsQueryResponseMap {
  'tests.list': { tests: readonly TestDefinition[] };
  'tests.results': { results: readonly TestResult[]; summary?: TestRunSummary };
  'tests.runners': { runners: readonly TestRunnerRef[] };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const TESTS_OPERATIONS: Record<string, OperationMeta> = {
  'tests.run': {
    kind: 'command', context: 'workspace', description: 'Run tests',
    params: { testIds: z.array(z.string()).optional().describe('Specific test IDs to run (omit to run all)'), runnerIds: z.array(z.string()).optional().describe('Specific runner IDs to use (omit for defaults)') },
  },
  'tests.register': {
    kind: 'command', context: 'workspace', description: 'Register test definitions',
    params: { tests: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), module: z.string().optional(), runners: z.array(z.object({ runnerId: z.string(), name: z.string(), description: z.string().optional() })) })).describe('Test definitions to register') },
  },
  'tests.list':     { kind: 'query',   context: 'workspace', description: 'List available tests' },
  'tests.results': {
    kind: 'query', context: 'workspace', description: 'Get test results',
    params: { runId: z.string().optional().describe('Filter to a specific run (omit for latest)') },
  },
  'tests.runners':  { kind: 'query',   context: 'workspace', description: 'List available test runners' },
};
