/**
 * Routing utilities -- determine where an operation should execute.
 *
 * Aggregates operation metadata from all services into a single registry.
 * Used by transport adapters to route commands and queries to the correct
 * handler (workspace server, Lambda/platform, or browser client).
 */

import type { ExecutionContext, OperationMeta } from './protocol.js';
import { PROJECTS_OPERATIONS } from './services/projects.js';
import { FILES_OPERATIONS } from './services/files.js';
import { BUILDS_OPERATIONS } from './services/builds.js';
import { TESTS_OPERATIONS } from './services/tests.js';
import { WORKSPACES_OPERATIONS } from './services/workspaces.js';
import { DEPLOYED_RESOURCES_OPERATIONS } from './services/deployed-resources.js';
import { AGENTS_OPERATIONS } from './services/agents.js';
import { AUTH_OPERATIONS } from './services/auth.js';
import { CLIENT_AUTOMATION_OPERATIONS } from './services/client-automation.js';
import { OBSERVABILITY_OPERATIONS } from './services/observability.js';

// ---------------------------------------------------------------------------
// Aggregated operation registry
// ---------------------------------------------------------------------------

export const ALL_OPERATIONS: Record<string, OperationMeta> = {
  ...PROJECTS_OPERATIONS,
  ...FILES_OPERATIONS,
  ...BUILDS_OPERATIONS,
  ...TESTS_OPERATIONS,
  ...WORKSPACES_OPERATIONS,
  ...DEPLOYED_RESOURCES_OPERATIONS,
  ...AGENTS_OPERATIONS,
  ...AUTH_OPERATIONS,
  ...CLIENT_AUTOMATION_OPERATIONS,
  ...OBSERVABILITY_OPERATIONS,
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Get the full operation metadata for a given operation type string.
 * Returns undefined if the type is not recognized.
 */
export function getOperationMeta(type: string): OperationMeta | undefined {
  return ALL_OPERATIONS[type];
}

/**
 * Get the execution context for a command or query type string.
 * Returns undefined if the type is not recognized.
 */
export function getExecutionContext(type: string): ExecutionContext | undefined {
  return ALL_OPERATIONS[type]?.context;
}

/** True if the operation runs on the workspace server (requires active workspace). */
export function isWorkspaceOperation(type: string): boolean {
  return getExecutionContext(type) === 'workspace';
}

/** True if the operation runs on the stateless platform (Lambda). */
export function isPlatformOperation(type: string): boolean {
  return getExecutionContext(type) === 'platform';
}

/** True if the operation runs in a connected browser client. */
export function isBrowserOperation(type: string): boolean {
  return getExecutionContext(type) === 'browser';
}

/** True if the operation is a command (state-mutating). */
export function isCommand(type: string): boolean {
  return ALL_OPERATIONS[type]?.kind === 'command';
}

/** True if the operation is a query (read-only). */
export function isQuery(type: string): boolean {
  return ALL_OPERATIONS[type]?.kind === 'query';
}

/**
 * Get the service namespace for an operation type.
 * E.g., 'files.write' -> 'files', 'builds.triggers.invoke' -> 'builds'.
 */
export function getServiceNamespace(type: string): string | undefined {
  const dot = type.indexOf('.');
  return dot > 0 ? type.slice(0, dot) : undefined;
}
