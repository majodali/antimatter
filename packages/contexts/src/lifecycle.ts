/**
 * Lifecycle status derivation for the context tree.
 *
 * Pure function: given the parsed model, per-context requirements, the
 * current pass/fail status of every rule and test, and the persisted
 * prior statuses, returns the new status for every context plus the
 * transitions that occurred.
 *
 * No I/O. No persistence. The caller (a server-side store) owns the
 * prior-status persistence and the transition-event emission.
 *
 * State machine
 * -------------
 *
 *   pending → ready → in-progress → done
 *
 * Plus the two regression states:
 *   - `regressed`            — was `done`; an OWN requirement (rule, test,
 *                              or constituent child) is now failing.
 *   - `dependency-regressed` — was `done` (or `ready`/`in-progress`) and
 *                              a `depends_on` context regressed; OR was
 *                              `dependency-regressed` and the dep hasn't
 *                              recovered yet.
 *
 * Effective requirements
 * ----------------------
 * A context's effective requirements are:
 *   - every `requires rule X` line  → rule X must pass
 *   - every `requires test X` line  → test X must pass
 *   - every `contains` child         → that child's status must be `done`
 *
 * Children act as implicit requirements because a parent can't be `done`
 * unless its constituents are. A leaf context with no requires lines and
 * no children has zero effective requirements and is vacuously `done`
 * once its dependencies are.
 *
 * Status derivation rules
 * -----------------------
 * Read the table top-to-bottom; the first matching row wins.
 *
 *   prior=done:
 *     own constituent failing       → regressed
 *     dep regressed                 → dependency-regressed
 *     deps not all done             → dependency-regressed (rare; dep
 *                                     transitioned out of done without
 *                                     entering a regression state)
 *     else                          → done
 *
 *   prior=regressed:
 *     own constituents recovered AND deps healthy   → done
 *     own constituents recovered AND dep regressed  → dependency-regressed
 *     else                                           → regressed
 *
 *   prior=dependency-regressed:
 *     dep recovered AND own constituents pass       → done
 *     dep recovered AND own constituents partial    → in-progress
 *     else                                           → dependency-regressed
 *
 *   forward (prior undefined / pending / ready / in-progress):
 *     dep regressed AND we'd progressed past pending
 *       (prior in {ready, in-progress})              → dependency-regressed
 *     dep regressed (otherwise)                      → pending
 *     deps not all done                              → pending
 *     all effective reqs pass                        → done
 *     some effective reqs pass                       → in-progress
 *     no effective reqs pass                         → ready
 *
 * Topological order
 * -----------------
 * Children are derived before parents (a parent's status depends on
 * `child === 'done'`), and dependencies are derived before dependents (a
 * context's status depends on its `depends_on` neighbours' statuses).
 * If the model has a `depends_on` cycle (validation should have caught
 * it), we bail and the cycle members get `pending` as a defensive
 * fallback.
 */
import type { Model, Node } from 'simple-modeling';
import {
  CONTEXT_NODE_TYPE,
  EDGE_CONTAINS,
  EDGE_DEPENDS_ON,
} from './metamodel.js';
import type { ContextRequirement } from './parse.js';

export type LifecycleStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'done'
  | 'regressed'
  | 'dependency-regressed';

/** All valid status values, in canonical order. */
export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  'pending', 'ready', 'in-progress', 'done', 'regressed', 'dependency-regressed',
] as const;

export interface LifecycleInputs {
  /** Parsed Context model (from parseContexts). */
  readonly model: Model;
  /** Per-context requirements (from parseContexts). */
  readonly requirements: ReadonlyMap<string, readonly ContextRequirement[]>;
  /** Map from rule id → did the rule's most recent run pass? */
  readonly rulePasses: ReadonlyMap<string, boolean>;
  /** Map from test id → did the test's most recent run pass? */
  readonly testPasses: ReadonlyMap<string, boolean>;
  /** Persisted prior status per context id (empty on first derivation). */
  readonly priorStatuses: ReadonlyMap<string, LifecycleStatus>;
}

export interface LifecycleTransition {
  readonly contextId: string;
  readonly from: LifecycleStatus | undefined;
  readonly to: LifecycleStatus;
}

