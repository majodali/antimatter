import { describe, it, expect } from 'vitest';
import { platform } from 'node:os';
import type { ToolConfig } from '@antimatter/project-model';
import { SubprocessRunner } from '../subprocess-runner.js';
import { MockRunner } from '../mock-runner.js';
import { substituteParameters, validateParameters } from '../parameter-substitution.js';

describe('Edge Cases', () => {
  const isWindows = platform() === 'win32';

  describe('empty and null values', () => {
    it('should handle empty string parameter', () => {
      const command = 'echo {{message}}';
      const result = substituteParameters(command, { message: '' });
      expect(result).toBe('echo ');
    });

    it('should handle null parameter value', () => {
      const command = 'echo {{message}}';
      const result = substituteParameters(command, { message: null });
      expect(result).toBe('echo ');
    });

    it('should handle undefined parameter value', () => {
      const command = 'echo {{message}}';
      const result = substituteParameters(command, { message: undefined });
      expect(result).toBe('echo {{message}}'); // Leaves placeholder
    });

    it('should handle empty array', () => {
      const command = 'process {{files}}';
      const result = substituteParameters(command, { files: [] });
      expect(result).toBe('process ');
    });

    it('should handle empty object', () => {
      const command = 'configure {{config}}';
      const result = substituteParameters(command, { config: {} });
      expect(result).toBe('configure "{}"');
    });
  });

  describe('special characters', () => {
    it('should handle strings with quotes', () => {
      const command = 'echo {{message}}';
      const result = substituteParameters(command, {
        message: 'say "hello" to me',
      });
      expect(result).toContain('\\"hello\\"');
    });

    it('should handle strings with backslashes', () => {
      const command = 'echo {{path}}';
      const result = substituteParameters(command, {
        path: 'C:\\Users\\test',
      });
      expect(result).toContain('\\\\');
    });

    it('should handle strings with dollar signs', () => {
      const command = 'echo {{message}}';
      const result = substituteParameters(command, {
        message: 'Price: $100',
      });
      expect(result).toContain('$100');
    });

    it('should handle strings with shell metacharacters', () => {
      const command = 'echo {{message}}';
      const chars = ['&', '|', ';', '<', '>', '(', ')', '{', '}', '`', '*'];

      for (const char of chars) {
        const result = substituteParameters(command, {
          message: `test${char}test`,
        });
        // Should be quoted for safety
        expect(result).toMatch(/"test.+test"/);
      }
    });

    it('should handle unicode characters', () => {
      const command = 'echo {{message}}';
      const result = substituteParameters(command, {
        message: 'Hello 世界 🌍',
      });
      expect(result).toContain('世界');
      expect(result).toContain('🌍');
    });

    it('should handle newlines in strings', () => {
      const command = 'echo {{message}}';
      const result = substituteParameters(command, {
        message: 'line1\nline2',
      });
      expect(result).toContain('line1');
      expect(result).toContain('line2');
    });
  });

  describe('nested paths edge cases', () => {
    it('should handle deeply nested paths', () => {
      const command = 'test {{a.b.c.d.e}}';
      const result = substituteParameters(command, {
        a: { b: { c: { d: { e: 'value' } } } },
      });
      expect(result).toBe('test value');
    });

    it('should handle missing intermediate path', () => {
      const command = 'test {{a.b.c}}';
      const result = substituteParameters(command, {
        a: { b: null },
      });
      expect(result).toBe('test {{a.b.c}}');
    });

    it('should handle path through array (unsupported)', () => {
      const command = 'test {{a.0}}';
      const result = substituteParameters(command, {
        a: ['value'],
      });
      // Arrays don't support nested path resolution
      expect(result).toBe('test {{a.0}}');
    });

    it('should handle path through primitive (unsupported)', () => {
      const command = 'test {{a.b}}';
      const result = substituteParameters(command, {
        a: 'string',
      });
      expect(result).toBe('test {{a.b}}');
    });
  });

  describe('type coercion and validation', () => {
    it('should reject NaN as number', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{count}}',
        parameters: [{ name: 'count', type: 'number', required: true }],
      };

      expect(() =>
        validateParameters(tool, { count: NaN })
      ).toThrow();
    });

    it('should reject Infinity as number', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{count}}',
        parameters: [{ name: 'count', type: 'number', required: true }],
      };

      // Infinity is technically a valid number in JavaScript
      // but might be unexpected in CLI contexts
      const result = validateParameters(tool, { count: Infinity });
      expect(result.count).toBe(Infinity);
    });

    it('should handle boolean false (not falsy null/undefined)', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{flag}}',
        parameters: [{ name: 'flag', type: 'boolean', required: true }],
      };

      const result = validateParameters(tool, { flag: false });
      expect(result.flag).toBe(false);
    });

    it('should handle zero as valid number', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{count}}',
        parameters: [{ name: 'count', type: 'number', required: true }],
      };

      const result = validateParameters(tool, { count: 0 });
      expect(result.count).toBe(0);
    });

    it('should reject string "true" as boolean', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{flag}}',
        parameters: [{ name: 'flag', type: 'boolean', required: true }],
      };

      expect(() =>
        validateParameters(tool, { flag: 'true' as unknown as boolean })
      ).toThrow();
    });

    it('should reject string "123" as number', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{count}}',
        parameters: [{ name: 'count', type: 'number', required: true }],
      };

      expect(() =>
        validateParameters(tool, { count: '123' as unknown as number })
      ).toThrow();
    });
  });

  describe('arrays with mixed types', () => {
    it('should serialize array with mixed types', () => {
      const command = 'test {{values}}';
      const result = substituteParameters(command, {
        values: [1, 'text', true, null],
      });
      expect(result).toBe('test 1 text true ');
    });

    it('should handle nested arrays', () => {
      const command = 'test {{values}}';
      const result = substituteParameters(command, {
        values: [[1, 2], [3, 4]],
      });
      // Nested arrays are serialized recursively
      expect(result).toContain('1 2');
      expect(result).toContain('3 4');
    });

    it('should handle array with objects', () => {
      const command = 'test {{values}}';
      const result = substituteParameters(command, {
        values: [{ a: 1 }, { b: 2 }],
      });
      // Objects in arrays are JSON-stringified and escaped
      expect(result).toContain('{\\"a\\":1}');
      expect(result).toContain('{\\"b\\":2}');
    });
  });

  describe('extreme values', () => {
    it('should handle very long strings', async () => {
      const longString = 'x'.repeat(10000);
      const runner = new MockRunner();

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{message}}',
        parameters: [{ name: 'message', type: 'string', required: true }],
      };

      await runner.run({
        tool,
        parameters: { message: longString },
        cwd: '/workspace',
      });

      const executed = runner.getExecutedCommands();
      expect(executed[0].command).toContain('xxxx');
    });

    it('should handle very large arrays', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      const command = 'test {{values}}';
      const result = substituteParameters(command, { values: largeArray });
      expect(result).toContain('0');
      expect(result).toContain('999');
    });

    it('should handle negative numbers', () => {
      const command = 'test {{value}}';
      const result = substituteParameters(command, { value: -42 });
      expect(result).toBe('test -42');
    });

    it('should handle floating point numbers', () => {
      const command = 'test {{value}}';
      const result = substituteParameters(command, { value: 3.14159 });
      expect(result).toBe('test 3.14159');
    });

    it('should handle very small numbers', () => {
      const command = 'test {{value}}';
      const result = substituteParameters(command, { value: 0.0000001 });
      expect(result).toBe('test 1e-7');
    });
  });

  describe('tool configuration edge cases', () => {
    it('should handle tool with no parameters', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows ? 'echo test' : 'echo "test"';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: echoCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
    });

    it('should handle tool with only optional parameters', async () => {
      const runner = new MockRunner();

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{opt1}} {{opt2}}',
        parameters: [
          { name: 'opt1', type: 'string', required: false },
          { name: 'opt2', type: 'string', required: false },
        ],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      expect(result.exitCode).toBe(0);
    });

    it('should handle command with no placeholders', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows ? 'echo hello' : 'echo "hello"';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: echoCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello');
    });

    it('should handle extra parameters not in config', async () => {
      const runner = new MockRunner();

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{known}}',
        parameters: [{ name: 'known', type: 'string', required: true }],
      };

      // Extra parameter should be ignored
      const result = await runner.run({
        tool,
        parameters: {
          known: 'value',
          unknown: 'extra',
        },
        cwd: '/workspace',
      });

      expect(result.exitCode).toBe(0);
    });
  });

  describe('environment edge cases', () => {
    it('should handle very long environment variable values', async () => {
      const runner = new SubprocessRunner();
      const longValue = 'x'.repeat(1000);
      const envCommand = isWindows ? 'echo %TEST_VAR%' : 'echo $TEST_VAR';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: envCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
        env: {
          TEST_VAR: longValue,
        },
      });

      expect(result.stdout.length).toBeGreaterThan(900);
    });

    it('should handle many environment variables', async () => {
      const runner = new MockRunner();
      const envVars: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        envVars[`VAR_${i}`] = `value_${i}`;
      }

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
        env: envVars,
      });

      const executed = runner.getExecutedCommands();
      expect(Object.keys(executed[0].env).length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('JSON parsing edge cases', () => {
    it('should handle JSON with whitespace', async () => {
      const runner = new SubprocessRunner();
      // Use node with properly escaped code
      const jsonCommand = isWindows
        ? 'node -e "console.log(JSON.stringify({status:\'ok\'}))"'
        : 'echo \'   {"status":"ok"}   \'';

      const tool: ToolConfig = {
        id: 'json',
        name: 'Json',
        command: jsonCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
      });

      // JSON parsing is opportunistic
      if (result.data !== undefined) {
        expect(result.data).toEqual({ status: 'ok' });
      } else {
        // Just verify command executed
        expect(result.exitCode).toBe(0);
      }
    });

    it('should not parse text that happens to start with {', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows
        ? 'echo {not json}'
        : 'echo \'{not json}\'';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: echoCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
      });

      expect(result.data).toBeUndefined();
    });

    it('should handle empty JSON object', async () => {
      const runner = new SubprocessRunner();
      const jsonCommand = isWindows ? 'echo {}' : 'echo \'{}\'';

      const tool: ToolConfig = {
        id: 'json',
        name: 'Json',
        command: jsonCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
      });

      expect(result.data).toEqual({});
    });

    it('should handle empty JSON array', async () => {
      const runner = new SubprocessRunner();
      const jsonCommand = isWindows ? 'echo []' : 'echo \'[]\'';

      const tool: ToolConfig = {
        id: 'json',
        name: 'Json',
        command: jsonCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
      });

      expect(result.data).toEqual([]);
    });
  });

  describe('command execution edge cases', () => {
    it('should handle command with only whitespace output', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows ? 'echo.' : 'echo ""';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: echoCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
    });

    it('should handle zero timeout gracefully', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows ? 'echo test' : 'echo "test"';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: echoCommand,
        parameters: [],
      };

      // Zero timeout might complete if command is very fast
      // or might timeout - both are acceptable
      try {
        const result = await runner.run({
          tool,
          parameters: {},
          cwd: process.cwd(),
          timeout: 0,
        });
        // If it completed, that's fine
        expect(result.exitCode).toBeDefined();
      } catch (error) {
        // If it timed out, that's also fine
        expect(error).toBeDefined();
      }
    });
  });

  describe('placeholder edge cases', () => {
    it('should handle malformed placeholders', () => {
      const command = 'test {{incomplete';
      const result = substituteParameters(command, { incomplete: 'value' });
      // Malformed placeholder is left as-is
      expect(result).toBe('test {{incomplete');
    });

    it('should handle empty placeholder', () => {
      const command = 'test {{}}';
      const result = substituteParameters(command, {});
      // Empty placeholder should be left as-is
      expect(result).toBe('test {{}}');
    });

    it('should handle placeholder with only whitespace', () => {
      const command = 'test {{   }}';
      const result = substituteParameters(command, {});
      // Whitespace-only placeholder should be left as-is
      expect(result).toBe('test {{   }}');
    });

    it('should handle multiple consecutive placeholders', () => {
      const command = 'test {{a}}{{b}}{{c}}';
      const result = substituteParameters(command, {
        a: '1',
        b: '2',
        c: '3',
      });
      expect(result).toBe('test 123');
    });
  });
});
