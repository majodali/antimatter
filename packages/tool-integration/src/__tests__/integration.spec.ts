import { describe, it, expect } from 'vitest';
import { platform } from 'node:os';
import type { ToolConfig } from '@antimatter/project-model';
import { SubprocessRunner } from '../subprocess-runner.js';
import { MockRunner } from '../mock-runner.js';

describe('Integration Tests', () => {
  const isWindows = platform() === 'win32';

  describe('end-to-end tool execution', () => {
    it('should execute ESLint-like tool with multiple parameters', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows
        ? 'echo Linting {{files}} with fix={{fix}}'
        : 'echo "Linting {{files}} with fix={{fix}}"';

      const eslintTool: ToolConfig = {
        id: 'eslint',
        name: 'ESLint',
        command: echoCommand,
        parameters: [
          { name: 'files', type: 'array', required: true },
          { name: 'fix', type: 'boolean', required: false, defaultValue: false },
        ],
      };

      const result = await runner.run({
        tool: eslintTool,
        parameters: {
          files: ['src/index.ts', 'src/utils.ts'],
          fix: true,
        },
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Linting');
      expect(result.stdout).toContain('src/index.ts');
      expect(result.stdout).toContain('true');
    });

    it('should execute TypeScript compiler-like tool with config', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows
        ? 'echo Compiling with config {{config}}'
        : 'echo "Compiling with config {{config}}"';

      const tscTool: ToolConfig = {
        id: 'tsc',
        name: 'TypeScript',
        command: echoCommand,
        parameters: [
          { name: 'config', type: 'object', required: true },
        ],
      };

      const result = await runner.run({
        tool: tscTool,
        parameters: {
          config: {
            target: 'ES2020',
            module: 'ESNext',
          },
        },
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Compiling');
      expect(result.stdout).toContain('ES2020');
    });

    it('should execute Docker-like tool with environment variables', async () => {
      const runner = new SubprocessRunner();
      const envCommand = isWindows
        ? 'echo Container: %CONTAINER_NAME%'
        : 'echo "Container: $CONTAINER_NAME"';

      const dockerTool: ToolConfig = {
        id: 'docker',
        name: 'Docker',
        command: envCommand,
        parameters: [],
        env: {
          CONTAINER_NAME: 'app-container',
        },
      };

      const result = await runner.run({
        tool: dockerTool,
        parameters: {},
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('app-container');
    });

    it('should handle tool with nested parameter paths', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows
        ? 'echo Server: {{server.host}}:{{server.port}}'
        : 'echo "Server: {{server.host}}:{{server.port}}"';

      const serverTool: ToolConfig = {
        id: 'server',
        name: 'Server',
        command: echoCommand,
        parameters: [
          { name: 'server', type: 'object', required: true },
        ],
      };

      const result = await runner.run({
        tool: serverTool,
        parameters: {
          server: {
            host: 'localhost',
            port: 8080,
          },
        },
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('localhost:8080');
    });
  });

  describe('MockRunner vs SubprocessRunner consistency', () => {
    it('should have consistent parameter validation', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{required}}',
        parameters: [
          { name: 'required', type: 'string', required: true },
        ],
      };

      const mockRunner = new MockRunner();
      const subprocessRunner = new SubprocessRunner();

      // Both should reject missing required parameter
      await expect(
        mockRunner.run({
          tool,
          parameters: {},
          cwd: process.cwd(),
        })
      ).rejects.toThrow();

      await expect(
        subprocessRunner.run({
          tool,
          parameters: {},
          cwd: process.cwd(),
        })
      ).rejects.toThrow();
    });

    it('should have consistent parameter substitution', async () => {
      const echoCommand = isWindows
        ? 'echo {{message}}'
        : 'echo "{{message}}"';

      const tool: ToolConfig = {
        id: 'echo',
        name: 'Echo',
        command: echoCommand,
        parameters: [
          { name: 'message', type: 'string', required: true },
        ],
      };

      const mockRunner = new MockRunner();
      const subprocessRunner = new SubprocessRunner();

      // MockRunner records the substituted command
      await mockRunner.run({
        tool,
        parameters: { message: 'test' },
        cwd: process.cwd(),
      });

      const mockExecuted = mockRunner.getExecutedCommands()[0];
      const mockCommand = mockExecuted.command;

      // SubprocessRunner executes the substituted command
      const subprocessResult = await subprocessRunner.run({
        tool,
        parameters: { message: 'test' },
        cwd: process.cwd(),
      });

      // Both should have processed the parameter
      expect(mockCommand).toContain('test');
      expect(subprocessResult.stdout).toContain('test');
    });
  });

  describe('real-world scenarios', () => {
    it('should execute git-like command with multiple files', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows
        ? 'echo Adding files: {{files}}'
        : 'echo "Adding files: {{files}}"';

      const gitTool: ToolConfig = {
        id: 'git',
        name: 'Git',
        command: echoCommand,
        parameters: [
          { name: 'files', type: 'array', required: true },
        ],
      };

      const result = await runner.run({
        tool: gitTool,
        parameters: {
          files: ['README.md', 'src/index.ts', 'package.json'],
        },
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('README.md');
      expect(result.stdout).toContain('src/index.ts');
      expect(result.stdout).toContain('package.json');
    });

    it('should handle npm-like command with environment override', async () => {
      const runner = new SubprocessRunner();
      const envCommand = isWindows
        ? 'echo NODE_ENV: %NODE_ENV%'
        : 'echo "NODE_ENV: $NODE_ENV"';

      const npmTool: ToolConfig = {
        id: 'npm',
        name: 'NPM',
        command: envCommand,
        parameters: [],
      };

      const result = await runner.run({
        tool: npmTool,
        parameters: {},
        cwd: process.cwd(),
        env: {
          NODE_ENV: 'production',
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('production');
    });

    it('should handle build tool with all parameter types', async () => {
      const runner = new SubprocessRunner();
      const echoCommand = isWindows
        ? 'echo Build: {{target}} watch={{watch}} jobs={{jobs}}'
        : 'echo "Build: {{target}} watch={{watch}} jobs={{jobs}}"';

      const buildTool: ToolConfig = {
        id: 'build',
        name: 'Build',
        command: echoCommand,
        parameters: [
          { name: 'target', type: 'string', required: true },
          { name: 'watch', type: 'boolean', required: false, defaultValue: false },
          { name: 'jobs', type: 'number', required: false, defaultValue: 4 },
        ],
      };

      const result = await runner.run({
        tool: buildTool,
        parameters: {
          target: 'production',
          watch: true,
          jobs: 8,
        },
        cwd: process.cwd(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('production');
      expect(result.stdout).toContain('true');
      expect(result.stdout).toContain('8');
    });
  });

  describe('testing workflows with MockRunner', () => {
    it('should support test-driven development workflow', async () => {
      const mockRunner = new MockRunner();

      // Register expected tool behaviors
      mockRunner.registerMock(/^echo "Linting/, {
        exitCode: 0,
        stdout: 'Linting passed\n',
        stderr: '',
        data: { errors: 0, warnings: 0 },
      });

      mockRunner.registerMock(/^echo "Testing/, {
        exitCode: 0,
        stdout: 'All tests passed\n',
        stderr: '',
        data: { passed: 10, failed: 0 },
      });

      // Execute tools
      const lintTool: ToolConfig = {
        id: 'lint',
        name: 'Lint',
        command: isWindows
          ? 'echo "Linting {{files}}"'
          : 'echo "Linting {{files}}"',
        parameters: [
          { name: 'files', type: 'array', required: true },
        ],
      };

      const testTool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: isWindows
          ? 'echo "Testing {{suite}}"'
          : 'echo "Testing {{suite}}"',
        parameters: [
          { name: 'suite', type: 'string', required: true },
        ],
      };

      const lintResult = await mockRunner.run({
        tool: lintTool,
        parameters: { files: ['src/**/*.ts'] },
        cwd: '/workspace',
      });

      const testResult = await mockRunner.run({
        tool: testTool,
        parameters: { suite: 'unit' },
        cwd: '/workspace',
      });

      // Verify results
      expect(lintResult.exitCode).toBe(0);
      expect(lintResult.data).toEqual({ errors: 0, warnings: 0 });

      expect(testResult.exitCode).toBe(0);
      expect(testResult.data).toEqual({ passed: 10, failed: 0 });

      // Verify execution history
      const executed = mockRunner.getExecutedCommands();
      expect(executed).toHaveLength(2);
      expect(executed[0].command).toContain('Linting');
      expect(executed[1].command).toContain('Testing');
    });
  });

  describe('error propagation', () => {
    it('should propagate parameter errors from both runners', async () => {
      const tool: ToolConfig = {
        id: 'test',
        name: 'Test',
        command: 'test {{count}}',
        parameters: [
          { name: 'count', type: 'number', required: true },
        ],
      };

      const mockRunner = new MockRunner();
      const subprocessRunner = new SubprocessRunner();

      // Both should reject invalid type
      await expect(
        mockRunner.run({
          tool,
          parameters: { count: 'not-a-number' },
          cwd: process.cwd(),
        })
      ).rejects.toThrow();

      await expect(
        subprocessRunner.run({
          tool,
          parameters: { count: 'not-a-number' },
          cwd: process.cwd(),
        })
      ).rejects.toThrow();
    });
  });
});
