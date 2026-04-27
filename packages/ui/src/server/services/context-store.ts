/**
 * ContextStore — server-side storage for the project's hierarchical
 * context tree, parsed from `.antimatter/contexts.dsl`.
 *
 * Owns:
 *  - The current parsed Model (from @antimatter/contexts)
 *  - Validation errors
 *  - The raw DSL source text
 *  - A serializable snapshot for transport to the UI
 *  - Subscribers (for WebSocket broadcast on reload)
 *
 * Reload semantics:
 *  - `reload()` reads the DSL file from the project workspace, parses,
 *    validates, and notifies subscribers if the parse result changed.
 *  - If the file doesn't exist, the store holds an empty model and
 *    `present: false` — consumers can render a "no contexts defined"
 *    state without crashing.
 *  - Parse exceptions (malformed indentation etc.) are caught and
 *    surfaced as a single 'parse-failed' validation error.
 *
 * Snapshot shape is intentionally flat (Context[] + edges by type) so
 * the UI doesn't need simple-modeling on the client.
 */

import type { WorkspaceEnvironment } from '@antimatter/workspace';
import {
  parseContexts,
  validateContexts,
  CONTEXT_NODE_TYPE,
  EDGE_CONTAINS,
  EDGE_DEPENDS_ON,
  EDGE_TARGETS,
  KIND_WORK,
  KIND_RUNTIME,
} from '@antimatter/contexts';
import type { ParseResult } from '@antimatter/contexts';
import type {
  ContextSnapshot,
  ContextNodeSnapshot,
  ContextEdgeSnapshot,
  ContextKind,
} from '../../shared/contexts-types.js';

const DSL_PATH = '.antimatter/contexts.dsl';

