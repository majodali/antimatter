/**
 * Project model assembler — pure function: takes lists of declarations
 * (already in memory; the loader handles compiling/importing files) and
 * returns a `ProjectModel` with validation errors inlined.
 *
 * Assembly is non-throwing: every consistency problem is reported via
 * `model.errors` so the IDE can render a partial/broken state instead
 * of crashing. Callers that want strictness should check the array.
 *
 * Validation passes:
 *
 *   1. Stable categorisation of declarations by `__kind`. Anything that
 *      isn't a recognised declaration kind is silently dropped (it may
 *      be a helper, a constant, etc. — exporting non-declarations is
 *      legal).
 *
 *   2. Id uniqueness within each kind family (Context / Resource /
 *      Rule). Cross-family collisions are also flagged because IDs are
 *      used as namespace keys.
 *
 *   3. Containment graph: every `parentId` resolves to an existing
 *      Context; exactly one root (no parent) exists; no cycles.
 *
 *   4. Resource ref resolution for every ResourceRef inside contexts
 *      (inputs) and rules (reads/writes):
 *        - 'resource' refs must point to a declared resource id
 *        - 'context-output' refs must point to (existing context, declared output)
 *        - 'external' refs are accepted as-is
 *
 *   5. Validation binding resources must each name an input (in the
 *      current context's inputs map), an output (in outputs), or a
 *      declared resource id. Names not in any of those scopes are
 *      flagged.
 *
 *   6. Validation kind-specific reference checks:
 *        - rule-outcome → ruleId must exist
 *        - test-pass    → testId must exist
 *        - test-set-pass → testSetId must exist
 *        - deployed-resource-* → resourceId must exist & be a deployed-resource
 *
 *   7. TestSet members must each name a declared test id.
 */
import {
  KIND,
  type ContextDeclaration,
  type ResourceDeclaration,
  type RuleDeclaration,
  type ProjectModel,
  type ProjectModelError,
  type AnyDeclaration,
  type ValidationBinding,
  type ResourceRef,
  RESOURCE_DISCRIMINATORS,
} from './model.js';

const RESOURCE_DISCRIMINATOR_SET: ReadonlySet<string> = new Set(RESOURCE_DISCRIMINATORS);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AssembleInput {
  readonly contexts?: readonly ContextDeclaration[];
  readonly resources?: readonly ResourceDeclaration[];
  readonly rules?: readonly RuleDeclaration[];
}

/**
 * Classify a heterogeneous list of declarations (typically gathered
 * from `.antimatter/*.ts` exports) into kind-specific lists.
 * Non-declaration values are dropped.
 */
export function classifyDeclarations(values: readonly unknown[]): AssembleInput {
  const contexts: ContextDeclaration[] = [];
  const resources: ResourceDeclaration[] = [];
  const rules: RuleDeclaration[] = [];

  for (const v of values) {
    if (!isDeclaration(v)) continue;
    if (v.__kind === KIND.Context) {
      contexts.push(v as ContextDeclaration);
    } else if (v.__kind === KIND.Rule) {
      rules.push(v as RuleDeclaration);
    } else if (RESOURCE_DISCRIMINATOR_SET.has(v.__kind)) {
      resources.push(v as ResourceDeclaration);
    }
  }

  return { contexts, resources, rules };
}

/**
 * Build a ProjectModel from a set of declarations. Always returns a
 * model — `errors` is the source of truth for problems.
 */
