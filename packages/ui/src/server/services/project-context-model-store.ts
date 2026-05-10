/**
 * ProjectContextModelStore — server-side store for the NEW project
 * context model (the `defineX()`-based model in @antimatter/contexts).
 *
 * Sits alongside the legacy ContextStore (which reads `.antimatter/
 * contexts.dsl` via the indent DSL). This store:
 *
 *  - Loads `.antimatter/{resources,contexts,build}.ts` on demand via
 *    `loadProjectModel(...)`.
 *  - Caches the most recent ProjectModel + load errors so subsequent
 *    reads don't re-compile.
 *  - Exposes a serialisable snapshot for transport to the IDE.
 *
 * Phase 1 keeps things minimal: load-on-demand (no file watcher yet),
 * no broadcast, no lifecycle derivation. Phase 2 adds the file-change
 * reload + WebSocket broadcast; Phase 3 wires
 * `deriveProjectLifecycle` against this store.
 */

import {
  loadProjectModel,
  deriveProjectLifecycle,
  traceRegression,
  validationKey,
  KIND,
} from '@antimatter/contexts';
import type {
  ProjectModel,
  LoadResult,
  LoadFileError,
  ProjectModelError,
  LifecycleStatus,
  ValidationDeclaration,
  ContextDeclaration,
  RegressionTrace,
} from '@antimatter/contexts';

/** Per-lifecycle-status counts (Phase 4 — drives the status header). */
export type LifecycleCounts = Readonly<Record<LifecycleStatus, number>>;

/**
 * One captured transition. Phase 4 stores a recent ring buffer of
 * these on the snapshot so the IDE can render an "activity" section
 * without separately querying the activity log.
 */
export interface SerializedTransition {
  readonly contextId: string;
  readonly contextName: string;
  readonly from: LifecycleStatus | null;
  readonly to: LifecycleStatus;
  readonly at: string;
}

/** Serialisable snapshot for transport to the IDE. */
export interface ProjectContextModelSnapshot {
  /**
   * True if any of the canonical `.antimatter/*.ts` files were found
   * and loaded. False for an empty project — IDE renders the
   * cold-start empty-state.
   */
  readonly present: boolean;
  /** Files that loaded successfully (relative to `.antimatter/`). */
  readonly loadedFiles: readonly string[];
  /** Load-time errors (compile / import / extract). */
  readonly loadErrors: readonly LoadFileError[];
  /** Model-assembly errors (duplicate ids, unresolved refs, …). */
  readonly modelErrors: readonly ProjectModelError[];
  /** Counts for quick UI display. */
  readonly counts: {
    readonly contexts: number;
    readonly resources: number;
    readonly rules: number;
    /** Per-lifecycle-status totals (Phase 4). */
    readonly byStatus: LifecycleCounts;
  };
  /** Flat list of contexts. */
  readonly contexts: readonly SerializedContext[];
  /** Flat list of resources, with kind discriminator preserved. */
  readonly resources: readonly SerializedResource[];
  /** Flat list of rules. */
  readonly rules: readonly SerializedRule[];
  /**
   * Recent lifecycle transitions, most-recent first. Capped at
   * `MAX_RECENT_TRANSITIONS` to keep the broadcast small. Phase 4.
   */
  readonly recentTransitions: readonly SerializedTransition[];
  /** ISO timestamp of the last successful load. */
  readonly loadedAt: string;
}

export interface SerializedContext {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly objectiveStatement: string;
  readonly objectiveNotes?: string;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly validations: readonly SerializedValidation[];
  readonly actionKind: string;
  readonly actionDescription: string;
  /**
   * Derived lifecycle status (pending/ready/in-progress/done/regressed/
   * dependency-regressed). Default is 'pending' for an empty model.
   */
  readonly lifecycleStatus: LifecycleStatus;
  /**
   * ISO timestamp of the most recent lifecycle transition for this
   * context, or undefined if none have been observed since the worker
   * started. Drives "regressed N minutes ago" annotations.
   */
  readonly lastTransitionAt?: string;
}

/** Per-validation status surfaced in the snapshot for UI display. */
export interface SerializedValidation {
  readonly id: string;
  readonly kind: ValidationDeclaration['kind'];
  readonly description: string;
  /**
   * 'passing' — evaluator returned true.
   * 'failing' — evaluator returned false (and inputs exist).
   * 'unknown' — kind not yet evaluable, or required state missing.
   */
  readonly status: 'passing' | 'failing' | 'unknown';
  /** Resource names this validation reads (within the context's input/output namespace). */
  readonly resources: readonly string[];
}

export interface SerializedResource {
  readonly id: string;
  readonly kind: string;       // short name e.g. 'file-set'
  readonly discriminator: string; // full __kind value
  readonly name?: string;
  readonly description?: string;
}

