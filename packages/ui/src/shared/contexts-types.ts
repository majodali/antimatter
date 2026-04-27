/**
 * Wire types for the project context tree, transmitted server → client
 * via WebSocket (`application-state.contexts`) and REST
 * (`/api/contexts`).
 *
 * The server-side ContextStore (`server/services/context-store.ts`)
 * derives these from the parsed simple-modeling Model. The shapes are
 * intentionally flat so the client doesn't need simple-modeling.
 *
 * See `docs/contexts.md` for the conceptual model.
 */

export type ContextKind = 'work' | 'runtime';
export type ContextEdgeType = 'contains' | 'depends_on' | 'targets';

/** Lifecycle status of a context, derived from its requirements + dep
 *  graph + persisted prior state. Mirror of @antimatter/contexts
 *  LifecycleStatus. See `docs/contexts.md` for the state machine. */
export type LifecycleStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'done'
  | 'regressed'
  | 'dependency-regressed';

/** A requirement attached to a context (either an explicit
 *  `requires rule X` / `requires test X` line, or an implicit
 *  "child must be done"). */
export type ContextRequirementKind = 'rule' | 'test';

export interface ContextRequirementSnapshot {
  kind: ContextRequirementKind;
  /** The id of the rule or test (resolved by the workflow runtime / test harness). */
  id: string;
  /** Whether this requirement currently passes. */
  passing: boolean;
  /** True if the integration layer couldn't find an artifact with this id
   *  (e.g. a `requires rule build:full` line where no rule named build:full
   *  is registered). UI should surface this as an error. */
  unresolved?: boolean;
}

/** Mirror of @antimatter/contexts ValidationError. Duplicated here to
 *  avoid pulling the contexts package into the client bundle. */
export interface ContextValidationError {
  code:
    | 'metamodel'
    | 'targets-source-kind'
    | 'targets-target-kind'
    | 'depends-source-kind'
    | 'depends-target-kind'
    | 'self-reference'
    | 'depends-cycle'
    | 'multiple-roots'
    | 'no-root'
    | 'unresolved-reference'
    | 'unresolved-rule-reference'
    | 'unresolved-test-reference';
  message: string;
  context?: string;
  target?: string;
}

export interface ContextNodeSnapshot {
  id: string;
  name: string;
  kind: ContextKind;
  description?: string;
  /** Parent context name (undefined for the root). */
  parent?: string;
  /** Names of runtime contexts targeted by this work context. */
  targets: string[];
  /** Names of work contexts this work context depends on. */
  dependsOn: string[];
  /** Explicit `requires rule X` / `requires test X` declarations.
   *  Each carries the current pass state and an `unresolved` flag if
   *  the integration layer couldn't find the referenced artifact. */
  requirements: ContextRequirementSnapshot[];
  /** Derived lifecycle status. Undefined until the lifecycle store has
   *  produced its first snapshot. */
  lifecycleStatus?: LifecycleStatus;
}

export interface ContextEdgeSnapshot {
  type: ContextEdgeType;
  source: string;
  target: string;
}

export interface ContextSnapshot {
  /** False if no `.antimatter/contexts.dsl` is present. */
  present: boolean;
  /** Name of the root context (undefined if not present). */
  rootName?: string;
  nodes: ContextNodeSnapshot[];
  edges: ContextEdgeSnapshot[];
  errors: ContextValidationError[];
  /** Raw DSL source text (for the UI to render an editor / show source). */
  source: string;
  /** ISO timestamp of last reload (success or failure). */
  loadedAt: string;
}

/**
 * Server-derived lifecycle data: per-context status + per-context
 * requirement pass/fail. Owned by ContextLifecycleStore on the server,
 * persisted across worker restarts (so regressions can be detected).
 *
 * The client merges this with `ContextSnapshot` to produce the enriched
 * view rendered in the UI: each `ContextNodeSnapshot.lifecycleStatus`
 * comes from `statuses[node.id]`, and each
 * `ContextNodeSnapshot.requirements` is overlaid with the live entries
 * from `requirements[node.id]`.
 */
export interface ContextLifecycleSnapshot {
  /** Context id → derived lifecycle status. */
  statuses: Record<string, LifecycleStatus>;
  /** Context id → live requirement pass/fail (overlays placeholder
   *  data in ContextSnapshot.nodes[].requirements). */
  requirements: Record<string, ContextRequirementSnapshot[]>;
  /**
   * Validation errors that need runtime catalogs (rule registry, test
   * results) to detect — `unresolved-rule-reference` /
   * `unresolved-test-reference` for typos in `requires` lines, etc.
   * The client merges these with `ContextSnapshot.errors` to give a
   * single combined error list.
   */
  validationErrors: ContextValidationError[];
  /** ISO timestamp of last derivation. */
  derivedAt: string;
}

/**
 * A lifecycle transition event emitted server-side when a context's
 * status changes. Mirrors @antimatter/contexts LifecycleTransition.
 */
export interface ContextLifecycleTransition {
  contextId: string;
  from?: LifecycleStatus;
  to: LifecycleStatus;
  /** ISO timestamp of the transition. */
  at: string;
}
