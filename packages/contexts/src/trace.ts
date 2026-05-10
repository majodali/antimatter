/**
 * Regression triage — given a context (typically in `regressed` or
 * `dependency-regressed` state) and current evaluator state, build a
 * structured explanation of *why* it isn't `done`.
 *
 * The IDE renders the result as the "Why is this regressed?" section
 * of the context detail dialog. The result is purely informational —
 * the model + collaborators stay authoritative.
 *
 * Pure: no I/O. The same lookup functions the evaluator uses are
 * passed in here so this module can rebuild the explanation without
 * a runtime dependency on the workspace server.
 */
import { KIND } from './model.js';
import type {
  ContextDeclaration,
  ProjectModel,
  ValidationDeclaration,
} from './model.js';
import { resolveResourceRef } from './queries.js';
import type { LifecycleStatus } from './lifecycle.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What the evaluator looks at when deciding pass/fail. */
export interface TraceCollaborators {
  readonly getRuleStatus?: (ruleId: string) => 'success' | 'failed' | undefined;
  readonly getTestPasses?: () => readonly { id: string; pass: boolean }[];
  readonly hasDeployedResource?: (resourceId: string) => boolean;
  readonly isDeployedResourceHealthy?: (resourceId: string) => boolean;
  /** Per-context lifecycle status — needed to identify dependency culprits. */
  readonly getLifecycleStatus?: (contextId: string) => LifecycleStatus | undefined;
}

/** A single explanation row about one validation. */
export type ValidationExplanation =
  | {
      readonly validationId: string;
      readonly kind: 'rule-outcome';
      readonly ruleId: string;
      readonly ruleStatus: 'success' | 'failed' | 'unknown';
      readonly ruleDeclared: boolean;
    }
  | {
      readonly validationId: string;
      readonly kind: 'test-pass';
      readonly testId: string;
      readonly passing: boolean | null;
    }
  | {
      readonly validationId: string;
      readonly kind: 'test-set-pass';
      readonly testSetId: string;
      readonly memberCount: number;
      /** Member tests that have been observed and failed. */
      readonly failingMembers: readonly string[];
      /** Member tests that have not yet been observed (no result recorded). */
      readonly unobservedMembers: readonly string[];
    }
  | {
      readonly validationId: string;
      readonly kind: 'deployed-resource-present';
      readonly resourceId: string;
      readonly present: boolean;
    }
  | {
      readonly validationId: string;
      readonly kind: 'deployed-resource-healthy';
      readonly resourceId: string;
      readonly healthy: boolean;
    }
  | {
      readonly validationId: string;
      readonly kind: 'manual-confirm';
      readonly description: string;
    }
  | {
      readonly validationId: string;
      readonly kind: 'code';
      readonly description: string;
      readonly fn?: string;
    };

/**
 * A child context that hasn't reached `done` and is therefore blocking
 * the parent's roll-up. Surfaced when the failing context's status is
 * `regressed` because of an own-constituent (child or validation)
 * problem.
 */
export interface ChildBlocker {
  readonly contextId: string;
  readonly contextName: string;
  readonly status: LifecycleStatus;
}

/**
 * A dependency root identified for a `dependency-regressed` context —
 * the upstream context whose state caused the cascade. May be empty
 * if the dep graph isn't yet wired (Phase 0 has no explicit deps).
 */
export interface DependencyCulprit {
  readonly contextId: string;
  readonly contextName: string;
  readonly status: LifecycleStatus;
  /**
   * Path describing how this context reaches the culprit. First entry
   * is the failing context's id, last is the culprit. Empty for
   * direct-only dependencies.
   */
  readonly path: readonly string[];
}

