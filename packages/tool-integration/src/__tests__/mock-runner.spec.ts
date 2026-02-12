import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolConfig } from '@antimatter/project-model';
import { MockRunner } from '../mock-runner.js';
import { ParameterError } from '../types.js';

describe('MockRunner', () => {
  let runner: MockRunner;

  beforeEach(() => {
    runner = new MockRunner();
  });

  describe('basic execution', () => {
    it('should execute command and return default success', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{message}}',
        parameters: [
          { name: 'message', type: 'string', required: true },
        ],
      };

      const result = await runner.run({
        tool,
        parameters: { message: 'hello' },
        cwd: '/workspace',
      });

      expect(result).toEqual({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });
    });

    it('should record executed command', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{message}}',
        parameters: [
          { name: 'message', type: 'string', required: true },
        ],
      };

      await runner.run({
        tool,
        parameters: { message: 'hello' },
        cwd: '/workspace',
      });

      const executed = runner.getExecutedCommands();
      expect(executed).toHaveLength(1);
      expect(executed[0].command).toBe('echo hello');
      expect(executed[0].cwd).toBe('/workspace');
    });

    it('should validate parameters before execution', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{message}}',
        parameters: [
          { name: 'message', type: 'string', required: true },
        ],
      };

      await expect(
        runner.run({
          tool,
          parameters: {},
          cwd: '/workspace',
        })
      ).rejects.toThrow(ParameterError);
    });

    it('should substitute parameters in command', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'process {{input}} {{output}}',
        parameters: [
          { name: 'input', type: 'string', required: true },
          { name: 'output', type: 'string', required: true },
        ],
      };

      await runner.run({
        tool,
        parameters: { input: 'in.txt', output: 'out.txt' },
        cwd: '/workspace',
      });

      const executed = runner.getExecutedCommands();
      expect(executed[0].command).toBe('process in.txt out.txt');
    });
  });

  describe('mock registration', () => {
    it('should return registered mock response for exact match', async () => {
      runner.registerMock('echo hello', {
        exitCode: 0,
        stdout: 'hello\n',
        stderr: '',
      });

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{msg}}',
        parameters: [
          { name: 'msg', type: 'string', required: true },
        ],
      };

      const result = await runner.run({
        tool,
        parameters: { msg: 'hello' },
        cwd: '/workspace',
      });

      expect(result).toEqual({
        exitCode: 0,
        stdout: 'hello\n',
        stderr: '',
      });
    });

    it('should return registered mock for partial match', async () => {
      runner.registerMock('echo', {
        exitCode: 0,
        stdout: 'matched\n',
        stderr: '',
      });

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{msg}}',
        parameters: [
          { name: 'msg', type: 'string', required: true },
        ],
      };

      const result = await runner.run({
        tool,
        parameters: { msg: 'anything' },
        cwd: '/workspace',
      });

      expect(result.stdout).toBe('matched\n');
    });

    it('should support regex patterns', async () => {
      runner.registerMock(/^echo .+$/, {
        exitCode: 0,
        stdout: 'regex matched\n',
        stderr: '',
      });

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{msg}}',
        parameters: [
          { name: 'msg', type: 'string', required: true },
        ],
      };

      const result = await runner.run({
        tool,
        parameters: { msg: 'test' },
        cwd: '/workspace',
      });

      expect(result.stdout).toBe('regex matched\n');
    });

    it('should return first matching mock', async () => {
      runner.registerMock(/echo/, {
        exitCode: 0,
        stdout: 'first\n',
        stderr: '',
      });
      runner.registerMock(/echo.*test/, {
        exitCode: 0,
        stdout: 'second\n',
        stderr: '',
      });

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo test',
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      expect(result.stdout).toBe('first\n');
    });

    it('should support mock with data field', async () => {
      runner.registerMock('get-config', {
        exitCode: 0,
        stdout: '{"port":8080}',
        stderr: '',
        data: { port: 8080 },
      });

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'get-config',
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      expect(result.data).toEqual({ port: 8080 });
    });

    it('should support non-zero exit codes', async () => {
      runner.registerMock('failing-command', {
        exitCode: 1,
        stdout: '',
        stderr: 'Error occurred',
      });

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'failing-command',
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('Error occurred');
    });
  });

  describe('command history', () => {
    it('should record multiple command executions', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'echo {{msg}}',
        parameters: [
          { name: 'msg', type: 'string', required: true },
        ],
      };

      await runner.run({
        tool,
        parameters: { msg: 'first' },
        cwd: '/workspace',
      });

      await runner.run({
        tool,
        parameters: { msg: 'second' },
        cwd: '/workspace',
      });

      await runner.run({
        tool,
        parameters: { msg: 'third' },
        cwd: '/workspace',
      });

      const executed = runner.getExecutedCommands();
      expect(executed).toHaveLength(3);
      expect(executed[0].command).toBe('echo first');
      expect(executed[1].command).toBe('echo second');
      expect(executed[2].command).toBe('echo third');
    });

    it('should record working directory', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      await runner.run({
        tool,
        parameters: {},
        cwd: '/custom/directory',
      });

      const executed = runner.getExecutedCommands();
      expect(executed[0].cwd).toBe('/custom/directory');
    });

    it('should record environment variables', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
        env: {
          TOOL_VAR: 'tool-value',
        },
      };

      await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
        env: {
          RUNTIME_VAR: 'runtime-value',
        },
      });

      const executed = runner.getExecutedCommands();
      expect(executed[0].env).toEqual({
        TOOL_VAR: 'tool-value',
        RUNTIME_VAR: 'runtime-value',
      });
    });

    it('should include timestamp in recorded commands', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const before = Date.now();
      await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });
      const after = Date.now();

      const executed = runner.getExecutedCommands();
      expect(executed[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(executed[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should clear history when requested', async () => {
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
      });

      expect(runner.getExecutedCommands()).toHaveLength(1);

      runner.clearHistory();

      expect(runner.getExecutedCommands()).toHaveLength(0);
    });

    it('should preserve mocks when clearing history', async () => {
      runner.registerMock('test', {
        exitCode: 0,
        stdout: 'mocked',
        stderr: '',
      });

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
      });

      runner.clearHistory();

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      expect(result.stdout).toBe('mocked');
    });
  });

  describe('mock management', () => {
    it('should clear all mocks', async () => {
      runner.registerMock('test', {
        exitCode: 0,
        stdout: 'mocked',
        stderr: '',
      });

      runner.clearMocks();

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      expect(result.stdout).toBe(''); // default response
    });

    it('should allow mock override', async () => {
      runner.registerMock('test', {
        exitCode: 0,
        stdout: 'first',
        stderr: '',
      });

      runner.registerMock('test', {
        exitCode: 0,
        stdout: 'second',
        stderr: '',
      });

      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test',
        parameters: [],
      };

      const result = await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      expect(result.stdout).toBe('second');
    });
  });

  describe('integration with parameter validation', () => {
    it('should validate parameter types', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{count}}',
        parameters: [
          { name: 'count', type: 'number', required: true },
        ],
      };

      await expect(
        runner.run({
          tool,
          parameters: { count: 'not-a-number' },
          cwd: '/workspace',
        })
      ).rejects.toThrow(ParameterError);
    });

    it('should apply default values', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{port}}',
        parameters: [
          {
            name: 'port',
            type: 'number',
            required: false,
            defaultValue: 8080,
          },
        ],
      };

      await runner.run({
        tool,
        parameters: {},
        cwd: '/workspace',
      });

      const executed = runner.getExecutedCommands();
      expect(executed[0].command).toBe('test 8080');
    });

    it('should handle complex parameter substitution', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'build --config {{config.file}} --port {{config.port}}',
        parameters: [
          { name: 'config', type: 'object', required: true },
        ],
      };

      await runner.run({
        tool,
        parameters: {
          config: { file: 'build.json', port: 3000 },
        },
        cwd: '/workspace',
      });

      const executed = runner.getExecutedCommands();
      expect(executed[0].command).toBe('build --config build.json --port 3000');
    });
  });
});
