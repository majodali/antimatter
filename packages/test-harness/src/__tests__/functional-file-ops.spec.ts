/**
 * Service-level functional tests: File Operations
 *
 * These tests correspond to the deployed smoke/functional tests for file
 * operations. They exercise the same logical operations but call the
 * service layer directly (MemoryFileSystem) instead of going through REST.
 *
 * Correspondence with deployed tests:
 *   Write/Read file      ↔ Smoke: Write File, Read File
 *   File existence        ↔ Smoke: File Exists, File Deleted
 *   Directory listing     ↔ Smoke: List Directory, File Tree
 *   Delete file           ↔ Smoke: Delete File
 *   Error cases           ↔ (additional service-level coverage)
 */
import { describe, it, beforeEach } from 'node:test';
import { expect } from '@antimatter/test-utils';
import type { WorkspacePath, FileEntry } from '@antimatter/filesystem';
import { createWorkspaceHarness, type WorkspaceHarness } from '../workspace-harness.js';

describe('Functional: File Operations', () => {
  let harness: WorkspaceHarness;

  beforeEach(async () => {
    harness = await createWorkspaceHarness();
  });

  // ↔ Smoke: Write File, Read File
  it('should write a file and read it back', async () => {
    await harness.writeFile('_test.txt', 'hello');
    const content = await harness.readFile('_test.txt');
    expect(content).toBe('hello');
  });

  // ↔ Smoke: File Exists
  it('should report file existence after write', async () => {
    await harness.writeFile('_test.txt', 'hello');
    expect(await harness.fileExists('_test.txt')).toBe(true);
  });

  // ↔ Smoke: File Exists (negative)
  it('should report non-existence for missing file', async () => {
    expect(await harness.fileExists('no-such-file.txt')).toBe(false);
  });

  // ↔ Smoke: List Directory
  it('should list directory entries', async () => {
    const entries = await harness.getFileTree();
    const names = entries.map((e: FileEntry) => e.name);
    expect(names).toContain('package.json');
    expect(names).toContain('src');
  });

  // ↔ Smoke: File Tree (nested)
  it('should list src directory with source files', async () => {
    const entries = await harness.getFileTree('src');
    const names = entries.map((e: FileEntry) => e.name).sort();
    expect(names).toContain('index.ts');
    expect(names).toContain('math.ts');
    expect(names).toContain('utils.ts');
  });

  // ↔ Smoke: Delete File
  it('should delete a file', async () => {
    await harness.writeFile('_temp.txt', 'delete me');
    expect(await harness.fileExists('_temp.txt')).toBe(true);
    await harness.deleteFile('_temp.txt');
    expect(await harness.fileExists('_temp.txt')).toBe(false);
  });

  // --- Additional service-level coverage ---

  it('should distinguish files from directories', async () => {
    const entries = await harness.getFileTree();
    const srcEntry = entries.find((e: FileEntry) => e.name === 'src');
    expect(srcEntry?.isDirectory).toBe(true);
    const pkgEntry = entries.find((e: FileEntry) => e.name === 'package.json');
    expect(pkgEntry?.isDirectory).toBe(false);
  });

  it('should list tests directory', async () => {
    const entries = await harness.getFileTree('tests');
    const names = entries.map((e: FileEntry) => e.name);
    expect(names).toContain('math.spec.ts');
  });

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

  it('should create directories', async () => {
    await harness.mkdir('new-dir');
    const entries = await harness.getFileTree();
    const names = entries.map((e: FileEntry) => e.name);
    expect(names).toContain('new-dir');
  });

  it('should throw when reading non-existent file', async () => {
    await expect(harness.readFile('src/missing.ts')).rejects.toThrow();
  });

  it('should throw when listing non-existent directory', async () => {
    await expect(harness.getFileTree('nonexistent')).rejects.toThrow();
  });
});
