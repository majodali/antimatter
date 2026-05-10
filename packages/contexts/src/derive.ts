/**
 * Lifecycle derivation against the new `ProjectModel`.
 *
 * Same state machine documented in `lifecycle.ts` — see that file's
 * header comment for the full table. This module differs only in its
 * inputs:
 *
 *   - Old (`lifecycle.ts`):    simple-modeling Model + per-context
 *                              `requirements` list + rule/test pass
 *                              maps + priorStatuses.
 *   - New (`derive.ts`):       `ProjectModel` + per-`{contextId,
 *                              validationId}` pass map + priorStatuses.
 *
 * Effective requirements per context = its validation bindings + each
 * child must be `done`. Phase 0 has no explicit `dependsOn` between
 * contexts (deferred), so the dep-related branches reduce to the
 * "no deps" path. Implicit data dependencies (input refs to other
 * contexts' outputs) will become first-class deps in Phase 3 alongside
 * fingerprint computation.
 *
 * Pure: no I/O. Caller owns persistence of `priorStatuses` and emission
 * of `transitions` as events.
 */
import type { LifecycleStatus, LifecycleTransition } from './lifecycle.js';
import type { ContextDeclaration, ProjectModel } from './model.js';

export type { LifecycleStatus, LifecycleTransition };

/** Key for `validationPasses` map: `${contextId}::${validationBindingId}`. */
export function validationKey(contextId: string, validationId: string): string {
  return `${contextId}::${validationId}`;
}

export interface DeriveLifecycleInput {
  readonly model: ProjectModel;
  /** Map keyed by `validationKey(ctxId, vId)` — true means this validation passes. */
  readonly validationPasses: ReadonlyMap<string, boolean>;
  /** Persisted prior status per context id (empty on first derivation). */
  readonly priorStatuses: ReadonlyMap<string, LifecycleStatus>;
}

export interface DeriveLifecycleOutput {
  readonly statuses: ReadonlyMap<string, LifecycleStatus>;
  readonly transitions: readonly LifecycleTransition[];
}

/**
 * Derive lifecycle status for every Context in the model. Children are
 * derived before parents so contains-rollup observes the up-to-date
 * child states.
 */
export function deriveProjectLifecycle(input: DeriveLifecycleInput): DeriveLifecycleOutput {
  const { model, validationPasses, priorStatuses } = input;

  const sorted = topoSort(model);
  const statuses = new Map<string, LifecycleStatus>();

  for (const ctx of sorted) {
    statuses.set(ctx.id, deriveOne(ctx, model, validationPasses, priorStatuses, statuses));
  }

  // Defensive: any context not visited by topoSort (cycle member)
  // gets a pending fallback so callers always have an entry.
  for (const ctx of model.contexts.values()) {
    if (!statuses.has(ctx.id)) statuses.set(ctx.id, 'pending');
  }

  const transitions: LifecycleTransition[] = [];
  for (const [id, to] of statuses) {
    const from = priorStatuses.get(id);
    if (from !== to) transitions.push({ contextId: id, from, to });
  }

  return { statuses, transitions };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function deriveOne(
  ctx: ContextDeclaration,
  model: ProjectModel,
  validationPasses: ReadonlyMap<string, boolean>,
  priorStatuses: ReadonlyMap<string, LifecycleStatus>,
  statuses: Map<string, LifecycleStatus>,
): LifecycleStatus {
  const prior = priorStatuses.get(ctx.id);

  // Effective requirements: explicit validation bindings + each child must be done.
  const ownPasses: boolean[] = ctx.validations.map(v => validationPasses.get(validationKey(ctx.id, v.id)) === true);
  const childIds = model.children.get(ctx.id) ?? [];
  const childPasses: boolean[] = childIds.map(id => statuses.get(id) === 'done');

  const effResults = [...ownPasses, ...childPasses];
  const total = effResults.length;
  const passing = effResults.filter(p => p).length;
  const allEffPass = total === 0 || passing === total;
  const anyEffPass = passing > 0;

  // Phase 0: no explicit deps. Dep checks always pass.
  const allDepsDone = true;
  const anyDepRegressed = false;

  if (prior === 'done') {
    if (!allEffPass) return 'regressed';
    if (anyDepRegressed || !allDepsDone) return 'dependency-regressed';
    return 'done';
  }

  if (prior === 'regressed') {
    if (allEffPass) {
      if (anyDepRegressed || !allDepsDone) return 'dependency-regressed';
      return 'done';
    }
    return 'regressed';
  }

  if (prior === 'dependency-regressed') {
    if (!anyDepRegressed && allDepsDone) {
      if (allEffPass) return 'done';
      return 'in-progress';
    }
    return 'dependency-regressed';
  }

  // Forward path: prior undefined / pending / ready / in-progress.
  if (anyDepRegressed) {
    if (prior === 'ready' || prior === 'in-progress') return 'dependency-regressed';
    return 'pending';
  }
  if (!allDepsDone) return 'pending';

  if (allEffPass) return 'done';
  if (anyEffPass) return 'in-progress';
  return 'ready';
}

/**
 * Topological sort: children before parents (for contains rollup).
 * In Phase 0 there are no explicit deps, so containment is the only
 * ordering constraint. DFS with cycle protection — cycle members are
 * skipped and get a `pending` fallback in `deriveProjectLifecycle`.
 */
function topoSort(model: ProjectModel): ContextDeclaration[] {
  const visited = new Set<string>();
  const result: ContextDeclaration[] = [];

  const visit = (id: string, stack: Set<string>): void => {
    if (visited.has(id)) return;
    if (stack.has(id)) return; // cycle — skip
    const ctx = model.contexts.get(id);
    if (!ctx) return;
    stack.add(id);
    for (const childId of model.children.get(id) ?? []) visit(childId, stack);
    stack.delete(id);
    visited.add(id);
    result.push(ctx);
  };

  for (const id of model.contexts.keys()) visit(id, new Set());
  return result;
}
