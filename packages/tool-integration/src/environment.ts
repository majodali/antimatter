import type { ToolConfig } from '@antimatter/project-model';
import type { RunToolOptions } from './types.js';

/**
 * Merges environment variables with the following precedence (lowest to highest):
 * 1. process.env (base environment)
 * 2. tool.env (tool-level overrides)
 * 3. options.env (runtime overrides)
 *
 * @returns {Record<string, string>} Merged environment variables
 */
export function mergeEnvironment(
  tool: ToolConfig,
  options: RunToolOptions
): Record<string, string> {
  const merged: Record<string, string> = {};

  // Start with process environment
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Apply tool-level environment
  if (tool.env) {
    for (const [key, value] of Object.entries(tool.env)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }

  // Apply runtime environment (highest precedence)
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }

  return sanitizeEnvironment(merged);
}

/**
 * Removes undefined and null values from environment variables.
 * Only string values are valid for environment variables.
 *
 * @returns {Record<string, string>} Sanitized environment variables
 */
export function sanitizeEnvironment(
  env: Record<string, unknown>
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== null && typeof value === 'string') {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
