import type { Identifier, Status, Timestamp, Diagnostic } from './common.js';

/** Status specific to test execution. */
export type TestStatus = Status;

/** A collection of related test cases (e.g. one test file). */
export interface TestSuite {
  readonly id: Identifier;
  readonly name: string;
  /** Module this suite belongs to. */
  readonly moduleId: Identifier;
  /** Workspace-relative path to the test file. */
  readonly filePath: string;
  readonly cases: readonly TestCase[];
}

/** A single test within a suite. */
export interface TestCase {
  readonly id: Identifier;
  readonly name: string;
  readonly suiteId: Identifier;
}

/** The result of executing a test suite. */
export interface TestResult {
  readonly suiteId: Identifier;
  readonly status: TestStatus;
  readonly startedAt: Timestamp;
  readonly finishedAt?: Timestamp;
  readonly durationMs?: number;
  readonly caseResults: readonly TestCaseResult[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The result of a single test case. */
export interface TestCaseResult {
  readonly caseId: Identifier;
  readonly status: TestStatus;
  readonly durationMs?: number;
  /** Failure / assertion message, if any. */
  readonly message?: string;
}
