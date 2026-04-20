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

export type ResourceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ResourcePoolMember {
  readonly id: string;
  readonly status?: ResourceStatus;
  readonly role?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface DeployedResource {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly resourceType: string;
  /**
   * Environment the resource belongs to (e.g. 'production', 'staging').
   * Undefined or '' = default (shared across environments).
   */
  readonly environment?: string;
  readonly description?: string;
  readonly metadata: Record<string, unknown>;
  readonly instance?: { readonly region?: string; readonly [key: string]: unknown };
  readonly pool?: {
    readonly minSize?: number;
    readonly maxSize?: number;
    readonly members: readonly ResourcePoolMember[];
  };
  readonly status?: ResourceStatus;
  readonly statusMessage?: string;
  readonly lastChecked?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Actions that target the resource as a whole. */
  readonly actions?: readonly DeployedResourceAction[];
  /** Actions that target individual pool members. */
  readonly memberActions?: readonly DeployedResourceAction[];
}

export interface DeployedResourceAction {
  readonly triggerId: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly enabled?: boolean;
  /** Marks an action as destructive — UI shows confirmation. */
  readonly destructive?: boolean;
  /** Action requires explicit user confirmation before running. */
  readonly requiresConfirmation?: boolean;
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

import { z } from 'zod';

const actionSchema = z.object({ triggerId: z.string(), label: z.string(), description: z.string().optional(), icon: z.string().optional(), enabled: z.boolean() });

export const DEPLOYED_RESOURCES_OPERATIONS: Record<string, OperationMeta> = {
  'deployed-resources.register': {
    kind: 'command', context: 'workspace', description: 'Register a deployed resource',
    params: { name: z.string().describe('Resource name'), resourceType: z.string().describe('Resource type identifier'), description: z.string().optional().describe('Resource description'), metadata: z.record(z.unknown()).optional().describe('Arbitrary resource metadata'), actions: z.array(actionSchema).optional().describe('Actions available on this resource') },
  },
  'deployed-resources.deregister': {
    kind: 'command', context: 'workspace', description: 'Remove a deployed resource',
    params: { resourceId: z.string().describe('Resource ID to remove') },
  },
  'deployed-resources.update': {
    kind: 'command', context: 'workspace', description: 'Update a deployed resource',
    params: { resourceId: z.string().describe('Resource ID to update'), metadata: z.record(z.unknown()).optional().describe('Updated metadata'), actions: z.array(actionSchema).optional().describe('Updated actions') },
  },
  'deployed-resources.list': {
    kind: 'query', context: 'workspace', description: 'List deployed resources',
    params: { resourceType: z.string().optional().describe('Filter by resource type') },
  },
  'deployed-resources.get': {
    kind: 'query', context: 'workspace', description: 'Get a deployed resource',
    params: { resourceId: z.string().describe('Resource ID to retrieve') },
  },
};