export interface LifecycleOutputs {
  /** Newly-derived status per context id. */
  readonly statuses: ReadonlyMap<string, LifecycleStatus>;
  /** Contexts whose status changed compared to prior. */
  readonly transitions: readonly LifecycleTransition[];
}

/**
 * Derive the lifecycle status for every Context in the model. Pure;
 * caller owns persistence of `priorStatuses` and emission of
 * `transitions` as events.
 */
export function deriveLifecycleStatuses(input: LifecycleInputs): LifecycleOutputs {
  const { model, requirements, rulePasses, testPasses, priorStatuses } = input;

  const contexts: Node[] = [];
  for (const n of model.nodes.values()) {
    if (n.type === CONTEXT_NODE_TYPE) contexts.push(n);
  }

  const sorted = topoSort(contexts, model);
  const statuses = new Map<string, LifecycleStatus>();

  for (const ctx of sorted) {
    const status = deriveOne({
      ctx, model, requirements, rulePasses, testPasses, priorStatuses, statuses,
    });
    statuses.set(ctx.id, status);
  }

  // Defensive: any context not visited by topoSort (a cycle member) gets
  // a pending fallback so callers always have an entry per context.
  for (const ctx of contexts) {
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

function deriveOne(args: {
  ctx: Node;
  model: Model;
  requirements: ReadonlyMap<string, readonly ContextRequirement[]>;
  rulePasses: ReadonlyMap<string, boolean>;
  testPasses: ReadonlyMap<string, boolean>;
  priorStatuses: ReadonlyMap<string, LifecycleStatus>;
  statuses: Map<string, LifecycleStatus>;
}): LifecycleStatus {
  const { ctx, model, requirements, rulePasses, testPasses, priorStatuses, statuses } = args;
  const prior = priorStatuses.get(ctx.id);

  // Effective requirements: explicit rule/test reqs + each child must be done.
  const ownReqs = requirements.get(ctx.id) ?? [];
  const ownPasses = ownReqs.map(r =>
    r.kind === 'rule' ? rulePasses.get(r.id) === true : testPasses.get(r.id) === true,
  );

  const childEdges = model.edgesFrom(ctx.id, EDGE_CONTAINS);
  const childPasses = childEdges.map(e => statuses.get(e.target) === 'done');

  const effResults = [...ownPasses, ...childPasses];
  const total = effResults.length;
  const passing = effResults.filter(p => p).length;
  const allEffPass = total === 0 || passing === total;
  const anyEffPass = passing > 0;

  // Dependency neighbourhood.
  const depEdges = model.edgesFrom(ctx.id, EDGE_DEPENDS_ON);
  const depStatuses = depEdges.map(e => statuses.get(e.target));
  const allDepsDone = depStatuses.every(s => s === 'done');
  const anyDepRegressed = depStatuses.some(
    s => s === 'regressed' || s === 'dependency-regressed',
  );

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
    // If we'd already begun (ready or in-progress), bump to dep-regressed —
    // a dep break invalidates active work. If we never started (pending or
    // first-time), stay pending.
    if (prior === 'ready' || prior === 'in-progress') return 'dependency-regressed';
    return 'pending';
  }
  if (!allDepsDone) return 'pending';

  if (allEffPass) return 'done';
  if (anyEffPass) return 'in-progress';
  return 'ready';
}

/**
 * Topological sort: children before parents (for contains rollup) AND
 * dependencies before dependents (for dep status lookup). DFS-based with
 * cycle protection (cycle members are skipped; callers handle them via
 * the defensive fallback in deriveLifecycleStatuses).
 */
function topoSort(contexts: Node[], model: Model): Node[] {
  const idMap = new Map<string, Node>();
  for (const c of contexts) idMap.set(c.id, c);

  const visited = new Set<string>();
  const result: Node[] = [];

  const visit = (id: string, stack: Set<string>): void => {
    if (visited.has(id)) return;
    if (stack.has(id)) return; // cycle — skip
    const ctx = idMap.get(id);
    if (!ctx) return;
    stack.add(id);

    for (const edge of model.edgesFrom(id, EDGE_CONTAINS)) visit(edge.target, stack);
    for (const edge of model.edgesFrom(id, EDGE_DEPENDS_ON)) visit(edge.target, stack);

    stack.delete(id);
    visited.add(id);
    result.push(ctx);
  };

  for (const c of contexts) visit(c.id, new Set());
  return result;
}
