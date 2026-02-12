import { describe, it, expect } from 'vitest';
import type { ToolConfig } from '@antimatter/project-model';
import { validateParameters, substituteParameters } from '../parameter-substitution.js';
import { ParameterError } from '../types.js';

describe('validateParameters', () => {
  describe('required parameters', () => {
    it('should pass when all required parameters are provided', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [
          { name: 'file', type: 'string', required: true },
          { name: 'count', type: 'number', required: true },
        ],
      };

      const result = validateParameters(tool, {
        file: 'test.txt',
        count: 5,
      });

      expect(result).toEqual({
        file: 'test.txt',
        count: 5,
      });
    });

    it('should throw ParameterError when required parameter is missing', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'file', type: 'string', required: true }],
      };

      expect(() => validateParameters(tool, {})).toThrow(ParameterError);
      expect(() => validateParameters(tool, {})).toThrow(
        "Required parameter 'file' is missing"
      );
    });

    it('should throw when required parameter is null', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'file', type: 'string', required: true }],
      };

      expect(() => validateParameters(tool, { file: null })).toThrow(
        ParameterError
      );
    });

    it('should throw when required parameter is undefined', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'file', type: 'string', required: true }],
      };

      expect(() => validateParameters(tool, { file: undefined })).toThrow(
        ParameterError
      );
    });
  });

  describe('optional parameters', () => {
    it('should pass when optional parameter is missing', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'file', type: 'string', required: false }],
      };

      const result = validateParameters(tool, {});
      expect(result).toEqual({});
    });

    it('should apply default value for missing optional parameter', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [
          {
            name: 'port',
            type: 'number',
            required: false,
            defaultValue: 8080,
          },
        ],
      };

      const result = validateParameters(tool, {});
      expect(result).toEqual({ port: 8080 });
    });

    it('should use provided value over default', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [
          {
            name: 'port',
            type: 'number',
            required: false,
            defaultValue: 8080,
          },
        ],
      };

      const result = validateParameters(tool, { port: 3000 });
      expect(result).toEqual({ port: 3000 });
    });
  });

  describe('type validation', () => {
    it('should validate string type', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'file', type: 'string', required: true }],
      };

      expect(validateParameters(tool, { file: 'test.txt' })).toEqual({
        file: 'test.txt',
      });
      expect(() => validateParameters(tool, { file: 123 })).toThrow(
        ParameterError
      );
    });

    it('should validate number type', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'count', type: 'number', required: true }],
      };

      expect(validateParameters(tool, { count: 42 })).toEqual({ count: 42 });
      expect(validateParameters(tool, { count: 0 })).toEqual({ count: 0 });
      expect(validateParameters(tool, { count: -5 })).toEqual({ count: -5 });
      expect(validateParameters(tool, { count: 3.14 })).toEqual({ count: 3.14 });
      expect(() => validateParameters(tool, { count: '42' })).toThrow(
        ParameterError
      );
      expect(() => validateParameters(tool, { count: NaN })).toThrow(
        ParameterError
      );
    });

    it('should validate boolean type', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'fix', type: 'boolean', required: true }],
      };

      expect(validateParameters(tool, { fix: true })).toEqual({ fix: true });
      expect(validateParameters(tool, { fix: false })).toEqual({ fix: false });
      expect(() => validateParameters(tool, { fix: 'true' })).toThrow(
        ParameterError
      );
      expect(() => validateParameters(tool, { fix: 1 })).toThrow(ParameterError);
    });

    it('should validate array type', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'files', type: 'array', required: true }],
      };

      expect(validateParameters(tool, { files: [] })).toEqual({ files: [] });
      expect(validateParameters(tool, { files: ['a', 'b'] })).toEqual({
        files: ['a', 'b'],
      });
      expect(() => validateParameters(tool, { files: 'not-array' })).toThrow(
        ParameterError
      );
      expect(() => validateParameters(tool, { files: { a: 1 } })).toThrow(
        ParameterError
      );
    });

    it('should validate object type', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'config', type: 'object', required: true }],
      };

      expect(validateParameters(tool, { config: {} })).toEqual({ config: {} });
      expect(validateParameters(tool, { config: { port: 8080 } })).toEqual({
        config: { port: 8080 },
      });
      expect(() => validateParameters(tool, { config: 'not-object' })).toThrow(
        ParameterError
      );
      expect(() => validateParameters(tool, { config: ['array'] })).toThrow(
        ParameterError
      );
      expect(() => validateParameters(tool, { config: null })).toThrow(
        ParameterError
      );
    });
  });

  describe('multiple parameters', () => {
    it('should validate multiple parameters of different types', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [
          { name: 'file', type: 'string', required: true },
          { name: 'count', type: 'number', required: true },
          { name: 'fix', type: 'boolean', required: false, defaultValue: false },
          { name: 'files', type: 'array', required: false },
          { name: 'config', type: 'object', required: false },
        ],
      };

      const result = validateParameters(tool, {
        file: 'test.txt',
        count: 5,
        files: ['a.js', 'b.js'],
        config: { port: 3000 },
      });

      expect(result).toEqual({
        file: 'test.txt',
        count: 5,
        fix: false, // default applied
        files: ['a.js', 'b.js'],
        config: { port: 3000 },
      });
    });
  });

  describe('ParameterError properties', () => {
    it('should include parameter name and reason in error', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'file', type: 'string', required: true }],
      };

      try {
        validateParameters(tool, {});
        expect.fail('Should have thrown ParameterError');
      } catch (error) {
        expect(error).toBeInstanceOf(ParameterError);
        const paramError = error as ParameterError;
        expect(paramError.parameterName).toBe('file');
        expect(paramError.reason).toBe('missing-required');
      }
    });

    it('should include invalid-type reason for type mismatches', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [{ name: 'count', type: 'number', required: true }],
      };

      try {
        validateParameters(tool, { count: 'not-a-number' });
        expect.fail('Should have thrown ParameterError');
      } catch (error) {
        expect(error).toBeInstanceOf(ParameterError);
        const paramError = error as ParameterError;
        expect(paramError.parameterName).toBe('count');
        expect(paramError.reason).toBe('invalid-type');
      }
    });
  });
});

