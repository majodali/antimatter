import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkspacePath, FileEntry } from '@antimatter/filesystem';
import { detectLanguage } from '@antimatter/filesystem';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';

describe('E2E: Browse & Read Files', () => {
  let harness: WorkspaceHarness;

  beforeEach(async () => {
    harness = await createWorkspaceHarness();
  });

  describe('directory listing', () => {
    it('should list root directory entries', async () => {
      const entries = await harness.fs.readDirectory('' as WorkspacePath);
      const names = entries.map((e: FileEntry) => e.name).sort();
      expect(names).toContain('package.json');
      expect(names).toContain('tsconfig.json');
      expect(names).toContain('src');
    });

    it('should list src directory with source files', async () => {
      const entries = await harness.fs.readDirectory('src' as WorkspacePath);
      const names = entries.map((e: FileEntry) => e.name).sort();
      expect(names).toContain('index.ts');
      expect(names).toContain('math.ts');
      expect(names).toContain('utils.ts');
    });

    it('should distinguish files from directories', async () => {
      const entries = await harness.fs.readDirectory('' as WorkspacePath);
      const srcEntry = entries.find((e: FileEntry) => e.name === 'src');
      expect(srcEntry?.isDirectory).toBe(true);

      const pkgEntry = entries.find((e: FileEntry) => e.name === 'package.json');
      expect(pkgEntry?.isDirectory).toBe(false);
    });

    it('should list tests directory', async () => {
      const entries = await harness.fs.readDirectory('tests' as WorkspacePath);
      const names = entries.map((e: FileEntry) => e.name);
      expect(names).toContain('math.spec.ts');
    });
  });

  describe('reading files', () => {
    it('should read source file contents', async () => {
      const content = await harness.readFile('src/math.ts');
      expect(content).toContain('export function add');
      expect(content).toContain('export function subtract');
    });

    it('should read JSON config files', async () => {
      const content = await harness.readFile('package.json');
      const parsed = JSON.parse(content);
      expect(parsed.name).toBe('demo-project');
    });

    it('should read test files', async () => {
      const content = await harness.readFile('tests/math.spec.ts');
      expect(content).toContain("describe('math'");
      expect(content).toContain('expect(add(2, 3)).toBe(5)');
    });
  });

  describe('language detection', () => {
    it('should detect TypeScript files', () => {
      expect(detectLanguage('src/index.ts')).toBe('typescript');
    });

    it('should detect JSON files', () => {
      expect(detectLanguage('package.json')).toBe('json');
    });
  });

  describe('error cases', () => {
    it('should throw when reading non-existent file', async () => {
      await expect(harness.readFile('src/missing.ts')).rejects.toThrow();
    });

    it('should throw when listing non-existent directory', async () => {
      await expect(
        harness.fs.readDirectory('nonexistent' as WorkspacePath),
      ).rejects.toThrow();
    });
  });
});
