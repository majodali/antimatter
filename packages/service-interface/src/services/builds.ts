/**
 * Builds Service
 *
 * Manages build rules, deployment, workflow execution, results, configurations,
 * and triggers.
 *
 * Build rules are the core abstraction. They are event-driven: file changes,
 * manual triggers, and other events cause rules to evaluate and execute.
 * Deployment and workflow orchestration are implemented as build rules --
 * there is no separate deploy service.
 *
 * The workflow engine is an internal implementation detail. Workflow state
 * and event routing are not exposed through the service interface.
 *
 * Results include errors, warnings, status messages, and other output from
 * rule execution. Results may also be written as annotations on source files
 * (via the Files service).
 *
 * Configurations are key-value settings declared by build rules, overridable
 * by users. Triggers are user-invokable actions declared by build rules
 * (e.g., "Deploy to staging", "Run migration"). Triggers can be enabled
 * or disabled.
 */

import type { ProjectScoped, ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface BuildRule {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Event types that trigger this rule. */
  readonly triggers: readonly string[];
  readonly enabled: boolean;
}

export type BuildResultSeverity = 'error' | 'warning' | 'info' | 'status';

export interface BuildResult {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: BuildResultSeverity;
  readonly message: string;
  readonly detail?: string;
  readonly timestamp: string;
  /** File path if this result relates to a specific file. */
  readonly path?: string;
  readonly line?: number;
}

export interface BuildConfiguration {
  readonly id: string;
  readonly ruleId: string;
  readonly label: string;
  readonly description?: string;
  readonly value: unknown;
  readonly defaultValue?: unknown;
  /** Type hint for UI rendering. */
  readonly valueType?: 'string' | 'number' | 'boolean' | 'select' | 'json';
  readonly options?: readonly string[];
}

export interface BuildTrigger {
  readonly id: string;
  readonly ruleId: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly enabled: boolean;
  /** Parameters the user can provide when invoking. */
  readonly params?: readonly BuildTriggerParam[];
}

export interface BuildTriggerParam {
  readonly name: string;
  readonly label: string;
  readonly type: 'string' | 'number' | 'boolean' | 'select';
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly options?: readonly string[];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface BuildsTriggerInvokeCommand extends ProjectScoped {
  readonly type: 'builds.triggers.invoke';
  readonly triggerId: string;
  readonly params?: Record<string, unknown>;
}

export interface BuildsConfigurationSetCommand extends ProjectScoped {
  readonly type: 'builds.configurations.set';
  readonly configurationId: string;
  readonly value: unknown;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface BuildsRulesListQuery extends ProjectScoped {
  readonly type: 'builds.rules.list';
}

export interface BuildsResultsListQuery extends ProjectScoped {
  readonly type: 'builds.results.list';
  readonly ruleId?: string;
  readonly severity?: BuildResultSeverity;
  readonly limit?: number;
}

export interface BuildsConfigurationsListQuery extends ProjectScoped {
  readonly type: 'builds.configurations.list';
  readonly ruleId?: string;
}

export interface BuildsTriggersListQuery extends ProjectScoped {
  readonly type: 'builds.triggers.list';
  readonly ruleId?: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface BuildsStartedEvent extends ServiceEventBase {
  readonly type: 'builds.started';
  readonly ruleId: string;
}

export interface BuildsOutputEvent extends ServiceEventBase {
  readonly type: 'builds.output';
  readonly ruleId: string;
  readonly line: string;
}

export interface BuildsCompletedEvent extends ServiceEventBase {
  readonly type: 'builds.completed';
  readonly ruleId: string;
  readonly status: 'success' | 'failed';
  readonly durationMs: number;
  readonly error?: string;
}

export interface BuildsResultEvent extends ServiceEventBase {
  readonly type: 'builds.result';
  readonly result: BuildResult;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type BuildsCommand =
  | BuildsTriggerInvokeCommand
  | BuildsConfigurationSetCommand;

export type BuildsQuery =
  | BuildsRulesListQuery
  | BuildsResultsListQuery
  | BuildsConfigurationsListQuery
  | BuildsTriggersListQuery;

export type BuildsEvent =
  | BuildsStartedEvent
  | BuildsOutputEvent
  | BuildsCompletedEvent
  | BuildsResultEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface BuildsCommandResponseMap {
  'builds.triggers.invoke': { triggerId: string };
  'builds.configurations.set': void;
}

export interface BuildsQueryResponseMap {
  'builds.rules.list': { rules: readonly BuildRule[] };
  'builds.results.list': { results: readonly BuildResult[] };
  'builds.configurations.list': { configurations: readonly BuildConfiguration[] };
  'builds.triggers.list': { triggers: readonly BuildTrigger[] };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const BUILDS_OPERATIONS: Record<string, OperationMeta> = {
  'builds.triggers.invoke': {
    kind: 'command', context: 'workspace', description: 'Invoke a build trigger',
    params: { triggerId: z.string().describe('Trigger ID to invoke'), params: z.record(z.unknown()).optional().describe('Parameters for the trigger') },
  },
  'builds.configurations.set': {
    kind: 'command', context: 'workspace', description: 'Set a build configuration value',
    params: { configurationId: z.string().describe('Configuration ID to set'), value: z.unknown().describe('New configuration value') },
  },
  'builds.rules.list':          { kind: 'query',   context: 'workspace', description: 'List build rules' },
  'builds.results.list': {
    kind: 'query', context: 'workspace', description: 'List build results',
    params: { ruleId: z.string().optional().describe('Filter by rule ID'), severity: z.enum(['error', 'warning', 'info', 'status']).optional().describe('Filter by severity'), limit: z.number().optional().describe('Max results to return') },
  },
  'builds.configurations.list': {
    kind: 'query', context: 'workspace', description: 'List build configurations',
    params: { ruleId: z.string().optional().describe('Filter by rule ID') },
  },
  'builds.triggers.list': {
    kind: 'query', context: 'workspace', description: 'List build triggers',
    params: { ruleId: z.string().optional().describe('Filter by rule ID') },
  },
};
