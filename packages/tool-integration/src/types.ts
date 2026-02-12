import type { ToolConfig, ToolOutput } from '@antimatter/project-model';

/**
 * Runtime parameter values provided when executing a tool.
 * Keys correspond to parameter names defined in ToolConfig.
 */
export type ParameterValues = Record<string, unknown>;

/**
 * Options for executing a tool.
 */
export interface RunToolOptions {
  /** The tool configuration to execute. */
  readonly tool: ToolConfig;
  /** Runtime parameter values for template substitution. */
  readonly parameters: ParameterValues;
  /** Working directory for command execution. */
  readonly cwd: string;
  /** Additional environment variables (merged with tool.env and process.env). */
  readonly env?: Readonly<Record<string, string>>;
  /** Execution timeout in milliseconds (default: 30000). */
  readonly timeout?: number;
}

/**
 * Interface for tool execution implementations.
 * Supports both production (SubprocessRunner) and testing (MockRunner) implementations.
 */
export interface ToolRunner {
  /**
   * Execute a tool with the given options.
   * @throws {ParameterError} If parameter validation fails
   * @throws {ToolExecutionError} If execution fails (timeout, spawn error, signal)
   * @returns {Promise<ToolOutput>} Structured output (non-zero exit codes are NOT errors)
   */
  run(options: RunToolOptions): Promise<ToolOutput>;
}

/**
 * Error thrown when tool execution fails.
 * Non-zero exit codes are NOT considered execution errors - they're valid ToolOutput.
 */
export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly reason: 'timeout' | 'spawn-error' | 'signal',
    public readonly details?: string
  ) {
    super(message);
    this.name = 'ToolExecutionError';
    Object.setPrototypeOf(this, ToolExecutionError.prototype);
  }
}

/**
 * Error thrown when parameter validation or substitution fails.
 */
export class ParameterError extends Error {
  constructor(
    message: string,
    public readonly parameterName: string,
    public readonly reason: 'missing-required' | 'invalid-type' | 'substitution-failed'
  ) {
    super(message);
    this.name = 'ParameterError';
    Object.setPrototypeOf(this, ParameterError.prototype);
  }
}