describe('substituteParameters', () => {
  describe('simple substitution', () => {
    it('should substitute single parameter', () => {
      const command = 'echo {{message}}';
      const params = { message: 'Hello World' };
      expect(substituteParameters(command, params)).toBe('echo "Hello World"');
    });

    it('should substitute multiple parameters', () => {
      const command = 'echo {{first}} {{second}}';
      const params = { first: 'Hello', second: 'World' };
      expect(substituteParameters(command, params)).toBe('echo Hello World');
    });

    it('should handle parameters without spaces (no quotes)', () => {
      const command = 'cat {{file}}';
      const params = { file: 'test.txt' };
      expect(substituteParameters(command, params)).toBe('cat test.txt');
    });

    it('should leave placeholder if parameter is undefined', () => {
      const command = 'echo {{message}}';
      const params = {};
      expect(substituteParameters(command, params)).toBe('echo {{message}}');
    });
  });

  describe('nested object access', () => {
    it('should resolve nested paths', () => {
      const command = 'server --port {{config.port}}';
      const params = { config: { port: 8080 } };
      expect(substituteParameters(command, params)).toBe('server --port 8080');
    });

    it('should resolve deeply nested paths', () => {
      const command = 'test {{settings.server.host}}';
      const params = { settings: { server: { host: 'localhost' } } };
      expect(substituteParameters(command, params)).toBe('test localhost');
    });

    it('should return placeholder if nested path not found', () => {
      const command = 'test {{config.missing}}';
      const params = { config: {} };
      expect(substituteParameters(command, params)).toBe(
        'test {{config.missing}}'
      );
    });

    it('should handle null in nested path', () => {
      const command = 'test {{config.port}}';
      const params = { config: null };
      expect(substituteParameters(command, params)).toBe('test {{config.port}}');
    });
  });

  describe('type serialization', () => {
    it('should serialize strings', () => {
      const command = 'echo {{msg}}';
      expect(substituteParameters(command, { msg: 'hello' })).toBe('echo hello');
      expect(substituteParameters(command, { msg: 'hello world' })).toBe(
        'echo "hello world"'
      );
    });

    it('should serialize numbers', () => {
      const command = 'count {{n}}';
      expect(substituteParameters(command, { n: 42 })).toBe('count 42');
      expect(substituteParameters(command, { n: 0 })).toBe('count 0');
      expect(substituteParameters(command, { n: -5 })).toBe('count -5');
      expect(substituteParameters(command, { n: 3.14 })).toBe('count 3.14');
    });

    it('should serialize booleans', () => {
      const command = 'test {{flag}}';
      expect(substituteParameters(command, { flag: true })).toBe('test true');
      expect(substituteParameters(command, { flag: false })).toBe('test false');
    });

    it('should serialize arrays as space-separated values', () => {
      const command = 'lint {{files}}';
      expect(
        substituteParameters(command, { files: ['a.js', 'b.js', 'c.js'] })
      ).toBe('lint a.js b.js c.js');
    });

    it('should serialize empty arrays', () => {
      const command = 'lint {{files}}';
      expect(substituteParameters(command, { files: [] })).toBe('lint ');
    });

    it('should serialize arrays with spaces in elements', () => {
      const command = 'process {{files}}';
      expect(
        substituteParameters(command, { files: ['file one.txt', 'file two.txt'] })
      ).toBe('process "file one.txt" "file two.txt"');
    });

    it('should serialize objects as JSON strings', () => {
      const command = 'configure {{config}}';
      const result = substituteParameters(command, {
        config: { port: 8080, host: 'localhost' },
      });
      expect(result).toBe('configure "{\\"port\\":8080,\\"host\\":\\"localhost\\"}"');
    });

    it('should handle null values', () => {
      const command = 'test {{value}}';
      expect(substituteParameters(command, { value: null })).toBe('test ');
    });
  });

  describe('shell escaping', () => {
    it('should escape strings with spaces', () => {
      const command = 'echo {{msg}}';
      expect(substituteParameters(command, { msg: 'hello world' })).toBe(
        'echo "hello world"'
      );
    });

    it('should escape strings with quotes', () => {
      const command = 'echo {{msg}}';
      expect(substituteParameters(command, { msg: 'say "hello"' })).toBe(
        'echo "say \\"hello\\""'
      );
    });

    it('should escape strings with backslashes', () => {
      const command = 'echo {{path}}';
      expect(substituteParameters(command, { path: 'C:\\Users\\test' })).toBe(
        'echo "C:\\\\Users\\\\test"'
      );
    });

    it('should escape strings with special shell characters', () => {
      const command = 'echo {{msg}}';
      expect(substituteParameters(command, { msg: 'test$var' })).toBe(
        'echo "test$var"'
      );
      expect(substituteParameters(command, { msg: 'test`cmd`' })).toBe(
        'echo "test`cmd`"'
      );
      expect(substituteParameters(command, { msg: 'a&b' })).toBe('echo "a&b"');
      expect(substituteParameters(command, { msg: 'a|b' })).toBe('echo "a|b"');
      expect(substituteParameters(command, { msg: 'a;b' })).toBe('echo "a;b"');
    });

    it('should not quote simple strings', () => {
      const command = 'cat {{file}}';
      expect(substituteParameters(command, { file: 'test.txt' })).toBe(
        'cat test.txt'
      );
      expect(substituteParameters(command, { file: 'file-name_123.txt' })).toBe(
        'cat file-name_123.txt'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty command', () => {
      expect(substituteParameters('', {})).toBe('');
    });

    it('should handle command with no placeholders', () => {
      expect(substituteParameters('echo hello', {})).toBe('echo hello');
    });

    it('should handle multiple occurrences of same parameter', () => {
      const command = 'echo {{msg}} and {{msg}} again';
      expect(substituteParameters(command, { msg: 'test' })).toBe(
        'echo test and test again'
      );
    });

    it('should handle whitespace in placeholder', () => {
      const command = 'echo {{ msg }}';
      expect(substituteParameters(command, { msg: 'test' })).toBe('echo test');
    });

    it('should handle unicode strings', () => {
      const command = 'echo {{msg}}';
      expect(substituteParameters(command, { msg: 'Hello 世界' })).toBe(
        'echo "Hello 世界"'
      );
    });

    it('should handle empty strings', () => {
      const command = 'echo {{msg}}';
      expect(substituteParameters(command, { msg: '' })).toBe('echo ');
    });

    it('should handle array with mixed types', () => {
      const command = 'test {{values}}';
      expect(substituteParameters(command, { values: [1, true, 'text'] })).toBe(
        'test 1 true text'
      );
    });
  });
});
