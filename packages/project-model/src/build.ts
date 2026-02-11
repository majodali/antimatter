import type { Identifier, Status, Timestamp, Diagnostic } from './common.js';

/** A declarative rule describing how to produce build outputs. */
export interface BuildRule {
  readonly id: Identifier;
  /** Human-readable name (e.g. "compile-ts", "bundle-css"). */
  readonly name: string;
  /** Glob patterns for input files that trigger this rule. */
  readonly inputs: readonly string[];
  /** Glob patterns / paths this rule produces. */
  readonly outputs: readonly string[];
  /** Shell command or tool reference to execute. */
  readonly command: string;
  /** Optional dependencies on other rules (by id). */
  readonly dependsOn?: readonly Identifier[];
}

/** A concrete target that can be executed (bound rule + config). */
export interface BuildTarget {
  readonly id: Identifier;
  readonly ruleId: Identifier;
  /** Module this target belongs to. */
  readonly moduleId: Identifier;
  /** Extra environment variables passed to the command. */
  readonly env?: Readonly<Record<string, string>>;
}

/** The outcome of running a single build target. */
export interface BuildResult {
  readonly targetId: Identifier;
  readonly status: BuildStatus;
  readonly startedAt: Timestamp;
  readonly finishedAt?: Timestamp;
  readonly diagnostics: readonly Diagnostic[];
  /** Wall-clock duration in milliseconds. */
  readonly durationMs?: number;
}

/** Build-specific status (extends the general Status). */
export type BuildStatus = Status | 'cached';
