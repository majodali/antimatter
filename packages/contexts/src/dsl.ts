/**
 * DSL definition for the project context tree.
 *
 * Indent-based containment: a child context is indented under its
 * parent. The topmost `work` line is the root project context.
 *
 * Example:
 *
 *   work antimatter "Antimatter IDE"
 *     work feature-dark-mode "Add dark mode support"
 *       targets staging
 *       depends theme-system
 *     work theme-system "Refactor theme system"
 *     runtime staging "Staging deployment env"
 *     runtime production
 *
 * Lines:
 *   work    {name} "{description}"  — a work context (with description)
 *   work    {name}                  — a work context (no description)
 *   runtime {name} "{description}"  — a runtime context (with description)
 *   runtime {name}                  — a runtime context (no description)
 *   targets {targetName}            — emit a `targets` edge to the named context
 *   depends {targetName}            — emit a `depends_on` edge to the named context
 *   requires rule {ruleId}          — declare a workflow rule whose success is
 *                                     a requirement for this context's lifecycle
 *   requires test {testId}          — declare a test case whose passing is
 *                                     a requirement for this context's lifecycle
 *
 * `targets` / `depends` / `requires` lines parse into intermediate
 * `_Reference` nodes connected via `_contains_ref` edges. After parse:
 *  - `targets` / `depends` are replaced by proper edges between Contexts
 *  - `requires rule` / `requires test` are collected per-context into a
 *    requirements map (rules/tests aren't first-class nodes here)
 * See parse.ts.
 *
 * Implementation notes:
 *
 *  - The deserializer tries variants in declaration order, then the
 *    primary pattern as fallback. Every variant carries
 *    `derivedProperties` so `kind` (Context) and `refKind` (_Reference)
 *    are always populated correctly.
 *
 *  - Only one Context→Context edge type has a `nested` rule (`contains`),
 *    so simple-modeling's findEdgeType picks it for nested Context
 *    children. The `targets` and `depends_on` edges have NO edge rules
 *    here — they're synthesized post-parse, never written by users
 *    directly via nested syntax.
 *
 *  - Serialization with optional description is not fully supported by
 *    simple-modeling (selectPattern picks the first variant whose
 *    derivedProperties match, regardless of whether all placeholders
 *    have values). For now we focus on parsing; round-trip serialization
 *    requires every Context to have a description.
 */
import type { DslDefinition } from 'simple-modeling';
import {
  CONTEXT_NODE_TYPE,
  REFERENCE_NODE_TYPE,
  EDGE_CONTAINS,
  EDGE_CONTAINS_REF,
  KIND_WORK,
  KIND_RUNTIME,
  REF_TARGETS,
  REF_DEPENDS,
  REF_REQUIRES_RULE,
  REF_REQUIRES_TEST,
} from './metamodel.js';

export function createContextDsl(): DslDefinition {
  return {
    name: 'AntimatterContexts',
    indent: 2,

    nodeRules: new Map([
      [
        CONTEXT_NODE_TYPE,
        {
          nodeType: CONTEXT_NODE_TYPE,
          // Primary pattern: tried last, but matches the same shape as the
          // first variant. We rely on variants for kind discrimination.
          pattern: 'work {name} {description:q}',
          mode: 'standalone' as const,
          variants: [
            { pattern: 'work {name} {description:q}',    derivedProperties: { kind: KIND_WORK } },
            { pattern: 'work {name}',                    derivedProperties: { kind: KIND_WORK } },
            { pattern: 'runtime {name} {description:q}', derivedProperties: { kind: KIND_RUNTIME } },
            { pattern: 'runtime {name}',                 derivedProperties: { kind: KIND_RUNTIME } },
          ],
          // Order children: nested Context children first, then any
          // intermediate Reference nodes. Post-process turns the latter
          // into clean `targets` / `depends_on` edges.
          childOrder: [EDGE_CONTAINS, EDGE_CONTAINS_REF],
        },
      ],
      [
        REFERENCE_NODE_TYPE,
        {
          nodeType: REFERENCE_NODE_TYPE,
          // Internal node — never seen by callers after post-process.
          //
          // The `requires rule {target:*}` and `requires test {target:*}`
          // variants use rest-of-line capture so multi-word rule names
          // ("Bundle API Lambda") and arbitrary ids work without quoting.
          // `targets {target}` and `depends {target}` use single-word
          // capture because they reference Context names (always slugs).
          pattern: 'targets {target}',
          mode: 'standalone' as const,
          variants: [
            { pattern: 'requires rule {target:*}', derivedProperties: { refKind: REF_REQUIRES_RULE } },
            { pattern: 'requires test {target:*}', derivedProperties: { refKind: REF_REQUIRES_TEST } },
            { pattern: 'targets {target}',         derivedProperties: { refKind: REF_TARGETS } },
            { pattern: 'depends {target}',         derivedProperties: { refKind: REF_DEPENDS } },
          ],
        },
      ],
    ]),

    edgeRules: new Map([
      // Implicit containment between Contexts (nested via indentation).
      [
        EDGE_CONTAINS,
        { edgeType: EDGE_CONTAINS, pattern: '', mode: 'nested' as const },
      ],
      // Implicit containment of intermediate Reference children.
      [
        EDGE_CONTAINS_REF,
        { edgeType: EDGE_CONTAINS_REF, pattern: '', mode: 'nested' as const },
      ],
      // Note: no edge rules for `targets` / `depends_on`. Those edges are
      // synthesized post-parse from intermediate `_Reference` nodes.
    ]),

    propertyRules: new Map(),
  };
}
