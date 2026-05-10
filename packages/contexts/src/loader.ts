/**
 * Project model loader — reads `.antimatter/*.ts` from a project root,
 * compiles each file via esbuild, dynamic-imports the compiled module,
 * collects every named export plus the default export, and feeds the
 * collected values to the assembler.
 *
 * Scope (Phase 0):
 *   - Reads the three canonical files: `resources.ts`, `contexts.ts`,
 *     `build.ts`. Other `.ts` files are ignored at this stage; the
 *     workflow manager keeps its own loader for the legacy callback
 *     style and only the three canonical filenames are wired into the
 *     new context model.
 *   - Returns load errors per-file (compilation failure, import
 *     failure, default-export-not-callable) inline alongside the
 *     resulting `ProjectModel`. Empty / missing files are not errors.
 *
 * Out of scope:
 *   - Hot reload (workflow-manager does this; Phase 1 wires it in).
 *   - Bundle size optimisation. Phase 0 marks `@antimatter/contexts`
 *     external so the compiled module imports the host package; this
 *     keeps the compiled output small and avoids loading two copies of
 *     the registry constants.
 */
import { resolve as pathResolve, isAbsolute } from 'node:path';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import {
  assembleProjectModel,
  classifyDeclarations,
} from './assemble.js';
import type { ProjectModel } from './model.js';

const CANONICAL_FILES = ['resources.ts', 'contexts.ts', 'build.ts'] as const;

export interface LoadFileError {
  readonly file: string;
  readonly stage: 'read' | 'compile' | 'import' | 'extract';
  readonly message: string;
}

export interface LoadResult {
  readonly model: ProjectModel;
  /** Per-file load errors (compile/import). Distinct from `model.errors`. */
  readonly loadErrors: readonly LoadFileError[];
  /** Files that were located and successfully parsed. */
  readonly loadedFiles: readonly string[];
}

export interface LoadOptions {
  /** Project root containing the `.antimatter/` directory. */
  readonly projectRoot: string;
  /**
   * Cache dir for compiled `.mjs` outputs. Defaults to
   * `<projectRoot>/.antimatter-cache/contexts/`.
   */
  readonly cacheDir?: string;
  /**
   * If provided, overrides which files to load (relative to
   * `<projectRoot>/.antimatter/`). Default: the three canonical files.
   */
  readonly files?: readonly string[];
}

/**
 * Load and assemble a project's context model from disk.
 */
export async function loadProjectModel(options: LoadOptions): Promise<LoadResult> {
  const projectRoot = isAbsolute(options.projectRoot)
    ? options.projectRoot
    : pathResolve(process.cwd(), options.projectRoot);

  const automationDir = pathResolve(projectRoot, '.antimatter');
  const cacheDir = options.cacheDir
    ? (isAbsolute(options.cacheDir) ? options.cacheDir : pathResolve(projectRoot, options.cacheDir))
    : pathResolve(projectRoot, '.antimatter-cache/contexts');
  await mkdir(cacheDir, { recursive: true });

  const targetFiles = options.files ?? CANONICAL_FILES;
  const loadErrors: LoadFileError[] = [];
  const loadedFiles: string[] = [];
  const collected: unknown[] = [];

  for (const filename of targetFiles) {
    const sourcePath = pathResolve(automationDir, filename);

    // Read source; skip silently if missing or empty.
    let source: string;
    try {
      const stats = await stat(sourcePath);
      if (!stats.isFile()) continue;
      source = await readFile(sourcePath, 'utf-8');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') continue;
      loadErrors.push({ file: filename, stage: 'read', message: errorMessage(err) });
      continue;
    }
    if (source.trim().length === 0) continue;

    // Compile via esbuild (transform-only — same approach as the
    // workflow manager; the compiled module imports host packages from
    // the project's node_modules).
    let compiledCode: string;
    try {
      const esbuild = await import('esbuild');
      const result = await esbuild.transform(source, {
        loader: 'ts',
        format: 'esm',
        target: 'node20',
        sourcefile: sourcePath,
      });
      compiledCode = result.code;
    } catch (err: unknown) {
      loadErrors.push({ file: filename, stage: 'compile', message: errorMessage(err) });
      continue;
    }

    // Write to cache and dynamic-import (cache-bust on every load so we
    // pick up edits without restarting the host).
    const compiledPath = pathResolve(cacheDir, filename.replace(/\.ts$/, '.compiled.mjs'));
    let imported: Record<string, unknown>;
    try {
      await writeFile(compiledPath, compiledCode, 'utf-8');
      const fileUrl = `file://${compiledPath.replace(/\\/g, '/')}?t=${Date.now()}`;
      imported = await import(fileUrl);
    } catch (err: unknown) {
      loadErrors.push({ file: filename, stage: 'import', message: errorMessage(err) });
      continue;
    }

    // Collect every export. The default export, if any, can be either:
    //   - a declaration array (Phase 0+ pattern)
    //   - a single declaration
    //   - a function (legacy callback style; ignored — those files
    //     belong to the workflow manager, not the context model)
    try {
      for (const [name, value] of Object.entries(imported)) {
        if (name === 'default') {
          if (Array.isArray(value)) {
            collected.push(...value);
          } else if (value && typeof value === 'object') {
            collected.push(value);
          }
          // function-default → workflow-style; ignored here.
          continue;
        }
        collected.push(value);
      }
      loadedFiles.push(filename);
    } catch (err: unknown) {
      loadErrors.push({ file: filename, stage: 'extract', message: errorMessage(err) });
    }
  }

  const classified = classifyDeclarations(collected);
  const model = assembleProjectModel(classified);

  return { model, loadErrors, loadedFiles };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
