/** General-purpose status for async operations. */
export type Status = 'pending' | 'running' | 'success' | 'failure' | 'skipped';

/** Severity levels for diagnostics and log messages. */
export type Severity = 'error' | 'warning' | 'info' | 'debug';

/** A diagnostic message attached to a file location. */
export interface Diagnostic {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly severity: Severity;
  readonly message: string;
  readonly code?: string;
}

/** ISO-8601 timestamp string. */
export type Timestamp = string;

/** Content-addressable hash (e.g. SHA-256 hex). */
export type Hash = string;

/** Unique identifier string (e.g. UUID). */
export type Identifier = string;
