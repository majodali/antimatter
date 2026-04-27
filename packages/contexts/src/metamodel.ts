/**
 * Project Context metamodel — the schema for a project's hierarchical
 * context tree. See docs/contexts.md for the full conceptual model.
 *
 * Single user-facing node type `Context` with a `kind` discriminator
 * (work | runtime). Three user-facing edge types: `contains`,
 * `depends_on`, `targets`.
 *
 * Plus an internal-only node type `_Reference` and an internal edge
 * type `_contains_ref` used to make the simple-modeling DSL parse work
 * for `targets X` / `depends X` lines (which are reference lines, not
 * structural-children lines). After parse we post-process the
 * intermediate nodes into proper `targets` / `depends_on` edges and
 * delete them. See `parse.ts`.
 *
 * Cross-kind constraints (e.g., "depends_on only between work
 * contexts", "targets only from work to runtime") are not expressible
 * via simple-modeling's cardinality system — kind is a property, not a
 * type — so they're enforced post-parse in `validate.ts`.
 */
import { Metamodel } from 'simple-modeling';

/** The user-facing node type. */
export const CONTEXT_NODE_TYPE = 'Context';

/** Internal node type used to model a `targets X` / `depends X` line
 *  during parsing. Removed before the model is returned. */
export const REFERENCE_NODE_TYPE = '_Reference';

/** User-facing edge types. */
export const EDGE_CONTAINS = 'contains';
export const EDGE_DEPENDS_ON = 'depends_on';
export const EDGE_TARGETS = 'targets';

/** Internal edge type holding intermediate Reference nodes during parse. */
export const EDGE_CONTAINS_REF = '_contains_ref';

/** Enum of context kinds. */
export const KIND_WORK = 'work';
export const KIND_RUNTIME = 'runtime';
export type ContextKind = typeof KIND_WORK | typeof KIND_RUNTIME;

/** Enum of reference kinds.
 *
 *  `targets` and `depends` synthesize edges between Context nodes after parse.
 *  `requires-rule` and `requires-test` are post-processed into a separate
 *  per-context requirements map (since rules/tests aren't first-class nodes
 *  in this metamodel — they live in the workflow runtime / test harness).
 */
export const REF_TARGETS = 'targets';
export const REF_DEPENDS = 'depends';
export const REF_REQUIRES_RULE = 'requires-rule';
export const REF_REQUIRES_TEST = 'requires-test';
export type ReferenceKind =
  | typeof REF_TARGETS
  | typeof REF_DEPENDS
  | typeof REF_REQUIRES_RULE
  | typeof REF_REQUIRES_TEST;

export function createContextMetamodel(): Metamodel {
  const mm = new Metamodel('AntimatterContexts');

  mm.addEnumType({
    name: 'ContextKind',
    literals: [KIND_WORK, KIND_RUNTIME],
  });

  mm.addEnumType({
    name: 'ReferenceKind',
    literals: [REF_TARGETS, REF_DEPENDS, REF_REQUIRES_RULE, REF_REQUIRES_TEST],
  });

  mm.addNodeType({
    name: CONTEXT_NODE_TYPE,
    properties: [
      { name: 'name', type: { kind: 'primitive', type: 'string' } },
      { name: 'kind', type: { kind: 'enum', enumType: 'ContextKind' } },
      { name: 'description', type: { kind: 'primitive', type: 'string' }, optional: true },
    ],
  });

  // Intermediate node — never seen by callers. Holds the data needed to
  // synthesize a proper `targets` / `depends_on` edge after parse.
  mm.addNodeType({
    name: REFERENCE_NODE_TYPE,
    properties: [
      { name: 'refKind', type: { kind: 'enum', enumType: 'ReferenceKind' } },
      { name: 'target', type: { kind: 'primitive', type: 'string' } },
    ],
  });

  // Strict-tree containment between Contexts. Source 0..* (a parent
  // has 0+ children); target 0..1 (a child has at most one parent —
  // the root context has zero, expressed by being the topmost line).
  mm.addEdgeType({
    name: EDGE_CONTAINS,
    source: CONTEXT_NODE_TYPE,
    target: CONTEXT_NODE_TYPE,
    sourceCardinality: '0..*',
    targetCardinality: '0..1',
  });

  // Containment of intermediate Reference nodes. Always 0..1 on target
  // (each Reference has exactly one parent Context). Removed during
  // post-process, never seen by validators.
  mm.addEdgeType({
    name: EDGE_CONTAINS_REF,
    source: CONTEXT_NODE_TYPE,
    target: REFERENCE_NODE_TYPE,
    sourceCardinality: '0..*',
    targetCardinality: '1',
  });

  // depends_on and targets are unconstrained at the metamodel level;
  // post-parse validation enforces "work → work" / "work → runtime"
  // semantics.
  mm.addEdgeType({
    name: EDGE_DEPENDS_ON,
    source: CONTEXT_NODE_TYPE,
    target: CONTEXT_NODE_TYPE,
    sourceCardinality: '0..*',
    targetCardinality: '0..*',
  });

  mm.addEdgeType({
    name: EDGE_TARGETS,
    source: CONTEXT_NODE_TYPE,
    target: CONTEXT_NODE_TYPE,
    sourceCardinality: '0..*',
    targetCardinality: '0..*',
  });

  return mm;
}