export interface RegressionTrace {
  readonly contextId: string;
  readonly contextName: string;
  readonly status: LifecycleStatus;
  /**
   * Whether the context is regressed because of its own constituents,
   * a dependency, neither (e.g. `done`), or both.
   */
  readonly hasOwnFailures: boolean;
  readonly hasDependencyFailures: boolean;
  /** One row per failing or unevaluable validation. */
  readonly validationFailures: readonly ValidationExplanation[];
  /** Children of this context that are not yet `done`. */
  readonly childBlockers: readonly ChildBlocker[];
  /** Upstream dependencies blocking this context. */
  readonly dependencyCulprits: readonly DependencyCulprit[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a trace for a given context. Returns `null` if the context is
 * not in the model. The function is safe to call against `done` /
 * `ready` contexts — the result simply has empty failure lists.
 */
export function traceRegression(
  model: ProjectModel,
  contextId: string,
  collaborators: TraceCollaborators,
): RegressionTrace | null {
  const ctx = model.contexts.get(contextId);
  if (!ctx) return null;

  const status = collaborators.getLifecycleStatus?.(contextId) ?? 'pending';

  // ---- Per-validation explanations (only failing or unevaluable) ----
  const validationFailures: ValidationExplanation[] = [];
  for (const binding of ctx.validations) {
    const result = explainValidation(binding.id, binding.validation, ctx, model, collaborators);
    if (result.shouldSurface) {
      validationFailures.push(result.explanation);
    }
  }

  // ---- Children blocking the parent's roll-up ----
  const childBlockers: ChildBlocker[] = [];
  for (const childId of model.children.get(contextId) ?? []) {
    const childStatus = collaborators.getLifecycleStatus?.(childId);
    if (childStatus && childStatus !== 'done') {
      childBlockers.push({
        contextId: childId,
        contextName: model.contexts.get(childId)?.name ?? childId,
        status: childStatus,
      });
    }
  }

  // ---- Dependency culprits ----
  // Phase 0+ has no explicit dependsOn edges — implicit deps come from
  // context-output input refs. Walk those up to find the regressed root.
  const dependencyCulprits: DependencyCulprit[] = [];
  if (status === 'dependency-regressed') {
    for (const culprit of findDependencyCulprits(model, contextId, collaborators)) {
      dependencyCulprits.push(culprit);
    }
  }

  return {
    contextId,
    contextName: ctx.name,
    status,
    hasOwnFailures: validationFailures.length > 0 || childBlockers.length > 0,
    hasDependencyFailures: dependencyCulprits.length > 0,
    validationFailures,
    childBlockers,
    dependencyCulprits,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ExplainResult {
  readonly explanation: ValidationExplanation;
  /**
   * True if this row should surface in the trace — i.e. it is
   * definitively failing OR has not yet been evaluable. Passing
   * validations never surface (a passing validation isn't a cause).
   */
  readonly shouldSurface: boolean;
}

function explainValidation(
  validationId: string,
  v: ValidationDeclaration,
  _ctx: ContextDeclaration,
  model: ProjectModel,
  c: TraceCollaborators,
): ExplainResult {
  const cfg = (v.config ?? {}) as Record<string, unknown>;
  switch (v.kind) {
    case 'rule-outcome': {
      const ruleId = String(cfg.ruleId ?? '');
      const ruleDeclared = !!model.rules.get(ruleId);
      const status = c.getRuleStatus?.(ruleId);
      const ruleStatus: 'success' | 'failed' | 'unknown' = status ?? 'unknown';
      return {
        explanation: { validationId, kind: 'rule-outcome', ruleId, ruleStatus, ruleDeclared },
        shouldSurface: ruleStatus !== 'success',
      };
    }
    case 'test-pass': {
      const testId = String(cfg.testId ?? '');
      const entry = c.getTestPasses?.().find(t => t.id === testId);
      const passing = entry === undefined ? null : entry.pass;
      return {
        explanation: { validationId, kind: 'test-pass', testId, passing },
        shouldSurface: passing !== true,
      };
    }
    case 'test-set-pass': {
      const testSetId = String(cfg.testSetId ?? '');
      const set = model.resources.get(testSetId);
      if (!set || set.__kind !== KIND.TestSet) {
        return {
          explanation: { validationId, kind: 'test-set-pass', testSetId, memberCount: 0, failingMembers: [], unobservedMembers: [] },
          shouldSurface: true,
        };
      }
      const passes = new Map((c.getTestPasses?.() ?? []).map(t => [t.id, t.pass]));
      const failing: string[] = [];
      const unobserved: string[] = [];
      for (const memberId of set.members) {
        if (!passes.has(memberId)) unobserved.push(memberId);
        else if (!passes.get(memberId)) failing.push(memberId);
      }
      const allPass = failing.length === 0 && unobserved.length === 0 && set.members.length > 0;
      return {
        explanation: { validationId, kind: 'test-set-pass', testSetId, memberCount: set.members.length, failingMembers: failing, unobservedMembers: unobserved },
        shouldSurface: !allPass,
      };
    }
    case 'deployed-resource-present': {
      const resourceId = String(cfg.resourceId ?? '');
      const present = c.hasDeployedResource?.(resourceId) ?? false;
      return {
        explanation: { validationId, kind: 'deployed-resource-present', resourceId, present },
        shouldSurface: !present,
      };
    }
    case 'deployed-resource-healthy': {
      const resourceId = String(cfg.resourceId ?? '');
      const healthy = c.isDeployedResourceHealthy?.(resourceId) ?? false;
      return {
        explanation: { validationId, kind: 'deployed-resource-healthy', resourceId, healthy },
        shouldSurface: !healthy,
      };
    }
    case 'manual-confirm':
      return {
        explanation: { validationId, kind: 'manual-confirm', description: v.description },
        shouldSurface: true,
      };
    case 'code': {
      const fn = cfg.fn === undefined ? undefined : String(cfg.fn);
      return {
        explanation: { validationId, kind: 'code', description: v.description, fn },
        shouldSurface: true,
      };
    }
  }
}

/**
 * Walk a context's implicit dependency graph (input refs that point at
 * other contexts' outputs) breadth-first and collect every reachable
 * upstream context that is not currently `done`. The first
 * non-`done` context on each path is reported as a culprit; we don't
 * walk past it to keep the noise low.
 *
 * Phase 0+ doesn't carry explicit deps, but the structure here is
 * forward-compatible — when Phase N introduces explicit deps, this
 * walker just gains another edge-list to consume.
 */
function* findDependencyCulprits(
  model: ProjectModel,
  startId: string,
  c: TraceCollaborators,
): Iterable<DependencyCulprit> {
  const seen = new Set<string>([startId]);
  // Each queue entry: (contextId, path-from-start-not-including-this-id)
  const queue: Array<{ id: string; path: readonly string[] }> = [];
  for (const dep of implicitDepsOf(model, startId)) {
    queue.push({ id: dep, path: [startId] });
  }

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const status = c.getLifecycleStatus?.(id);
    const fullPath = [...path, id];
    if (status && status !== 'done') {
      yield {
        contextId: id,
        contextName: model.contexts.get(id)?.name ?? id,
        status,
        path: fullPath,
      };
      // Don't walk past the culprit; we report the closest non-done.
      continue;
    }
    for (const next of implicitDepsOf(model, id)) {
      queue.push({ id: next, path: fullPath });
    }
  }
}

function implicitDepsOf(model: ProjectModel, contextId: string): string[] {
  const ctx = model.contexts.get(contextId);
  if (!ctx) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of Object.values(ctx.inputs)) {
    if (ref.mode !== 'context-output') continue;
    if (seen.has(ref.contextId)) continue;
    // Only follow refs that resolve.
    const resolved = resolveResourceRef(model, ref);
    if (resolved.kind !== 'context-output') continue;
    seen.add(ref.contextId);
    out.push(ref.contextId);
  }
  return out;
}
