import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  joinPath,
  dirName,
  baseName,
  extName,
  isWithin,
} from '../path-utils.js';

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\utils\\file.ts')).toBe('src/utils/file.ts');
  });

  it('strips leading ./', () => {
    expect(normalizePath('./src/file.ts')).toBe('src/file.ts');
  });

  it('strips leading /', () => {
    expect(normalizePath('/src/file.ts')).toBe('src/file.ts');
  });

  it('collapses .. segments', () => {
    expect(normalizePath('src/utils/../file.ts')).toBe('src/file.ts');
  });

  it('collapses . segments', () => {
    expect(normalizePath('src/./file.ts')).toBe('src/file.ts');
  });

  it('returns empty string for .', () => {
    expect(normalizePath('.')).toBe('');
  });

  it('returns empty string for /', () => {
    expect(normalizePath('/')).toBe('');
  });

  it('handles already-normalized paths', () => {
    expect(normalizePath('src/file.ts')).toBe('src/file.ts');
  });
});

describe('joinPath', () => {
  it('joins two segments', () => {
    expect(joinPath('src', 'file.ts')).toBe('src/file.ts');
  });

  it('joins multiple segments', () => {
    expect(joinPath('src', 'utils', 'file.ts')).toBe('src/utils/file.ts');
  });

  it('normalizes the result', () => {
    expect(joinPath('src', '../lib', 'file.ts')).toBe('lib/file.ts');
  });
});

describe('dirName', () => {
  it('returns parent directory', () => {
    expect(dirName('src/utils/file.ts')).toBe('src/utils');
  });

  it('returns empty string for top-level file', () => {
    expect(dirName('file.ts')).toBe('');
  });
});

describe('baseName', () => {
  it('returns file name with extension', () => {
    expect(baseName('src/utils/file.ts')).toBe('file.ts');
  });

  it('strips given extension', () => {
    expect(baseName('src/file.ts', '.ts')).toBe('file');
  });
});

describe('extName', () => {
  it('returns extension', () => {
    expect(extName('file.ts')).toBe('.ts');
  });

  it('returns last extension for double extensions', () => {
    expect(extName('file.spec.ts')).toBe('.ts');
  });

  it('returns empty string when no extension', () => {
    expect(extName('Makefile')).toBe('');
  });
});

describe('isWithin', () => {
  it('returns true for child path', () => {
    expect(isWithin('src', 'src/file.ts')).toBe(true);
  });

  it('returns true for deeply nested child', () => {
    expect(isWithin('src', 'src/utils/deep/file.ts')).toBe(true);
  });

  it('returns false for sibling path', () => {
    expect(isWithin('src', 'lib/file.ts')).toBe(false);
  });

  it('returns false for same path', () => {
    expect(isWithin('src', 'src')).toBe(false);
  });

  it('returns false for prefix-matching but not child', () => {
    expect(isWithin('src', 'src2/file.ts')).toBe(false);
  });

  it('returns true when parent is root (empty string)', () => {
    expect(isWithin('', 'src/file.ts')).toBe(true);
  });
});
