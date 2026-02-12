import { describe, it, expect, beforeEach } from 'vitest';
import {
  globToRegex,
  matchesAnyGlob,
  expandGlobs,
} from '../glob-matcher.js';
import { MemoryFileSystem } from '@antimatter/filesystem';
import type { WorkspacePath } from '@antimatter/filesystem';

describe('globToRegex', () => {
  it('should convert simple wildcard pattern', () => {
    const regex = globToRegex('*.ts');
    expect(regex.test('file.ts')).toBe(true);
    expect(regex.test('file.js')).toBe(false);
    expect(regex.test('dir/file.ts')).toBe(false);
  });

  it('should convert recursive wildcard pattern', () => {
    const regex = globToRegex('**/*.ts');
    expect(regex.test('file.ts')).toBe(true);
    expect(regex.test('dir/file.ts')).toBe(true);
    expect(regex.test('a/b/c/file.ts')).toBe(true);
    expect(regex.test('file.js')).toBe(false);
  });

  it('should handle question mark pattern', () => {
    const regex = globToRegex('file?.ts');
    expect(regex.test('file1.ts')).toBe(true);
    expect(regex.test('fileA.ts')).toBe(true);
    expect(regex.test('file.ts')).toBe(false);
    expect(regex.test('file12.ts')).toBe(false);
  });

  it('should handle character class', () => {
    const regex = globToRegex('file[abc].ts');
    expect(regex.test('filea.ts')).toBe(true);
    expect(regex.test('fileb.ts')).toBe(true);
    expect(regex.test('filec.ts')).toBe(true);
    expect(regex.test('filed.ts')).toBe(false);
  });

  it('should handle character range', () => {
    const regex = globToRegex('file[0-9].ts');
    expect(regex.test('file0.ts')).toBe(true);
    expect(regex.test('file5.ts')).toBe(true);
    expect(regex.test('file9.ts')).toBe(true);
    expect(regex.test('filea.ts')).toBe(false);
  });

  it('should escape regex special characters', () => {
    const regex = globToRegex('file.name.ts');
    expect(regex.test('file.name.ts')).toBe(true);
    expect(regex.test('fileXnameXts')).toBe(false);
  });

  it('should handle mixed patterns', () => {
    const regex = globToRegex('src/**/*.spec.ts');
    expect(regex.test('src/utils.spec.ts')).toBe(true);
    expect(regex.test('src/lib/utils.spec.ts')).toBe(true);
    expect(regex.test('src/utils.ts')).toBe(false);
    expect(regex.test('test/utils.spec.ts')).toBe(false);
  });
});

describe('matchesAnyGlob', () => {
  it('should match simple pattern', () => {
    expect(matchesAnyGlob('file.ts', ['*.ts'])).toBe(true);
    expect(matchesAnyGlob('file.js', ['*.ts'])).toBe(false);
  });

  it('should match recursive pattern', () => {
    expect(matchesAnyGlob('src/file.ts', ['**/*.ts'])).toBe(true);
    expect(matchesAnyGlob('src/lib/file.ts', ['**/*.ts'])).toBe(true);
    expect(matchesAnyGlob('file.ts', ['**/*.ts'])).toBe(true);
  });

  it('should match any of multiple patterns', () => {
    expect(matchesAnyGlob('file.ts', ['*.ts', '*.js'])).toBe(true);
    expect(matchesAnyGlob('file.js', ['*.ts', '*.js'])).toBe(true);
    expect(matchesAnyGlob('file.py', ['*.ts', '*.js'])).toBe(false);
  });

  it('should handle negation patterns', () => {
    expect(
      matchesAnyGlob('src/file.ts', ['**/*.ts', '!**/*.spec.ts']),
    ).toBe(true);
    expect(
      matchesAnyGlob('src/file.spec.ts', ['**/*.ts', '!**/*.spec.ts']),
    ).toBe(false);
  });

  it('should exclude if any negation matches', () => {
    expect(
      matchesAnyGlob('test/file.ts', ['**/*.ts', '!test/**']),
    ).toBe(false);
    expect(matchesAnyGlob('src/file.ts', ['**/*.ts', '!test/**'])).toBe(true);
  });

  it('should handle Windows path separators', () => {
    expect(matchesAnyGlob('src\\file.ts', ['**/*.ts'])).toBe(true);
    expect(matchesAnyGlob('src\\lib\\file.ts', ['**/*.ts'])).toBe(true);
  });

  it('should return true for empty pattern list', () => {
    expect(matchesAnyGlob('file.ts', [])).toBe(true);
  });

  it('should handle only negation patterns', () => {
    // No positive patterns means everything matches unless excluded
    expect(matchesAnyGlob('file.ts', ['!*.spec.ts'])).toBe(true);
    expect(matchesAnyGlob('file.spec.ts', ['!*.spec.ts'])).toBe(false);
  });
});

