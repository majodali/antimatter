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

  // Drop a stub `@antimatter/contexts` package alongside the cache so
  // compiled .mjs files can `import { defineX } from '@antimatter/contexts'`
  // even on workspace servers where there is no real node_modules tree.
  // The stub is shape-preserving only — it doesn't share identity with
  // the host's @antimatter/contexts module, but the assembler classifies
  // declarations by their `__kind` discriminator, which is stable.
  await ensureStubPackage(pathResolve(projectRoot, '.antimatter-cache'));

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

/**
 * Cache of stub-package roots we've already written this process — avoids
 * rewriting the same files on every load.
 */
const STUB_WRITTEN = new Set<string>();

/**
 * Write a minimal stub `@antimatter/contexts` package under
 * `<stubRoot>/node_modules/@antimatter/contexts/`. The stub re-implements
 * `defineX()` / `ref` / `validation` / `action` / `output` as standalone
 * functions that produce the same `__kind`-tagged shapes the bundled
 * assembler classifies. It does NOT share identity with the host's
 * `@antimatter/contexts` module, which is fine because classification is
 * by the literal string `__kind`, not by reference.
 *
 * Idempotent within a process via {@link STUB_WRITTEN}; cheap to re-run
 * across process restarts.
 */
async function ensureStubPackage(stubRoot: string): Promise<void> {
  if (STUB_WRITTEN.has(stubRoot)) return;
  const pkgDir = pathResolve(stubRoot, 'node_modules/@antimatter/contexts');
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    pathResolve(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@antimatter/contexts',
      version: '0.0.0-stub',
      type: 'module',
      main: 'index.mjs',
      exports: { '.': './index.mjs' },
    }, null, 2),
    'utf-8',
  );
  await writeFile(pathResolve(pkgDir, 'index.mjs'), STUB_INDEX_SOURCE, 'utf-8');
  STUB_WRITTEN.add(stubRoot);
}

/**
 * Source of the stub package's `index.mjs`. Mirrors the public surface of
 * `@antimatter/contexts/define.ts` (minus type-only exports). KIND values
 * are inlined to match the host's `model.ts` exactly.
 */
