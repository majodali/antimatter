/**
 * Source-code emitters for `defineX(...)` calls.
 *
 * The "Add" automation commands (Phase 2.3) take typed inputs from the
 * IDE forms, run them through these emitters to produce a TS source
 * snippet, and append the snippet to the corresponding
 * `.antimatter/{resources,contexts,build}.ts` file.
 *
 * Design notes:
 *
 *  - Identifiers (variable names, ids) go through `safeIdent`/`safeId`
 *    which reject anything non-alphanumeric outside `[a-z0-9._-]`. This
 *    matches the runtime guard in `define.ts` and keeps the emitter
 *    safe against injection.
 *
 *  - Strings (descriptions, objectives, instructions, glob patterns)
 *    are emitted via JSON.stringify which handles all escapes correctly
 *    and never produces template-literal escape hazards.
 *
 *  - Imports: each emitter advertises which symbols it needs from
 *    `@antimatter/contexts`. The append helper is responsible for
 *    extending an existing import statement (or adding a fresh one) so
 *    the resulting file remains valid TS.
 *
 *  - Output is whitespace-stable: deterministic two-space indent and
 *    trailing newline. The caller appends the snippet directly to the
 *    target file's text.
 */
import type {
  Performer,
  ResourceKind,
} from './model.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EmittedDeclaration {
  /** Source snippet, e.g. `export const foo = defineFileSet({ ... });`. */
  readonly source: string;
  /** Symbols this snippet imports from `@antimatter/contexts`. */
  readonly imports: readonly string[];
  /** The variable name the snippet exports. */
  readonly varName: string;
}

// ---- Resource inputs ----

export interface EmitFileSetInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
}

export interface EmitConfigInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly source: { readonly kind: 'file' | 'env' | 'inline'; readonly value: string };
}

export interface EmitSecretInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly source: { readonly kind: 'env' | 'aws-secrets-manager' | 'file'; readonly key: string };
}

export interface EmitDeployedResourceInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly resourceType: string;
  readonly target: string;
}

export interface EmitEnvironmentInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly provider: string;
  readonly config?: Record<string, string>;
}

export interface EmitTestInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly testType?: 'unit' | 'functional' | 'smoke' | 'integration';
}

export interface EmitTestSetInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly members: readonly string[];
}

// ---- Rule input ----

export interface EmitRuleInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Trigger spec — recorded as a JSON-serialisable literal. */
  readonly on: unknown;
  /**
   * Action spec — for Phase 2 we model this as `{ kind: 'shell',
   * command: '…' }`. Other shapes are passed through as-is.
   */
  readonly run: unknown;
  readonly reads?: readonly EmitResourceRefInput[];
  readonly writes?: readonly EmitResourceRefInput[];
  readonly manual?: boolean;
}

export type EmitResourceRefInput =
  | { readonly mode: 'resource'; readonly id: string }
  | { readonly mode: 'context-output'; readonly contextId: string; readonly outputName: string }
  | { readonly mode: 'external'; readonly uri: string };

// ---- Context input ----

export interface EmitContextInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly objective: string;
  readonly objectiveNotes?: string;
  /** Named inputs — values are ResourceRef inputs. */
  readonly inputs?: Readonly<Record<string, EmitResourceRefInput>>;
  /** Named outputs — short kind name + optional description. */
  readonly outputs?: Readonly<Record<string, { readonly producesKind: ResourceKind; readonly description?: string }>>;
  readonly validations?: readonly EmitValidationBindingInput[];
  readonly action: EmitActionInput;
  readonly guidance?: string;
}

export interface EmitValidationBindingInput {
  readonly id: string;
  readonly validation: EmitValidationInput;
  readonly resources: readonly string[];
}

/** Validations the IDE form can emit. Mirrors the factory shapes. */
export type EmitValidationInput =
  | { readonly kind: 'rule-outcome'; readonly ruleId: string; readonly description?: string }
  | { readonly kind: 'test-pass'; readonly testId: string; readonly description?: string }
  | { readonly kind: 'test-set-pass'; readonly testSetId: string; readonly description?: string }
  | { readonly kind: 'deployed-resource-present'; readonly resourceId: string; readonly description?: string }
  | { readonly kind: 'deployed-resource-healthy'; readonly resourceId: string; readonly description?: string }
  | { readonly kind: 'manual-confirm'; readonly description: string }
  | { readonly kind: 'code'; readonly description: string; readonly fn: string; readonly module?: string };

