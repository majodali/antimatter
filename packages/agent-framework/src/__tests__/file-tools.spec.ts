import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystem } from '@antimatter/filesystem';
import type { WorkspacePath } from '@antimatter/filesystem';
import {
  createReadFileTool,
  createWriteFileTool,
  createListFilesTool,
  createFileTools,
} from '../tools/file-tools.js';

describe('File Tools', () => {
  let fs: MemoryFileSystem;

  beforeEach(async () => {
    fs = new MemoryFileSystem();
    await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');
    await fs.writeFile('src/utils.ts' as WorkspacePath, 'export const y = 2;');
  });

  describe('readFile', () => {
    it('should read an existing file', async () => {
      const tool = createReadFileTool(fs);
      const result = await tool.execute({ path: 'src/index.ts' });
      expect(result).toBe('export const x = 1;');
    });

    it('should return error JSON for non-existent file', async () => {
      const tool = createReadFileTool(fs);
      const result = await tool.execute({ path: 'src/missing.ts' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Failed to read file');
    });

    it('should return error JSON when path is missing', async () => {
      const tool = createReadFileTool(fs);
      const result = await tool.execute({});
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('path is required');
    });
  });

  describe('writeFile', () => {
    it('should write a new file', async () => {
      const tool = createWriteFileTool(fs);
      const result = await tool.execute({ path: 'src/new.ts', content: 'hello' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);

      const content = await fs.readTextFile('src/new.ts' as WorkspacePath);
      expect(content).toBe('hello');
    });

    it('should overwrite an existing file', async () => {
      const tool = createWriteFileTool(fs);
      await tool.execute({ path: 'src/index.ts', content: 'updated' });

      const content = await fs.readTextFile('src/index.ts' as WorkspacePath);
      expect(content).toBe('updated');
    });

    it('should return error JSON when path is missing', async () => {
      const tool = createWriteFileTool(fs);
      const result = await tool.execute({ content: 'hello' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('path is required');
    });
  });

  describe('listFiles', () => {
    it('should list directory entries', async () => {
      const tool = createListFilesTool(fs);
      const result = await tool.execute({ path: 'src' });
      const entries = JSON.parse(result);
      expect(entries).toHaveLength(2);

      const names = entries.map((e: { name: string }) => e.name).sort();
      expect(names).toEqual(['index.ts', 'utils.ts']);
    });

    it('should return error for non-existent directory', async () => {
      const tool = createListFilesTool(fs);
      const result = await tool.execute({ path: 'nonexistent' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Failed to list directory');
    });
  });

  describe('createFileTools', () => {
    it('should return all three tools', () => {
      const tools = createFileTools(fs);
      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(['listFiles', 'readFile', 'writeFile']);
    });
  });
});
