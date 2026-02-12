import type { ToolConfig, ToolParameter } from '@antimatter/project-model';
import { ParameterError, type ParameterValues } from './types.js';

/**
 * Validates runtime parameter values against tool configuration.
 * - Checks required parameters are provided
 * - Validates parameter types
 * - Applies default values for missing optional parameters
 *
 * @throws {ParameterError} If validation fails
 * @returns {ParameterValues} Validated parameters with defaults applied
 */
export function validateParameters(
  tool: ToolConfig,
  parameters: ParameterValues
): ParameterValues {
  const validated: ParameterValues = { ...parameters };

  for (const param of tool.parameters) {
    const value = validated[param.name];

    // Check required parameters
    if (param.required && (value === undefined || value === null)) {
      throw new ParameterError(
        `Required parameter '${param.name}' is missing`,
        param.name,
        'missing-required'
      );
    }

    // Apply default value if parameter is missing
    if (value === undefined && param.defaultValue !== undefined) {
      validated[param.name] = param.defaultValue;
      continue;
    }

    // Skip validation if parameter is optional and not provided
    if (value === undefined || value === null) {
      continue;
    }

    // Validate type
    if (!isValidType(value, param)) {
      throw new ParameterError(
        `Parameter '${param.name}' has invalid type. Expected ${param.type}, got ${typeof value}`,
        param.name,
        'invalid-type'
      );
    }
  }

  return validated;
}

/**
 * Validates that a value matches the expected parameter type.
 */
function isValidType(value: unknown, param: ToolParameter): boolean {
  switch (param.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

/**
 * Substitutes {{param}} placeholders in command template with validated parameter values.
 * - Supports nested object access: {{config.port}}
 * - Arrays are serialized as space-separated values: [1, 2, 3] → "1 2 3"
 * - Objects are serialized as JSON strings
 * - Strings with spaces/special chars are shell-escaped with quotes
 *
 * @throws {ParameterError} If substitution fails (e.g., nested path not found)
 * @returns {string} Command with all placeholders replaced
 */
export function substituteParameters(
  command: string,
  parameters: ParameterValues
): string {
  // Match {{param}} or {{nested.path}}
  const placeholderRegex = /\{\{([^}]+)\}\}/g;

  return command.replace(placeholderRegex, (match, path: string) => {
    const trimmedPath = path.trim();
    const value = resolveNestedPath(parameters, trimmedPath);

    // If value is undefined, keep the placeholder (for optional params)
    if (value === undefined) {
      return match;
    }

    return serializeValue(value);
  });
}

/**
 * Resolves a potentially nested path in the parameters object.
 * Example: "config.port" → parameters.config.port
 */
function resolveNestedPath(obj: ParameterValues, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Serializes a parameter value for command-line usage.
 * - Strings: Escape and quote if needed
 * - Numbers/booleans: Convert to string
 * - Arrays: Space-separated values
 * - Objects: JSON string
 */
function serializeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return escapeShellString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item)).join(' ');
  }

  if (typeof value === 'object') {
    return escapeShellString(JSON.stringify(value));
  }

  return String(value);
}

/**
 * Escapes a string for safe shell usage.
 * - Quotes strings containing spaces or special characters
 * - Escapes quotes and backslashes within the string
 */
function escapeShellString(str: string): string {
  // If string contains no special characters, return as-is
  if (!/[\s"'\\$`!*?[\](){};<>|&~#]/.test(str)) {
    return str;
  }

  // Escape backslashes and double quotes, then wrap in quotes
  const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}