describe('expandGlobs', () => {
  let fs: MemoryFileSystem;

  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  it('should expand simple wildcard pattern', async () => {
    await fs.writeFile('file1.ts' as WorkspacePath, 'content');
    await fs.writeFile('file2.ts' as WorkspacePath, 'content');
    await fs.writeFile('file3.js' as WorkspacePath, 'content');

    const matches = await expandGlobs(fs, '/', ['*.ts']);
    expect(matches).toHaveLength(2);
    expect(matches).toContain('/file1.ts');
    expect(matches).toContain('/file2.ts');
  });

  it('should expand recursive pattern', async () => {
    await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
    await fs.writeFile('src/lib/utils.ts' as WorkspacePath, 'content');
    await fs.writeFile('src/lib/helpers.ts' as WorkspacePath, 'content');
    await fs.writeFile('test/test.js' as WorkspacePath, 'content');

    const matches = await expandGlobs(fs, '/', ['**/*.ts']);
    expect(matches).toHaveLength(3);
    expect(matches).toContain('/src/index.ts');
    expect(matches).toContain('/src/lib/utils.ts');
    expect(matches).toContain('/src/lib/helpers.ts');
  });

  it('should handle multiple patterns', async () => {
    await fs.writeFile('file.ts' as WorkspacePath, 'content');
    await fs.writeFile('file.js' as WorkspacePath, 'content');
    await fs.writeFile('file.py' as WorkspacePath, 'content');

    const matches = await expandGlobs(fs, '/', ['*.ts', '*.js']);
    expect(matches).toHaveLength(2);
    expect(matches).toContain('/file.ts');
    expect(matches).toContain('/file.js');
  });

  it('should handle negation patterns', async () => {
    await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
    await fs.writeFile('src/utils.ts' as WorkspacePath, 'content');
    await fs.writeFile('src/test.spec.ts' as WorkspacePath, 'content');

    const matches = await expandGlobs(fs, '/', ['**/*.ts', '!**/*.spec.ts']);
    expect(matches).toHaveLength(2);
    expect(matches).toContain('/src/index.ts');
    expect(matches).toContain('/src/utils.ts');
  });

  it('should search from specific base directory', async () => {
    await fs.writeFile('src/index.ts' as WorkspacePath, 'content');
    await fs.writeFile('src/lib/utils.ts' as WorkspacePath, 'content');
    await fs.writeFile('test/test.ts' as WorkspacePath, 'content');

    const matches = await expandGlobs(fs, '/src', ['**/*.ts']);
    expect(matches).toHaveLength(2);
    expect(matches).toContain('/src/index.ts');
    expect(matches).toContain('/src/lib/utils.ts');
  });

  it('should return empty array for no matches', async () => {
    await fs.writeFile('file.js' as WorkspacePath, 'content');

    const matches = await expandGlobs(fs, '/', ['*.ts']);
    expect(matches).toHaveLength(0);
  });

  it('should return empty array for empty directory', async () => {
    const matches = await expandGlobs(fs, '/', ['*.ts']);
    expect(matches).toHaveLength(0);
  });

  it('should handle empty pattern list', async () => {
    await fs.writeFile('file.ts' as WorkspacePath, 'content');

    const matches = await expandGlobs(fs, '/', []);
    expect(matches).toHaveLength(1);
    expect(matches).toContain('/file.ts');
  });
});