/** Actions the IDE form can emit. Mirrors the factory shapes. */
export type EmitActionInput =
  | { readonly kind: 'agent'; readonly description: string; readonly instructions?: string; readonly agentId?: string }
  | { readonly kind: 'code'; readonly description: string; readonly fn: string; readonly module?: string }
  | { readonly kind: 'invoke-rule'; readonly ruleId: string; readonly description?: string }
  | { readonly kind: 'human'; readonly description: string; readonly instructions?: string; readonly role?: string }
  | { readonly kind: 'plan'; readonly description: string; readonly performer?: Performer };

// ---------------------------------------------------------------------------
// Resource emitters
// ---------------------------------------------------------------------------

export function emitFileSet(input: EmitFileSetInput): EmittedDeclaration {
  requireId('emitFileSet', input.id);
  if (!input.include?.length) throw new Error(`emitFileSet(${input.id}): include must be non-empty`);
  const lines: string[] = [];
  lines.push(`export const ${safeIdent(input.id)} = defineFileSet({`);
  lines.push(`  id: ${str(input.id)},`);
  if (input.name) lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  lines.push(`  include: [${input.include.map(str).join(', ')}],`);
  if (input.exclude?.length) lines.push(`  exclude: [${input.exclude.map(str).join(', ')}],`);
  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: ['defineFileSet'], varName: safeIdent(input.id) };
}

export function emitConfig(input: EmitConfigInput): EmittedDeclaration {
  requireId('emitConfig', input.id);
  const lines = [`export const ${safeIdent(input.id)} = defineConfig({`];
  lines.push(`  id: ${str(input.id)},`);
  if (input.name) lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  lines.push(`  source: { kind: ${str(input.source.kind)}, value: ${str(input.source.value)} },`);
  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: ['defineConfig'], varName: safeIdent(input.id) };
}

export function emitSecret(input: EmitSecretInput): EmittedDeclaration {
  requireId('emitSecret', input.id);
  const lines = [`export const ${safeIdent(input.id)} = defineSecret({`];
  lines.push(`  id: ${str(input.id)},`);
  if (input.name) lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  lines.push(`  source: { kind: ${str(input.source.kind)}, key: ${str(input.source.key)} },`);
  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: ['defineSecret'], varName: safeIdent(input.id) };
}

export function emitDeployedResource(input: EmitDeployedResourceInput): EmittedDeclaration {
  requireId('emitDeployedResource', input.id);
  const lines = [`export const ${safeIdent(input.id)} = defineDeployedResource({`];
  lines.push(`  id: ${str(input.id)},`);
  if (input.name) lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  lines.push(`  resourceType: ${str(input.resourceType)},`);
  lines.push(`  target: ${str(input.target)},`);
  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: ['defineDeployedResource'], varName: safeIdent(input.id) };
}

export function emitEnvironment(input: EmitEnvironmentInput): EmittedDeclaration {
  requireId('emitEnvironment', input.id);
  const lines = [`export const ${safeIdent(input.id)} = defineEnvironment({`];
  lines.push(`  id: ${str(input.id)},`);
  if (input.name) lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  lines.push(`  provider: ${str(input.provider)},`);
  if (input.config && Object.keys(input.config).length > 0) {
    lines.push(`  config: ${objectLiteral(input.config)},`);
  }
  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: ['defineEnvironment'], varName: safeIdent(input.id) };
}

export function emitTest(input: EmitTestInput): EmittedDeclaration {
  requireId('emitTest', input.id);
  const lines = [`export const ${safeIdent(input.id)} = defineTest({`];
  lines.push(`  id: ${str(input.id)},`);
  if (input.name) lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  if (input.testType) lines.push(`  testType: ${str(input.testType)},`);
  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: ['defineTest'], varName: safeIdent(input.id) };
}

export function emitTestSet(input: EmitTestSetInput): EmittedDeclaration {
  requireId('emitTestSet', input.id);
  const lines = [`export const ${safeIdent(input.id)} = defineTestSet({`];
  lines.push(`  id: ${str(input.id)},`);
  if (input.name) lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  lines.push(`  members: [${input.members.map(str).join(', ')}],`);
  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: ['defineTestSet'], varName: safeIdent(input.id) };
}

// ---------------------------------------------------------------------------
// Rule emitter
// ---------------------------------------------------------------------------

export function emitRule(input: EmitRuleInput): EmittedDeclaration {
  requireId('emitRule', input.id);
  if (!input.name) throw new Error(`emitRule(${input.id}): name is required`);

  const imports = new Set<string>(['defineRule']);
  const lines = [`export const ${safeIdent(input.id)} = defineRule({`];
  lines.push(`  id: ${str(input.id)},`);
  lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  lines.push(`  on: ${literal(input.on)},`);
  lines.push(`  run: ${literal(input.run)},`);

  if (input.reads?.length) {
    imports.add('ref');
    lines.push(`  reads: [${input.reads.map(emitResourceRefExpr).join(', ')}],`);
  }
  if (input.writes?.length) {
    imports.add('ref');
    lines.push(`  writes: [${input.writes.map(emitResourceRefExpr).join(', ')}],`);
  }
  if (input.manual) lines.push(`  manual: true,`);

  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: [...imports], varName: safeIdent(input.id) };
}

