import type { Diagnostic } from '@antimatter/project-model';
import * as path from 'node:path';

/**
 * Parse diagnostics from tool output.
 *
 * Attempts to extract structured diagnostics from various output formats:
 * 1. JSON format (ESLint, TSC with --json)
 * 2. TypeScript format: `file.ts(10,5): error TS2345: message`
 * 3. Generic format: `file.ts:10:5 - error: message`
 *
 * @param output - Tool output text
 * @param workspaceRoot - Workspace root to make paths relative
 * @returns Array of parsed diagnostics
 */
export function parseDiagnostics(
  output: string,
  workspaceRoot: string,
): Diagnostic[] {
  if (!output || output.trim().length === 0) {
    return [];
  }

  // Try parsing as JSON first
  const jsonDiagnostics = tryParseJson(output, workspaceRoot);
  if (jsonDiagnostics.length > 0) {
    return jsonDiagnostics;
  }

  // Fall back to regex-based parsing
  return parseWithRegex(output, workspaceRoot);
}

/**
 * Try to parse output as JSON (ESLint, TSC --json).
 */
function tryParseJson(
  output: string,
  workspaceRoot: string,
): Diagnostic[] {
  try {
    const data = JSON.parse(output);

    // ESLint format: array of file results
    if (Array.isArray(data)) {
      const diagnostics: Diagnostic[] = [];

      for (const fileResult of data) {
        if (fileResult.messages && Array.isArray(fileResult.messages)) {
          for (const msg of fileResult.messages) {
            diagnostics.push({
              file: makeRelative(fileResult.filePath || '', workspaceRoot),
              line: msg.line || 0,
              column: msg.column || 0,
              severity: mapSeverity(msg.severity),
              message: msg.message || '',
              code: msg.ruleId || undefined,
            });
          }
        }
      }

      return diagnostics;
    }

    // TypeScript --json format: { diagnostics: [...] }
    if (data.diagnostics && Array.isArray(data.diagnostics)) {
      const diagnostics: Diagnostic[] = [];

      for (const diag of data.diagnostics) {
        const file = diag.file?.fileName || '';

        diagnostics.push({
          file: makeRelative(file, workspaceRoot),
          line: diag.line || 0,
          column: diag.column || 0,
          severity: 'error',
          message: diag.messageText || '',
          code: diag.code ? `TS${diag.code}` : undefined,
        });
      }

      return diagnostics;
    }
  } catch {
    // Not valid JSON, continue to regex parsing
  }

  return [];
}

/**
 * Parse output using regex patterns for common formats.
 */
function parseWithRegex(
  output: string,
  workspaceRoot: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // TypeScript format: file.ts(10,5): error TS2345: message
    const tsMatch = line.match(
      /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(\w+):\s+(.+)$/,
    );
    if (tsMatch) {
      diagnostics.push({
        file: makeRelative(tsMatch[1], workspaceRoot),
        line: parseInt(tsMatch[2], 10),
        column: parseInt(tsMatch[3], 10),
        severity: mapSeverity(tsMatch[4]),
        message: tsMatch[6],
        code: tsMatch[5],
      });
      continue;
    }

    // Generic format: file.ts:10:5 - error: message
    const genericMatch = line.match(
      /^(.+?):(\d+):(\d+)\s*-\s*(error|warning|info):\s*(.+)$/,
    );
    if (genericMatch) {
      diagnostics.push({
        file: makeRelative(genericMatch[1], workspaceRoot),
        line: parseInt(genericMatch[2], 10),
        column: parseInt(genericMatch[3], 10),
        severity: mapSeverity(genericMatch[4]),
        message: genericMatch[5],
      });
      continue;
    }

    // Simpler format: file.ts:10:5: error: message
    const simpleMatch = line.match(
      /^(.+?):(\d+):(\d+):\s*(error|warning|info):\s*(.+)$/,
    );
    if (simpleMatch) {
      diagnostics.push({
        file: makeRelative(simpleMatch[1], workspaceRoot),
        line: parseInt(simpleMatch[2], 10),
        column: parseInt(simpleMatch[3], 10),
        severity: mapSeverity(simpleMatch[4]),
        message: simpleMatch[5],
      });
      continue;
    }
  }

  return diagnostics;
}

/**
 * Map various severity values to standard format.
 */
function mapSeverity(
  severity: string | number | undefined,
): 'error' | 'warning' | 'info' {
  if (typeof severity === 'number') {
    // ESLint: 1 = warning, 2 = error
    return severity === 2 ? 'error' : 'warning';
  }

  if (severity === undefined || severity === null) {
    return 'warning'; // Default to warning when severity is missing
  }

  const lower = String(severity).toLowerCase();
  if (lower.includes('error') || lower === 'err') {
    return 'error';
  }
  if (lower.includes('warn')) {
    return 'warning';
  }
  if (lower.includes('info')) {
    return 'info';
  }
  return 'warning'; // Default to warning for unknown severities
}

/**
 * Make file path relative to workspace root.
 */
function makeRelative(filePath: string, workspaceRoot: string): string {
  if (!filePath) {
    return '';
  }

  // If path is already relative, return as-is
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  // Make it relative to workspace root
  const relative = path.relative(workspaceRoot, filePath);

  // Normalize to forward slashes
  return relative.replace(/\\/g, '/');
}
