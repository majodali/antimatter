/**
 * ContextLifecycleStore — server-side persistence + derivation for the
 * project context tree's lifecycle status.
 *
 * Derives the status of every Context (`pending` → `ready` →
 * `in-progress` → `done`, plus `regressed` and `dependency-regressed`)
 * from:
 *   - The parsed model + per-context requirements (from ContextStore)
 *   - The current pass/fail of every workflow rule (via callback)
 *   - The current pass/fail of every test (via callback)
 *   - The persisted prior status of every context (from disk)
 *
 * On every recompute it produces:
 *   - A new statuses map (persisted to disk for future regression detection)
 *   - A list of transitions (changes vs. prior) — emitted as
 *     `context:transitioned` workflow events so rules can react
 *   - An updated ContextLifecycleSnapshot — broadcast to clients
 *
 * Recompute triggers:
 *   - On startup (via `initialize()`)
 *   - On context model changes (subscribed to ContextStore)
 *   - On rule result changes (call `scheduleRecompute()` from caller)
 *   - On test result changes (call `scheduleRecompute()` from caller)
 *
 * Recomputes are debounced (~150ms) so multiple input changes coalesce
 * into a single derivation pass.
 */
import type { WorkspaceEnvironment } from '@antimatter/workspace';
import {
  CONTEXT_NODE_TYPE,
  deriveLifecycleStatuses,
  validateRequirements,
  type LifecycleStatus,
  type LifecycleTransition,
} from '@antimatter/contexts';
import type { ContextStore } from './context-store.js';
import type {
  ContextLifecycleSnapshot,
  ContextLifecycleTransition,
  ContextRequirementSnapshot,
  ContextValidationError,
} from '../../shared/contexts-types.js';

const STORAGE_PATH = '.antimatter-cache/context-lifecycle.json';
const DEBOUNCE_MS = 150;

/**
 * Workflow rule execution status — kept narrow to decouple from
 * @antimatter/workflow's full PersistedRuleResult shape.
 */
export type RuleResultStatus = 'success' | 'failed' | 'pending' | 'running';

/**
 * Test result for a single test case (latest run wins). Kept narrow to
 * decouple from the full StoredTestResult shape.
 */
export interface TestPassEntry {
  id: string;
  pass: boolean;
}

/** Workflow rule declaration — used to map names → ids. */
export interface RuleDeclaration {
  id: string;
  name: string;
}

export interface ContextLifecycleStoreConfig {
  env: WorkspaceEnvironment;
  contextStore: ContextStore;
  /** Returns the current set of declared rules (id + name). */
  getRuleDeclarations: () => readonly RuleDeclaration[];
  /** Returns the most recent status for a rule (by canonical id),
   *  or undefined if the rule has never run. */
  getRuleResult: (ruleId: string) => RuleResultStatus | undefined;
  /** Returns the latest test pass state for every test that has run.
   *  Most-recent-wins semantics — caller can pass the final flattened
   *  list across all stored runs. */
  getTestPasses: () => readonly TestPassEntry[];
  /** Optional hook fired with the list of transitions on every
   *  recompute that produced any. Used to emit `context:transitioned`
   *  workflow events. */
  onTransitions?: (transitions: readonly ContextLifecycleTransition[]) => void;
  /** Storage path override (for tests). */
  storagePath?: string;
}

/** What's persisted to disk. */
interface PersistedLifecycle {
  statuses: Record<string, LifecycleStatus>;
  derivedAt: string;
  /** Schema version — bump if format changes. */
  version: number;
}

const PERSISTENCE_VERSION = 1;

export class ContextLifecycleStore {
  private statuses = new Map<string, LifecycleStatus>();
  private requirementResults = new Map<string, ContextRequirementSnapshot[]>();
  private validationErrors: ContextValidationError[] = [];
  private subscribers = new Set<(snap: ContextLifecycleSnapshot) => void>();
  private recomputeTimer: ReturnType<typeof setTimeout> | null = null;
  private contextStoreUnsub?: () => void;
  private readonly storagePath: string;
  private initialized = false;

  constructor(private readonly config: ContextLifecycleStoreConfig) {
    this.storagePath = config.storagePath ?? STORAGE_PATH;
  }