// ---------------------------------------------------------------------------
// Context emitter
// ---------------------------------------------------------------------------

export function emitContext(input: EmitContextInput): EmittedDeclaration {
  requireId('emitContext', input.id);
  if (!input.name) throw new Error(`emitContext(${input.id}): name is required`);
  if (!input.objective) throw new Error(`emitContext(${input.id}): objective is required`);
  if (!input.action) throw new Error(`emitContext(${input.id}): action is required`);

  const imports = new Set<string>(['defineContext', 'action']);
  const lines = [`export const ${safeIdent(input.id)} = defineContext({`];
  lines.push(`  id: ${str(input.id)},`);
  lines.push(`  name: ${str(input.name)},`);
  if (input.description) lines.push(`  description: ${str(input.description)},`);
  if (input.parentId) lines.push(`  parentId: ${str(input.parentId)},`);

  if (input.objectiveNotes) {
    lines.push(`  objective: { statement: ${str(input.objective)}, notes: ${str(input.objectiveNotes)} },`);
  } else {
    lines.push(`  objective: ${str(input.objective)},`);
  }

  if (input.inputs && Object.keys(input.inputs).length > 0) {
    imports.add('ref');
    const entries = Object.entries(input.inputs).map(
      ([k, v]) => `    ${safeKey(k)}: ${emitResourceRefExpr(v)}`,
    );
    lines.push(`  inputs: {`);
    lines.push(entries.join(',\n') + ',');
    lines.push(`  },`);
  }

  if (input.outputs && Object.keys(input.outputs).length > 0) {
    imports.add('output');
    const entries = Object.entries(input.outputs).map(([k, v]) => {
      const desc = v.description ? `, ${str(v.description)}` : '';
      return `    ${safeKey(k)}: output(${str(v.producesKind)}${desc})`;
    });
    lines.push(`  outputs: {`);
    lines.push(entries.join(',\n') + ',');
    lines.push(`  },`);
  }

  if (input.validations?.length) {
    imports.add('validation');
    lines.push(`  validations: [`);
    for (const v of input.validations) {
      lines.push(`    {`);
      lines.push(`      id: ${str(v.id)},`);
      lines.push(`      validation: ${emitValidationExpr(v.validation)},`);
      lines.push(`      resources: [${v.resources.map(str).join(', ')}],`);
      lines.push(`    },`);
    }
    lines.push(`  ],`);
  }

  lines.push(`  action: ${emitActionExpr(input.action)},`);
  if (input.guidance) lines.push(`  guidance: ${str(input.guidance)},`);

  lines.push(`});`);
  return { source: lines.join('\n') + '\n', imports: [...imports], varName: safeIdent(input.id) };
}

// ---------------------------------------------------------------------------
// Sub-expression helpers (validation, action, ref)
// ---------------------------------------------------------------------------

function emitResourceRefExpr(r: EmitResourceRefInput): string {
  if (r.mode === 'resource') return `ref.resource(${str(r.id)})`;
  if (r.mode === 'context-output') return `ref.contextOutput(${str(r.contextId)}, ${str(r.outputName)})`;
  return `ref.external(${str(r.uri)})`;
}

function emitValidationExpr(v: EmitValidationInput): string {
  switch (v.kind) {
    case 'rule-outcome':
      return `validation.ruleOutcome({ ruleId: ${str(v.ruleId)}${descPart(v.description)} })`;
    case 'test-pass':
      return `validation.testPass({ testId: ${str(v.testId)}${descPart(v.description)} })`;
    case 'test-set-pass':
      return `validation.testSetPass({ testSetId: ${str(v.testSetId)}${descPart(v.description)} })`;
    case 'deployed-resource-present':
      return `validation.deployedResourcePresent({ resourceId: ${str(v.resourceId)}${descPart(v.description)} })`;
    case 'deployed-resource-healthy':
      return `validation.deployedResourceHealthy({ resourceId: ${str(v.resourceId)}${descPart(v.description)} })`;
    case 'manual-confirm':
      return `validation.manualConfirm({ description: ${str(v.description)} })`;
    case 'code': {
      const mod = v.module ? `, module: ${str(v.module)}` : '';
      return `validation.code({ description: ${str(v.description)}, fn: ${str(v.fn)}${mod} })`;
    }
  }
}

