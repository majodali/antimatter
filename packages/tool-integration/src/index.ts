import type { ToolOutput } from '@antimatter/project-model';
import { SubprocessRunner } from './subprocess-runner.js';
import type { RunToolOptions } from './types.js';

// Types
export type { ParameterValues, RunToolOptions, ToolRunner } from './types.js';

// Errors
export { ToolExecutionError, ParameterError } from './types.js';

// Parameter substitution functions
export { validateParameters, substituteParameters } from './parameter-substitution.js';

// Environment management functions
export { mergeEnvironment, sanitizeEnvironment } from './environment.js';

// Runner implementations
export { SubprocessRunner } from './subprocess-runner.js';
export {
  MockRunner,
  type CommandPattern,
  type MockResponse,
  type ExecutedCommand,
} from './mock-runner.js';

// Convenience function using default SubprocessRunner
let defaultRunner: SubprocessRunner | undefined;

/**
 * Execute a tool using the default SubprocessRunner instance.
 * This is a convenience function for simple use cases.
 *
 * @example
 * ```typescript
 * import { runTool } from '@antimatter/tool-integration';
 * import type { ToolConfig } from '@antimatter/project-model';
 *
 * const eslintTool: ToolConfig = {
 *   id: 'eslint',
 *   name: 'ESLint',
 *   command: 'eslint {{files}} --fix={{fix}}',
 *   parameters: [
 *     { name: 'files', type: 'array', required: true },
 *     { name: 'fix', type: 'boolean', required: false, defaultValue: false },
 *   ],
 * };
 *
 * const result = await runTool({
 *   tool: eslintTool,
 *   parameters: { files: ['src/**\/*.ts'], fix: true },
 *   cwd: '/workspace',
 * });
 *
 * console.log(result.exitCode, result.stdout);
 * ```
 */
export async function runTool(options: RunToolOptions): Promise<ToolOutput> {
  if (!defaultRunner) {
    defaultRunner = new SubprocessRunner();
  }
  return defaultRunner.run(options);
}
