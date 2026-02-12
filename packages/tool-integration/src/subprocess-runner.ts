import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { ToolOutput } from '@antimatter/project-model';
import type { ToolRunner, RunToolOptions } from './types.js';
import { ToolExecutionError } from './types.js';
import { validateParameters, substituteParameters } from './parameter-substitution.js';
import { mergeEnvironment } from './environment.js';

/**
 * Default timeout for command execution (30 seconds).
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Production implementation of ToolRunner using Node.js child_process.
 * Executes commands as subprocesses with timeout handling and output buffering.
 */
export class SubprocessRunner implements ToolRunner {
  /**
   * Execute a tool as a subprocess.
   *
   * @throws {ParameterError} If parameter validation fails
   * @throws {ToolExecutionError} If execution fails (timeout, spawn error, signal)
   * @returns {Promise<ToolOutput>} Structured output (non-zero exit codes are NOT errors)
   */
  async run(options: RunToolOptions): Promise<ToolOutput> {
    // Validate and substitute parameters
    const validatedParams = validateParameters(options.tool, options.parameters);
    const command = substituteParameters(options.tool.command, validatedParams);

    // Merge environment variables
    const env = mergeEnvironment(options.tool, options);

    // Determine timeout
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

    // Execute command
    return this.executeCommand(command, options.cwd, env, timeout);
  }

  /**
   * Execute a command as a subprocess.
   */
  private async executeCommand(
    command: string,
    cwd: string,
    env: Record<string, string>,
    timeout: number
  ): Promise<ToolOutput> {
    return new Promise((resolve, reject) => {
      // Determine shell based on platform
      const isWindows = platform() === 'win32';
      const shell = isWindows ? 'cmd' : 'sh';
      const shellFlag = isWindows ? '/c' : '-c';

      // Spawn subprocess
      const child = spawn(shell, [shellFlag, command], {
        cwd,
        env,
        shell: false, // We're explicitly using shell command
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | undefined;
      let completed = false;

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!completed) {
            completed = true;
            child.kill('SIGTERM');
            // Give process a moment to cleanup, then force kill
            setTimeout(() => child.kill('SIGKILL'), 1000);
            reject(
              new ToolExecutionError(
                `Command timed out after ${timeout}ms`,
                command,
                'timeout'
              )
            );
          }
        }, timeout);
      }

      // Collect stdout
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Collect stderr
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process exit
      child.on('close', (code, signal) => {
        if (completed) return;
        completed = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // If process was killed by signal (and not our timeout), treat as error
        if (signal && signal !== 'SIGTERM') {
          reject(
            new ToolExecutionError(
              `Command terminated by signal: ${signal}`,
              command,
              'signal',
              signal
            )
          );
          return;
        }

        // Parse output data if it looks like JSON
        const data = this.tryParseJson(stdout);

        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          data,
        });
      });

      // Handle spawn errors
      child.on('error', (error: Error) => {
        if (completed) return;
        completed = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        reject(
          new ToolExecutionError(
            `Failed to spawn command: ${error.message}`,
            command,
            'spawn-error',
            error.message
          )
        );
      });
    });
  }

  /**
   * Attempt to parse stdout as JSON if it looks like JSON.
   * Returns undefined if parsing fails.
   */
  private tryParseJson(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return undefined;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
}
