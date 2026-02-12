import { describe, it, expect } from 'vitest';
import { parseDiagnostics } from '../diagnostic-parser.js';

describe('parseDiagnostics', () => {
  describe('TypeScript format', () => {
    it('should parse TypeScript error format', () => {
      const output = `src/index.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toEqual({
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
        code: 'TS2345',
      });
    });

    it('should parse TypeScript warning format', () => {
      const output = `src/utils.ts(5,1): warning TS6133: 'x' is declared but its value is never read.`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe('warning');
      expect(diagnostics[0].code).toBe('TS6133');
    });

    it('should parse multiple TypeScript errors', () => {
      const output = `src/index.ts(10,5): error TS2345: Type error.
src/utils.ts(20,3): error TS2322: Another error.
src/lib.ts(30,1): warning TS6133: Warning message.`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(3);
      expect(diagnostics[0].file).toBe('src/index.ts');
      expect(diagnostics[1].file).toBe('src/utils.ts');
      expect(diagnostics[2].file).toBe('src/lib.ts');
    });
  });

  describe('generic format', () => {
    it('should parse generic error format with dash', () => {
      const output = `src/index.ts:10:5 - error: Expected semicolon`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toEqual({
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        message: 'Expected semicolon',
      });
    });

    it('should parse generic format with colon separator', () => {
      const output = `src/index.ts:10:5: error: Expected semicolon`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toEqual({
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        message: 'Expected semicolon',
      });
    });

    it('should parse generic warning format', () => {
      const output = `src/utils.ts:15:10 - warning: Unused variable`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe('warning');
    });

    it('should parse generic info format', () => {
      const output = `src/lib.ts:5:1 - info: Compilation info`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe('info');
    });
  });

  describe('JSON format', () => {
    it('should parse ESLint JSON format', () => {
      const output = JSON.stringify([
        {
          filePath: '/workspace/src/index.ts',
          messages: [
            {
              line: 10,
              column: 5,
              severity: 2,
              message: 'Missing semicolon',
              ruleId: 'semi',
            },
            {
              line: 15,
              column: 3,
              severity: 1,
              message: 'Prefer const',
              ruleId: 'prefer-const',
            },
          ],
        },
      ]);

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]).toEqual({
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        message: 'Missing semicolon',
        code: 'semi',
      });
      expect(diagnostics[1]).toEqual({
        file: 'src/index.ts',
        line: 15,
        column: 3,
        severity: 'warning',
        message: 'Prefer const',
        code: 'prefer-const',
      });
    });

    it('should handle empty messages array', () => {
      const output = JSON.stringify([
        {
          filePath: '/workspace/src/index.ts',
          messages: [],
        },
      ]);

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(0);
    });

    it('should parse TypeScript JSON format', () => {
      const output = JSON.stringify({
        diagnostics: [
          {
            file: {
              fileName: '/workspace/src/index.ts',
            },
            start: 100,
            line: 10,
            column: 5,
            messageText: 'Type error',
            code: 2345,
          },
        ],
      });

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toEqual({
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        message: 'Type error',
        code: 'TS2345',
      });
    });
  });

  describe('path handling', () => {
    it('should make absolute paths relative to workspace', () => {
      const output = `/workspace/src/index.ts:10:5 - error: Some error`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics[0].file).toBe('src/index.ts');
    });

    it('should handle relative paths', () => {
      const output = `src/index.ts:10:5 - error: Some error`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics[0].file).toBe('src/index.ts');
    });

    it('should normalize Windows path separators', () => {
      const output = `C:\\workspace\\src\\index.ts:10:5 - error: Some error`;

      const diagnostics = parseDiagnostics(output, 'C:\\workspace');

      expect(diagnostics[0].file).toBe('src/index.ts');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty output', () => {
      const diagnostics = parseDiagnostics('', '/workspace');
      expect(diagnostics).toHaveLength(0);
    });

    it('should return empty array for whitespace-only output', () => {
      const diagnostics = parseDiagnostics('   \n  \n  ', '/workspace');
      expect(diagnostics).toHaveLength(0);
    });

    it('should return empty array for unparseable output', () => {
      const output = `This is some random text
that doesn't match any diagnostic format
and should be ignored`;

      const diagnostics = parseDiagnostics(output, '/workspace');
      expect(diagnostics).toHaveLength(0);
    });

    it('should handle mixed valid and invalid lines', () => {
      const output = `Some preamble text
src/index.ts:10:5 - error: Valid error
More random text
src/utils.ts:20:3 - warning: Valid warning
Final summary`;

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0].message).toBe('Valid error');
      expect(diagnostics[1].message).toBe('Valid warning');
    });

    it('should handle invalid JSON gracefully', () => {
      const output = `{ "invalid": json }`;

      const diagnostics = parseDiagnostics(output, '/workspace');
      expect(diagnostics).toHaveLength(0);
    });

    it('should handle JSON with missing fields', () => {
      const output = JSON.stringify([
        {
          filePath: '/workspace/src/index.ts',
          messages: [
            {
              // Missing line, column, severity
              message: 'Some message',
            },
          ],
        },
      ]);

      const diagnostics = parseDiagnostics(output, '/workspace');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].line).toBe(0);
      expect(diagnostics[0].column).toBe(0);
      expect(diagnostics[0].severity).toBe('warning'); // Default for missing severity
    });
  });

  describe('severity mapping', () => {
    it('should map ESLint severity 2 to error', () => {
      const output = JSON.stringify([
        {
          filePath: '/workspace/src/index.ts',
          messages: [{ line: 1, column: 1, severity: 2, message: 'Error' }],
        },
      ]);

      const diagnostics = parseDiagnostics(output, '/workspace');
      expect(diagnostics[0].severity).toBe('error');
    });

    it('should map ESLint severity 1 to warning', () => {
      const output = JSON.stringify([
        {
          filePath: '/workspace/src/index.ts',
          messages: [{ line: 1, column: 1, severity: 1, message: 'Warning' }],
        },
      ]);

      const diagnostics = parseDiagnostics(output, '/workspace');
      expect(diagnostics[0].severity).toBe('warning');
    });

    it('should map string "error" to error', () => {
      const output = `src/index.ts:10:5 - error: Some error`;

      const diagnostics = parseDiagnostics(output, '/workspace');
      expect(diagnostics[0].severity).toBe('error');
    });

    it('should map string "warning" to warning', () => {
      const output = `src/index.ts:10:5 - warning: Some warning`;

      const diagnostics = parseDiagnostics(output, '/workspace');
      expect(diagnostics[0].severity).toBe('warning');
    });

    it('should map string "info" to info', () => {
      const output = `src/index.ts:10:5 - info: Some info`;

      const diagnostics = parseDiagnostics(output, '/workspace');
      expect(diagnostics[0].severity).toBe('info');
    });
  });
});