  /** Load persisted statuses, subscribe to context model changes,
   *  do an initial derivation. Safe to call repeatedly (no-op after first). */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Load persisted statuses (best-effort).
    try {
      if (await this.config.env.exists(this.storagePath)) {
        const content = await this.config.env.readFile(this.storagePath);
        const data = JSON.parse(content) as Partial<PersistedLifecycle>;
        if (data.statuses) {
          for (const [id, st] of Object.entries(data.statuses)) {
            this.statuses.set(id, st);
          }
        }
      }
    } catch {
      // Corrupt or missing — start fresh.
    }

    // Subscribe to context model changes.
    this.contextStoreUnsub = this.config.contextStore.subscribe(() => {
      this.scheduleRecompute();
    });

    // Initial derivation.
    await this.recomputeNow();
  }

  /** Schedule a debounced recompute. Coalesces rapid input changes. */
  scheduleRecompute(): void {
    if (this.recomputeTimer) return;
    this.recomputeTimer = setTimeout(() => {
      this.recomputeTimer = null;
      this.recomputeNow().catch((err: unknown) => {
        console.error('[context-lifecycle] recompute failed:', err);
      });
    }, DEBOUNCE_MS);
  }

  /** Force an immediate recompute. Mostly for tests; production should
   *  use scheduleRecompute() to benefit from coalescing. */
  async recomputeNow(): Promise<void> {
    const parsed = this.config.contextStore.getParsed();

    if (!parsed) {
      // No DSL — clear everything if we had data, then notify.
      const had = this.statuses.size > 0
        || this.requirementResults.size > 0
        || this.validationErrors.length > 0;
      this.statuses.clear();
      this.requirementResults.clear();
      this.validationErrors = [];
      if (had) {
        await this.persist();
        this.notify();
      }
      return;
    }

    const { model, requirements } = parsed;

    // Build a name → canonical-id map for rules. Both `Bundle API Lambda`
    // (display name) and `bundle-api-lambda` (slugified id) should resolve
    // to the same rule. The id form wins if a name happens to collide
    // with a different rule's id.
    const ruleIdByName = new Map<string, string>();
    for (const decl of this.config.getRuleDeclarations()) {
      ruleIdByName.set(decl.name, decl.id);
      ruleIdByName.set(decl.id, decl.id);
    }

    // Build test-id → pass map (latest-wins is the caller's responsibility).
    const testPassMap = new Map<string, boolean>();
    const validTestIds = new Set<string>();
    for (const t of this.config.getTestPasses()) {
      testPassMap.set(t.id, t.pass);
      validTestIds.add(t.id);
    }

    // Validate requires lines against the runtime catalogs. Surfaces
    // typos like `requires rule Bundle API Lambdaa` as user-visible
    // errors. Does NOT affect the lifecycle status derivation —
    // unresolved requires lines still produce passing=false on their
    // requirement snapshot, so the status logic is consistent. The
    // errors are an additional, clearer signal for the UI.
    const runtimeValidationErrors = validateRequirements(requirements, {
      ruleIds: new Set(ruleIdByName.keys()),
      testIds: validTestIds,
    });

    // Build per-context requirement snapshots AND per-requirement-id pass
    // maps for the derivation function. The derivation function looks up
    // by the SAME id string the user wrote in the DSL, so both map keys
    // are the as-written ids.
    const requirementSnapshots = new Map<string, ContextRequirementSnapshot[]>();
    const derivationRulePasses = new Map<string, boolean>();
    const derivationTestPasses = new Map<string, boolean>();

    for (const node of model.nodes.values()) {
      if (node.type !== CONTEXT_NODE_TYPE) continue;
      const reqs = requirements.get(node.id) ?? [];
      const snapshots: ContextRequirementSnapshot[] = [];
      for (const req of reqs) {
        if (req.kind === 'rule') {
          const canonicalId = ruleIdByName.get(req.id);
          const unresolved = canonicalId === undefined;
          const passing = canonicalId !== undefined
            ? this.config.getRuleResult(canonicalId) === 'success'
            : false;
          snapshots.push({ kind: 'rule', id: req.id, passing, unresolved });
          derivationRulePasses.set(req.id, passing);
        } else {
          const unresolved = !validTestIds.has(req.id);
          const passing = testPassMap.get(req.id) === true;
          snapshots.push({ kind: 'test', id: req.id, passing, unresolved });
          derivationTestPasses.set(req.id, passing);
        }
      }
      requirementSnapshots.set(node.id, snapshots);
    }

    const { statuses: nextStatuses, transitions } = deriveLifecycleStatuses({
      model,
      requirements,
      rulePasses: derivationRulePasses,
      testPasses: derivationTestPasses,
      priorStatuses: this.statuses,
    });

    const statusesChanged = !mapsEqual(this.statuses, nextStatuses);
    const reqsChanged = !requirementsMapsEqual(this.requirementResults, requirementSnapshots);
    const errorsChanged = !validationErrorsEqual(this.validationErrors, runtimeValidationErrors);

    this.statuses = new Map(nextStatuses);
    this.requirementResults = requirementSnapshots;
    this.validationErrors = runtimeValidationErrors;

    // Persist whenever statuses change (regression detection depends on it).
    if (statusesChanged) {
      await this.persist();
    }

    // Emit transition events.
    if (transitions.length > 0 && this.config.onTransitions) {
      const at = new Date().toISOString();
      const wireTransitions: ContextLifecycleTransition[] = transitions.map(t => ({
        contextId: t.contextId,
        from: t.from,
        to: t.to,
        at,
      }));
      try {
        this.config.onTransitions(wireTransitions);
      } catch (err) {
        console.error('[context-lifecycle] onTransitions hook failed:', err);
      }
    }

    if (statusesChanged || reqsChanged || errorsChanged) this.notify();
  }

  /** Get the current snapshot (cheap; no I/O). */
  getSnapshot(): ContextLifecycleSnapshot {
    return {
      statuses: Object.fromEntries(this.statuses),
      requirements: Object.fromEntries(
        [...this.requirementResults.entries()].map(([k, v]) => [k, [...v]]),
      ),
      validationErrors: [...this.validationErrors],
      derivedAt: new Date().toISOString(),
    };
  }

  /** Subscribe to snapshot changes. */
  subscribe(cb: (snap: ContextLifecycleSnapshot) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  /** Stop watchers, flush state. */
  async shutdown(): Promise<void> {
    if (this.recomputeTimer) {
      clearTimeout(this.recomputeTimer);
      this.recomputeTimer = null;
    }
    this.contextStoreUnsub?.();
    this.contextStoreUnsub = undefined;
    // Final persist in case a recompute ran since last save.
    if (this.statuses.size > 0) {
      try { await this.persist(); } catch { /* ignore on shutdown */ }
    }
  }

  // ---- internals ----

  private notify(): void {
    const snap = this.getSnapshot();
    for (const cb of this.subscribers) {
      try { cb(snap); } catch { /* ignore subscriber errors */ }
    }
  }

  private async persist(): Promise<void> {
    const data: PersistedLifecycle = {
      statuses: Object.fromEntries(this.statuses),
      derivedAt: new Date().toISOString(),
      version: PERSISTENCE_VERSION,
    };
    try {
      await this.config.env.writeFile(this.storagePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[context-lifecycle] persist failed:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapsEqual<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

function requirementsMapsEqual(
  a: ReadonlyMap<string, readonly ContextRequirementSnapshot[]>,
  b: ReadonlyMap<string, readonly ContextRequirementSnapshot[]>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (!bv || av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i].kind !== bv[i].kind ||
          av[i].id !== bv[i].id ||
          av[i].passing !== bv[i].passing ||
          av[i].unresolved !== bv[i].unresolved) return false;
    }
  }
  return true;
}

function validationErrorsEqual(
  a: readonly ContextValidationError[],
  b: readonly ContextValidationError[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].code !== b[i].code ||
        a[i].message !== b[i].message ||
        a[i].context !== b[i].context ||
        a[i].target !== b[i].target) return false;
  }
  return true;
}

// Re-export wire types so server callers don't need to reach into shared/.
export type {
  ContextLifecycleSnapshot,
  ContextLifecycleTransition,
  ContextRequirementSnapshot,
} from '../../shared/contexts-types.js';
export type { LifecycleStatus, LifecycleTransition };
