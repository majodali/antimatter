import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../memory-fs.js';
import {
  detectLanguage,
  detectSourceType,
  createSourceFile,
  scanDirectory,
} from '../source-file-utils.js';

describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('file.ts')).toBe('typescript');
    expect(detectLanguage('file.tsx')).toBe('typescript');
    expect(detectLanguage('file.mts')).toBe('typescript');
  });

  it('detects JavaScript', () => {
    expect(detectLanguage('file.js')).toBe('javascript');
    expect(detectLanguage('file.jsx')).toBe('javascript');
    expect(detectLanguage('file.mjs')).toBe('javascript');
  });

  it('detects CSS variants', () => {
    expect(detectLanguage('file.css')).toBe('css');
    expect(detectLanguage('file.scss')).toBe('css');
  });

  it('detects JSON', () => {
    expect(detectLanguage('file.json')).toBe('json');
  });

  it('detects YAML', () => {
    expect(detectLanguage('file.yaml')).toBe('yaml');
    expect(detectLanguage('file.yml')).toBe('yaml');
  });

  it('detects Markdown', () => {
    expect(detectLanguage('file.md')).toBe('markdown');
  });

  it('detects Rust', () => {
    expect(detectLanguage('file.rs')).toBe('rust');
  });

  it('detects Go', () => {
    expect(detectLanguage('file.go')).toBe('go');
  });

  it('detects Python', () => {
    expect(detectLanguage('file.py')).toBe('python');
  });

  it('returns other for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBe('other');
    expect(detectLanguage('Makefile')).toBe('other');
  });
});

describe('detectSourceType', () => {
  it('detects test files', () => {
    expect(detectSourceType('file.spec.ts')).toBe('test');
    expect(detectSourceType('file.test.js')).toBe('test');
  });

  it('detects documentation', () => {
    expect(detectSourceType('README.md')).toBe('documentation');
    expect(detectSourceType('docs/guide.mdx')).toBe('documentation');
  });

  it('detects config files', () => {
    expect(detectSourceType('tsconfig.json')).toBe('config');
    expect(detectSourceType('package.json')).toBe('config');
    expect(detectSourceType('vitest.config.ts')).toBe('config');
    expect(detectSourceType('.eslintrc.json')).toBe('config');
  });

  it('detects assets', () => {
    expect(detectSourceType('logo.png')).toBe('asset');
    expect(detectSourceType('font.woff2')).toBe('asset');
    expect(detectSourceType('image.svg')).toBe('asset');
  });

  it('defaults to source', () => {
    expect(detectSourceType('index.ts')).toBe('source');
    expect(detectSourceType('utils.js')).toBe('source');
  });
});

describe('createSourceFile', () => {
  it('creates a SourceFile from filesystem', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('src/index.ts', 'export const x = 1;');
    const sf = await createSourceFile(fs, 'src/index.ts');
    expect(sf.path).toBe('src/index.ts');
    expect(sf.language).toBe('typescript');
    expect(sf.type).toBe('source');
    expect(sf.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sf.size).toBeGreaterThan(0);
  });
});

describe('scanDirectory', () => {
  it('recursively scans all files', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('src/index.ts', 'export {};');
    await fs.writeFile('src/utils/helper.ts', 'export function h() {}');
    await fs.writeFile('src/utils/helper.spec.ts', 'test');
    const files = await scanDirectory(fs, 'src');
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toEqual([
      'src/index.ts',
      'src/utils/helper.spec.ts',
      'src/utils/helper.ts',
    ]);
  });

  it('returns empty array for empty directory', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('empty');
    const files = await scanDirectory(fs, 'empty');
    expect(files).toEqual([]);
  });
});
