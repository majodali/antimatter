/**
 * ErrorStore — server-side project error storage.
 *
 * Persists errors to disk (.antimatter-cache/errors.json) and broadcasts
 * snapshots to all connected WebSocket clients. All clients see the same
 * errors, and errors persist across browser sessions.
 *
 * Errors are keyed by toolId — calling setErrors(toolId, errors) replaces
 * ALL previous errors from that tool.
 */

import type { ProjectError } from '@antimatter/workflow';
import type { WorkspaceEnvironment } from '@antimatter/workspace';

export class ErrorStore {
  /** toolId → ProjectError[] */
  private errors = new Map<string, ProjectError[]>();

  constructor(
    private readonly env: WorkspaceEnvironment,
    private readonly broadcast: (msg: object) => void,
    private readonly storagePath: string = '.antimatter-cache/errors.json',
  ) {}

  // ---- Public API ----

  /** Load persisted errors from disk on startup. */
  async initialize(): Promise<void> {
    try {
      const exists = await this.env.exists(this.storagePath);
      if (!exists) return;

      const content = await this.env.readFile(this.storagePath);
      const data = JSON.parse(content) as { errors?: Record<string, ProjectError[]> };

      if (data.errors) {
        for (const [toolId, errs] of Object.entries(data.errors)) {
          if (Array.isArray(errs) && errs.length > 0) {
            this.errors.set(toolId, errs);
          }
        }
        const total = this.getAllErrors().length;
        if (total > 0) {
          console.log(`[error-store] Restored ${total} error(s) from ${this.errors.size} tool(s)`);
        }
      }
    } catch {
      // No persisted errors or corrupt file — start fresh
    }
  }

  /**
   * Set all errors from a tool. Replaces ALL previous errors from this toolId.
   * Pass an empty array to clear errors from a tool.
   * Persists to disk and broadcasts snapshot to all clients.
   */
  async setErrors(toolId: string, errors: ProjectError[]): Promise<void> {
    if (errors.length === 0) {
      this.errors.delete(toolId);
    } else {
      this.errors.set(toolId, errors);
    }

    await this.persist();
    this.broadcastSnapshot();
  }

  /** Clear all errors from a specific tool. Persists + broadcasts. */
  async clearTool(toolId: string): Promise<void> {
    if (!this.errors.has(toolId)) return;
    this.errors.delete(toolId);
    await this.persist();
    this.broadcastSnapshot();
  }

  /** Clear all errors from all tools. Persists + broadcasts. */
  async clearAll(): Promise<void> {
    if (this.errors.size === 0) return;
    this.errors.clear();
    await this.persist();
    this.broadcastSnapshot();
  }

  /** Get all errors as a flat array. */
  getAllErrors(): ProjectError[] {
    const result: ProjectError[] = [];
    for (const errs of this.errors.values()) {
      result.push(...errs);
    }
    return result;
  }

  /** Get errors grouped by file path. */
  getErrorsByFile(): Record<string, ProjectError[]> {
    const byFile: Record<string, ProjectError[]> = {};
    for (const errs of this.errors.values()) {
      for (const err of errs) {
        if (!byFile[err.file]) {
          byFile[err.file] = [];
        }
        byFile[err.file].push(err);
      }
    }
    return byFile;
  }

  // ---- Private ----

  /** Persist current errors to disk. */
  private async persist(): Promise<void> {
    try {
      const data: Record<string, ProjectError[]> = {};
      for (const [toolId, errs] of this.errors) {
        data[toolId] = errs;
      }

      // Ensure the cache directory exists
      const dir = this.storagePath.substring(0, this.storagePath.lastIndexOf('/'));
      if (dir) {
        try {
          await this.env.mkdir(dir);
        } catch {
          // Directory may already exist
        }
      }

      await this.env.writeFile(this.storagePath, JSON.stringify({ errors: data }, null, 2));
    } catch (err) {
      console.error('[error-store] Failed to persist errors:', err);
    }
  }

  /** Broadcast full error snapshot to all connected WebSocket clients. */
  private broadcastSnapshot(): void {
    this.broadcast({
      type: 'project-errors-snapshot',
      errors: this.getAllErrors(),
    });
  }
}
