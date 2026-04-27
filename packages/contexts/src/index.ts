/**
 * @antimatter/contexts — DSL, metamodel, and lifecycle derivation for
 * the project context tree.
 *
 * See docs/contexts.md for the conceptual model.
 *
 * Typical use:
 *
 *   import {
 *     parseContexts,
 *     assertValidContexts,
 *     deriveLifecycleStatuses,
 *   } from '@antimatter/contexts';
 *
 *   const { model, requirements, unresolvedReferences } = parseContexts(text);
 *   assertValidContexts(model, unresolvedReferences);
 *
 *   const { statuses, transitions } = deriveLifecycleStatuses({
 *     model, requirements, rulePasses, testPasses, priorStatuses,
 *   });
 */
export {
  createContextMetamodel,
  CONTEXT_NODE_TYPE,
  REFERENCE_NODE_TYPE,
  EDGE_CONTAINS,
  EDGE_DEPENDS_ON,
  EDGE_TARGETS,
  EDGE_CONTAINS_REF,
  KIND_WORK,
  KIND_RUNTIME,
  REF_TARGETS,
  REF_DEPENDS,
  REF_REQUIRES_RULE,
  REF_REQUIRES_TEST,
} from './metamodel.js';
export type { ContextKind, ReferenceKind } from './metamodel.js';

export { createContextDsl } from './dsl.js';

export { parseContexts } from './parse.js';
export type {
  ParseResult,
  UnresolvedReference,
  ContextRequirement,
  RequirementKind,
} from './parse.js';

export { validateContexts, assertValidContexts } from './validate.js';
export type { ValidationError } from './validate.js';

export { deriveLifecycleStatuses, LIFECYCLE_STATUSES } from './lifecycle.js';
export type {
  LifecycleStatus,
  LifecycleInputs,
  LifecycleOutputs,
  LifecycleTransition,
} from './lifecycle.js';
