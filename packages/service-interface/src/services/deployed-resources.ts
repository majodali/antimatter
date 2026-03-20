/**
 * DeployedResources Service
 *
 * Simple repository for tracking project-defined deployed resources.
 *
 * Resources are registered by build rules during deployment. Each resource
 * has project-defined metadata and optional custom actions (also defined by
 * build rules). Actions are invoked through `builds.triggers.invoke`.
 *
 * Environment-specific configuration (secrets, environment variables) is
 * tracked as deployed resources.
 *
 * All operations are project-scoped. No resource discovery unless
 * implemented by the project's build rules.
 */

import type { ProjectScoped, ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface DeployedResource {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly resourceType: string;
  readonly description?: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Actions defined for this resource, invoked via builds.triggers.invoke. */
  readonly actions?: readonly DeployedResourceAction[];
}

export interface DeployedResourceAction {
  readonly triggerId: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface DeployedResourcesRegisterCommand extends ProjectScoped {
  readonly type: 'deployed-resources.register';
  readonly name: string;
  readonly resourceType: string;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
  readonly actions?: readonly DeployedResourceAction[];
}

export interface DeployedResourcesDeregisterCommand extends ProjectScoped {
  readonly type: 'deployed-resources.deregister';
  readonly resourceId: string;
}

export interface DeployedResourcesUpdateCommand extends ProjectScoped {
  readonly type: 'deployed-resources.update';
  readonly resourceId: string;
  readonly metadata?: Record<string, unknown>;
  readonly actions?: readonly DeployedResourceAction[];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface DeployedResourcesListQuery extends ProjectScoped {
  readonly type: 'deployed-resources.list';
  readonly resourceType?: string;
}

export interface DeployedResourcesGetQuery extends ProjectScoped {
  readonly type: 'deployed-resources.get';
  readonly resourceId: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface DeployedResourcesCreatedEvent extends ServiceEventBase {
  readonly type: 'deployed-resources.created';
  readonly resource: DeployedResource;
}

export interface DeployedResourcesUpdatedEvent extends ServiceEventBase {
  readonly type: 'deployed-resources.updated';
  readonly resource: DeployedResource;
}

export interface DeployedResourcesDeletedEvent extends ServiceEventBase {
  readonly type: 'deployed-resources.deleted';
  readonly resourceId: string;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type DeployedResourcesCommand =
  | DeployedResourcesRegisterCommand
  | DeployedResourcesDeregisterCommand
  | DeployedResourcesUpdateCommand;

export type DeployedResourcesQuery =
  | DeployedResourcesListQuery
  | DeployedResourcesGetQuery;

export type DeployedResourcesEvent =
  | DeployedResourcesCreatedEvent
  | DeployedResourcesUpdatedEvent
  | DeployedResourcesDeletedEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface DeployedResourcesCommandResponseMap {
  'deployed-resources.register': DeployedResource;
  'deployed-resources.deregister': void;
  'deployed-resources.update': DeployedResource;
}

export interface DeployedResourcesQueryResponseMap {
  'deployed-resources.list': { resources: readonly DeployedResource[] };
  'deployed-resources.get': DeployedResource;
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

export const DEPLOYED_RESOURCES_OPERATIONS: Record<string, OperationMeta> = {
  'deployed-resources.register':   { kind: 'command', context: 'workspace', description: 'Register a deployed resource' },
  'deployed-resources.deregister': { kind: 'command', context: 'workspace', description: 'Remove a deployed resource' },
  'deployed-resources.update':     { kind: 'command', context: 'workspace', description: 'Update a deployed resource' },
  'deployed-resources.list':       { kind: 'query',   context: 'workspace', description: 'List deployed resources' },
  'deployed-resources.get':        { kind: 'query',   context: 'workspace', description: 'Get a deployed resource' },
};