function emitActionExpr(a: EmitActionInput): string {
  switch (a.kind) {
    case 'agent': {
      const parts = [`description: ${str(a.description)}`];
      if (a.instructions) parts.push(`instructions: ${str(a.instructions)}`);
      if (a.agentId) parts.push(`agentId: ${str(a.agentId)}`);
      return `action.agent({ ${parts.join(', ')} })`;
    }
    case 'code': {
      const parts = [`description: ${str(a.description)}`, `fn: ${str(a.fn)}`];
      if (a.module) parts.push(`module: ${str(a.module)}`);
      return `action.code({ ${parts.join(', ')} })`;
    }
    case 'invoke-rule': {
      const parts = [`ruleId: ${str(a.ruleId)}`];
      if (a.description) parts.push(`description: ${str(a.description)}`);
      return `action.invokeRule({ ${parts.join(', ')} })`;
    }
    case 'human': {
      const parts = [`description: ${str(a.description)}`];
      if (a.instructions) parts.push(`instructions: ${str(a.instructions)}`);
      if (a.role) parts.push(`role: ${str(a.role)}`);
      return `action.human({ ${parts.join(', ')} })`;
    }
    case 'plan': {
      return `action.plan({ description: ${str(a.description)} })`;
    }
  }
}

function descPart(description: string | undefined): string {
  return description ? `, description: ${str(description)}` : '';
}

// ---------------------------------------------------------------------------
// Append helper — extends an existing import line or adds a fresh one
// ---------------------------------------------------------------------------

const IMPORT_RE = /^import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]@antimatter\/contexts['"]\s*;?\s*$/m;

/**
 * Append an emitted declaration to a TS source file's text, extending
 * the existing `import { … } from '@antimatter/contexts'` line so all
 * referenced helpers are imported.
 *
 * If no such import exists, a fresh import line is prepended (after a
 * leading comment block, if present) along with a single blank line
 * separating the imports from the file body.
 *
 * If the target file is empty, a minimal header (single import line)
 * plus the snippet is produced.
 */
export function appendDeclaration(
  existingSource: string,
  decl: EmittedDeclaration,
  options?: { fileLabel?: string },
): string {
  const wantedImports = new Set<string>(decl.imports);

  if (existingSource.trim().length === 0) {
    const header = options?.fileLabel
      ? `/**\n * ${options.fileLabel}\n */\n`
      : '';
    return `${header}import { ${[...wantedImports].sort().join(', ')} } from '@antimatter/contexts';\n\n${decl.source}`;
  }

  const m = IMPORT_RE.exec(existingSource);
  if (!m) {
    // No existing import — prepend one.
    return `import { ${[...wantedImports].sort().join(', ')} } from '@antimatter/contexts';\n\n${existingSource.replace(/\n*$/, '\n')}\n${decl.source}`;
  }

  // Merge into existing imports.
  const existing = m[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
  const merged = new Set<string>(existing);
  for (const i of wantedImports) merged.add(i);
  const newImportLine = `import { ${[...merged].sort().join(', ')} } from '@antimatter/contexts';`;
  const replaced = existingSource.replace(IMPORT_RE, newImportLine);

  // Append the snippet — ensure exactly one blank line between existing body and snippet.
  const trimmedTrailing = replaced.replace(/\n*$/, '');
  return `${trimmedTrailing}\n\n${decl.source}`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function requireId(fn: string, id: string | undefined): asserts id is string {
  if (!id || typeof id !== 'string') {
    throw new Error(`${fn}: id is required`);
  }
  if (!ID_RE.test(id)) {
    throw new Error(`${fn}: id '${id}' must match /^[a-z0-9][a-z0-9._-]*$/i`);
  }
}

/**
 * Map a kebab/snake/dotted id to a safe JS identifier. The id has
 * already been validated by `requireId`; here we just transform any
 * non-ident chars to underscores so the emitted variable name is
 * valid TS.
 */
function safeIdent(id: string): string {
  // Already validated to start with [a-z0-9]; just sanitise the rest.
  return id.replace(/[.-]/g, '_');
}

/** JS string literal that survives any embedded quote / newline / unicode. */
function str(s: string): string {
  return JSON.stringify(s);
}

/**
 * For object keys: bare identifier when valid, quoted string otherwise.
 * We accept any non-empty key here (validated upstream by the form).
 */
function safeKey(k: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)) return k;
  return JSON.stringify(k);
}

/**
 * Simple JSON-shaped literal for opaque trigger / action specs. Strings
 * become quoted; objects/arrays become single-line literals. Anything
 * exotic falls back to JSON.stringify.
 */
function literal(value: unknown): string {
  return JSON.stringify(value);
}

function objectLiteral(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(([k, v]) => `${safeKey(k)}: ${str(v)}`);
  return `{ ${entries.join(', ')} }`;
}
