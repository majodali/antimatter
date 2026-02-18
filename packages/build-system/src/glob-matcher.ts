import type { FileSystem, WorkspacePath } from '@antimatter/filesystem';
import * as path from 'node:path';

/**
 * Convert a glob pattern to a regular expression.
 *
 * Supports:
 * - `*` matches any characters except path separator
 * - `**` matches any characters including path separators
 * - `?` matches a single character
 * - `[abc]` matches any character in the set
 * - `[a-z]` matches any character in the range
 *
 * @param pattern - Glob pattern to convert
 * @returns Regular expression that matches the pattern
 */
export function globToRegex(pattern: string): RegExp {
  let regex = '^';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      // Check for **
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i += 2;
        // Skip trailing / if present
        if (pattern[i] === '/') {
          i++;
        }
      } else {
        // Single * - match anything except path separator
        regex += '[^/\\\\]*';
        i++;
      }
    } else if (char === '?') {
      // Match single character except path separator
      regex += '[^/\\\\]';
      i++;
    } else if (char === '[') {
      // Character class
      const endBracket = pattern.indexOf(']', i);
      if (endBracket === -1) {
        // Invalid pattern - treat [ as literal
        regex += '\\[';
        i++;
      } else {
        const charClass = pattern.slice(i, endBracket + 1);
        regex += charClass;
        i = endBracket + 1;
      }
    } else if ('.+^${}()|\\'.includes(char)) {
      // Escape regex special characters
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }

  regex += '$';
  return new RegExp(regex);
}

/**
 * Check if a path matches any of the given glob patterns.
 *
 * Patterns starting with `!` are negations - if a path matches a negation
 * pattern, it is excluded even if it matches other patterns.
 *
 * @param filePath - Path to check (relative to base)
 * @param patterns - Array of glob patterns (may include negations with `!`)
 * @returns true if path matches any positive pattern and no negation patterns
 */
export function matchesAnyGlob(
  filePath: string,
  patterns: readonly string[],
): boolean {
  // Normalize path separators to forward slashes for matching
  const normalizedPath = filePath.replace(/\\/g, '/');

  const positivePatterns: RegExp[] = [];
  const negativePatterns: RegExp[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      // Negation pattern
      const actualPattern = pattern.slice(1);
      negativePatterns.push(globToRegex(actualPattern));
    } else {
      positivePatterns.push(globToRegex(pattern));
    }
  }

  // Check if any negative pattern matches (exclude)
  for (const regex of negativePatterns) {
    if (regex.test(normalizedPath)) {
      return false;
    }
  }

  // If no positive patterns, everything matches (unless excluded)
  if (positivePatterns.length === 0) {
    return true;
  }

  // Check if any positive pattern matches
  for (const regex of positivePatterns) {
    if (regex.test(normalizedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Expand glob patterns to find matching files in the file system.
 *
 * @param fs - File system to search
 * @param baseDir - Base directory to search from
 * @param patterns - Glob patterns to match
 * @returns Array of workspace paths that match the patterns
 */
export async function expandGlobs(
  fs: FileSystem,
  baseDir: string,
  patterns: readonly string[],
): Promise<WorkspacePath[]> {
  const matches: WorkspacePath[] = [];

  // Recursively scan directory
  async function scan(dir: string): Promise<void> {
    const entries = await fs.readDirectory(dir as WorkspacePath);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name).replace(/\\/g, '/');
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

      if (!entry.isDirectory) {
        // It's a file - check if it matches patterns
        if (matchesAnyGlob(relativePath, patterns)) {
          matches.push(fullPath as WorkspacePath);
        }
      } else {
        // It's a directory - recursively scan subdirectory
        await scan(fullPath);
      }
    }
  }

  await scan(baseDir);
  return matches;
}
