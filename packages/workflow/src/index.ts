// @antimatter/workflow — Public API
//
// Workflow scripts import from this module:
//   import { defineWorkflow, type Workflow, type WorkflowEvent } from '@antimatter/workflow';

export { defineWorkflow } from './types.js';
export { WorkflowRuntime } from './runtime.js';

export type {
  // Events
  WorkflowEvent,
  FileChangeEvent,
  FileDeleteEvent,
  ProjectInitializeEvent,

  // Rules
  WorkflowPredicate,
  WorkflowAction,
  WorkflowRule,

  // Execution
  ExecOptions,
  ExecResult,

  // Declarations
  ModuleDeclaration,
  TargetDeclaration,
  EnvironmentDeclaration,
  EnvironmentAction,
  RuleDeclaration,
  LambdaTargetConfig,
  S3TargetConfig,
  WorkflowDeclarations,

  // Workflow handle
  Workflow,
  WorkflowDefinition,

  // Runtime (used by the engine, not by scripts)
  WorkflowRuntimeConfig,
  WorkflowLogEntry,
  WorkflowInvocationResult,
  PersistedWorkflowState,
} from './types.js';