// Re-export wire types so server callers don't need to reach into shared/.
export type {
  ContextSnapshot,
  ContextNodeSnapshot,
  ContextEdgeSnapshot,
  ContextKind,
} from '../../shared/contexts-types.js';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ContextStore {
  private snapshot: ContextSnapshot = emptySnapshot();
  /** Parsed model + requirements. Null when no DSL file exists. Kept
   *  alongside the flat snapshot so consumers like ContextLifecycleStore
   *  can do graph traversals without re-parsing. */
  private parsed: ParseResult | null = null;
  private subscribers = new Set<(snap: ContextSnapshot) => void>();

  constructor(private readonly env: WorkspaceEnvironment) {}

  /** Parse the DSL on disk if present. Always safe to call; never throws. */
  async initialize(): Promise<void> {
    await this.reload();
  }

  /** Re-parse the DSL on disk and notify subscribers if anything changed. */
  async reload(): Promise<ContextSnapshot> {
    const built = await this.buildSnapshot();
    const next = built.snapshot;
    const changed = !snapshotsEqual(this.snapshot, next);
    this.snapshot = next;
    this.parsed = built.parsed;
    if (changed) {
      for (const cb of this.subscribers) {
        try { cb(next); } catch { /* ignore subscriber errors */ }
      }
    }
    return next;
  }

  /** Get the current snapshot (cheap; no file I/O). */
  getSnapshot(): ContextSnapshot {
    return this.snapshot;
  }

  /**
   * Get the current parsed model + requirements (cheap; no file I/O).
   * Returns null if no DSL file is present or parsing failed.
   * Used by ContextLifecycleStore to drive lifecycle derivation without
   * re-parsing the DSL.
   */
  getParsed(): ParseResult | null {
    return this.parsed;
  }

  /** Subscribe to snapshot changes. Returns unsubscribe fn. */
  subscribe(cb: (snap: ContextSnapshot) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  /** Returns true if a path matches the contexts DSL — used by the
   *  watcher integration in ProjectContext to trigger reload. */
  static isContextsFile(path: string): boolean {
    const normalized = path.startsWith('/') ? path.slice(1) : path;
    return normalized === DSL_PATH;
  }

  // ---- internals ----

  private async buildSnapshot(): Promise<{ snapshot: ContextSnapshot; parsed: ParseResult | null }> {
    const loadedAt = new Date().toISOString();

    let exists = false;
    try { exists = await this.env.exists(DSL_PATH); } catch { exists = false; }
    if (!exists) {
      return { snapshot: { ...emptySnapshot(), loadedAt }, parsed: null };
    }

    let source = '';
    try { source = await this.env.readFile(DSL_PATH); }
    catch (err) {
      return {
        snapshot: {
          ...emptySnapshot(),
          present: true,
          loadedAt,
          errors: [{
            code: 'metamodel',
            message: `Failed to read ${DSL_PATH}: ${err instanceof Error ? err.message : String(err)}`,
          }],
        },
        parsed: null,
      };
    }

    try {
      const parsed = parseContexts(source);
      const { model, unresolvedReferences, requirements } = parsed;
      const errors = validateContexts(model, unresolvedReferences);

      // Find root: the (hopefully single) Context with no incoming `contains`.
      let rootName: string | undefined;
      for (const node of model.nodes.values()) {
        if (node.type !== CONTEXT_NODE_TYPE) continue;
        if (model.edgesTo(node.id, EDGE_CONTAINS).length === 0) {
          rootName = node.name ?? node.id;
          break;
        }
      }

      const nodes: ContextNodeSnapshot[] = [];
      const edges: ContextEdgeSnapshot[] = [];

      for (const node of model.nodes.values()) {
        if (node.type !== CONTEXT_NODE_TYPE) continue;
        const name = node.name ?? node.id;
        const parentEdges = model.edgesTo(node.id, EDGE_CONTAINS);
        const parent = parentEdges.length > 0
          ? (model.getNode(parentEdges[0].source).name ?? parentEdges[0].source)
          : undefined;
        const targets = model.edgesFrom(node.id, EDGE_TARGETS)
          .map(e => model.getNode(e.target).name ?? e.target);
        const dependsOn = model.edgesFrom(node.id, EDGE_DEPENDS_ON)
          .map(e => model.getNode(e.target).name ?? e.target);

        const kind = node.properties.kind === KIND_RUNTIME ? KIND_RUNTIME : KIND_WORK;

        // Requirements as declared in the DSL. Without a wired-in rule/test
        // catalog yet (next slice — ContextLifecycleStore), we mark every
        // declared requirement as `passing: false, unresolved: true` so the
        // UI can show "I'm declared but not yet wired". The lifecycle store
        // will overwrite these with real pass/fail once it lands.
        const reqs = requirements.get(node.id) ?? [];
        const requirementSnapshots = reqs.map(r => ({
          kind: r.kind,
          id: r.id,
          passing: false,
          unresolved: true,
        }));

        nodes.push({
          id: node.id,
          name,
          kind: kind as ContextKind,
          description: node.properties.description as string | undefined,
          parent,
          targets,
          dependsOn,
          requirements: requirementSnapshots,
        });
      }

      for (const edge of model.edges.values()) {
        if (edge.type !== EDGE_CONTAINS &&
            edge.type !== EDGE_TARGETS &&
            edge.type !== EDGE_DEPENDS_ON) continue;
        edges.push({
          type: edge.type as ContextEdgeSnapshot['type'],
          source: model.getNode(edge.source).name ?? edge.source,
          target: model.getNode(edge.target).name ?? edge.target,
        });
      }

      // Stable order: nodes by name, edges by (type, source, target).
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      edges.sort((a, b) =>
        a.type.localeCompare(b.type) ||
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target),
      );

      return {
        snapshot: {
          present: true,
          rootName,
          nodes,
          edges,
          errors,
          source,
          loadedAt,
        },
        parsed,
      };
    } catch (err) {
      return {
        snapshot: {
          ...emptySnapshot(),
          present: true,
          source,
          loadedAt,
          errors: [{
            code: 'metamodel',
            message: `Parse failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
        },
        parsed: null,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySnapshot(): ContextSnapshot {
  return {
    present: false,
    nodes: [],
    edges: [],
    errors: [],
    source: '',
    loadedAt: new Date(0).toISOString(),
  };
}

/** Equality check that ignores `loadedAt` (which always changes). */
function snapshotsEqual(a: ContextSnapshot, b: ContextSnapshot): boolean {
  if (a.present !== b.present) return false;
  if (a.rootName !== b.rootName) return false;
  if (a.source !== b.source) return false;
  if (a.nodes.length !== b.nodes.length) return false;
  if (a.edges.length !== b.edges.length) return false;
  if (a.errors.length !== b.errors.length) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    const an = a.nodes[i]; const bn = b.nodes[i];
    if (an.name !== bn.name || an.kind !== bn.kind ||
        an.description !== bn.description || an.parent !== bn.parent) return false;
    if (an.targets.length !== bn.targets.length) return false;
    if (an.dependsOn.length !== bn.dependsOn.length) return false;
    if (an.requirements.length !== bn.requirements.length) return false;
    if (an.lifecycleStatus !== bn.lifecycleStatus) return false;
    for (let j = 0; j < an.targets.length; j++) if (an.targets[j] !== bn.targets[j]) return false;
    for (let j = 0; j < an.dependsOn.length; j++) if (an.dependsOn[j] !== bn.dependsOn[j]) return false;
    for (let j = 0; j < an.requirements.length; j++) {
      const ar = an.requirements[j]; const br = bn.requirements[j];
      if (ar.kind !== br.kind || ar.id !== br.id ||
          ar.passing !== br.passing || ar.unresolved !== br.unresolved) return false;
    }
  }
  for (let i = 0; i < a.edges.length; i++) {
    const ae = a.edges[i]; const be = b.edges[i];
    if (ae.type !== be.type || ae.source !== be.source || ae.target !== be.target) return false;
  }
  for (let i = 0; i < a.errors.length; i++) {
    if (a.errors[i].code !== b.errors[i].code || a.errors[i].message !== b.errors[i].message) return false;
  }
  return true;
}
