import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileSystem } from '../local-fs.js';

describe('LocalFileSystem', () => {
  let tmpDir: string;
  let fs: LocalFileSystem;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'antimatter-fs-test-'));
    fs = new LocalFileSystem(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('readFile / writeFile', () => {
    it('writes and reads back content', async () => {
      await fs.writeFile('file.txt', 'hello');
      const result = await fs.readFile('file.txt');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result)).toBe('hello');
    });

    it('writes Uint8Array content', async () => {
      const bytes = new TextEncoder().encode('binary');
      await fs.writeFile('bin.dat', bytes);
      const result = await fs.readFile('bin.dat');
      expect(new TextDecoder().decode(result)).toBe('binary');
    });

    it('auto-creates parent directories', async () => {
      await fs.writeFile('a/b/c.txt', 'deep');
      expect(await fs.exists('a/b/c.txt')).toBe(true);
    });
  });

  describe('readTextFile', () => {
    it('reads file as string', async () => {
      await fs.writeFile('file.txt', 'text content');
      expect(await fs.readTextFile('file.txt')).toBe('text content');
    });
  });

  describe('deleteFile', () => {
    it('removes an existing file', async () => {
      await fs.writeFile('file.txt', 'data');
      await fs.deleteFile('file.txt');
      expect(await fs.exists('file.txt')).toBe(false);
    });

    it('throws for missing file', async () => {
      await expect(fs.deleteFile('missing.txt')).rejects.toThrow();
    });
  });

  describe('exists', () => {
    it('returns true for file', async () => {
      await fs.writeFile('file.txt', 'data');
      expect(await fs.exists('file.txt')).toBe(true);
    });

    it('returns false for non-existent path', async () => {
      expect(await fs.exists('nope')).toBe(false);
    });
  });

  describe('stat', () => {
    it('returns file stat', async () => {
      await fs.writeFile('file.txt', 'hello');
      const stat = await fs.stat('file.txt');
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(5);
    });

    it('returns directory stat', async () => {
      await fs.mkdir('dir');
      const stat = await fs.stat('dir');
      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
    });
  });

  describe('readDirectory', () => {
    it('lists directory contents', async () => {
      await fs.writeFile('dir/a.txt', 'a');
      await fs.writeFile('dir/b.txt', 'b');
      await fs.mkdir('dir/sub');
      const entries = await fs.readDirectory('dir');
      const names = entries.map((e) => e.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('b.txt');
      expect(names).toContain('sub');
    });
  });

  describe('mkdir', () => {
    it('creates nested directories', async () => {
      await fs.mkdir('a/b/c');
      expect(await fs.exists('a/b/c')).toBe(true);
    });

    it('is idempotent', async () => {
      await fs.mkdir('dir');
      await fs.mkdir('dir');
      expect(await fs.exists('dir')).toBe(true);
    });
  });

  describe('copyFile', () => {
    it('copies file to new location', async () => {
      await fs.writeFile('src.txt', 'original');
      await fs.copyFile('src.txt', 'dest.txt');
      expect(await fs.readTextFile('dest.txt')).toBe('original');
    });

    it('copies into new directory', async () => {
      await fs.writeFile('src.txt', 'data');
      await fs.copyFile('src.txt', 'new-dir/dest.txt');
      expect(await fs.readTextFile('new-dir/dest.txt')).toBe('data');
    });
  });

  describe('rename', () => {
    it('moves file', async () => {
      await fs.writeFile('old.txt', 'data');
      await fs.rename('old.txt', 'new.txt');
      expect(await fs.exists('old.txt')).toBe(false);
      expect(await fs.readTextFile('new.txt')).toBe('data');
    });
  });
});
