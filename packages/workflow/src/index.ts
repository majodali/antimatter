// @antimatter/workflow — Public API
//
// Workflow scripts import from this module:
//   import { defineWorkflow, type Workflow, type WorkflowEvent } from '@antimatter/workflow';

export { defineWorkflow, ErrorTypes } from './types.js';
export { WorkflowRuntime } from './runtime.js';
export { parseTscErrors, parseEsbuildErrors, parseToolOutput } from './parsers.js';
export { parseInterval, MIN_SCHEDULE_INTERVAL_MS, SCHEDULE_FIRE_EVENT_TYPE } from './schedule.js';

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
  RuleOptions,

  // Errors
  ErrorType,
  ProjectError,

  // Execution
  ExecOptions,
  ExecResult,

  // Declarations
  ModuleDeclaration,
  TargetDeclaration,
  EnvironmentDeclaration,
  EnvironmentAction,
  RuleDeclaration,
  ScheduleDeclaration,
  LambdaTargetConfig,
  S3TargetConfig,
  WorkflowDeclarations,

  // Widgets
  WidgetDeclaration,
  WidgetState,
  WidgetType,
  WidgetVariant,
  WidgetSection,

  // Workflow handle
  Workflow,
  WorkflowDefinition,

  // Runtime (used by the engine, not by scripts)
  WorkflowRuntimeConfig,
  WorkflowLogEntry,
  WorkflowInvocationResult,
  PersistedWorkflowState,
  PersistedRuleResult,

  // Unified application state
  ApplicationState,

  // Event log
  EventLogEntry,
  EventSource,
} from './types.js';