const STUB_INDEX_SOURCE = `// Auto-generated stub for @antimatter/contexts.
// Re-implements the define*/ref/validation/action/output helpers so that
// compiled .antimatter/*.ts files can resolve their imports on hosts that
// don't ship a real node_modules tree (e.g., the bundled workspace server).
// Shape-preserving only: identity is not shared with the host module.

export const KIND = Object.freeze({
  Context:           'antimatter:context',
  FileSet:           'antimatter:resource:file-set',
  Config:            'antimatter:resource:config',
  Secret:            'antimatter:resource:secret',
  DeployedResource:  'antimatter:resource:deployed-resource',
  Environment:       'antimatter:resource:environment',
  Test:              'antimatter:resource:test',
  TestSet:           'antimatter:resource:test-set',
  Signal:            'antimatter:resource:signal',
  Authorization:     'antimatter:resource:authorization',
  Rule:              'antimatter:rule',
  Validation:        'antimatter:validation',
  Action:            'antimatter:action',
  ResourceRef:       'antimatter:resource-ref',
});

const DEFAULT_PERFORMER = Object.freeze({ kind: 'code' });

function requireId(fn, id) {
  if (!id || typeof id !== 'string') {
    throw new Error(\`\${fn}: 'id' is required and must be a non-empty string\`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(\`\${fn}: id '\${id}' must match /^[a-z0-9][a-z0-9._-]*$/i\`);
  }
}

function requireResourceRef(label, r) {
  if (!r || typeof r !== 'object' || r.__kind !== KIND.ResourceRef) {
    throw new Error(\`\${label}: expected a ResourceRef built with ref.* factories, got \${typeof r}\`);
  }
}

export const ref = Object.freeze({
  resource(id) {
    if (!id) throw new Error('ref.resource: id is required');
    return { __kind: KIND.ResourceRef, mode: 'resource', id };
  },
  contextOutput(contextId, outputName) {
    if (!contextId) throw new Error('ref.contextOutput: contextId is required');
    if (!outputName) throw new Error('ref.contextOutput: outputName is required');
    return { __kind: KIND.ResourceRef, mode: 'context-output', contextId, outputName };
  },
  external(uri) {
    if (!uri) throw new Error('ref.external: uri is required');
    return { __kind: KIND.ResourceRef, mode: 'external', uri };
  },
});

export function defineFileSet(input) {
  requireId('defineFileSet', input.id);
  if (!input.include?.length) {
    throw new Error(\`defineFileSet(\${input.id}): 'include' must be a non-empty array of glob patterns\`);
  }
  return {
    __kind: KIND.FileSet,
    id: input.id, name: input.name, description: input.description,
    include: input.include, exclude: input.exclude,
  };
}

export function defineConfig(input) {
  requireId('defineConfig', input.id);
  if (!input.source) throw new Error(\`defineConfig(\${input.id}): 'source' is required\`);
  return {
    __kind: KIND.Config,
    id: input.id, name: input.name, description: input.description, source: input.source,
  };
}

export function defineSecret(input) {
  requireId('defineSecret', input.id);
  if (!input.source) throw new Error(\`defineSecret(\${input.id}): 'source' is required\`);
  return {
    __kind: KIND.Secret,
    id: input.id, name: input.name, description: input.description, source: input.source,
  };
}

export function defineDeployedResource(input) {
  requireId('defineDeployedResource', input.id);
  if (!input.resourceType) throw new Error(\`defineDeployedResource(\${input.id}): 'resourceType' is required\`);
  if (!input.target) throw new Error(\`defineDeployedResource(\${input.id}): 'target' is required\`);
  return {
    __kind: KIND.DeployedResource,
    id: input.id, name: input.name, description: input.description,
    resourceType: input.resourceType, target: input.target,
  };
}

export function defineEnvironment(input) {
  requireId('defineEnvironment', input.id);
  if (!input.provider) throw new Error(\`defineEnvironment(\${input.id}): 'provider' is required\`);
  return {
    __kind: KIND.Environment,
    id: input.id, name: input.name, description: input.description,
    provider: input.provider, config: input.config,
  };
}

export function defineTest(input) {
  requireId('defineTest', input.id);
  if (input.source !== undefined) requireResourceRef('defineTest.source', input.source);
  return {
    __kind: KIND.Test,
    id: input.id, name: input.name, description: input.description,
    testType: input.testType, source: input.source,
  };
}

export function defineTestSet(input) {
  requireId('defineTestSet', input.id);
  if (!Array.isArray(input.members)) {
    throw new Error(\`defineTestSet(\${input.id}): 'members' must be an array of test ids\`);
  }
  return {
    __kind: KIND.TestSet,
    id: input.id, name: input.name, description: input.description, members: input.members,
  };
}

export function defineSignal(input) {
  requireId('defineSignal', input.id);
  if (!input.source) throw new Error(\`defineSignal(\${input.id}): 'source' is required\`);
  return {
    __kind: KIND.Signal,
    id: input.id, name: input.name, description: input.description, source: input.source,
  };
}

export function defineAuthorization(input) {
  requireId('defineAuthorization', input.id);
  if (!input.grant) throw new Error(\`defineAuthorization(\${input.id}): 'grant' is required\`);
  return {
    __kind: KIND.Authorization,
    id: input.id, name: input.name, description: input.description, grant: input.grant,
  };
}

export function defineRule(input) {
  requireId('defineRule', input.id);
  if (!input.name) throw new Error(\`defineRule(\${input.id}): 'name' is required\`);
  if (input.on === undefined) throw new Error(\`defineRule(\${input.id}): 'on' is required\`);
  if (input.run === undefined) throw new Error(\`defineRule(\${input.id}): 'run' is required\`);
  for (const r of input.reads ?? []) requireResourceRef(\`defineRule(\${input.id}).reads\`, r);
  for (const r of input.writes ?? []) requireResourceRef(\`defineRule(\${input.id}).writes\`, r);
  return {
    __kind: KIND.Rule,
    id: input.id, name: input.name, description: input.description,
    on: input.on, run: input.run,
    reads: input.reads, writes: input.writes, manual: input.manual,
  };
}

export const validation = Object.freeze({
  ruleOutcome(args) {
    if (!args.ruleId) throw new Error('validation.ruleOutcome: ruleId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? \`Rule "\${args.ruleId}" last run succeeded\`,
      performer: args.performer ?? DEFAULT_PERFORMER,
      kind: 'rule-outcome', config: { ruleId: args.ruleId },
    };
  },
  testPass(args) {
    if (!args.testId) throw new Error('validation.testPass: testId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? \`Test "\${args.testId}" passes\`,
      performer: args.performer ?? DEFAULT_PERFORMER,
      kind: 'test-pass', config: { testId: args.testId },
    };
  },
  testSetPass(args) {
    if (!args.testSetId) throw new Error('validation.testSetPass: testSetId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? \`All tests in set "\${args.testSetId}" pass\`,
      performer: args.performer ?? DEFAULT_PERFORMER,
      kind: 'test-set-pass', config: { testSetId: args.testSetId },
    };
  },
  deployedResourcePresent(args) {
    if (!args.resourceId) throw new Error('validation.deployedResourcePresent: resourceId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? \`Deployed resource "\${args.resourceId}" is present\`,
      performer: args.performer ?? { kind: 'service', service: 'deployed-resources' },
      kind: 'deployed-resource-present', config: { resourceId: args.resourceId },
    };
  },
  deployedResourceHealthy(args) {
    if (!args.resourceId) throw new Error('validation.deployedResourceHealthy: resourceId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? \`Deployed resource "\${args.resourceId}" is healthy\`,
      performer: args.performer ?? { kind: 'service', service: 'deployed-resources' },
      kind: 'deployed-resource-healthy', config: { resourceId: args.resourceId },
    };
  },
  manualConfirm(args) {
    if (!args.description) throw new Error('validation.manualConfirm: description is required');
    return {
      __kind: KIND.Validation,
      description: args.description,
      performer: args.performer ?? { kind: 'human' },
      kind: 'manual-confirm',
    };
  },
  code(args) {
    if (!args.description) throw new Error('validation.code: description is required');
    if (!args.fn) throw new Error('validation.code: fn is required');
    return {
      __kind: KIND.Validation,
      description: args.description,
      performer: args.performer ?? { kind: 'code', module: args.module, fn: args.fn },
      kind: 'code', config: { module: args.module, fn: args.fn },
    };
  },
});

export const action = Object.freeze({
  agent(args) {
    if (!args.description) throw new Error('action.agent: description is required');
    return {
      __kind: KIND.Action, description: args.description,
      performer: { kind: 'agent', agentId: args.agentId },
      kind: 'agent', config: { instructions: args.instructions },
    };
  },
  code(args) {
    if (!args.description) throw new Error('action.code: description is required');
    if (!args.fn) throw new Error('action.code: fn is required');
    return {
      __kind: KIND.Action, description: args.description,
      performer: { kind: 'code', module: args.module, fn: args.fn },
      kind: 'code', config: { module: args.module, fn: args.fn },
    };
  },
  invokeRule(args) {
    if (!args.ruleId) throw new Error('action.invokeRule: ruleId is required');
    return {
      __kind: KIND.Action,
      description: args.description ?? \`Invoke workflow rule "\${args.ruleId}"\`,
      performer: { kind: 'service', service: 'workflow' },
      kind: 'invoke-rule', config: { ruleId: args.ruleId },
    };
  },
  human(args) {
    if (!args.description) throw new Error('action.human: description is required');
    return {
      __kind: KIND.Action, description: args.description,
      performer: { kind: 'human', role: args.role },
      kind: 'human', config: { instructions: args.instructions },
    };
  },
  plan(args) {
    if (!args.description) throw new Error('action.plan: description is required');
    return {
      __kind: KIND.Action, description: args.description,
      performer: args.performer ?? { kind: 'agent' },
      kind: 'plan',
    };
  },
});

export function output(producesKind, description) {
  return { producesKind, description };
}

export function defineContext(input) {
  requireId('defineContext', input.id);
  if (!input.name) throw new Error(\`defineContext(\${input.id}): 'name' is required\`);
  if (!input.objective) throw new Error(\`defineContext(\${input.id}): 'objective' is required\`);
  if (!input.action) throw new Error(\`defineContext(\${input.id}): 'action' is required\`);
  if (input.action.__kind !== KIND.Action) {
    throw new Error(\`defineContext(\${input.id}): 'action' must be built via action.* factories\`);
  }
  const objective = typeof input.objective === 'string' ? { statement: input.objective } : input.objective;
  const inputs = input.inputs ?? {};
  const outputs = input.outputs ?? {};
  const validations = input.validations ?? [];
  for (const [name, r] of Object.entries(inputs)) {
    requireResourceRef(\`defineContext(\${input.id}).inputs.\${name}\`, r);
  }
  const seenBindings = new Set();
  for (const v of validations) {
    if (!v.id) throw new Error(\`defineContext(\${input.id}): every validation binding needs an id\`);
    if (seenBindings.has(v.id)) {
      throw new Error(\`defineContext(\${input.id}): duplicate validation binding id '\${v.id}'\`);
    }
    seenBindings.add(v.id);
    if (v.validation?.__kind !== KIND.Validation) {
      throw new Error(\`defineContext(\${input.id}): validation '\${v.id}' must be built via validation.* factories\`);
    }
    if (!Array.isArray(v.resources)) {
      throw new Error(\`defineContext(\${input.id}): validation '\${v.id}' must declare a 'resources' array (may be empty)\`);
    }
  }
  return {
    __kind: KIND.Context,
    id: input.id, name: input.name, description: input.description, parentId: input.parentId,
    objective, inputs, outputs, validations, action: input.action, guidance: input.guidance,
  };
}
`;
