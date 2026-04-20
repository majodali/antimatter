/**
 * DeployedResourceStore — server-side storage for project deployed resources.
 *
 * Persists to `.antimatter-cache/deployed-resources.json` and notifies
 * via onChange callback when resources change. The callback is used to
 * broadcast updates to WebSocket clients.
 *
 * Resources are keyed by ID. Each resource has a name, type, optional URL,
 * metadata, and optional actions (triggers for workflow rules).
 */

import type { WorkspaceEnvironment } from '@antimatter/workspace';

// ---------------------------------------------------------------------------
// Types (mirrors service-interface DeployedResource)
// ---------------------------------------------------------------------------

export type ResourceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ResourcePoolMember {
  /** Member identifier (instance ID, task ARN, etc.). */
  id: string;
  /** Current health status. */
  status?: ResourceStatus;
  /** Optional role label (e.g. 'active', 'standby', 'worker'). */
  role?: string;
  /** Member-specific metadata. */
  metadata?: Record<string, unknown>;
}

export interface DeployedResource {
  id: string;
  name: string;
  resourceType: string;
  /**
   * Environment the resource belongs to (e.g. 'production', 'staging').
   * Undefined or '' = default (shared across all environments).
   */
  environment?: string;
  description?: string;
  /** Top-level metadata (legacy; free-form). */
  metadata: Record<string, unknown>;
  /**
   * For singleton resources — the single instance's identity/config.
   * Either `instance` or `pool` is set, not both.
   */
  instance?: {
    region?: string;
    [key: string]: unknown;
  };
  /**
   * For pool/cluster resources — the members and pool-level config.
   * Each member has its own status and metadata.
   */
  pool?: {
    minSize?: number;
    maxSize?: number;
    members: ResourcePoolMember[];
  };
  /** Current health status of the resource (or overall pool). */
  status?: ResourceStatus;
  /** Human-readable status message (e.g. error details). */
  statusMessage?: string;
  /** ISO timestamp of last health/status check. */
  lastChecked?: string;
  createdAt: string;
  updatedAt: string;
  /** Actions that target the resource as a whole. */
  actions?: DeployedResourceAction[];
  /** Actions that target individual pool members (only applies if `pool` is set). */
  memberActions?: DeployedResourceAction[];
  /** Built-in resources (like Preview) can't be deregistered by users. */
  builtIn?: boolean;
}

export interface DeployedResourceAction {
  triggerId: string;
  label: string;
  description?: string;
  icon?: string;
  enabled?: boolean;
  /** Marks an action as destructive — UI should show confirmation. */
  destructive?: boolean;
  /** Indicates the action requires explicit confirmation before executing. */
  requiresConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class DeployedResourceStore {
  private resources = new Map<string, DeployedResource>();

  constructor(
    private readonly env: WorkspaceEnvironment,
    private readonly onChange?: () => void,
    private readonly storagePath: string = '.antimatter-cache/deployed-resources.json',
  ) {}

  // ---- Public API ----

  /** Load persisted resources from disk on startup. */
  async initialize(): Promise<void> {
    try {
      const exists = await this.env.exists(this.storagePath);
      if (!exists) return;
      const content = await this.env.readFile(this.storagePath);
      const data = JSON.parse(content) as { resources?: DeployedResource[] };
      if (data.resources) {
        for (const r of data.resources) {
          this.resources.set(r.id, r);
        }
        if (this.resources.size > 0) {
          console.log(`[deployed-resources] Restored ${this.resources.size} resource(s)`);
        }
      }
    } catch {
      // No persisted data or corrupt file — start fresh
    }
  }

  /**
   * Register a new deployed resource, or update an existing one if the same
   * `id` is provided. Returns the resource.
   */
  async register(input: {
    /** Optional stable ID. If omitted, generated from name. If it exists, upsert. */
    id?: string;
    name: string;
    resourceType: string;
    environment?: string;
    description?: string;
    metadata?: Record<string, unknown>;
    instance?: DeployedResource['instance'];
    pool?: DeployedResource['pool'];
    status?: ResourceStatus;
    statusMessage?: string;
    actions?: DeployedResourceAction[];
    memberActions?: DeployedResourceAction[];
    builtIn?: boolean;
  }): Promise<DeployedResource> {
    const now = new Date().toISOString();

    // Determine the ID. If caller provided one, use it (enables idempotent upsert).
    let id = input.id;
    if (!id) {
      const baseId = input.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 64);
      id = baseId;
      let suffix = 2;
      while (this.resources.has(id)) {
        id = `${baseId}-${suffix++}`;
      }
    }

    const existing = this.resources.get(id);
    const resource: DeployedResource = {
      id,
      name: input.name,
      resourceType: input.resourceType,
      environment: input.environment,
      description: input.description,
      metadata: input.metadata ?? existing?.metadata ?? {},
      instance: input.instance ?? existing?.instance,
      pool: input.pool ?? existing?.pool,
      status: input.status ?? existing?.status,
      statusMessage: input.statusMessage ?? existing?.statusMessage,
      lastChecked: existing?.lastChecked,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      actions: input.actions ?? existing?.actions,
      memberActions: input.memberActions ?? existing?.memberActions,
      builtIn: input.builtIn ?? existing?.builtIn,
    };

    this.resources.set(id, resource);
    await this.persist();
    this.onChange?.();
    return resource;
  }

