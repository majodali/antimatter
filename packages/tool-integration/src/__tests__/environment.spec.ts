import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ToolConfig } from '@antimatter/project-model';
import type { RunToolOptions } from '../types.js';
import { mergeEnvironment, sanitizeEnvironment } from '../environment.js';

describe('sanitizeEnvironment', () => {
  it('should keep valid string values', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      NODE_ENV: 'production',
    };

    const result = sanitizeEnvironment(env);
    expect(result).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/user',
      NODE_ENV: 'production',
    });
  });

  it('should remove undefined values', () => {
    const env = {
      PATH: '/usr/bin',
      UNDEFINED: undefined,
    };

    const result = sanitizeEnvironment(env);
    expect(result).toEqual({
      PATH: '/usr/bin',
    });
  });

  it('should remove null values', () => {
    const env = {
      PATH: '/usr/bin',
      NULL: null,
    };

    const result = sanitizeEnvironment(env);
    expect(result).toEqual({
      PATH: '/usr/bin',
    });
  });

  it('should remove non-string values', () => {
    const env = {
      PATH: '/usr/bin',
      NUMBER: 42 as unknown,
      BOOLEAN: true as unknown,
      OBJECT: {} as unknown,
      ARRAY: [] as unknown,
    };

    const result = sanitizeEnvironment(env);
    expect(result).toEqual({
      PATH: '/usr/bin',
    });
  });

  it('should handle empty object', () => {
    const result = sanitizeEnvironment({});
    expect(result).toEqual({});
  });

  it('should handle all invalid values', () => {
    const env = {
      UNDEFINED: undefined,
      NULL: null,
      NUMBER: 42 as unknown,
    };

    const result = sanitizeEnvironment(env);
    expect(result).toEqual({});
  });

  it('should preserve empty strings', () => {
    const env = {
      EMPTY: '',
      NORMAL: 'value',
    };

    const result = sanitizeEnvironment(env);
    expect(result).toEqual({
      EMPTY: '',
      NORMAL: 'value',
    });
  });
});

describe('mergeEnvironment', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Clear process.env for predictable testing
    process.env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      NODE_ENV: 'test',
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('precedence order', () => {
    it('should use process.env as base', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.PATH).toBe('/usr/bin');
      expect(result.HOME).toBe('/home/user');
      expect(result.NODE_ENV).toBe('test');
    });

    it('should override process.env with tool.env', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          NODE_ENV: 'development',
          CUSTOM_TOOL: 'value',
        },
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.PATH).toBe('/usr/bin'); // from process.env
      expect(result.HOME).toBe('/home/user'); // from process.env
      expect(result.NODE_ENV).toBe('development'); // overridden by tool.env
      expect(result.CUSTOM_TOOL).toBe('value'); // from tool.env
    });

    it('should override tool.env with options.env', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          NODE_ENV: 'development',
          TOOL_VAR: 'tool-value',
        },
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
        env: {
          NODE_ENV: 'production',
          RUNTIME_VAR: 'runtime-value',
        },
      };

      const result = mergeEnvironment(tool, options);
      expect(result.PATH).toBe('/usr/bin'); // from process.env
      expect(result.NODE_ENV).toBe('production'); // overridden by options.env
      expect(result.TOOL_VAR).toBe('tool-value'); // from tool.env
      expect(result.RUNTIME_VAR).toBe('runtime-value'); // from options.env
    });

    it('should demonstrate full precedence chain', () => {
      process.env.VAR = 'process';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          VAR: 'tool',
        },
      };

      const options1: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      expect(mergeEnvironment(tool, options1).VAR).toBe('tool');

      const options2: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
        env: {
          VAR: 'runtime',
        },
      };

      expect(mergeEnvironment(tool, options2).VAR).toBe('runtime');
    });
  });

  describe('edge cases', () => {
    it('should handle tool without env', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.PATH).toBe('/usr/bin');
      expect(result.HOME).toBe('/home/user');
    });

    it('should handle options without env', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          TOOL_VAR: 'value',
        },
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.PATH).toBe('/usr/bin');
      expect(result.TOOL_VAR).toBe('value');
    });

    it('should handle empty process.env', () => {
      process.env = {};

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          TOOL_VAR: 'value',
        },
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result).toEqual({
        TOOL_VAR: 'value',
      });
    });

    it('should filter undefined values from process.env', () => {
      process.env.UNDEFINED_VAR = undefined;
      process.env.DEFINED_VAR = 'value';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.UNDEFINED_VAR).toBeUndefined();
      expect(result.DEFINED_VAR).toBe('value');
    });

    it('should handle undefined values in tool.env', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          DEFINED: 'value',
          UNDEFINED: undefined as unknown as string,
        },
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.DEFINED).toBe('value');
      expect(result.UNDEFINED).toBeUndefined();
    });

    it('should handle undefined values in options.env', () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
        env: {
          DEFINED: 'value',
          UNDEFINED: undefined as unknown as string,
        },
      };

      const result = mergeEnvironment(tool, options);
      expect(result.DEFINED).toBe('value');
      expect(result.UNDEFINED).toBeUndefined();
    });
  });

  describe('real-world scenarios', () => {
    it('should handle CI environment override', () => {
      process.env.CI = 'false';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
        env: {
          CI: 'true',
        },
      };

      const result = mergeEnvironment(tool, options);
      expect(result.CI).toBe('true');
    });

    it('should handle NODE_ENV override for testing', () => {
      process.env.NODE_ENV = 'production';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          NODE_ENV: 'test',
        },
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.NODE_ENV).toBe('test');
    });

    it('should preserve PATH with custom additions', () => {
      process.env.PATH = '/usr/bin:/usr/local/bin';

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          PATH: '/custom/bin:/usr/bin:/usr/local/bin',
        },
      };

      const options: RunToolOptions = {
        tool,
        parameters: {},
        cwd: '/workspace',
      };

      const result = mergeEnvironment(tool, options);
      expect(result.PATH).toBe('/custom/bin:/usr/bin:/usr/local/bin');
    });
  });
});
