import type {
  Identifier,
  BuildRule,
  BuildTarget,
  Hash,
} from '@antimatter/project-model';
import type {
  FileSystem,
  WorkspacePath,
} from '@antimatter/filesystem';
import { createSnapshot } from '@antimatter/filesystem';
import type { CacheEntry } from './types.js';
import { CacheError } from './types.js';
import { expandGlobs } from './glob-matcher.js';
import * as path from 'node:path';

/**
 * Manages build cache using input file hashes.
 *
 * Cache is stored in `.antimatter-cache/{targetId}.json` and contains:
 * - Input file hashes (to detect changes)
 * - Output file hashes (for verification)
 * - Timestamp of when cache was created
 *
 * Cache is considered valid only if ALL input file hashes match.
 */
export class CacheManager {
  constructor(
    private readonly fs: FileSystem,
    private readonly cacheDir: string = '.antimatter-cache',
  ) {}

  /**
   * Get cache file path for a target.
   */
  private getCachePath(targetId: Identifier): WorkspacePath {
    const joined = path.join(this.cacheDir, `${targetId}.json`);
    // Normalize to forward slashes for WorkspacePath
    return joined.replace(/\\/g, '/') as WorkspacePath;
  }

  /**
   * Load cache entry from disk.
   * @returns Cache entry or undefined if not found or invalid
   */
  async loadCache(targetId: Identifier): Promise<CacheEntry | undefined> {
    const cachePath = this.getCachePath(targetId);

    try {
      const fileContent = await this.fs.readFile(cachePath);
      const content = new TextDecoder().decode(fileContent);
      const data = JSON.parse(content);

      // Convert arrays back to Maps
      const inputHashes = new Map<string, Hash>(
        data.inputHashes || [],
      ) as ReadonlyMap<string, Hash>;
      const outputHashes = new Map<string, Hash>(
        data.outputHashes || [],
      ) as ReadonlyMap<string, Hash>;

      return {
        targetId: data.targetId,
        inputHashes,
        outputHashes,
        timestamp: data.timestamp,
      };
    } catch (error) {
      // Cache file doesn't exist or is corrupted
      return undefined;
    }
  }

  /**
   * Save cache entry to disk.
   */
  private async saveEntry(entry: CacheEntry): Promise<void> {
    const cachePath = this.getCachePath(entry.targetId);

    try {
      // Ensure cache directory exists
      const cacheDir = path.dirname(cachePath).replace(/\\/g, '/');
      await this.fs.mkdir(cacheDir as WorkspacePath);

      // Convert Maps to arrays for JSON serialization
      const data = {
        targetId: entry.targetId,
        inputHashes: Array.from(entry.inputHashes.entries()),
        outputHashes: Array.from(entry.outputHashes.entries()),
        timestamp: entry.timestamp,
      };

      await this.fs.writeFile(cachePath, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new CacheError(
        `Failed to write cache for target '${entry.targetId}': ${error instanceof Error ? error.message : String(error)}`,
        'write-failed',
      );
    }
  }

  /**
   * Check if cache is valid for a target.
   *
   * Cache is valid if:
   * 1. Cache entry exists
   * 2. All input files still exist
   * 3. All input file hashes match
   * 4. No new input files have been added
   *
   * @param target - Build target to check
   * @param rule - Build rule for the target
   * @param workspaceRoot - Workspace root directory
   * @returns true if cache is valid, false otherwise
   */
  async isCacheValid(
    target: BuildTarget,
    rule: BuildRule,
    workspaceRoot: string,
  ): Promise<boolean> {
    // Load existing cache
    const cachedEntry = await this.loadCache(target.id);
    if (!cachedEntry) {
      return false;
    }

    // Expand input globs to get current file list
    const inputFiles = await expandGlobs(
      this.fs,
      workspaceRoot,
      rule.inputs,
    );

    // Create snapshot of current inputs
    const currentSnapshot = await createSnapshot(this.fs, inputFiles);

    // Check if file count matches
    if (currentSnapshot.files.size !== cachedEntry.inputHashes.size) {
      return false;
    }

    // Check if all hashes match
    for (const [filePath, fileSnapshot] of currentSnapshot.files) {
      const cachedHash = cachedEntry.inputHashes.get(filePath);
      if (cachedHash !== fileSnapshot.hash) {
        return false;
      }
    }

    return true;
  }

  /**
   * Save cache after successful build.
   *
   * @param target - Build target that was built
   * @param rule - Build rule for the target
   * @param workspaceRoot - Workspace root directory
   */
  async saveCache(
    target: BuildTarget,
    rule: BuildRule,
    workspaceRoot: string,
  ): Promise<void> {
    // Expand input globs to get file list
    const inputFiles = await expandGlobs(
      this.fs,
      workspaceRoot,
      rule.inputs,
    );

    // Create snapshot of inputs
    const inputSnapshot = await createSnapshot(this.fs, inputFiles);

    // Expand output globs to get file list
    const outputFiles = await expandGlobs(
      this.fs,
      workspaceRoot,
      rule.outputs,
    );

    // Create snapshot of outputs
    const outputSnapshot = await createSnapshot(this.fs, outputFiles);

    // Extract hashes from snapshots
    const inputHashes = new Map<string, Hash>();
    for (const [path, fileSnapshot] of inputSnapshot.files) {
      inputHashes.set(path, fileSnapshot.hash);
    }

    const outputHashes = new Map<string, Hash>();
    for (const [path, fileSnapshot] of outputSnapshot.files) {
      outputHashes.set(path, fileSnapshot.hash);
    }

    // Create cache entry
    const entry: CacheEntry = {
      targetId: target.id,
      inputHashes,
      outputHashes,
      timestamp: new Date().toISOString(),
    };

    await this.saveEntry(entry);
  }

  /**
   * Clear cache for a specific target.
   */
  async clearCache(targetId: Identifier): Promise<void> {
    const cachePath = this.getCachePath(targetId);

    try {
      await this.fs.deleteFile(cachePath);
    } catch (error) {
      // Ignore errors if file doesn't exist (ENOENT)
      if (
        error instanceof Error &&
        !error.message.includes('ENOENT')
      ) {
        throw new CacheError(
          `Failed to clear cache for target '${targetId}': ${error.message}`,
          'write-failed',
        );
      }
    }
  }
}
