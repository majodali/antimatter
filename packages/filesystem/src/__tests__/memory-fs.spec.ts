import { describe, it, expect, vi } from 'vitest';
import { MemoryFileSystem } from '../memory-fs.js';

describe('MemoryFileSystem', () => {
  describe('readFile / writeFile', () => {
    it('writes and reads back content as Uint8Array', async () => {
      const fs = new MemoryFileSystem();
      const content = new TextEncoder().encode('hello');
      await fs.writeFile('file.txt', content);
      const result = await fs.readFile('file.txt');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result)).toBe('hello');
    });

    it('writes string content and reads back as bytes', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'hello');
      const result = await fs.readFile('file.txt');
      expect(new TextDecoder().decode(result)).toBe('hello');
    });

    it('returns a copy, not the original buffer', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'hello');
      const first = await fs.readFile('file.txt');
      first[0] = 0;
      const second = await fs.readFile('file.txt');
      expect(new TextDecoder().decode(second)).toBe('hello');
    });

    it('throws ENOENT for missing file', async () => {
      const fs = new MemoryFileSystem();
      await expect(fs.readFile('missing.txt')).rejects.toThrow('ENOENT');
    });
  });

  describe('readTextFile', () => {
    it('reads file as string', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'hello world');
      expect(await fs.readTextFile('file.txt')).toBe('hello world');
    });
  });

  describe('deleteFile', () => {
    it('removes an existing file', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'hello');
      await fs.deleteFile('file.txt');
      expect(await fs.exists('file.txt')).toBe(false);
    });

    it('throws ENOENT for missing file', async () => {
      const fs = new MemoryFileSystem();
      await expect(fs.deleteFile('missing.txt')).rejects.toThrow('ENOENT');
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'hello');
      expect(await fs.exists('file.txt')).toBe(true);
    });

    it('returns true for existing directory', async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('dir');
      expect(await fs.exists('dir')).toBe(true);
    });

    it('returns false for non-existent path', async () => {
      const fs = new MemoryFileSystem();
      expect(await fs.exists('nope')).toBe(false);
    });
  });

  describe('stat', () => {
    it('returns file stat', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'hello');
      const stat = await fs.stat('file.txt');
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(5);
      expect(stat.modifiedAt).toBeTruthy();
      expect(stat.createdAt).toBeTruthy();
    });

    it('returns directory stat', async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('dir');
      const stat = await fs.stat('dir');
      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
    });

    it('throws ENOENT for missing path', async () => {
      const fs = new MemoryFileSystem();
      await expect(fs.stat('missing')).rejects.toThrow('ENOENT');
    });
  });

  describe('auto-mkdir', () => {
    it('creates parent directories when writing', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('a/b/c/file.txt', 'data');
      expect(await fs.exists('a')).toBe(true);
      expect(await fs.exists('a/b')).toBe(true);
      expect(await fs.exists('a/b/c')).toBe(true);
    });
  });

  describe('readDirectory', () => {
    it('lists files and directories', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('dir/a.txt', 'a');
      await fs.writeFile('dir/b.txt', 'b');
      await fs.mkdir('dir/sub');
      const entries = await fs.readDirectory('dir');
      expect(entries).toEqual([
        { name: 'a.txt', isDirectory: false },
        { name: 'b.txt', isDirectory: false },
        { name: 'sub', isDirectory: true },
      ]);
    });

    it('throws ENOENT for non-existent directory', async () => {
      const fs = new MemoryFileSystem();
      await expect(fs.readDirectory('nope')).rejects.toThrow('ENOENT');
    });

    it('lists root directory', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('top.txt', 'hello');
      const entries = await fs.readDirectory('');
      expect(entries.some((e) => e.name === 'top.txt')).toBe(true);
    });
  });

  describe('copyFile', () => {
    it('copies file content', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('src.txt', 'data');
      await fs.copyFile('src.txt', 'dest.txt');
      expect(await fs.readTextFile('dest.txt')).toBe('data');
    });
  });

  describe('rename', () => {
    it('moves file to new path', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('old.txt', 'data');
      await fs.rename('old.txt', 'new.txt');
      expect(await fs.exists('old.txt')).toBe(false);
      expect(await fs.readTextFile('new.txt')).toBe('data');
    });
  });

  describe('watch', () => {
    it('emits create event on new file', async () => {
      const fs = new MemoryFileSystem();
      const listener = vi.fn();
      fs.watch('', listener);
      await fs.writeFile('file.txt', 'data');
      expect(listener).toHaveBeenCalledWith([
        { type: 'create', path: 'file.txt' },
      ]);
    });

    it('emits modify event on overwrite', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'first');
      const listener = vi.fn();
      fs.watch('', listener);
      await fs.writeFile('file.txt', 'second');
      expect(listener).toHaveBeenCalledWith([
        { type: 'modify', path: 'file.txt' },
      ]);
    });

    it('emits delete event', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'data');
      const listener = vi.fn();
      fs.watch('', listener);
      await fs.deleteFile('file.txt');
      expect(listener).toHaveBeenCalledWith([
        { type: 'delete', path: 'file.txt' },
      ]);
    });

    it('stops emitting after close', async () => {
      const fs = new MemoryFileSystem();
      const listener = vi.fn();
      const watcher = fs.watch('', listener);
      watcher.close();
      await fs.writeFile('file.txt', 'data');
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
