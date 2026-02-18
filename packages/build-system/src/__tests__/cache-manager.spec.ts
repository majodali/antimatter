import { describe, it, expect, beforeEach } from 'vitest';
import { CacheManager } from '../cache-manager.js';
import { CacheError } from '../types.js';
import { MemoryFileSystem } from '@antimatter/filesystem';
import type { BuildRule, BuildTarget } from '@antimatter/project-model';
import type { WorkspacePath } from '@antimatter/filesystem';

describe('CacheManager', () => {
  let fs: MemoryFileSystem;
  let cacheManager: CacheManager;

  beforeEach(() => {
    fs = new MemoryFileSystem();
    cacheManager = new CacheManager(fs);
  });

  describe('saveCache and loadCache', () => {
    it('should save and load cache entry', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'export const x = 1;');
      await fs.writeFile('dist/index.js' as WorkspacePath, 'exports.x = 1;');

      await cacheManager.saveCache(target, rule, '/');

      const loaded = await cacheManager.loadCache(target.id);
      expect(loaded).toBeDefined();
      expect(loaded?.targetId).toBe('build-app');
      expect(loaded?.inputHashes.size).toBe(1);
      expect(loaded?.outputHashes.size).toBe(1);
      expect(loaded?.timestamp).toBeDefined();
    });

    it('should return undefined for non-existent cache', async () => {
      const loaded = await cacheManager.loadCache('non-existent');
      expect(loaded).toBeUndefined();
    });

    it('should handle multiple input files', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content1');
      await fs.writeFile('src/utils.ts' as WorkspacePath, 'content2');
      await fs.writeFile('src/lib/helpers.ts' as WorkspacePath, 'content3');

      await cacheManager.saveCache(target, rule, '/');

      const loaded = await cacheManager.loadCache(target.id);
      expect(loaded?.inputHashes.size).toBe(3);
      expect(loaded?.inputHashes.has('src/index.ts')).toBe(true);
      expect(loaded?.inputHashes.has('src/utils.ts')).toBe(true);
      expect(loaded?.inputHashes.has('src/lib/helpers.ts')).toBe(true);
    });
  });

  describe('isCacheValid', () => {
    it('should return false when no cache exists', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');

      const valid = await cacheManager.isCacheValid(target, rule, '/');
      expect(valid).toBe(false);
    });

    it('should return true when inputs are unchanged', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
      await cacheManager.saveCache(target, rule, '/');

      const valid = await cacheManager.isCacheValid(target, rule, '/');
      expect(valid).toBe(true);
    });

    it('should return false when input file content changes', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'original content');
      await cacheManager.saveCache(target, rule, '/');

      // Change file content
      await fs.writeFile('src/index.ts' as WorkspacePath, 'modified content');

      const valid = await cacheManager.isCacheValid(target, rule, '/');
      expect(valid).toBe(false);
    });

    it('should return false when input file is added', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
      await cacheManager.saveCache(target, rule, '/');

      // Add new file
      await fs.writeFile('src/utils.ts' as WorkspacePath, 'new file');

      const valid = await cacheManager.isCacheValid(target, rule, '/');
      expect(valid).toBe(false);
    });

    it('should return false when input file is removed', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content1');
      await fs.writeFile('src/utils.ts' as WorkspacePath, 'content2');
      await cacheManager.saveCache(target, rule, '/');

      // Remove file
      await fs.deleteFile('src/utils.ts' as WorkspacePath);

      const valid = await cacheManager.isCacheValid(target, rule, '/');
      expect(valid).toBe(false);
    });

    it('should handle empty input list', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: [],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await cacheManager.saveCache(target, rule, '/');

      const valid = await cacheManager.isCacheValid(target, rule, '/');
      expect(valid).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('should clear existing cache', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
      await cacheManager.saveCache(target, rule, '/');

      let loaded = await cacheManager.loadCache(target.id);
      expect(loaded).toBeDefined();

      await cacheManager.clearCache(target.id);

      loaded = await cacheManager.loadCache(target.id);
      expect(loaded).toBeUndefined();
    });

    it('should not throw error when clearing non-existent cache', async () => {
      await expect(
        cacheManager.clearCache('non-existent'),
      ).resolves.not.toThrow();
    });
  });

  describe('custom cache directory', () => {
    it('should use custom cache directory', async () => {
      const customCacheManager = new CacheManager(fs, 'custom-cache');

      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
      await customCacheManager.saveCache(target, rule, '/');

      // Verify cache was saved to custom directory
      const exists = await fs.exists('custom-cache/build-app.json' as WorkspacePath);
      expect(exists).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should return undefined for corrupted cache JSON', async () => {
      // Write invalid JSON
      await fs.mkdir('.antimatter-cache' as WorkspacePath);
      await fs.writeFile(
        '.antimatter-cache/corrupt.json' as WorkspacePath,
        'not valid json',
      );

      const loaded = await cacheManager.loadCache('corrupt');
      expect(loaded).toBeUndefined();
    });

    it('should handle missing timestamp in cache', async () => {
      // Write cache without timestamp
      await fs.mkdir('.antimatter-cache' as WorkspacePath);
      await fs.writeFile(
        '.antimatter-cache/incomplete.json' as WorkspacePath,
        JSON.stringify({
          targetId: 'incomplete',
          inputHashes: [],
          outputHashes: [],
        }),
      );

      const loaded = await cacheManager.loadCache('incomplete');
      expect(loaded?.timestamp).toBeUndefined();
    });
  });

  describe('workspace root handling', () => {
    it('should resolve paths relative to workspace root', async () => {
      const rule: BuildRule = {
        id: 'compile',
        name: 'Compile',
        inputs: ['src/**/*.ts'],
        outputs: ['dist/**/*.js'],
        command: 'tsc',
      };

      const target: BuildTarget = {
        id: 'build-app',
        ruleId: 'compile',
        moduleId: 'app',
      };

      // Write files in subdirectory
      await fs.writeFile('project/src/index.ts' as WorkspacePath, 'content');

      await cacheManager.saveCache(target, rule, '/project');

      const loaded = await cacheManager.loadCache(target.id);
      expect(loaded?.inputHashes.has('project/src/index.ts')).toBe(true);
    });
  });
});
