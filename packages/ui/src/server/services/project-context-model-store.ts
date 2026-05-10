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

import { loadProjectModel } from '@antimatter/contexts';
import type {
  ProjectModel,
  LoadResult,
  LoadFileError,
  ProjectModelError,
} from '@antimatter/contexts';

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
  };
  /** Flat list of contexts. */
  readonly contexts: readonly SerializedContext[];
  /** Flat list of resources, with kind discriminator preserved. */
  readonly resources: readonly SerializedResource[];
  /** Flat list of rules. */
  readonly rules: readonly SerializedRule[];
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
  readonly validationIds: readonly string[];
  readonly actionKind: string;
  readonly actionDescription: string;
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

const EMPTY_SNAPSHOT: ProjectContextModelSnapshot = {
  present: false,
  loadedFiles: [],
  loadErrors: [],
  modelErrors: [],
  counts: { contexts: 0, resources: 0, rules: 0 },
  contexts: [],
  resources: [],
  rules: [],
  loadedAt: new Date(0).toISOString(),
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ProjectContextModelStore {
  private snapshot: ProjectContextModelSnapshot = EMPTY_SNAPSHOT;
  private model: ProjectModel | null = null;
  private subscribers = new Set<(snap: ProjectContextModelSnapshot) => void>();

  constructor(private readonly projectRoot: string) {}

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
    const next = buildSnapshot(result);
    const changed = !snapshotsEquivalent(this.snapshot, next);
    this.snapshot = next;
    if (changed) this.notify(next);
    return next;
  }

  /** Return the current snapshot (cheap; no I/O). */
  getSnapshot(): ProjectContextModelSnapshot {
    return this.snapshot;
  }

  /** The full ProjectModel for callers that need richer access. */
  getModel(): ProjectModel | null {
    return this.model;
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
// Serialisation
// ---------------------------------------------------------------------------

function buildSnapshot(result: LoadResult): ProjectContextModelSnapshot {
  const present = result.loadedFiles.length > 0;
  const m = result.model;

  const contexts: SerializedContext[] = [];
  for (const c of m.contexts.values()) {
    contexts.push({
      id: c.id,
      name: c.name,
      description: c.description,
      parentId: c.parentId,
      objectiveStatement: c.objective.statement,
      objectiveNotes: c.objective.notes,
      inputNames: Object.keys(c.inputs),
      outputNames: Object.keys(c.outputs),
      validationIds: c.validations.map(v => v.id),
      actionKind: c.action.kind,
      actionDescription: c.action.description,
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
    counts: { contexts: contexts.length, resources: resources.length, rules: rules.length },
    contexts,
    resources,
    rules,
    loadedAt: new Date().toISOString(),
  };
}

function kindShortName(discriminator: string): string {
  // Discriminators look like 'antimatter:resource:file-set'. Strip the
  // namespace prefix to produce the user-facing short name.
  const idx = discriminator.lastIndexOf(':');
  return idx >= 0 ? discriminator.slice(idx + 1) : discriminator;
}
