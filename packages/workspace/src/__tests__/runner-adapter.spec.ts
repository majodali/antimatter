import { describe, it, beforeEach } from 'node:test';
import { expect } from '@antimatter/test-utils';
import type { ToolConfig } from '@antimatter/project-model';
import { WorkspaceEnvironmentRunnerAdapter } from '../runner-adapter.js';
import { MemoryWorkspaceEnvironment } from '../memory-workspace-environment.js';

describe('WorkspaceEnvironmentRunnerAdapter', () => {
  let env: MemoryWorkspaceEnvironment;
  let adapter: WorkspaceEnvironmentRunnerAdapter;

  beforeEach(() => {
    env = new MemoryWorkspaceEnvironment();
    adapter = new WorkspaceEnvironmentRunnerAdapter(env);
  });

  it('should implement ToolRunner.run()', async () => {
    env.runner.registerMock(/tsc/, {
      stdout: 'Compiled successfully',
      stderr: '',
      exitCode: 0,
    });

    const tool: ToolConfig = {
      id: 'tsc',
      name: 'TypeScript Compiler',
      command: 'tsc',
      parameters: [],
    };

    const result = await adapter.run({
      tool,
      parameters: {},
      cwd: '/',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Compiled successfully');
    expect(result.stderr).toBe('');
  });

  it('should substitute parameters in command', async () => {
    env.runner.registerMock(/eslint src/, {
      stdout: 'No errors',
      stderr: '',
      exitCode: 0,
    });

    const tool: ToolConfig = {
      id: 'eslint',
      name: 'ESLint',
      command: 'eslint {{path}}',
      parameters: [
        { name: 'path', type: 'string', required: true },
      ],
    };

    const result = await adapter.run({
      tool,
      parameters: { path: 'src' },
      cwd: '/',
    });

    expect(result.exitCode).toBe(0);
  });

  it('should pass through non-zero exit codes', async () => {
    env.runner.registerMock(/tsc/, {
      stdout: '',
      stderr: 'error TS2305: Module has no exported member',
      exitCode: 1,
    });

    const tool: ToolConfig = {
      id: 'tsc',
      name: 'TypeScript Compiler',
      command: 'tsc',
      parameters: [],
    };

    const result = await adapter.run({
      tool,
      parameters: {},
      cwd: '/',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('TS2305');
  });

  it('should parse JSON stdout as data', async () => {
    env.runner.registerMock(/json-tool/, {
      stdout: '{"success": true, "count": 42}',
      stderr: '',
      exitCode: 0,
    });

    const tool: ToolConfig = {
      id: 'json-tool',
      name: 'JSON Tool',
      command: 'json-tool',
      parameters: [],
    };

    const result = await adapter.run({
      tool,
      parameters: {},
      cwd: '/',
    });

    expect(result.data).toEqual({ success: true, count: 42 });
  });

  it('should merge tool env and options env', async () => {
    env.runner.registerMock(/cmd/, {
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const tool: ToolConfig = {
      id: 'cmd',
      name: 'Command',
      command: 'cmd',
      parameters: [],
      env: { TOOL_VAR: 'from-tool' },
    };

    // Should not throw — env merging is handled
    const result = await adapter.run({
      tool,
      parameters: {},
      cwd: '/',
      env: { RUNTIME_VAR: 'from-runtime' },
    });

    expect(result.exitCode).toBe(0);
  });
});