export interface SerializedRule {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly readsCount: number;
  readonly writesCount: number;
  readonly manual: boolean;
}

/** How many recent transitions to retain in the snapshot ring buffer. */
const MAX_RECENT_TRANSITIONS = 50;

const EMPTY_BY_STATUS: LifecycleCounts = {
  pending: 0,
  ready: 0,
  'in-progress': 0,
  done: 0,
  regressed: 0,
  'dependency-regressed': 0,
};

const EMPTY_SNAPSHOT: ProjectContextModelSnapshot = {
  present: false,
  loadedFiles: [],
  loadErrors: [],
  modelErrors: [],
  counts: { contexts: 0, resources: 0, rules: 0, byStatus: EMPTY_BY_STATUS },
  contexts: [],
  resources: [],
  rules: [],
  recentTransitions: [],
  loadedAt: new Date(0).toISOString(),
};

/**
 * External services the evaluator consults to determine validation
 * pass/fail. All getters are optional — when absent, the relevant
 * validation kinds report `'unknown'` (the IDE shows them grey).
 *
 * `onTransition` is fired once per lifecycle transition each time the
 * snapshot is reassembled — Phase 4 wires this to the project's
 * activity log so transitions show up in the unified activity stream.
 */
export interface ProjectContextModelStoreCollaborators {
  /** Last-known result for a given workflow rule id ('success' | 'failed'). */
  readonly getRuleStatus?: (ruleId: string) => 'success' | 'failed' | undefined;
  /** Latest pass/fail per test id (most-recent-wins). */
  readonly getTestPasses?: () => readonly { id: string; pass: boolean }[];
  /** Returns true if a deployed-resource exists for the given id. */
  readonly hasDeployedResource?: (resourceId: string) => boolean;
  /** Returns true if a deployed-resource is currently healthy. */
  readonly isDeployedResourceHealthy?: (resourceId: string) => boolean;
  /** Called once per transition with the new contextId, prior status (or null), and new status. */
  readonly onTransition?: (event: SerializedTransition) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ProjectContextModelStore {
  private snapshot: ProjectContextModelSnapshot = EMPTY_SNAPSHOT;
  private model: ProjectModel | null = null;
  private subscribers = new Set<(snap: ProjectContextModelSnapshot) => void>();
  private priorStatuses = new Map<string, LifecycleStatus>();
  /** Most-recent-first ring buffer of captured transitions. */
  private recentTransitions: SerializedTransition[] = [];
  /** Per-context most-recent transition timestamp (ISO). */
  private lastTransitionAt = new Map<string, string>();

  constructor(
    private readonly projectRoot: string,
    private readonly collaborators: ProjectContextModelStoreCollaborators = {},
  ) {}

  /**
   * Re-evaluate validations against the cached model without going to
   * disk. Useful when only the collaborator state changed (a workflow
   * rule finished, a test passed) and the model is still authoritative.
   */
  async reevaluate(): Promise<ProjectContextModelSnapshot> {
    if (!this.model) return this.reload();
    const next = this.assembleSnapshot({
      loadedFiles: this.snapshot.loadedFiles,
      loadErrors: [...this.snapshot.loadErrors],
      model: this.model,
    });
    const changed = !snapshotsEquivalent(this.snapshot, next);
    this.snapshot = next;
    if (changed) this.notify(next);
    return next;
  }

  /**
   * Load (or re-load) the model from disk. Always safe; never throws.
   * Notifies subscribers when the snapshot actually changes — the
   * broadcast cost is paid only when state moves.
   */
  async reload(): Promise<ProjectContextModelSnapshot> {
    let result: LoadResult;
    try {
      result = await loadProjectModel({ projectRoot: this.projectRoot });
    } catch (err: unknown) {
      // Defensive — `loadProjectModel` is non-throwing today, but be safe.
      const message = err instanceof Error ? err.message : String(err);
      const next: ProjectContextModelSnapshot = {
        ...EMPTY_SNAPSHOT,
        loadErrors: [{ file: '<loader>', stage: 'read', message }],
        loadedAt: new Date().toISOString(),
      };
      const changed = !snapshotsEquivalent(this.snapshot, next);
      this.snapshot = next;
      this.model = null;
      if (changed) this.notify(next);
      return next;
    }

    this.model = result.model;
    const next = this.assembleSnapshot(result);
    const changed = !snapshotsEquivalent(this.snapshot, next);
    this.snapshot = next;
    if (changed) this.notify(next);
    return next;
  }

  /**
   * Build the snapshot from a loaded model + the current collaborator
   * state. Runs validation evaluation and lifecycle derivation; updates
   * `priorStatuses` so future runs detect transitions correctly.
   */
  private assembleSnapshot(result: { loadedFiles: readonly string[]; loadErrors: readonly LoadFileError[]; model: ProjectModel }): ProjectContextModelSnapshot {
    const present = result.loadedFiles.length > 0;
    const m = result.model;

    // ---- Evaluate validations ----
    const validationPasses = new Map<string, boolean>();
    const validationStatuses = new Map<string, 'passing' | 'failing' | 'unknown'>();
    for (const ctx of m.contexts.values()) {
      for (const v of ctx.validations) {
        const status = this.evaluateValidation(ctx, v.validation);
        const key = validationKey(ctx.id, v.id);
        validationStatuses.set(key, status);
        // Pass map only includes definitive 'passing'; unknown counts as
        // not-yet-passing for lifecycle purposes (deriveProjectLifecycle
        // treats absent or false as not passing).
        if (status === 'passing') validationPasses.set(key, true);
      }
    }

    // ---- Derive lifecycle ----
    const { statuses, transitions } = deriveProjectLifecycle({
      model: m,
      validationPasses,
      priorStatuses: this.priorStatuses,
    });

    // ---- Capture transitions ----
    if (transitions.length > 0) {
      const at = new Date().toISOString();
      const captured: SerializedTransition[] = transitions.map(t => ({
        contextId: t.contextId,
        contextName: m.contexts.get(t.contextId)?.name ?? t.contextId,
        from: t.from ?? null,
        to: t.to,
        at,
      }));
      // Most-recent-first: prepend, cap at MAX_RECENT_TRANSITIONS.
      this.recentTransitions = [...captured.slice().reverse(), ...this.recentTransitions]
        .slice(0, MAX_RECENT_TRANSITIONS);
      // Track per-context "when did this last transition" for the snapshot.
      for (const t of captured) {
        this.lastTransitionAt.set(t.contextId, at);
      }
      // Fire the per-transition hook (Phase 4: drives activityLog wiring in ProjectContext).
      if (this.collaborators.onTransition) {
        for (const t of captured) {
          try { this.collaborators.onTransition(t); } catch { /* ignore subscriber errors */ }
        }
      }
    }
    // Persist as the new prior for next derivation.
    this.priorStatuses = new Map(statuses);

    // ---- Build serialised snapshot ----
    const byStatus: { -readonly [K in LifecycleStatus]: number } = {
      pending: 0, ready: 0, 'in-progress': 0, done: 0, regressed: 0, 'dependency-regressed': 0,
    };
    const contexts: SerializedContext[] = [];
    for (const c of m.contexts.values()) {
      const validations: SerializedValidation[] = c.validations.map((v) => ({
        id: v.id,
        kind: v.validation.kind,
        description: v.validation.description,
        status: validationStatuses.get(validationKey(c.id, v.id)) ?? 'unknown',
        resources: v.resources,
      }));
      const status = statuses.get(c.id) ?? 'pending';
      byStatus[status]++;
      contexts.push({
        id: c.id,
        name: c.name,
        description: c.description,
        parentId: c.parentId,
        objectiveStatement: c.objective.statement,
        objectiveNotes: c.objective.notes,
        inputNames: Object.keys(c.inputs),
        outputNames: Object.keys(c.outputs),
        validations,
        actionKind: c.action.kind,
        actionDescription: c.action.description,
        lifecycleStatus: status,
        lastTransitionAt: this.lastTransitionAt.get(c.id),
      });
    }

    const resources: SerializedResource[] = [];
    for (const r of m.resources.values()) {
      resources.push({
        id: r.id,
        kind: kindShortName(r.__kind),
        discriminator: r.__kind,
        name: r.name,
        description: r.description,
      });
    }

    const rules: SerializedRule[] = [];
    for (const r of m.rules.values()) {
      rules.push({
        id: r.id,
        name: r.name,
        description: r.description,
        readsCount: r.reads?.length ?? 0,
        writesCount: r.writes?.length ?? 0,
        manual: r.manual ?? false,
      });
    }

    return {
      present,
      loadedFiles: result.loadedFiles,
      loadErrors: result.loadErrors,
      modelErrors: m.errors,
      counts: {
        contexts: contexts.length,
        resources: resources.length,
        rules: rules.length,
        byStatus,
      },
      contexts,
      resources,
      rules,
      recentTransitions: [...this.recentTransitions],
      loadedAt: new Date().toISOString(),
    };
  }

  /**
   * Evaluate one validation against current collaborator state. Returns
   * 'unknown' when the relevant collaborator isn't wired or the
   * required state isn't yet recorded — this keeps the IDE's "we
   * don't know yet" different from a definitive failure.
   */
  private evaluateValidation(ctx: ContextDeclaration, v: ValidationDeclaration): 'passing' | 'failing' | 'unknown' {
    const cfg = (v.config ?? {}) as Record<string, unknown>;
    switch (v.kind) {
      case 'rule-outcome': {
        const ruleId = String(cfg.ruleId ?? '');
        if (!ruleId || !this.collaborators.getRuleStatus) return 'unknown';
        const status = this.collaborators.getRuleStatus(ruleId);
        if (status === undefined) return 'unknown';
        return status === 'success' ? 'passing' : 'failing';
      }
      case 'test-pass': {
        const testId = String(cfg.testId ?? '');
        if (!testId || !this.collaborators.getTestPasses) return 'unknown';
        const entry = this.collaborators.getTestPasses().find(t => t.id === testId);
        if (!entry) return 'unknown';
        return entry.pass ? 'passing' : 'failing';
      }
      case 'test-set-pass': {
        const testSetId = String(cfg.testSetId ?? '');
        if (!testSetId || !this.collaborators.getTestPasses || !this.model) return 'unknown';
        const set = this.model.resources.get(testSetId);
        if (!set || set.__kind !== KIND.TestSet) return 'unknown';
        const passes = new Map(this.collaborators.getTestPasses().map(t => [t.id, t.pass]));
        let anyKnown = false;
        for (const testId of set.members) {
          if (!passes.has(testId)) continue;
          anyKnown = true;
          if (!passes.get(testId)) return 'failing';
        }
        // All known passes; if none of the members have run yet, status is unknown.
        return anyKnown ? 'passing' : 'unknown';
      }
      case 'deployed-resource-present': {
        const id = String(cfg.resourceId ?? '');
        if (!id || !this.collaborators.hasDeployedResource) return 'unknown';
        return this.collaborators.hasDeployedResource(id) ? 'passing' : 'failing';
      }
      case 'deployed-resource-healthy': {
        const id = String(cfg.resourceId ?? '');
        if (!id || !this.collaborators.isDeployedResourceHealthy) return 'unknown';
        return this.collaborators.isDeployedResourceHealthy(id) ? 'passing' : 'failing';
      }
      case 'manual-confirm':
      case 'code':
        // Phase 3 doesn't run these. Phase 4+ adds a manual-confirm
        // store and a code execution adapter.
        return 'unknown';
    }
    // Unreachable, but TS can't always narrow exhaustive switches.
    void ctx;
    return 'unknown';
  }

  /** Return the current snapshot (cheap; no I/O). */
  getSnapshot(): ProjectContextModelSnapshot {
    return this.snapshot;
  }

  /** The full ProjectModel for callers that need richer access. */
  getModel(): ProjectModel | null {
    return this.model;
  }

  /**
   * Build a regression trace for the given context against the
   * store's current model + collaborator state. Returns null when
   * the context is unknown or no model is loaded.
   */
  traceRegression(contextId: string): RegressionTrace | null {
    if (!this.model) return null;
    return traceRegression(this.model, contextId, {
      getRuleStatus: this.collaborators.getRuleStatus,
      getTestPasses: this.collaborators.getTestPasses,
      hasDeployedResource: this.collaborators.hasDeployedResource,
      isDeployedResourceHealthy: this.collaborators.isDeployedResourceHealthy,
      getLifecycleStatus: (id) => this.priorStatuses.get(id),
    });
  }

  /** Subscribe to snapshot changes. Returns unsubscribe fn. */
  subscribe(cb: (snap: ProjectContextModelSnapshot) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  private notify(snap: ProjectContextModelSnapshot): void {
    for (const cb of this.subscribers) {
      try { cb(snap); } catch { /* ignore subscriber errors */ }
    }
  }

  /** Returns true if a path matches one of the canonical .antimatter/*.ts files. */
  static isContextModelFile(path: string): boolean {
    const normalized = path.startsWith('/') ? path.slice(1) : path;
    return (
      normalized === '.antimatter/resources.ts' ||
      normalized === '.antimatter/contexts.ts' ||
      normalized === '.antimatter/build.ts'
    );
  }
}

/**
 * Returns true if two snapshots represent the same logical state.
 * Compares everything except `loadedAt` (which moves on every reload).
 * Cheap JSON-compare is fine — snapshots are small (one line per
 * declaration, no large strings).
 */
function snapshotsEquivalent(a: ProjectContextModelSnapshot, b: ProjectContextModelSnapshot): boolean {
  const norm = (s: ProjectContextModelSnapshot) => ({ ...s, loadedAt: '' });
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindShortName(discriminator: string): string {
  // Discriminators look like 'antimatter:resource:file-set'. Strip the
  // namespace prefix to produce the user-facing short name.
  const idx = discriminator.lastIndexOf(':');
  return idx >= 0 ? discriminator.slice(idx + 1) : discriminator;
}
