import type { SourceFile, SourceLanguage, SourceType } from '@antimatter/project-model';
import { extName, baseName, normalizePath, joinPath } from './path-utils.js';
import { hashContent } from './hashing.js';
import type { FileSystem, WorkspacePath } from './types.js';

const LANGUAGE_MAP: Record<string, SourceLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.rs': 'rust',
  '.go': 'go',
  '.py': 'python',
};

const TEST_PATTERN = /\.(spec|test)\.[^.]+$/;
const CONFIG_PATTERNS = [
  /^\..*rc(\.[^.]+)?$/,
  /config\.[^.]+$/,
  /\.config\.[^.]+$/,
  /tsconfig.*\.json$/,
  /package\.json$/,
  /\.eslintrc/,
];
const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.webp', '.avif', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
  '.pdf', '.zip', '.tar', '.gz',
]);

export function detectLanguage(path: WorkspacePath): SourceLanguage {
  const ext = extName(path).toLowerCase();
  return LANGUAGE_MAP[ext] ?? 'other';
}

export function detectSourceType(path: WorkspacePath): SourceType {
  const name = baseName(path);
  const ext = extName(path).toLowerCase();

  if (ext === '.md' || ext === '.mdx') return 'documentation';
  if (TEST_PATTERN.test(name)) return 'test';
  if (ASSET_EXTENSIONS.has(ext)) return 'asset';
  if (CONFIG_PATTERNS.some((p) => p.test(name))) return 'config';
  return 'source';
}

export async function createSourceFile(
  fs: FileSystem,
  path: WorkspacePath,
): Promise<SourceFile> {
  const normalized = normalizePath(path);
  const content = await fs.readFile(normalized);
  const hash = hashContent(content);
  return {
    path: normalized,
    language: detectLanguage(normalized),
    type: detectSourceType(normalized),
    hash,
    size: content.byteLength,
  };
}

export async function scanDirectory(
  fs: FileSystem,
  root: WorkspacePath,
): Promise<SourceFile[]> {
  const normalized = normalizePath(root);
  const results: SourceFile[] = [];
  const stack: WorkspacePath[] = [normalized];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await fs.readDirectory(dir);
    for (const entry of entries) {
      const entryPath = dir === '' ? entry.name : joinPath(dir, entry.name);
      if (entry.isDirectory) {
        stack.push(entryPath);
      } else {
        results.push(await createSourceFile(fs, entryPath));
      }
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}
