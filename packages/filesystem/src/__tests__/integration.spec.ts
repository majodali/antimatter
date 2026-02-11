import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../memory-fs.js';
import { createSnapshot, diffSnapshots } from '../change-tracker.js';
import { scanDirectory } from '../source-file-utils.js';
import { joinPath, isWithin } from '../path-utils.js';

describe('Integration Tests', () => {
  describe('Snapshot-based change detection workflow', () => {
    it('tracks changes across multiple file operations', async () => {
      const fs = new MemoryFileSystem();

      // Initial project structure
      await fs.writeFile('src/index.ts', 'export const version = 1;');
      await fs.writeFile('src/utils.ts', 'export function helper() {}');
      await fs.writeFile('README.md', '# Project');

      const initial = await createSnapshot(fs, [
        'src/index.ts',
        'src/utils.ts',
        'README.md',
      ]);

      // Simulate development changes
      await fs.writeFile('src/index.ts', 'export const version = 2;'); // Modified
      await fs.deleteFile('src/utils.ts'); // Deleted
      await fs.writeFile('src/types.ts', 'export type Config = {};'); // Added

      const updated = await createSnapshot(fs, [
        'src/index.ts',
        'src/types.ts',
        'README.md',
      ]);

      const changes = diffSnapshots(initial, updated);

      expect(changes).toHaveLength(3);
      expect(changes.find((c) => c.path === 'src/index.ts')?.kind).toBe(
        'modified'
      );
      expect(changes.find((c) => c.path === 'src/utils.ts')?.kind).toBe(
        'deleted'
      );
      expect(changes.find((c) => c.path === 'src/types.ts')?.kind).toBe(
        'added'
      );
    });

    it('integrates with directory scanning for automatic tracking', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('src/a.ts', 'code');
      await fs.writeFile('src/b.ts', 'code');
      await fs.writeFile('src/sub/c.ts', 'code');

      const files = await scanDirectory(fs, 'src');
      const paths = files.map((f) => f.path);

      const snapshot = await createSnapshot(fs, paths);

      expect(snapshot.files.size).toBe(3);
      expect(snapshot.files.has('src/a.ts')).toBe(true);
      expect(snapshot.files.has('src/b.ts')).toBe(true);
      expect(snapshot.files.has('src/sub/c.ts')).toBe(true);
    });
  });

  describe('Source file metadata with filesystem operations', () => {
    it('maintains accurate metadata after file modifications', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('test.ts', 'original content');
      const files1 = await scanDirectory(fs, '');
      const original = files1[0];

      expect(original.path).toBe('test.ts');
      expect(original.language).toBe('typescript');
      expect(original.type).toBe('source');

      // Modify the file
      await fs.writeFile('test.ts', 'modified content with more text');
      const files2 = await scanDirectory(fs, '');
      const modified = files2[0];

      // Metadata should update
      expect(modified.hash).not.toBe(original.hash);
      expect(modified.size).toBeGreaterThan(original.size);
      expect(modified.language).toBe('typescript'); // unchanged
      expect(modified.type).toBe('source'); // unchanged
    });

    it('correctly categorizes different file types in a project', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('src/index.ts', 'export {}');
      await fs.writeFile('src/index.spec.ts', 'test');
      await fs.writeFile('tsconfig.json', '{}');
      await fs.writeFile('README.md', '# Docs');
      await fs.writeFile('logo.png', 'binary');

      const files = await scanDirectory(fs, '');

      const byType = {
        source: files.filter((f) => f.type === 'source'),
        test: files.filter((f) => f.type === 'test'),
        config: files.filter((f) => f.type === 'config'),
        documentation: files.filter((f) => f.type === 'documentation'),
        asset: files.filter((f) => f.type === 'asset'),
      };

      expect(byType.source).toHaveLength(1);
      expect(byType.test).toHaveLength(1);
      expect(byType.config).toHaveLength(1);
      expect(byType.documentation).toHaveLength(1);
      expect(byType.asset).toHaveLength(1);
    });
  });

  describe('Path utilities with filesystem operations', () => {
    it('validates path containment for access control', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('project/src/file.ts', 'code');
      await fs.writeFile('project/tests/test.ts', 'test');
      await fs.writeFile('other/file.ts', 'code');

      const projectFiles = await scanDirectory(fs, 'project');

      // All project files should be within project directory
      for (const file of projectFiles) {
        expect(isWithin('project', file.path)).toBe(true);
      }

      // Verify other files are not within project
      const otherFiles = await scanDirectory(fs, 'other');
      for (const file of otherFiles) {
        expect(isWithin('project', file.path)).toBe(false);
      }
    });

    it('builds correct paths for nested directory operations', async () => {
      const fs = new MemoryFileSystem();

      const baseDir = 'packages/filesystem';
      const subDir = 'src';
      const fileName = 'index.ts';

      const fullPath = joinPath(baseDir, subDir, fileName);
      await fs.writeFile(fullPath, 'export {}');

      expect(await fs.exists(fullPath)).toBe(true);
      expect(fullPath).toBe('packages/filesystem/src/index.ts');

      const files = await scanDirectory(fs, baseDir);
      expect(files[0].path).toBe(fullPath);
    });
  });

  describe('Copy and rename operations with tracking', () => {
    it('tracks file history through copy operations', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('original.ts', 'const x = 1;');
      const snapshot1 = await createSnapshot(fs, ['original.ts']);

      await fs.copyFile('original.ts', 'copy.ts');
      const snapshot2 = await createSnapshot(fs, ['original.ts', 'copy.ts']);

      const changes = diffSnapshots(snapshot1, snapshot2);

      expect(changes).toHaveLength(1);
      expect(changes[0].kind).toBe('added');
      expect(changes[0].path).toBe('copy.ts');

      // Copied file should have same hash as original
      const originalHash = snapshot2.files.get('original.ts')?.hash;
      const copyHash = snapshot2.files.get('copy.ts')?.hash;
      expect(copyHash).toBe(originalHash);
    });

    it('tracks file history through rename operations', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('old-name.ts', 'const x = 1;');
      const snapshot1 = await createSnapshot(fs, ['old-name.ts']);
      const oldHash = snapshot1.files.get('old-name.ts')?.hash;

      await fs.rename('old-name.ts', 'new-name.ts');
      const snapshot2 = await createSnapshot(fs, ['new-name.ts']);

      const changes = diffSnapshots(snapshot1, snapshot2);

      // Should show as delete and add
      expect(changes).toHaveLength(2);
      expect(changes.find((c) => c.kind === 'deleted')?.path).toBe(
        'old-name.ts'
      );
      expect(changes.find((c) => c.kind === 'added')?.path).toBe(
        'new-name.ts'
      );

      // Content hash should be preserved
      const newHash = snapshot2.files.get('new-name.ts')?.hash;
      expect(newHash).toBe(oldHash);
    });
  });

  describe('Concurrent operations', () => {
    it('handles parallel file writes correctly', async () => {
      const fs = new MemoryFileSystem();

      // Write multiple files in parallel
      await Promise.all([
        fs.writeFile('a.txt', 'a'),
        fs.writeFile('b.txt', 'b'),
        fs.writeFile('c.txt', 'c'),
        fs.writeFile('d.txt', 'd'),
      ]);

      // All files should exist
      expect(await fs.exists('a.txt')).toBe(true);
      expect(await fs.exists('b.txt')).toBe(true);
      expect(await fs.exists('c.txt')).toBe(true);
      expect(await fs.exists('d.txt')).toBe(true);

      // All files should be readable
      const results = await Promise.all([
        fs.readTextFile('a.txt'),
        fs.readTextFile('b.txt'),
        fs.readTextFile('c.txt'),
        fs.readTextFile('d.txt'),
      ]);

      expect(results).toEqual(['a', 'b', 'c', 'd']);
    });

    it('handles mixed concurrent operations', async () => {
      const fs = new MemoryFileSystem();

      await fs.writeFile('file1.txt', 'initial');
      await fs.writeFile('file2.txt', 'initial');

      // Mix of reads and writes
      await Promise.all([
        fs.writeFile('file1.txt', 'updated1'),
        fs.readTextFile('file2.txt'),
        fs.writeFile('file3.txt', 'new'),
        fs.exists('file1.txt'),
      ]);

      expect(await fs.readTextFile('file1.txt')).toBe('updated1');
      expect(await fs.readTextFile('file2.txt')).toBe('initial');
      expect(await fs.readTextFile('file3.txt')).toBe('new');
    });
  });

  describe('Large scale operations', () => {
    it('efficiently handles many files', async () => {
      const fs = new MemoryFileSystem();
      const fileCount = 1000;

      // Create many files
      const writePromises = [];
      for (let i = 0; i < fileCount; i++) {
        writePromises.push(
          fs.writeFile(`files/file-${i}.txt`, `content-${i}`)
        );
      }
      await Promise.all(writePromises);

      // Scan should find all files
      const files = await scanDirectory(fs, 'files');
      expect(files).toHaveLength(fileCount);

      // Snapshot should handle all files
      const paths = files.map((f) => f.path);
      const snapshot = await createSnapshot(fs, paths);
      expect(snapshot.files.size).toBe(fileCount);
    });

    it('efficiently tracks changes in large directories', async () => {
      const fs = new MemoryFileSystem();
      const fileCount = 100;

      // Initial state
      for (let i = 0; i < fileCount; i++) {
        await fs.writeFile(`dir/file-${i}.txt`, `v1-${i}`);
      }

      const files = await scanDirectory(fs, 'dir');
      const snapshot1 = await createSnapshot(
        fs,
        files.map((f) => f.path)
      );

      // Modify a subset of files
      const modifiedCount = 10;
      for (let i = 0; i < modifiedCount; i++) {
        await fs.writeFile(`dir/file-${i}.txt`, `v2-${i}`);
      }

      const snapshot2 = await createSnapshot(
        fs,
        files.map((f) => f.path)
      );

      const changes = diffSnapshots(snapshot1, snapshot2);

      // Should detect exactly the modified files
      expect(changes).toHaveLength(modifiedCount);
      expect(changes.every((c) => c.kind === 'modified')).toBe(true);
    });
  });
});
