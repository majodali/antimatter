/**
 * Cross-kind and structural validation for a parsed Context model.
 *
 * Layered on top of simple-modeling's built-in `Model.validate()` which
 * checks property types, required properties, and edge cardinality.
 *
 * This module enforces what the metamodel's cardinality system can't
 * express because `kind` is a property, not a node type:
 *
 *   - `targets` edges: source must be `kind=work`, target must be
 *     `kind=runtime`
 *   - `depends_on` edges: source AND target must be `kind=work`
 *   - No self-loops on `targets` or `depends_on`
 *   - No cycles in `depends_on`
 *   - Reachable from a single root (no orphan top-level Contexts beyond
 *     the root) — the deserializer naturally produces this from a
 *     well-formed indent tree, but we double-check
 */
import type { Model } from 'simple-modeling';
import {
  CONTEXT_NODE_TYPE,
  EDGE_CONTAINS,
  EDGE_DEPENDS_ON,
  EDGE_TARGETS,
  KIND_WORK,
  KIND_RUNTIME,
} from './metamodel.js';
import type { UnresolvedReference, ContextRequirement } from './parse.js';

export interface ValidationError {
  readonly code:
    | 'metamodel'                 // simple-modeling's built-in check failed
    | 'targets-source-kind'       // `targets` from a non-work context
    | 'targets-target-kind'       // `targets` to a non-runtime context
    | 'depends-source-kind'       // `depends_on` from a non-work context
    | 'depends-target-kind'       // `depends_on` to a non-work context
    | 'self-reference'            // self-loop on targets/depends_on
    | 'depends-cycle'             // cycle in depends_on graph
    | 'multiple-roots'            // more than one Context with no parent
    | 'no-root'                   // no Context with zero parents
    | 'unresolved-reference'      // `targets X` / `depends X` with no matching Context
    | 'unresolved-rule-reference' // `requires rule X` with no matching declared rule
    | 'unresolved-test-reference';// `requires test X` with no matching test id
  readonly message: string;
  /** Optional context names involved in the error (for UI display). */
  readonly context?: string;
  readonly target?: string;
}

/**
 * Validate the cleaned Context model. Pass the `unresolvedReferences`
 * from `parseContexts` so they get rolled into the same error list.
 */
export function validateContexts(
  model: Model,
  unresolvedReferences: readonly UnresolvedReference[] = [],
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Built-in metamodel validation (cardinality, types, required props).
  for (const msg of model.validate()) {
    errors.push({ code: 'metamodel', message: msg });
  }

  // 2. Unresolved references from parse.
  for (const ref of unresolvedReferences) {
    errors.push({
      code: 'unresolved-reference',
      message: `Context '${ref.fromContext}' ${ref.refKind} '${ref.toName}', but no context with that name exists`,
      context: ref.fromContext,
      target: ref.toName,
    });
  }

  // 3. Cross-kind edge constraints.
  for (const edge of model.edges.values()) {
    if (edge.type !== EDGE_TARGETS && edge.type !== EDGE_DEPENDS_ON) continue;
    const source = model.getNode(edge.source);
    const target = model.getNode(edge.target);
    const sourceName = source.name ?? source.id;
    const targetName = target.name ?? target.id;

    // Self-loop check (applies to both edge types).
    if (edge.source === edge.target) {
      errors.push({
        code: 'self-reference',
        message: `Context '${sourceName}' cannot ${edge.type === EDGE_TARGETS ? 'target' : 'depend on'} itself`,
        context: sourceName,
      });
      continue;
    }

    if (edge.type === EDGE_TARGETS) {
      if (source.properties.kind !== KIND_WORK) {
        errors.push({
          code: 'targets-source-kind',
          message: `Only work contexts can use 'targets', but '${sourceName}' is kind=${source.properties.kind}`,
          context: sourceName,
        });
      }
      if (target.properties.kind !== KIND_RUNTIME) {
        errors.push({
          code: 'targets-target-kind',
          message: `'targets' must point to a runtime context, but '${targetName}' is kind=${target.properties.kind}`,
          context: sourceName,
          target: targetName,
        });
      }
    } else {
      // EDGE_DEPENDS_ON
      if (source.properties.kind !== KIND_WORK) {
        errors.push({
          code: 'depends-source-kind',
          message: `Only work contexts can use 'depends', but '${sourceName}' is kind=${source.properties.kind}`,
          context: sourceName,
        });
      }
      if (target.properties.kind !== KIND_WORK) {
        errors.push({
          code: 'depends-target-kind',
          message: `'depends' must point to a work context, but '${targetName}' is kind=${target.properties.kind}`,
          context: sourceName,
          target: targetName,
        });
      }
    }
  }

  // 4. Cycle detection in depends_on. DFS with three-color marking.
  const cycleErrors = findDependsCycles(model);
  errors.push(...cycleErrors);

  // 5. Root context check: exactly one Context with zero `contains` parents.
  const roots: string[] = [];
  for (const node of model.nodes.values()) {
    if (node.type !== CONTEXT_NODE_TYPE) continue;
    if (model.edgesTo(node.id, EDGE_CONTAINS).length === 0) {
      roots.push(node.name ?? node.id);
    }
  }
  if (roots.length === 0) {
    errors.push({ code: 'no-root', message: 'No root context found (every Context has a parent)' });
  } else if (roots.length > 1) {
    errors.push({
      code: 'multiple-roots',
      message: `Multiple top-level contexts: ${roots.join(', ')}. Exactly one is allowed.`,
    });
  }

  return errors;
}

