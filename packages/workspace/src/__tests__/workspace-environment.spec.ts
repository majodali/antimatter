import { describe, it, beforeEach } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { MemoryWorkspaceEnvironment } from '../memory-workspace-environment.js';

describe('MemoryWorkspaceEnvironment', () => {
  let env: MemoryWorkspaceEnvironment;

  beforeEach(() => {
    env = new MemoryWorkspaceEnvironment();
  });

  it('should have default id and label', () => {
    expect(env.id).toBe('memory');
    expect(env.label).toBe('memory');
  });

  it('should accept custom id and label', () => {
    const custom = new MemoryWorkspaceEnvironment({ id: 'test-1', label: 'Test Env' });
    expect(custom.id).toBe('test-1');
    expect(custom.label).toBe('Test Env');
  });

  describe('file operations', () => {
    it('should write and read files', async () => {
      await env.writeFile('hello.txt', 'world');
      const content = await env.readFile('hello.txt');
      expect(content).toBe('world');
    });

    it('should check file existence', async () => {
      expect(await env.exists('missing.txt')).toBe(false);
      await env.writeFile('exists.txt', 'content');
      expect(await env.exists('exists.txt')).toBe(true);
    });

    it('should delete files', async () => {
      await env.writeFile('temp.txt', 'data');
      expect(await env.exists('temp.txt')).toBe(true);
      await env.deleteFile('temp.txt');
      expect(await env.exists('temp.txt')).toBe(false);
    });

    it('should create directories', async () => {
      await env.mkdir('src');
      await env.writeFile('src/index.ts', 'export {}');
      const entries = await env.readDirectory('src');
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('index.ts');
    });

    it('should read directory entries', async () => {
      await env.writeFile('a.ts', '');
      await env.writeFile('b.ts', '');
      const entries = await env.readDirectory('');
      const names = entries.map((e) => e.name);
      expect(names).toContain('a.ts');
      expect(names).toContain('b.ts');
    });

    it('should stat files', async () => {
      await env.writeFile('file.txt', 'hello');
      const stat = await env.stat('file.txt');
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('command execution', () => {
    it('should execute commands via MockRunner', async () => {
      env.runner.registerMock(/echo/, {
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
      });

      const result = await env.execute({ command: 'echo hello' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return non-zero exit codes', async () => {
      env.runner.registerMock(/fail/, {
        stdout: '',
        stderr: 'error occurred',
        exitCode: 1,
      });

      const result = await env.execute({ command: 'fail' });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('error occurred');
    });

    it('should pass args as part of command', async () => {
      env.runner.registerMock(/tsc --noEmit/, {
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await env.execute({
        command: 'tsc',
        args: ['--noEmit'],
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('should initialize without error', async () => {
      await expect(env.initialize()).resolves.toBeUndefined();
    });

    it('should dispose without error', async () => {
      await expect(env.dispose()).resolves.toBeUndefined();
    });
  });

  describe('backward compatibility', () => {
    it('should expose fileSystem property', () => {
      expect(env.fileSystem).toBe(env.fs);
    });

    it('should expose fs and runner for test setup', () => {
      expect(env.fs).toBeDefined();
      expect(env.runner).toBeDefined();
    });
  });
});
