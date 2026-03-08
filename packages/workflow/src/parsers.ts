// ============================================================================
// Error Output Parsers — convert tool output into ProjectError[]
//
// Used by:
//  - WorkflowManager when compiling build scripts (esbuild errors)
//  - Build scripts in their rules (e.g. parsing tsc output after wf.exec())
//
// Imports from the same package, so build scripts can do:
//   import { parseTscErrors, parseEsbuildErrors } from '@antimatter/workflow';
// ============================================================================

import { ErrorTypes, type ErrorType, type ProjectError } from './types.js';

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/** Normalize Windows backslashes and strip workspace root prefix. */
function normalizePath(filePath: string, workspaceRoot?: string): string {
  if (!filePath) return '';
  let normalized = filePath.replace(/\\/g, '/');

  if (workspaceRoot) {
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.startsWith(normalizedRoot + '/')) {
      normalized = normalized.slice(normalizedRoot.length + 1);
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// parseTscErrors — TypeScript compiler output
// ---------------------------------------------------------------------------

/**
 * Parse TypeScript compiler text output into ProjectErrors.
 *
 * Handles the standard tsc text format:
 *   `file.ts(10,5): error TS2345: Argument of type 'string' is not assignable...`
 *
 * @param output - Combined stdout + stderr from `tsc --build` or `tsc`
 * @param options - Optional workspace root for path normalization
 */
export function parseTscErrors(
  output: string,
  options?: { workspaceRoot?: string },
): ProjectError[] {
  if (!output || output.trim().length === 0) return [];

  const errors: ProjectError[] = [];
  const lines = output.split('\n');

  // TypeScript format: file.ts(10,5): error TS2345: message
  const tsRegex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(tsRegex);
    if (!match) continue;

    const [, file, lineStr, colStr, severity, code, message] = match;
    const errorType = severity === 'error' ? ErrorTypes.TypeError : ErrorTypes.Warning;

    errors.push({
      errorType,
      toolId: 'tsc',
      file: normalizePath(file, options?.workspaceRoot),
      message,
      detail: `<code>${code}</code>`,
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// parseEsbuildErrors — esbuild BuildResult
// ---------------------------------------------------------------------------

/** Minimal esbuild message shape (avoids importing esbuild types). */
interface EsbuildMessage {
  text: string;
  location?: {
    file: string;
    line: number;
    column: number;
    length?: number;
    lineText?: string;
  } | null;
}

/**
 * Parse esbuild build result errors and warnings into ProjectErrors.
 *
 * Uses esbuild's structured location info (file, line, column, length)
 * for precise error positioning.
 *
 * @param result - The esbuild BuildResult (or BuildFailure) object
 */
export function parseEsbuildErrors(result: {
  errors?: EsbuildMessage[];
  warnings?: EsbuildMessage[];
}): ProjectError[] {
  const errors: ProjectError[] = [];

  for (const msg of result.errors ?? []) {
    errors.push(esbuildMessageToError(msg, ErrorTypes.SyntaxError));
  }

  for (const msg of result.warnings ?? []) {
    errors.push(esbuildMessageToError(msg, ErrorTypes.Warning));
  }

  return errors;
}

function esbuildMessageToError(msg: EsbuildMessage, errorType: ErrorType): ProjectError {
  const loc = msg.location;
  const detail = loc?.lineText
    ? `<pre>${escapeHtml(loc.lineText)}</pre>`
    : undefined;

  return {
    errorType,
    toolId: 'esbuild',
    file: loc?.file ? normalizePath(loc.file) : '<unknown>',
    message: msg.text,
    detail,
    line: loc?.line,
    column: loc ? loc.column + 1 : undefined, // esbuild columns are 0-based
    endLine: loc?.line,
    endColumn: loc && loc.length ? loc.column + 1 + loc.length : undefined,
  };
}

// ---------------------------------------------------------------------------
// parseToolOutput — generic file:line:col output
// ---------------------------------------------------------------------------

/**
 * Generic parser for tools that emit `file:line:col: severity: message` format.
 *
 * Handles three common line formats:
 * - `file.ts(10,5): error TS2345: message` (tsc-style)
 * - `file.ts:10:5 - error: message` (generic with dash)
 * - `file.ts:10:5: error: message` (generic with colon)
 *
 * @param output - Combined stdout + stderr
 * @param toolId - Tool identifier (e.g. 'eslint', 'gcc')
 * @param options - Optional workspace root and default error type
 */
export function parseToolOutput(
  output: string,
  toolId: string,
  options?: {
    workspaceRoot?: string;
    defaultErrorType?: ErrorType;
  },
): ProjectError[] {
  if (!output || output.trim().length === 0) return [];

  const errors: ProjectError[] = [];
  const lines = output.split('\n');
  const defaultType = options?.defaultErrorType ?? ErrorTypes.SyntaxError;

  // Pattern 1: file.ts(10,5): error TS2345: message
  const tsRegex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(\w+):\s+(.+)$/;
  // Pattern 2: file.ts:10:5 - error: message
  const dashRegex = /^(.+?):(\d+):(\d+)\s*-\s*(error|warning|info):\s*(.+)$/;
  // Pattern 3: file.ts:10:5: error: message
  const colonRegex = /^(.+?):(\d+):(\d+):\s*(error|warning|info):\s*(.+)$/;

  for (const line of lines) {
    let match: RegExpMatchArray | null;

    // Try TypeScript format first
    match = line.match(tsRegex);
    if (match) {
      const [, file, lineStr, colStr, severity, code, message] = match;
      errors.push({
        errorType: mapSeverityToErrorType(severity, defaultType),
        toolId,
        file: normalizePath(file, options?.workspaceRoot),
        message,
        detail: `<code>${code}</code>`,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
      });
      continue;
    }

    // Try dash format
    match = line.match(dashRegex);
    if (match) {
      const [, file, lineStr, colStr, severity, message] = match;
      errors.push({
        errorType: mapSeverityToErrorType(severity, defaultType),
        toolId,
        file: normalizePath(file, options?.workspaceRoot),
        message,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
      });
      continue;
    }

    // Try colon format
    match = line.match(colonRegex);
    if (match) {
      const [, file, lineStr, colStr, severity, message] = match;
      errors.push({
        errorType: mapSeverityToErrorType(severity, defaultType),
        toolId,
        file: normalizePath(file, options?.workspaceRoot),
        message,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
      });
      continue;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSeverityToErrorType(severity: string, defaultType: ErrorType): ErrorType {
  switch (severity.toLowerCase()) {
    case 'error': return ErrorTypes.SyntaxError;
    case 'warning': return ErrorTypes.Warning;
    case 'info': return ErrorTypes.Info;
    default: return defaultType;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