  /** Update just the status fields of a resource. Returns the updated resource or null. */
  async setStatus(id: string, patch: {
    status?: ResourceStatus;
    statusMessage?: string;
    lastChecked?: string;
  }): Promise<DeployedResource | null> {
    const existing = this.resources.get(id);
    if (!existing) return null;
    const updated: DeployedResource = {
      ...existing,
      status: patch.status ?? existing.status,
      statusMessage: patch.statusMessage !== undefined ? patch.statusMessage : existing.statusMessage,
      lastChecked: patch.lastChecked ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.resources.set(id, updated);
    await this.persist();
    this.onChange?.();
    return updated;
  }

  /** Update an existing resource. Partial patch — only provided fields change. */
  async update(id: string, patch: {
    name?: string;
    environment?: string;
    metadata?: Record<string, unknown>;
    instance?: DeployedResource['instance'];
    pool?: DeployedResource['pool'];
    status?: ResourceStatus;
    statusMessage?: string;
    actions?: DeployedResourceAction[];
    memberActions?: DeployedResourceAction[];
  }): Promise<DeployedResource | null> {
    const existing = this.resources.get(id);
    if (!existing) return null;

    const updated: DeployedResource = {
      ...existing,
      name: patch.name ?? existing.name,
      environment: patch.environment !== undefined ? patch.environment : existing.environment,
      metadata: patch.metadata !== undefined ? { ...existing.metadata, ...patch.metadata } : existing.metadata,
      instance: patch.instance !== undefined ? patch.instance : existing.instance,
      pool: patch.pool !== undefined ? patch.pool : existing.pool,
      status: patch.status ?? existing.status,
      statusMessage: patch.statusMessage !== undefined ? patch.statusMessage : existing.statusMessage,
      actions: patch.actions !== undefined ? patch.actions : existing.actions,
      memberActions: patch.memberActions !== undefined ? patch.memberActions : existing.memberActions,
      updatedAt: new Date().toISOString(),
    };

    this.resources.set(id, updated);
    await this.persist();
    this.onChange?.();
    return updated;
  }

  /** List resources with optional filtering. */
  filter(opts?: { resourceType?: string; environment?: string }): DeployedResource[] {
    let all = Array.from(this.resources.values());
    if (opts?.resourceType) all = all.filter(r => r.resourceType === opts.resourceType);
    if (opts?.environment !== undefined) {
      // '' or 'default' match resources with no environment (shared)
      if (opts.environment === '' || opts.environment === 'default') {
        all = all.filter(r => !r.environment);
      } else {
        all = all.filter(r => r.environment === opts.environment);
      }
    }
    return all;
  }

  /** Remove a deployed resource. Returns true if found and removed. */
  async deregister(id: string): Promise<boolean> {
    const resource = this.resources.get(id);
    if (!resource) return false;
    if (resource.builtIn) return false; // Can't remove built-in resources
    this.resources.delete(id);
    await this.persist();
    this.onChange?.();
    return true;
  }

  /** List all resources, optionally filtered by resourceType. */
  list(resourceType?: string): DeployedResource[] {
    const all = Array.from(this.resources.values());
    if (!resourceType) return all;
    return all.filter(r => r.resourceType === resourceType);
  }

  /** Get a single resource by ID. */
  get(id: string): DeployedResource | undefined {
    return this.resources.get(id);
  }

  // ---- Private ----

  private async persist(): Promise<void> {
    try {
      const dir = this.storagePath.substring(0, this.storagePath.lastIndexOf('/'));
      if (dir) {
        try { await this.env.mkdir(dir); } catch { /* may exist */ }
      }
      const resources = Array.from(this.resources.values());
      await this.env.writeFile(this.storagePath, JSON.stringify({ resources }, null, 2));
    } catch (err) {
      console.error('[deployed-resources] Failed to persist:', err);
    }
  }
}
