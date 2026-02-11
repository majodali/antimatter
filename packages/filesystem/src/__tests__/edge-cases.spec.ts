import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../memory-fs.js';
import { createSnapshot, diffSnapshots } from '../change-tracker.js';
import { scanDirectory, createSourceFile } from '../source-file-utils.js';
import {
  normalizePath,
  joinPath,
  dirName,
  baseName,
  extName,
} from '../path-utils.js';
import { hashContent } from '../hashing.js';

describe('Edge Cases and Error Handling', () => {
  describe('Empty and null content', () => {
    it('handles empty file content', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('empty.txt', '');

      const content = await fs.readTextFile('empty.txt');
      expect(content).toBe('');

      const stat = await fs.stat('empty.txt');
      expect(stat.size).toBe(0);
    });

    it('handles empty Uint8Array', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('empty.bin', new Uint8Array(0));

      const content = await fs.readFile('empty.bin');
      expect(content).toBeInstanceOf(Uint8Array);
      expect(content.length).toBe(0);
    });

    it('creates snapshot of empty file', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('empty.txt', '');

      const snapshot = await createSnapshot(fs, ['empty.txt']);
      expect(snapshot.files.size).toBe(1);

      const fileSnap = snapshot.files.get('empty.txt');
      expect(fileSnap?.size).toBe(0);
      expect(fileSnap?.hash).toBeTruthy();
    });
  });

  describe('Special characters in paths', () => {
    it('handles spaces in file names', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file with spaces.txt', 'content');

      expect(await fs.exists('file with spaces.txt')).toBe(true);
      expect(await fs.readTextFile('file with spaces.txt')).toBe('content');
    });

    it('handles special characters in directory names', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('dir-with-dashes/file.txt', 'content');
      await fs.writeFile('dir_with_underscores/file.txt', 'content');
      await fs.writeFile('dir.with.dots/file.txt', 'content');

      expect(await fs.exists('dir-with-dashes/file.txt')).toBe(true);
      expect(await fs.exists('dir_with_underscores/file.txt')).toBe(true);
      expect(await fs.exists('dir.with.dots/file.txt')).toBe(true);
    });

    it('handles unicode characters in file names', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('文件.txt', 'content');
      await fs.writeFile('фајл.txt', 'content');
      await fs.writeFile('αρχείο.txt', 'content');

      expect(await fs.exists('文件.txt')).toBe(true);
      expect(await fs.exists('фајл.txt')).toBe(true);
      expect(await fs.exists('αρχείο.txt')).toBe(true);
    });
  });

  describe('Path edge cases', () => {
    it('normalizes various path formats consistently', () => {
      expect(normalizePath('')).toBe('');
      expect(normalizePath('.')).toBe('');
      expect(normalizePath('..')).toBe('..');
      expect(normalizePath('../..')).toBe('../..');
      expect(normalizePath('a/./b')).toBe('a/b');
      expect(normalizePath('a//b')).toBe('a/b');
      // Note: Node's posix.normalize keeps trailing slashes
      expect(normalizePath('a/b/')).toBe('a/b/');
      expect(normalizePath('//a//b//')).toBe('a/b/');
    });

    it('handles edge cases in joinPath', () => {
      expect(joinPath('', 'file.txt')).toBe('file.txt');
      expect(joinPath('dir', '')).toBe('dir');
      expect(joinPath('', '')).toBe('');
      expect(joinPath('a', '..', 'b')).toBe('b');
      expect(joinPath('a', '.', 'b')).toBe('a/b');
    });

    it('handles edge cases in dirName', () => {
      expect(dirName('')).toBe('');
      expect(dirName('file.txt')).toBe('');
      expect(dirName('a/b/c')).toBe('a/b');
      expect(dirName('a')).toBe('');
    });

    it('handles edge cases in baseName', () => {
      expect(baseName('')).toBe('');
      expect(baseName('file.txt')).toBe('file.txt');
      // Node's posix.basename returns 'dir' for 'dir/'
      expect(baseName('dir/')).toBe('dir');
      expect(baseName('.hidden')).toBe('.hidden');
      expect(baseName('file.')).toBe('file.');
    });

    it('handles edge cases in extName', () => {
      expect(extName('')).toBe('');
      expect(extName('file')).toBe('');
      expect(extName('.hidden')).toBe('');
      expect(extName('file.')).toBe('.');
      expect(extName('..')).toBe('');
      expect(extName('file.tar.gz')).toBe('.gz');
    });
  });

  describe('File operation edge cases', () => {
    it('overwrites existing file without error', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('file.txt', 'first');
      await fs.writeFile('file.txt', 'second');

      expect(await fs.readTextFile('file.txt')).toBe('second');
    });

    it('handles rapid successive modifications', async () => {
      const fs = new MemoryFileSystem();

      for (let i = 0; i < 100; i++) {
        await fs.writeFile('file.txt', `version-${i}`);
      }

      expect(await fs.readTextFile('file.txt')).toBe('version-99');
    });

    it('handles copy to same location', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'content');

      // Copy to itself should work (no-op or overwrite)
      await fs.copyFile('file.txt', 'file.txt');
      expect(await fs.readTextFile('file.txt')).toBe('content');
    });
  });

  describe('Directory operation edge cases', () => {
    it('lists empty directory', async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('empty');

      const entries = await fs.readDirectory('empty');
      expect(entries).toEqual([]);
    });

    it('scans empty directory', async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('empty');

      const files = await scanDirectory(fs, 'empty');
      expect(files).toEqual([]);
    });

    it('handles deeply nested directory creation', async () => {
      const fs = new MemoryFileSystem();
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/file.txt';

      await fs.writeFile(deepPath, 'content');
      expect(await fs.exists(deepPath)).toBe(true);
    });

    it('handles root directory operations', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('root-file.txt', 'content');
      await fs.mkdir('dir');

      const entries = await fs.readDirectory('');
      expect(entries.length).toBeGreaterThan(0);

      const files = await scanDirectory(fs, '');
      expect(files.some((f) => f.path === 'root-file.txt')).toBe(true);
    });
  });

  describe('Snapshot edge cases', () => {
    it('creates snapshot with no files', async () => {
      const fs = new MemoryFileSystem();
      const snapshot = await createSnapshot(fs, []);

      expect(snapshot.files.size).toBe(0);
      expect(snapshot.createdAt).toBeTruthy();
    });

    it('diffs two empty snapshots', async () => {
      const fs = new MemoryFileSystem();
      const snap1 = await createSnapshot(fs, []);
      const snap2 = await createSnapshot(fs, []);

      const changes = diffSnapshots(snap1, snap2);
      expect(changes).toEqual([]);
    });

    it('handles snapshot with duplicate paths', async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('file.txt', 'content');

      // Same path listed multiple times
      const snapshot = await createSnapshot(fs, [
        'file.txt',
        'file.txt',
        'file.txt',
      ]);

      // Should only store once
      expect(snapshot.files.size).toBe(1);
    });
  });

  describe('Hash consistency', () => {
    it('produces consistent hashes across operations', async () => {
      const content = 'test content';

      const hash1 = hashContent(content);
      const hash2 = hashContent(content);
      const hash3 = hashContent(new TextEncoder().encode(content));

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
    });

    it('produces different hashes for different content', async () => {
      const hashes = [
        hashContent('a'),
        hashContent('b'),
        hashContent('aa'),
        hashContent(''),
        hashContent(' '),
      ];

      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(hashes.length);
    });

    it('handles very long content', () => {
      const longContent = 'a'.repeat(1000000); // 1MB of 'a's
      const hash = hashContent(longContent);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      // Hash should be consistent
      expect(hashContent(longContent)).toBe(hash);
    });
  });

  describe('Error recovery', () => {
    it('maintains consistency after failed operations', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('file.txt', 'original');

      // Try to read non-existent file
      await expect(fs.readFile('missing.txt')).rejects.toThrow();

      // Original file should still be intact
      expect(await fs.readTextFile('file.txt')).toBe('original');
    });

    it('handles errors in snapshot creation gracefully', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('exists.txt', 'content');

      // Snapshot with mix of existing and non-existing files
      await expect(
        createSnapshot(fs, ['exists.txt', 'missing.txt'])
      ).rejects.toThrow();

      // File system should still be in good state
      expect(await fs.exists('exists.txt')).toBe(true);
    });
  });

  describe('Binary data handling', () => {
    it('handles binary data correctly', async () => {
      const fs = new MemoryFileSystem();

      // Create binary data with all byte values
      const binaryData = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }

      await fs.writeFile('binary.dat', binaryData);
      const result = await fs.readFile('binary.dat');

      expect(result).toEqual(binaryData);
    });

    it('handles large binary files', async () => {
      const fs = new MemoryFileSystem();

      const largeBinary = new Uint8Array(1024 * 1024); // 1MB
      for (let i = 0; i < largeBinary.length; i++) {
        largeBinary[i] = i % 256;
      }

      await fs.writeFile('large.bin', largeBinary);
      const result = await fs.readFile('large.bin');

      expect(result.length).toBe(largeBinary.length);
      expect(result).toEqual(largeBinary);
    });

    it('handles null bytes in content', async () => {
      const fs = new MemoryFileSystem();

      const withNulls = new Uint8Array([
        0, 1, 2, 0, 0, 3, 4, 0, 5,
      ]);

      await fs.writeFile('nulls.bin', withNulls);
      const result = await fs.readFile('nulls.bin');

      expect(result).toEqual(withNulls);
    });
  });

  describe('Watch edge cases', () => {
    it('handles watcher on non-existent directory', async () => {
      const fs = new MemoryFileSystem();
      const events: any[] = [];

      // Watch a directory that doesn't exist yet
      fs.watch('nonexistent', (e) => events.push(...e));

      // Create file in that directory
      await fs.writeFile('nonexistent/file.txt', 'content');

      expect(events.length).toBeGreaterThan(0);
    });

    it('handles multiple watchers on same path', async () => {
      const fs = new MemoryFileSystem();
      const events1: any[] = [];
      const events2: any[] = [];

      fs.watch('', (e) => events1.push(...e));
      fs.watch('', (e) => events2.push(...e));

      await fs.writeFile('file.txt', 'content');

      // Both watchers should receive events
      expect(events1.length).toBeGreaterThan(0);
      expect(events2.length).toBeGreaterThan(0);
    });
  });

  describe('Source file detection edge cases', () => {
    it('handles files without extensions', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('Makefile', 'content');
      await fs.writeFile('Dockerfile', 'content');
      await fs.writeFile('LICENSE', 'content');

      const files = await scanDirectory(fs, '');

      expect(files.length).toBe(3);
      expect(files.every((f) => f.language === 'other')).toBe(true);
    });

    it('handles hidden files', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('.gitignore', 'node_modules/');
      await fs.writeFile('.env', 'SECRET=value');

      const files = await scanDirectory(fs, '');

      expect(files.some((f) => f.path === '.gitignore')).toBe(true);
      expect(files.some((f) => f.path === '.env')).toBe(true);
    });

    it('handles files with multiple extensions', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('component.test.tsx', 'test');
      await fs.writeFile('types.d.ts', 'declarations');
      await fs.writeFile('config.prod.json', '{}');

      const files = await scanDirectory(fs, '');

      const testFile = files.find((f) => f.path === 'component.test.tsx');
      expect(testFile?.language).toBe('typescript');
      expect(testFile?.type).toBe('test');

      const dtsFile = files.find((f) => f.path === 'types.d.ts');
      expect(dtsFile?.language).toBe('typescript');
    });
  });
});
