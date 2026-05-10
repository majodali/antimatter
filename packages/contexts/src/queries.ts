/**
 * Graph queries over an assembled `ProjectModel`. Pure helpers that the
 * UI / lifecycle / runtime use to traverse the model without
 * re-implementing index lookups.
 *
 * Two shapes of dependency:
 *   - Structural: the contains tree (parent → children).
 *   - Data:       implicit edges from `inputs` → resource origin.
 *
 * Phase 0 surfaces the structural traversals plus a basic
 * "context-output back-references" lookup. Heavy data-flow queries
 * (full producer chains, resource-to-context-readers) land alongside
 * fingerprinting in Phase 3.
 */
import {
  KIND,
  KIND_OF,
  type ContextDeclaration,
  type ResourceDeclaration,
  type RuleDeclaration,
  type ProjectModel,
  type ResourceRef,
  type ResourceKind,
} from './model.js';

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

/** The single root context, or undefined if the model is empty / has multiple roots / has no root. */
export function rootContext(model: ProjectModel): ContextDeclaration | undefined {
  let root: ContextDeclaration | undefined;
  for (const ctx of model.contexts.values()) {
    if (!ctx.parentId) {
      if (root) return undefined; // multiple roots → ambiguous
      root = ctx;
    }
  }
  return root;
}

/** Direct children of a context, in declaration-encounter order. */
export function childrenOf(model: ProjectModel, contextId: string): ContextDeclaration[] {
  const ids = model.children.get(contextId) ?? [];
  return ids
    .map(id => model.contexts.get(id))
    .filter((c): c is ContextDeclaration => c !== undefined);
}

/** Parent context of the given id, or undefined for the root. */
export function parentOf(model: ProjectModel, contextId: string): ContextDeclaration | undefined {
  const pid = model.parentOf.get(contextId);
  return pid ? model.contexts.get(pid) : undefined;
}

/** All ancestors from the immediate parent up to the root, in order. */
export function ancestorsOf(model: ProjectModel, contextId: string): ContextDeclaration[] {
  const out: ContextDeclaration[] = [];
  let current = parentOf(model, contextId);
  while (current) {
    out.push(current);
    current = parentOf(model, current.id);
  }
  return out;
}

/** Depth-first descendants (children, grandchildren, …). */
export function descendantsOf(model: ProjectModel, contextId: string): ContextDeclaration[] {
  const out: ContextDeclaration[] = [];
  const stack = [...childrenOf(model, contextId)];
  while (stack.length > 0) {
    const next = stack.shift()!;
    out.push(next);
    stack.unshift(...childrenOf(model, next.id));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resource lookups
// ---------------------------------------------------------------------------

/** Resolve a ResourceRef to whatever it points to, if anything. */
export function resolveResourceRef(
  model: ProjectModel,
  ref: ResourceRef,
):
  | { readonly kind: 'resource'; readonly resource: ResourceDeclaration }
  | { readonly kind: 'context-output'; readonly context: ContextDeclaration; readonly outputName: string }
  | { readonly kind: 'external'; readonly uri: string }
  | { readonly kind: 'unresolved'; readonly reason: string } {
  if (ref.mode === 'resource') {
    const r = model.resources.get(ref.id);
    if (!r) return { kind: 'unresolved', reason: `resource '${ref.id}' not declared` };
    return { kind: 'resource', resource: r };
  }
  if (ref.mode === 'context-output') {
    const ctx = model.contexts.get(ref.contextId);
    if (!ctx) return { kind: 'unresolved', reason: `context '${ref.contextId}' not declared` };
    if (!Object.prototype.hasOwnProperty.call(ctx.outputs, ref.outputName)) {
      return { kind: 'unresolved', reason: `context '${ref.contextId}' has no output '${ref.outputName}'` };
    }
    return { kind: 'context-output', context: ctx, outputName: ref.outputName };
  }
  return { kind: 'external', uri: ref.uri };
}

/** All declared resources of a particular kind (short name like `'file-set'`). */
export function resourcesOfKind(model: ProjectModel, kind: ResourceKind): ResourceDeclaration[] {
  const discriminator = KIND_OF[kind];
  const out: ResourceDeclaration[] = [];
  for (const r of model.resources.values()) {
    if (r.__kind === discriminator) out.push(r);
  }
  return out;
}

/** Test sets a given test id is a member of (many-to-many). */
export function testSetsForTest(model: ProjectModel, testId: string): ResourceDeclaration[] {
  const out: ResourceDeclaration[] = [];
  for (const r of model.resources.values()) {
    if (r.__kind !== KIND.TestSet) continue;
    if (r.members.includes(testId)) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Implicit dependencies — derived from inputs
// ---------------------------------------------------------------------------

/**
 * Contexts whose outputs another context consumes, derived from
 * `context-output` ResourceRefs in inputs. Returned in declaration
 * order; deduped.
 */
export function implicitDependencies(model: ProjectModel, contextId: string): ContextDeclaration[] {
  const ctx = model.contexts.get(contextId);
  if (!ctx) return [];
  const seen = new Set<string>();
  const out: ContextDeclaration[] = [];
  for (const r of Object.values(ctx.inputs)) {
    if (r.mode !== 'context-output') continue;
    if (seen.has(r.contextId)) continue;
    seen.add(r.contextId);
    const dep = model.contexts.get(r.contextId);
    if (dep) out.push(dep);
  }
  return out;
}

/** Inverse: contexts that consume the given context's outputs. */
export function implicitDependents(model: ProjectModel, contextId: string): ContextDeclaration[] {
  const out: ContextDeclaration[] = [];
  for (const ctx of model.contexts.values()) {
    if (ctx.id === contextId) continue;
    if (implicitDependencies(model, ctx.id).some(d => d.id === contextId)) {
      out.push(ctx);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule lookups
// ---------------------------------------------------------------------------

/** Rules that read a given resource id (matches reads-list refs in 'resource' mode). */
export function rulesReading(model: ProjectModel, resourceId: string): RuleDeclaration[] {
  const out: RuleDeclaration[] = [];
  for (const r of model.rules.values()) {
    if (r.reads?.some(ref => ref.mode === 'resource' && ref.id === resourceId)) {
      out.push(r);
    }
  }
  return out;
}

/** Rules that write a given resource id. */
export function rulesWriting(model: ProjectModel, resourceId: string): RuleDeclaration[] {
  const out: RuleDeclaration[] = [];
  for (const r of model.rules.values()) {
    if (r.writes?.some(ref => ref.mode === 'resource' && ref.id === resourceId)) {
      out.push(r);
    }
  }
  return out;
}
