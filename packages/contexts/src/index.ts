/**
 * @antimatter/contexts — declaration model, loader, and lifecycle
 * derivation for the project context tree.
 *
 * Two coexisting surfaces:
 *
 *  1. NEW (Phase 0+): `defineContext`, `defineFileSet`, `defineRule`, …
 *     plus `loadProjectModel` for loading `.antimatter/{resources,
 *     contexts,build}.ts` and `deriveProjectLifecycle` for status
 *     derivation. Used by everything wired to the new context model.
 *
 *  2. LEGACY (pre-Phase-0): `parseContexts`, `validateContexts`,
 *     `deriveLifecycleStatuses` — operate on the indent-DSL model and
 *     simple-modeling Models. Still used by the workspace server's
 *     ContextLifecycleStore until Phase 1 swaps consumers over.
 *
 * See docs/contexts.md for the conceptual model.
 */

// ============================================================================
// NEW surface (Phase 0+)
// ============================================================================

// Model types
export {
  KIND,
  RESOURCE_KINDS,
  RESOURCE_DISCRIMINATORS,
  KIND_OF,
  KIND_NAME,
} from './model.js';
export type {
  DeclarationKind,
  ResourceKind,
  ResourceDiscriminator,
  Performer,
  ResourceRef,
  FileSetDeclaration,
  ConfigDeclaration,
  SecretDeclaration,
  DeployedResourceDeclaration,
  EnvironmentDeclaration,
  TestDeclaration,
  TestSetDeclaration,
  SignalDeclaration,
  AuthorizationDeclaration,
  ResourceDeclaration,
  ValidationResult,
  ValidationDeclaration,
  ValidationBinding,
  ActionDeclaration,
  OutputDeclaration,
  ContextObjective,
  ContextDeclaration,
  RuleDeclaration,
  AnyDeclaration,
  ProjectModel,
  ProjectModelError,
  ProjectModelErrorCode,
  ContextRuntimeState,
} from './model.js';

// Constructors
export {
  ref,
  validation,
  action,
  output,
  defineContext,
  defineFileSet,
  defineConfig,
  defineSecret,
  defineDeployedResource,
  defineEnvironment,
  defineTest,
  defineTestSet,
  defineSignal,
  defineAuthorization,
  defineRule,
} from './define.js';
export type {
  DefineFileSetInput,
  DefineConfigInput,
  DefineSecretInput,
  DefineDeployedResourceInput,
  DefineEnvironmentInput,
  DefineTestInput,
  DefineTestSetInput,
  DefineSignalInput,
  DefineAuthorizationInput,
  DefineRuleInput,
  DefineContextInput,
} from './define.js';

// Assembly
export {
  assembleProjectModel,
  classifyDeclarations,
} from './assemble.js';
export type { AssembleInput } from './assemble.js';

// Loader
export { loadProjectModel } from './loader.js';
export type { LoadOptions, LoadResult, LoadFileError } from './loader.js';

// Queries
export {
  rootContext,
  childrenOf,
  parentOf,
  ancestorsOf,
  descendantsOf,
  resolveResourceRef,
  resourcesOfKind,
  testSetsForTest,
  implicitDependencies,
  implicitDependents,
  rulesReading,
  rulesWriting,
} from './queries.js';

// Lifecycle derivation against new model
export { deriveProjectLifecycle, validationKey } from './derive.js';
export type { DeriveLifecycleInput, DeriveLifecycleOutput } from './derive.js';

// Regression triage
export { traceRegression } from './trace.js';
export type {
  RegressionTrace,
  ValidationExplanation,
  ChildBlocker,
  DependencyCulprit,
  TraceCollaborators,
} from './trace.js';

// Templates
export {
  listTemplates,
  getTemplate,
  renderTemplate,
} from './templates.js';
export type {
  TemplateParam,
  TemplateMetadata,
  RenderedTemplate,
  TemplateRender,
  TemplateDefinition,
} from './templates.js';

// Source emitters (Phase 2 — drives the IDE's "Add" forms)
export {
  emitFileSet,
  emitConfig,
  emitSecret,
  emitDeployedResource,
  emitEnvironment,
  emitTest,
  emitTestSet,
  emitRule,
  emitContext,
  appendDeclaration,
} from './emit.js';
export type {
  EmittedDeclaration,
  EmitFileSetInput,
  EmitConfigInput,
  EmitSecretInput,
  EmitDeployedResourceInput,
  EmitEnvironmentInput,
  EmitTestInput,
  EmitTestSetInput,
  EmitRuleInput,
  EmitContextInput,
  EmitResourceRefInput,
  EmitValidationBindingInput,
  EmitValidationInput,
  EmitActionInput,
} from './emit.js';

// ============================================================================
// LEGACY surface (pre-Phase-0; retired in Phase 1+)
// ============================================================================

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

export { validateContexts, assertValidContexts, validateRequirements } from './validate.js';
export type { ValidationError, RequirementCatalogs } from './validate.js';

export { deriveLifecycleStatuses, LIFECYCLE_STATUSES } from './lifecycle.js';
export type {
  LifecycleStatus,
  LifecycleInputs,
  LifecycleOutputs,
  LifecycleTransition,
} from './lifecycle.js';