/**
 * Throw if validation fails. Convenience for callers that prefer
 * exception-style error handling.
 */
export function assertValidContexts(
  model: Model,
  unresolvedReferences: readonly UnresolvedReference[] = [],
): void {
  const errors = validateContexts(model, unresolvedReferences);
  if (errors.length > 0) {
    const lines = errors.map(e => `  - [${e.code}] ${e.message}`).join('\n');
    throw new Error(`Context model validation failed:\n${lines}`);
  }
}

/**
 * Catalogs of valid rule and test identifiers, used to validate
 * `requires rule X` / `requires test X` lines.
 *
 * For rules, the set should include BOTH the workflow runtime's
 * canonical id (slugified, e.g. `bundle-api-lambda`) AND the display
 * name as written in `wf.rule(name, ...)` (e.g. `Bundle API Lambda`),
 * so authors can write either form. The caller is responsible for
 * populating both forms.
 */
export interface RequirementCatalogs {
  /** Set of every valid rule identifier (display names + slug ids). */
  readonly ruleIds?: ReadonlySet<string>;
  /** Set of every valid test id (e.g. `FT-M3-001`). */
  readonly testIds?: ReadonlySet<string>;
}

/**
 * Validate `requires rule X` / `requires test X` lines against the
 * runtime catalogs. Returns one error per requirement whose target
 * isn't found in the corresponding catalog.
 *
 * This is a SEPARATE function from `validateContexts` because it needs
 * runtime data (the workflow rule registry, the test results history)
 * that the contexts package doesn't own. Callers (typically
 * ContextLifecycleStore on the server) merge these errors with the
 * structural errors from `validateContexts`.
 *
 * Catalogs that are `undefined` are not validated — useful when only
 * one of (rules, tests) is available.
 */
export function validateRequirements(
  requirements: ReadonlyMap<string, readonly ContextRequirement[]>,
  catalogs: RequirementCatalogs,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [contextId, reqs] of requirements) {
    for (const req of reqs) {
      const catalog = req.kind === 'rule' ? catalogs.ruleIds : catalogs.testIds;
      // No catalog supplied for this kind → skip (caller hasn't wired it).
      if (!catalog) continue;
      if (catalog.has(req.id)) continue;
      errors.push({
        code: req.kind === 'rule' ? 'unresolved-rule-reference' : 'unresolved-test-reference',
        message: `Context '${contextId}' requires ${req.kind} '${req.id}', but no ${req.kind} with that name is declared`,
        context: contextId,
        target: req.id,
      });
    }
  }

  return errors;
}

function findDependsCycles(model: Model): ValidationError[] {
  // Standard 3-color DFS: WHITE=unvisited, GRAY=on stack, BLACK=done.
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  for (const node of model.nodes.values()) {
    if (node.type === CONTEXT_NODE_TYPE) color.set(node.id, 'white');
  }

  const errors: ValidationError[] = [];
  const cyclesReported = new Set<string>(); // dedupe by sorted-cycle key

  const visit = (nodeId: string, stack: string[]): void => {
    color.set(nodeId, 'gray');
    stack.push(nodeId);
    for (const edge of model.edgesFrom(nodeId, EDGE_DEPENDS_ON)) {
      const next = edge.target;
      const c = color.get(next);
      if (c === 'gray') {
        // Found a cycle: from `next` back through the stack to itself.
        const cycleStart = stack.indexOf(next);
        const cyclePath = stack.slice(cycleStart).concat(next);
        const key = [...cyclePath].sort().join('|');
        if (!cyclesReported.has(key)) {
          cyclesReported.add(key);
          const names = cyclePath.map(id => model.getNode(id).name ?? id).join(' → ');
          errors.push({
            code: 'depends-cycle',
            message: `Cycle in depends_on: ${names}`,
          });
        }
      } else if (c === 'white') {
        visit(next, stack);
      }
    }
    stack.pop();
    color.set(nodeId, 'black');
  };

  for (const [nodeId, c] of color) {
    if (c === 'white') visit(nodeId, []);
  }

  return errors;
}