export function assembleProjectModel(input: AssembleInput): ProjectModel {
  const errors: ProjectModelError[] = [];

  // 1. Index declarations by id, flagging duplicates.
  const contexts = new Map<string, ContextDeclaration>();
  const resources = new Map<string, ResourceDeclaration>();
  const rules = new Map<string, RuleDeclaration>();
  const idToFamily = new Map<string, 'context' | 'resource' | 'rule'>();

  for (const c of input.contexts ?? []) addToIndex(c, 'context', contexts, idToFamily, errors);
  for (const r of input.resources ?? []) addToIndex(r, 'resource', resources, idToFamily, errors);
  for (const r of input.rules ?? []) addToIndex(r, 'rule', rules, idToFamily, errors);

  // 2. Build containment index.
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const roots: string[] = [];
  for (const ctx of contexts.values()) {
    if (ctx.parentId) {
      if (!contexts.has(ctx.parentId)) {
        errors.push({
          code: 'unknown-parent',
          message: `Context '${ctx.id}' has parentId '${ctx.parentId}', which is not a declared context`,
          subject: ctx.id,
          target: ctx.parentId,
        });
        continue;
      }
      parentOf.set(ctx.id, ctx.parentId);
      const list = children.get(ctx.parentId) ?? [];
      list.push(ctx.id);
      children.set(ctx.parentId, list);
    } else {
      roots.push(ctx.id);
    }
  }
  if (contexts.size > 0) {
    if (roots.length === 0) {
      errors.push({ code: 'no-root', message: 'No root context found (every context has a parentId).' });
    } else if (roots.length > 1) {
      errors.push({
        code: 'multiple-roots',
        message: `Multiple root contexts: ${roots.join(', ')}. Exactly one is allowed.`,
      });
    }
  }

  // 3. Cycle detection in containment.
  for (const cycle of findContainsCycles(contexts, parentOf)) {
    errors.push({
      code: 'contains-cycle',
      message: `Cycle in context containment: ${cycle.join(' → ')}`,
    });
  }

  // 4. Resolve ResourceRefs in contexts and rules.
  for (const ctx of contexts.values()) {
    for (const [name, r] of Object.entries(ctx.inputs)) {
      checkResourceRef(`context '${ctx.id}' input '${name}'`, ctx.id, r, contexts, resources, errors);
    }
  }
  for (const rule of rules.values()) {
    for (const r of rule.reads ?? []) {
      checkResourceRef(`rule '${rule.id}' reads`, rule.id, r, contexts, resources, errors);
    }
    for (const r of rule.writes ?? []) {
      checkResourceRef(`rule '${rule.id}' writes`, rule.id, r, contexts, resources, errors);
    }
  }

  // 5. Validation binding scope — each named resource must be an input,
  //    an output, or a declared resource id.
  for (const ctx of contexts.values()) {
    for (const v of ctx.validations) {
      checkValidationBinding(ctx, v, resources, rules, errors);
    }
  }

  // 6. TestSet members must reference declared tests.
  for (const r of resources.values()) {
    if (r.__kind !== KIND.TestSet) continue;
    for (const memberId of r.members) {
      const m = resources.get(memberId);
      if (!m || m.__kind !== KIND.Test) {
        errors.push({
          code: 'unresolved-test-member',
          message: `Test set '${r.id}' references test '${memberId}', which is not a declared test`,
          subject: r.id,
          target: memberId,
        });
      }
    }
  }

  return {
    contexts,
    resources,
    rules,
    children: new Map([...children.entries()].map(([k, v]) => [k, [...v]])),
    parentOf,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isDeclaration(v: unknown): v is AnyDeclaration {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { __kind?: unknown }).__kind;
  if (typeof k !== 'string') return false;
  return (
    k === KIND.Context ||
    k === KIND.Rule ||
    RESOURCE_DISCRIMINATOR_SET.has(k)
  );
}

function addToIndex<T extends { id: string }>(
  decl: T,
  family: 'context' | 'resource' | 'rule',
  bucket: Map<string, T>,
  idToFamily: Map<string, 'context' | 'resource' | 'rule'>,
  errors: ProjectModelError[],
): void {
  const existingFamily = idToFamily.get(decl.id);
  if (existingFamily) {
    errors.push({
      code: 'duplicate-id',
      message: existingFamily === family
        ? `Duplicate ${family} id '${decl.id}'`
        : `Id '${decl.id}' is used by both a ${existingFamily} and a ${family}`,
      subject: decl.id,
    });
    return;
  }
  idToFamily.set(decl.id, family);
  bucket.set(decl.id, decl);
}

function checkResourceRef(
  label: string,
  subject: string,
  r: ResourceRef,
  contexts: ReadonlyMap<string, ContextDeclaration>,
  resources: ReadonlyMap<string, ResourceDeclaration>,
  errors: ProjectModelError[],
): void {
  if (r.mode === 'resource') {
    if (!resources.has(r.id)) {
      errors.push({
        code: 'unresolved-resource-ref',
        message: `${label} references resource '${r.id}', which is not declared`,
        subject,
        target: r.id,
      });
    }
  } else if (r.mode === 'context-output') {
    const ctx = contexts.get(r.contextId);
    if (!ctx) {
      errors.push({
        code: 'unresolved-context-output',
        message: `${label} references context '${r.contextId}', which is not declared`,
        subject,
        target: r.contextId,
      });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(ctx.outputs, r.outputName)) {
      errors.push({
        code: 'unresolved-context-output',
        message: `${label} references output '${r.outputName}' on context '${r.contextId}', which is not declared`,
        subject,
        target: `${r.contextId}.${r.outputName}`,
      });
    }
  }
  // 'external' refs are not validated; they're literal URIs.
}

function checkValidationBinding(
  ctx: ContextDeclaration,
  v: ValidationBinding,
  resources: ReadonlyMap<string, ResourceDeclaration>,
  rules: ReadonlyMap<string, RuleDeclaration>,
  errors: ProjectModelError[],
): void {
  const inputNames = new Set(Object.keys(ctx.inputs));
  const outputNames = new Set(Object.keys(ctx.outputs));

  for (const name of v.resources) {
    if (inputNames.has(name)) continue;
    if (outputNames.has(name)) continue;
    if (resources.has(name)) continue;
    errors.push({
      code: 'validation-resource-not-in-scope',
      message: `Context '${ctx.id}' validation '${v.id}' references resource '${name}', which is not an input, output, or declared resource id`,
      subject: ctx.id,
      target: name,
    });
  }

  // Kind-specific reference checks.
  const cfg = (v.validation.config ?? {}) as Record<string, unknown>;
  switch (v.validation.kind) {
    case 'rule-outcome': {
      const ruleId = String(cfg.ruleId ?? '');
      if (ruleId && !rules.has(ruleId)) {
        errors.push({
          code: 'unresolved-rule',
          message: `Context '${ctx.id}' validation '${v.id}' references rule '${ruleId}', which is not declared`,
          subject: ctx.id,
          target: ruleId,
        });
      }
      break;
    }
    case 'test-pass': {
      const testId = String(cfg.testId ?? '');
      const r = resources.get(testId);
      if (!r || r.__kind !== KIND.Test) {
        errors.push({
          code: 'unresolved-resource-ref',
          message: `Context '${ctx.id}' validation '${v.id}' references test '${testId}', which is not a declared test`,
          subject: ctx.id,
          target: testId,
        });
      }
      break;
    }
    case 'test-set-pass': {
      const testSetId = String(cfg.testSetId ?? '');
      const r = resources.get(testSetId);
      if (!r || r.__kind !== KIND.TestSet) {
        errors.push({
          code: 'unresolved-resource-ref',
          message: `Context '${ctx.id}' validation '${v.id}' references test set '${testSetId}', which is not a declared test set`,
          subject: ctx.id,
          target: testSetId,
        });
      }
      break;
    }
    case 'deployed-resource-present':
    case 'deployed-resource-healthy': {
      const resourceId = String(cfg.resourceId ?? '');
      const r = resources.get(resourceId);
      if (!r || r.__kind !== KIND.DeployedResource) {
        errors.push({
          code: 'unresolved-resource-ref',
          message: `Context '${ctx.id}' validation '${v.id}' references deployed resource '${resourceId}', which is not declared`,
          subject: ctx.id,
          target: resourceId,
        });
      }
      break;
    }
    case 'manual-confirm':
    case 'code':
      // No structural reference check.
      break;
  }
}

function findContainsCycles(
  contexts: ReadonlyMap<string, ContextDeclaration>,
  parentOf: ReadonlyMap<string, string>,
): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();

  for (const startId of contexts.keys()) {
    if (seen.has(startId)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let cursor: string | undefined = startId;
    while (cursor && !seen.has(cursor)) {
      if (onPath.has(cursor)) {
        const start = path.indexOf(cursor);
        cycles.push([...path.slice(start), cursor]);
        break;
      }
      onPath.add(cursor);
      path.push(cursor);
      cursor = parentOf.get(cursor);
    }
    for (const id of path) seen.add(id);
  }

  // Dedupe cycles by sorted-key.
  const uniq = new Map<string, string[]>();
  for (const c of cycles) {
    const key = [...c].sort().join('|');
    if (!uniq.has(key)) uniq.set(key, c);
  }
  return [...uniq.values()];
}
