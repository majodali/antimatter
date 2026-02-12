import type { ToolOutput } from '@antimatter/project-model';
import type { ToolRunner, RunToolOptions } from './types.js';
import { validateParameters, substituteParameters } from './parameter-substitution.js';

/**
 * Pattern for matching commands, can be string or RegExp.
 */
export type CommandPattern = string | RegExp;

/**
 * Mock response to return for a matched command.
 */
export interface MockResponse {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly data?: unknown;
}

/**
 * Record of an executed command.
 */
export interface ExecutedCommand {
  readonly command: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly timestamp: number;
}

/**
 * Mock implementation of ToolRunner for testing purposes.
 * Records all executed commands and returns registered mock responses.
 */
export class MockRunner implements ToolRunner {
  private mocks = new Map<string | RegExp, MockResponse>();
  private executedCommands: ExecutedCommand[] = [];

  /**
   * Register a mock response for commands matching the pattern.
   * Later registrations override earlier ones for the same pattern.
   */
  registerMock(pattern: CommandPattern, response: MockResponse): void {
    this.mocks.set(pattern, response);
  }

  /**
   * Get history of all executed commands.
   */
  getExecutedCommands(): readonly ExecutedCommand[] {
    return [...this.executedCommands];
  }

  /**
   * Clear command execution history.
   */
  clearHistory(): void {
    this.executedCommands = [];
  }

  /**
   * Clear all registered mocks.
   */
  clearMocks(): void {
    this.mocks.clear();
  }

  /**
   * Execute a tool (mock implementation).
   * - Validates and substitutes parameters (tests the logic)
   * - Records the command in history
   * - Returns registered mock response or default success
   */
  async run(options: RunToolOptions): Promise<ToolOutput> {
    // Validate parameters (throws if invalid)
    const validatedParams = validateParameters(options.tool, options.parameters);

    // Substitute parameters in command
    const command = substituteParameters(options.tool.command, validatedParams);

    // Build environment (simplified for mock)
    const env: Record<string, string> = {};
    if (options.tool.env) {
      Object.assign(env, options.tool.env);
    }
    if (options.env) {
      Object.assign(env, options.env);
    }

    // Record command execution
    this.executedCommands.push({
      command,
      cwd: options.cwd,
      env,
      timestamp: Date.now(),
    });

    // Find matching mock response
    for (const [pattern, response] of this.mocks.entries()) {
      if (this.matches(command, pattern)) {
        return response;
      }
    }

    // Default success response
    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
    };
  }

  /**
   * Check if a command matches a pattern.
   */
  private matches(command: string, pattern: CommandPattern): boolean {
    if (typeof pattern === 'string') {
      return command === pattern || command.includes(pattern);
    }
    return pattern.test(command);
  }
}
