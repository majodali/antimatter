/**
 * Parse a context DSL document into a clean Context graph plus a
 * per-context requirements map.
 *
 * Wraps simple-modeling's `deserialize` and post-processes the
 * intermediate `_Reference` nodes:
 *
 *  - `targets` / `depends` references → proper `targets` / `depends_on`
 *    edges between Contexts (target resolved by name).
 *  - `requires rule {id}` / `requires test {id}` references → entries
 *    in `requirements` map keyed by the parent context's id. Rules and
 *    tests are NOT first-class nodes here (they live in the workflow
 *    runtime / test harness), so we don't try to resolve them — that
 *    happens at the integration layer where those registries exist.
 *
 * After post-processing the model contains ONLY:
 *   - Context nodes
 *   - `contains` edges (parent → child)
 *   - `targets` edges (work-context → runtime-context)
 *   - `depends_on` edges (work-context → work-context)
 *
 * The intermediate `_Reference` nodes and `_contains_ref` edges are
 * deleted so callers never see them.
 */
import { deserialize, type Model, type Node } from 'simple-modeling';
import {
  createContextMetamodel,
  REFERENCE_NODE_TYPE,
  EDGE_CONTAINS_REF,
  EDGE_TARGETS,
  EDGE_DEPENDS_ON,
  REF_TARGETS,
  REF_DEPENDS,
  REF_REQUIRES_RULE,
  REF_REQUIRES_TEST,
  CONTEXT_NODE_TYPE,
} from './metamodel.js';
import { createContextDsl } from './dsl.js';

export type RequirementKind = 'rule' | 'test';

export interface ContextRequirement {
  /** What kind of artifact must succeed for this requirement to pass. */
  readonly kind: RequirementKind;
  /** The id of the rule or test (resolved at the integration layer). */
  readonly id: string;
}

export interface UnresolvedReference {
  /** The Context that owned the `targets` / `depends` line. */
  readonly fromContext: string;
  /** The unresolved target name (as written in the DSL). */
  readonly toName: string;
  /** Which kind of reference. */
  readonly refKind: 'targets' | 'depends';
}

export interface ParseResult {
  readonly model: Model;
  readonly unresolvedReferences: readonly UnresolvedReference[];
  /**
   * Map from Context node id (= name) to its declared requirements.
   * Contexts with no `requires` lines are absent from the map; callers
   * should treat absence as "empty requirements list".
   */
  readonly requirements: ReadonlyMap<string, readonly ContextRequirement[]>;
}

/**
 * Parse a contexts DSL document. Returns the cleaned model, any
 * references that couldn't be resolved by name, and the per-context
 * requirements declared via `requires rule X` / `requires test X`.
 */
export function parseContexts(text: string): ParseResult {
  const metamodel = createContextMetamodel();
  const dsl = createContextDsl();
  const model = deserialize(text, metamodel, dsl);

  const unresolved: UnresolvedReference[] = [];
  const requirements = new Map<string, ContextRequirement[]>();

  // Collect all _Reference nodes (snapshot first — we'll be mutating).
  const referenceNodes: Node[] = [];
  for (const node of model.nodes.values()) {
    if (node.type === REFERENCE_NODE_TYPE) {
      referenceNodes.push(node);
    }
  }

  for (const refNode of referenceNodes) {
    // Find the parent Context via incoming `_contains_ref` edge.
    const incoming = model.edgesTo(refNode.id, EDGE_CONTAINS_REF);
    if (incoming.length === 0) {
      // Orphan reference (shouldn't happen with valid indent — refs
      // can't be top-level) — drop it silently.
      model.removeNode(refNode.id);
      continue;
    }
    const parentId = incoming[0].source;
    const parent = model.getNode(parentId);

    const refKind = refNode.properties.refKind as string;
    const targetName = refNode.properties.target as string;

    if (refKind === REF_REQUIRES_RULE || refKind === REF_REQUIRES_TEST) {
      // Collect into requirements map; don't resolve (rules/tests aren't
      // model nodes). Validation that the id exists happens at the
      // integration layer with access to the workflow / test registries.
      const list = requirements.get(parentId) ?? [];
      list.push({
        kind: refKind === REF_REQUIRES_RULE ? 'rule' : 'test',
        id: targetName,
      });
      requirements.set(parentId, list);
      model.removeNode(refNode.id);
      continue;
    }

    if (refKind === REF_TARGETS || refKind === REF_DEPENDS) {
      // Resolve the target Context by name.
      const targetNode = model.findNodeByName(targetName);
      if (!targetNode || targetNode.type !== CONTEXT_NODE_TYPE) {
        unresolved.push({
          fromContext: parent.name ?? parent.id,
          toName: targetName,
          refKind: refKind === REF_TARGETS ? 'targets' : 'depends',
        });
        model.removeNode(refNode.id);
        continue;
      }

      const edgeType = refKind === REF_TARGETS ? EDGE_TARGETS : EDGE_DEPENDS_ON;
      model.addEdge(edgeType, parentId, targetNode.id);
      model.removeNode(refNode.id);
      continue;
    }

    // Unknown refKind — defensive; just drop.
    model.removeNode(refNode.id);
  }

  return { model, unresolvedReferences: unresolved, requirements };
}
