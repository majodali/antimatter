import type { Identifier } from './common.js';

/** How a single parameter is described for a tool. */
export interface ToolParameter {
  readonly name: string;
  readonly description?: string;
  readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  readonly required: boolean;
  readonly defaultValue?: unknown;
}

/** Structured output returned by a tool invocation. */
export interface ToolOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Optional structured payload (e.g. JSON result). */
  readonly data?: unknown;
}

/** Configuration for an external tool that can be invoked. */
export interface ToolConfig {
  readonly id: Identifier;
  /** Display name (e.g. "ESLint", "tsc", "docker"). */
  readonly name: string;
  /** Shell command template (may contain {{param}} placeholders). */
  readonly command: string;
  readonly parameters: readonly ToolParameter[];
  /** Working directory override (workspace-relative). */
  readonly cwd?: string;
  /** Environment variable overrides. */
  readonly env?: Readonly<Record<string, string>>;
}
