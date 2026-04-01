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

export interface DeployedResource {
  id: string;
  name: string;
  resourceType: string;
  description?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  actions?: DeployedResourceAction[];
  /** Built-in resources (like Preview) can't be deregistered by users. */
  builtIn?: boolean;
}

export interface DeployedResourceAction {
  triggerId: string;
  label: string;
  description?: string;
  icon?: string;
  enabled: boolean;
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

  /** Register a new deployed resource. Returns the created resource. */
  async register(input: {
    name: string;
    resourceType: string;
    description?: string;
    metadata?: Record<string, unknown>;
    actions?: DeployedResourceAction[];
    builtIn?: boolean;
  }): Promise<DeployedResource> {
    const now = new Date().toISOString();
    // Generate a slug-like ID from the name
    const baseId = input.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    let id = baseId;
    let suffix = 2;
    while (this.resources.has(id)) {
      id = `${baseId}-${suffix++}`;
    }

    const resource: DeployedResource = {
      id,
      name: input.name,
      resourceType: input.resourceType,
      description: input.description,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      actions: input.actions,
      builtIn: input.builtIn,
    };

    this.resources.set(id, resource);
    await this.persist();
    this.onChange?.();
    return resource;
  }

  /** Update an existing resource's metadata and/or actions. */
  async update(id: string, patch: {
    metadata?: Record<string, unknown>;
    actions?: DeployedResourceAction[];
  }): Promise<DeployedResource | null> {
    const existing = this.resources.get(id);
    if (!existing) return null;

    const updated: DeployedResource = {
      ...existing,
      metadata: patch.metadata !== undefined ? { ...existing.metadata, ...patch.metadata } : existing.metadata,
      actions: patch.actions !== undefined ? patch.actions : existing.actions,
      updatedAt: new Date().toISOString(),
    };

    this.resources.set(id, updated);
    await this.persist();
    this.onChange?.();
    return updated;
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
