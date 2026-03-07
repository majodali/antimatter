/**
 * WorkflowManager — manages the lifecycle of a WorkflowRuntime instance.
 *
 * Responsibilities:
 *  - Loads workflow definitions from `.antimatter/*.ts` (multi-file)
 *  - Auto-reloads definitions when any automation file changes (debounced)
 *  - Incremental reload: only re-runs changed definition files
 *  - File→declaration tracking: knows which file declared each element
 *  - Persists state to `.antimatter/workflow-state.json`
 *  - Connects file change events to the workflow engine
 *  - Broadcasts invocation results to WebSocket clients
 *  - Hold/release pattern for pausing during batch operations
 *  - Exposes declarations (modules, targets, environments, rules)
 *  - Manual rule execution via runRule() (skips predicate)
 *  - Startup file diff: compares workspace files against manifest, emits changes
 */

import { createHash } from 'node:crypto';
import {
  WorkflowRuntime,
  type WorkflowDefinition,
  type WorkflowDeclarations,
  type WorkflowEvent,
  type WorkflowInvocationResult,
  type PersistedWorkflowState,
  type ExecOptions,
  type ExecResult,
} from '@antimatter/workflow';
import type { WorkspaceEnvironment, ExecuteOptions } from '@antimatter/workspace';
import type { WatchEvent } from '@antimatter/filesystem';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowManagerOptions {
  /** The workspace environment for file I/O and command execution. */
  readonly env: WorkspaceEnvironment;
  /** Callback to broadcast messages to WebSocket clients. */
  readonly broadcast: (msg: object) => void;
  /** Pre-loaded definition (for testing — skips file loading). */
  readonly definition?: WorkflowDefinition<any>;
  /** Directory containing automation `.ts` files. Default: '.antimatter' */
  readonly automationDir?: string;
  /** Path to the persisted state file. Default: '.antimatter/workflow-state.json' */
  readonly statePath?: string;
  /** Called when a workflow command starts executing (e.g., to hold shutdown timer). */
  readonly onExecStart?: () => void;
  /** Called when a workflow command finishes executing (e.g., to release shutdown timer). */
  readonly onExecEnd?: () => void;
}

/** Tagged definition — pairs a file path with its loaded definition function. */
interface TaggedDefinition {
  filePath: string;
  definition: WorkflowDefinition<any>;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class WorkflowManager {
  private runtime: WorkflowRuntime<any> | null = null;
  private state: any = {};
  private persisted: PersistedWorkflowState<any> | null = null;
  private held = false;
  private pendingEvents: WorkflowEvent[] = [];
  private processing = false;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloading = false;

  private readonly env: WorkspaceEnvironment;
  private readonly broadcast: (msg: object) => void;
  private readonly preloadedDefinition?: WorkflowDefinition<any>;
  private readonly automationDir: string;
  private readonly statePath: string;
  private readonly onExecStart?: () => void;
  private readonly onExecEnd?: () => void;

  /** Tracks which files were loaded in the last definition load. */
  private loadedFiles: string[] = [];
  /** Loaded definitions by file path (for incremental reload). */
  private loadedDefinitions = new Map<string, WorkflowDefinition<any>>();
  /** Automation files that changed since last reload (for incremental reload). */
  private changedAutomationFiles = new Set<string>();

  constructor(options: WorkflowManagerOptions) {
    this.env = options.env;
    this.broadcast = options.broadcast;
    this.preloadedDefinition = options.definition;
    this.automationDir = options.automationDir ?? '.antimatter';
    this.statePath = options.statePath ?? '.antimatter/workflow-state.json';
    this.onExecStart = options.onExecStart;
    this.onExecEnd = options.onExecEnd;
  }

  // ---- Public API ----

  /**
   * Load (or reload) the workflow definition and persisted state.
   * If no prior state exists, fires `project:initialize`.
   */
  async start(): Promise<void> {
    if (this.preloadedDefinition) {
      // Testing path — use pre-loaded definition directly
      this.runtime = new WorkflowRuntime(this.preloadedDefinition, {
        executor: this.createExecutor(),
      });
    } else {
      // Production path — load tagged definitions and build runtime with source tracking
      const tagged = await this.loadTaggedDefinitions();
      if (!tagged || tagged.length === 0) {
        console.log('[workflow-manager] No workflow definition found — skipping');
        this.runtime = null;
        return;
      }

      // Create runtime with an empty definition first, then register
      // definitions with source file tracking.
      this.runtime = new WorkflowRuntime(() => {}, {
        executor: this.createExecutor(),
      });

      // Now register all definitions with source file tracking
      const handle = this.runtime.getHandle();
      for (const { filePath, definition } of tagged) {
        this.runtime.setSourceFile(filePath);
        try {
          definition(handle);
        } catch (err) {
          console.error(`[workflow-manager] Error running definition from ${filePath}:`, err);
        }
      }
      this.runtime.setSourceFile(null);

      // Store definitions for incremental reload
      this.loadedDefinitions.clear();
      for (const { filePath, definition } of tagged) {
        this.loadedDefinitions.set(filePath, definition);
      }
    }

    const decl = this.runtime.declarations;
    const parts = [`${this.runtime.ruleCount} rules`];
    if (decl.modules.length) parts.push(`${decl.modules.length} modules`);
    if (decl.targets.length) parts.push(`${decl.targets.length} targets`);
    if (decl.environments.length) parts.push(`${decl.environments.length} environments`);
    console.log(`[workflow-manager] Loaded workflow: ${parts.join(', ')} from ${this.loadedFiles.length} file(s)`);

    // Load persisted state
    const loadedState = await this.loadState();
    if (loadedState) {
      this.state = loadedState.state;
      this.persisted = loadedState;

      // Restore file→declaration tracking from persisted state
      if (loadedState.fileDeclarations) {
        this.runtime.restoreFileDeclarations(loadedState.fileDeclarations);
      }

      console.log('[workflow-manager] Restored persisted state');

      // Startup diff: compare workspace files against manifest
      if (loadedState.fileManifest) {
        await this.emitStartupDiff(loadedState.fileManifest);
      }
    } else {
      // First run — send project:initialize
      this.state = {} as any;
      console.log('[workflow-manager] No prior state — sending project:initialize');
      await this.processEvents([{
        type: 'project:initialize',
        timestamp: new Date().toISOString(),
      }]);
    }
  }

  /** Pause event processing (for batch operations like git checkout). */
  hold(): void {
    this.held = true;
    console.log('[workflow-manager] Hold — pausing event processing');
  }

  /** Resume event processing, flushing accumulated events. */
  release(): void {
    this.held = false;
    console.log('[workflow-manager] Release — resuming event processing');

    if (this.pendingEvents.length > 0) {
      const events = this.pendingEvents.splice(0);
      this.processEvents(events).catch(err => {
        console.error('[workflow-manager] Error processing flushed events:', err);
      });
    }
  }

  /**
   * Feed file change events from the FileChangeNotifier.
   * Converts WatchEvents to workflow FileChangeEvent/FileDeleteEvent.
   *
   * If an automation file changes, the manager auto-reloads (incrementally)
   * after a short debounce.
   */
  onFileChanges(events: readonly WatchEvent[]): void {
    // Check for automation file changes — track which files changed for incremental reload.
    for (const e of events) {
      const normalized = e.path.replace(/^\//, '');
      if (this.isAutomationFile(normalized)) {
        this.changedAutomationFiles.add(normalized);
      }
    }

    if (this.changedAutomationFiles.size > 0) {
      this.scheduleReload();
    }

    if (!this.runtime) return;

    const workflowEvents: WorkflowEvent[] = events
      .filter(e => !e.path.startsWith('/.antimatter/') && !e.path.startsWith('.antimatter/'))
      .map(e => ({
        type: e.type === 'delete' ? 'file:delete' as const : 'file:change' as const,
        path: e.path,
        timestamp: new Date().toISOString(),
      }));

    if (workflowEvents.length === 0) return;

    if (this.held) {
      this.pendingEvents.push(...workflowEvents);
      return;
    }

    this.processEvents(workflowEvents).catch(err => {
      console.error('[workflow-manager] Error processing file change events:', err);
    });
  }

  /**
   * Manually emit a custom event and process it through the workflow.
   */
  async emitEvent(event: { type: string; [key: string]: unknown }): Promise<WorkflowInvocationResult | null> {
    if (!this.runtime) return null;

    const workflowEvent: WorkflowEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    return this.processEvents([workflowEvent]);
  }

  /**
   * Run a specific rule by ID, skipping its predicate.
   * Invokes the rule action with an empty event array.
   * Emitted events are processed through subsequent cycles.
   */
  async runRule(ruleId: string): Promise<WorkflowInvocationResult | null> {
    if (!this.runtime) return null;

    // Serialize — don't process concurrently
    if (this.processing) {
      console.warn(`[workflow-manager] Cannot run rule ${ruleId} — another invocation is in progress`);
      return null;
    }

    this.processing = true;
    try {
      const declBefore = JSON.stringify(this.runtime.declarations);
      const { state: newState, result } = await this.runtime.runRule(ruleId, this.state);
      this.state = newState;

      // Persist state
      await this.persistAndBroadcast(result);

      // Check for dynamic declaration changes
      this.broadcastIfDeclarationsChanged(declBefore);

      return result;
    } catch (err) {
      console.error(`[workflow-manager] Error running rule ${ruleId}:`, err);
      return null;
    } finally {
      this.processing = false;
      this.flushPendingEvents();
    }
  }

  /** Get the current persisted workflow state, or null if no workflow is loaded. */
  getState(): PersistedWorkflowState<any> | null {
    return this.persisted;
  }

  /** Get the declarations (modules, targets, environments, rules) from the loaded workflow. */
  getDeclarations(): WorkflowDeclarations {
    if (!this.runtime) {
      return { modules: [], targets: [], environments: [], rules: [] };
    }
    return this.runtime.declarations;
  }

  // ---- Private: Event Processing ----

  /**
   * Process events through the runtime, persist state, and broadcast results.
   */
  private async processEvents(events: WorkflowEvent[]): Promise<WorkflowInvocationResult | null> {
    if (!this.runtime) return null;

    // Serialize — don't process events concurrently
    if (this.processing) {
      this.pendingEvents.push(...events);
      return null;
    }

    this.processing = true;
    try {
      const declBefore = JSON.stringify(this.runtime.declarations);
      const { state: newState, result } = await this.runtime.processEvents(events, this.state);
      this.state = newState;

      // Persist state and broadcast result
      await this.persistAndBroadcast(result);

      // Check for dynamic declaration changes (e.g., rule action called wf.environment())
      this.broadcastIfDeclarationsChanged(declBefore);

      return result;
    } catch (err) {
      console.error('[workflow-manager] Error processing events:', err);
      return null;
    } finally {
      this.processing = false;
      this.flushPendingEvents();
    }
  }

  /** Persist state and broadcast workflow-result to clients. */
  private async persistAndBroadcast(result: WorkflowInvocationResult): Promise<void> {
    // Build file declarations map for persistence
    const fileDeclarations: Record<string, readonly string[]> = {};
    if (this.runtime) {
      for (const [file, ids] of this.runtime.fileDeclarations) {
        fileDeclarations[file] = ids;
      }
    }

    this.persisted = {
      version: 1,
      state: this.state,
      lastInvocation: result,
      updatedAt: new Date().toISOString(),
      fileDeclarations,
    };
    await this.saveState();

    // Broadcast to connected clients
    this.broadcast({
      type: 'workflow-result',
      result,
      state: this.state,
    });

    // Log summary
    const executed = result.rulesExecuted.filter(r => !r.error).length;
    const errored = result.rulesExecuted.filter(r => r.error).length;
    if (result.rulesExecuted.length > 0) {
      console.log(
        `[workflow-manager] Invocation: ${executed} rules OK, ${errored} errors, ${result.cycles} cycle(s), ${result.durationMs}ms`,
      );
    }
  }

  /** If declarations changed during execution, broadcast workflow-reloaded. */
  private broadcastIfDeclarationsChanged(declBefore: string): void {
    if (!this.runtime) return;
    const declAfter = JSON.stringify(this.runtime.declarations);
    if (declBefore !== declAfter) {
      this.broadcast({
        type: 'workflow-reloaded',
        ruleCount: this.runtime.ruleCount,
        declarations: this.runtime.declarations,
        files: this.loadedFiles,
      });
    }
  }

  /** Flush any pending events that accumulated during processing. */
  private flushPendingEvents(): void {
    if (this.pendingEvents.length > 0 && !this.held) {
      const queued = this.pendingEvents.splice(0);
      // Fire and forget to avoid deep recursion — schedule on next tick
      setTimeout(() => {
        this.processEvents(queued).catch(e => {
          console.error('[workflow-manager] Error processing queued events:', e);
        });
      }, 0);
    }
  }

  // ---- Private: Reload ----

  /**
   * Schedule a debounced reload of changed workflow definition files.
   * Waits 500ms after the last change before reloading to avoid
   * thrashing during rapid saves (e.g. editor auto-save).
   */
  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }

    this.reloadTimer = setTimeout(async () => {
      this.reloadTimer = null;

      if (this.reloading) return;
      this.reloading = true;

      const changedFiles = [...this.changedAutomationFiles];
      this.changedAutomationFiles.clear();

      try {
        if (!this.runtime || changedFiles.length === 0) {
          // No runtime or no changed files — do a full reload
          console.log('[workflow-manager] Workflow definition changed — full reload');
          await this.start();
        } else {
          // Incremental reload: only re-run changed files
          console.log(`[workflow-manager] Incremental reload: ${changedFiles.map(f => f.split('/').pop()).join(', ')}`);
          await this.incrementalReload(changedFiles);
        }

        this.broadcast({
          type: 'workflow-reloaded',
          ruleCount: this.runtime?.ruleCount ?? 0,
          declarations: this.getDeclarations(),
          files: this.loadedFiles,
        });

        console.log('[workflow-manager] Auto-reload complete');
      } catch (err) {
        console.error('[workflow-manager] Auto-reload failed:', err);
        this.broadcast({
          type: 'workflow-reload-error',
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.reloading = false;
      }
    }, 500);
  }

  /**
   * Incremental reload: re-run only the changed definition files.
   * Removes old declarations from changed files, recompiles them,
   * and re-runs them against the existing runtime handle.
   */
  private async incrementalReload(changedFiles: string[]): Promise<void> {
    if (!this.runtime) return;

    for (const filePath of changedFiles) {
      // Remove old declarations from this file
      this.runtime.removeDeclarationsFromFile(filePath);
      this.loadedDefinitions.delete(filePath);

      // Check if the file still exists (might have been deleted)
      const exists = await this.env.exists(filePath);
      if (!exists) {
        // File was deleted — declarations already removed, update loaded files
        this.loadedFiles = this.loadedFiles.filter(f => f !== filePath);
        continue;
      }

      // Recompile and load the changed file
      try {
        const def = await this.loadSingleDefinition(filePath);
        if (def) {
          // Re-run the definition with source file tracking
          this.runtime.setSourceFile(filePath);
          def(this.runtime.getHandle());
          this.runtime.setSourceFile(null);

          this.loadedDefinitions.set(filePath, def);

          // Ensure file is in the loaded list
          if (!this.loadedFiles.includes(filePath)) {
            this.loadedFiles.push(filePath);
          }
        }
      } catch (err) {
        console.error(`[workflow-manager] Failed to reload ${filePath}:`, err);
        this.broadcast({
          type: 'workflow-load-error',
          file: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Save updated state (with new fileDeclarations)
    if (this.persisted) {
      const fileDeclarations: Record<string, readonly string[]> = {};
      for (const [file, ids] of this.runtime.fileDeclarations) {
        fileDeclarations[file] = ids;
      }
      this.persisted = { ...this.persisted, fileDeclarations, updatedAt: new Date().toISOString() };
      await this.saveState();
    }
  }

  // ---- Private: Startup Diff ----

  /**
   * On startup with existing state, compare workspace files against the
   * persisted manifest to detect changes that happened while the workspace
   * was stopped (e.g., code pushed via git, files modified via Lambda API).
   * Emits file:change / file:delete events for differences.
   */
  private async emitStartupDiff(manifest: Record<string, string>): Promise<void> {
    try {
      const currentManifest = await this.computeFileManifest();
      const events: WorkflowEvent[] = [];
      const now = new Date().toISOString();

      // Files that are new or changed
      for (const [path, hash] of Object.entries(currentManifest)) {
        if (!manifest[path] || manifest[path] !== hash) {
          events.push({ type: 'file:change', path, timestamp: now });
        }
      }

      // Files that were deleted
      for (const path of Object.keys(manifest)) {
        if (!(path in currentManifest)) {
          events.push({ type: 'file:delete', path, timestamp: now });
        }
      }

      if (events.length > 0) {
        console.log(`[workflow-manager] Startup diff: ${events.length} file(s) changed since last run`);
        await this.processEvents(events);
      } else {
        console.log('[workflow-manager] Startup diff: no file changes detected');
      }

      // Update manifest in persisted state
      if (this.persisted) {
        this.persisted = { ...this.persisted, fileManifest: currentManifest };
        await this.saveState();
      }
    } catch (err) {
      console.error('[workflow-manager] Error computing startup diff:', err);
    }
  }

  /**
   * Compute a hash manifest of all workspace files (excluding .antimatter/).
   * Maps relative file paths to content hashes.
   */
  private async computeFileManifest(dir = '', result: Record<string, string> = {}): Promise<Record<string, string>> {
    try {
      const entries = await this.env.readDirectory(dir || '.');
      for (const entry of entries) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        // Skip .antimatter directory and node_modules
        if (entry.name === '.antimatter' || entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.type === 'file') {
          try {
            const content = await this.env.readFile(path);
            const hash = createHash('md5').update(content).digest('hex');
            result[path] = hash;
          } catch {
            // Skip files that can't be read
          }
        } else if (entry.type === 'directory') {
          await this.computeFileManifest(path, result);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return result;
  }

  // ---- Private: File Loading ----

  /**
   * Check if a path is an automation file we should load/watch.
   * Includes `.ts` files in the automation directory, excluding
   * compiled artifacts, declaration files, and state files.
   */
  private isAutomationFile(path: string): boolean {
    const normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith(this.automationDir + '/')) return false;
    // Only top-level files in the dir (not subdirectories)
    const parts = normalized.slice(this.automationDir.length + 1).split('/');
    if (parts.length !== 1) return false;
    const filename = parts[0];
    if (!filename.endsWith('.ts')) return false;
    // Exclude compiled artifacts, declaration files, state files
    if (filename.endsWith('.d.ts')) return false;
    if (filename.endsWith('.compiled.mjs')) return false;
    if (filename === 'workflow-state.json') return false;
    return true;
  }

  /**
   * Scan `.antimatter/*.ts` for automation files and load all definitions.
   * Returns tagged definitions (file path + definition function).
   */
  private async loadTaggedDefinitions(): Promise<TaggedDefinition[] | null> {
    try {
      // Check if the automation directory exists
      const dirExists = await this.env.exists(this.automationDir);
      if (!dirExists) return null;

      // Read directory entries
      const entries = await this.env.readDirectory(this.automationDir);
      const tsFiles = entries
        .filter((e: { type: string; name: string }) => e.type === 'file')
        .map((e: { name: string }) => `${this.automationDir}/${e.name}`)
        .filter((p: string) => this.isAutomationFile(p))
        .sort(); // deterministic order

      if (tsFiles.length === 0) return null;

      console.log(`[workflow-manager] Found ${tsFiles.length} automation file(s): ${tsFiles.map((f: string) => f.split('/').pop()).join(', ')}`);

      // Load each file individually with error isolation
      const tagged: TaggedDefinition[] = [];
      const loaded: string[] = [];

      for (const filePath of tsFiles) {
        try {
          const def = await this.loadSingleDefinition(filePath);
          if (def) {
            tagged.push({ filePath, definition: def });
            loaded.push(filePath);
          }
        } catch (err) {
          console.error(`[workflow-manager] Failed to load ${filePath} — skipping:`, err);
          this.broadcast({
            type: 'workflow-load-error',
            file: filePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.loadedFiles = loaded;
      return tagged.length > 0 ? tagged : null;
    } catch (err) {
      console.error('[workflow-manager] Failed to scan automation directory:', err);
      return null;
    }
  }

  /**
   * Load a single workflow definition file.
   * Transpiles TypeScript to ESM JavaScript, writes to a temp file, and imports it.
   */
  private async loadSingleDefinition(filePath: string): Promise<WorkflowDefinition<any> | null> {
    // Read the TypeScript source
    const source = await this.env.readFile(filePath);

    // Transpile TS → ESM JS using esbuild
    const esbuild = await import('esbuild');
    const result = await esbuild.transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'node20',
    });

    // Write compiled output to a temp file (dynamic import needs a real file)
    const compiledPath = filePath.replace(/\.ts$/, '.compiled.mjs');
    await this.env.writeFile(compiledPath, result.code);

    // Resolve the absolute path for import()
    const { resolve } = await import('node:path');
    const absolutePath = resolve(
      (this.env as any).rootPath ?? process.cwd(),
      compiledPath,
    );

    // Dynamic import with cache-busting query param
    const fileUrl = `file://${absolutePath.replace(/\\/g, '/')}?t=${Date.now()}`;
    const module = await import(fileUrl);

    const definition = module.default;
    if (typeof definition !== 'function') {
      console.warn(`[workflow-manager] ${filePath} does not export a default function — skipping`);
      return null;
    }

    return definition;
  }

  // ---- Private: State Persistence ----

  /** Load persisted state from the state file. */
  private async loadState(): Promise<PersistedWorkflowState<any> | null> {
    try {
      const exists = await this.env.exists(this.statePath);
      if (!exists) return null;

      const content = await this.env.readFile(this.statePath);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /** Persist state to the state file. */
  private async saveState(): Promise<void> {
    if (!this.persisted) return;
    try {
      await this.env.writeFile(this.statePath, JSON.stringify(this.persisted, null, 2));
    } catch (err) {
      console.error('[workflow-manager] Failed to persist state:', err);
    }
  }

  // ---- Private: Executor ----

  /**
   * Create the executor function that bridges workflow ExecOptions
   * to the workspace environment's execute() method.
   */
  private createExecutor(): (command: string, options?: ExecOptions) => Promise<ExecResult> {
    return async (command: string, options?: ExecOptions): Promise<ExecResult> => {
      this.onExecStart?.();
      try {
        const execOptions: ExecuteOptions = {
          command,
          cwd: options?.cwd,
          env: options?.env as Record<string, string>,
          timeout: options?.timeout,
          onStdout: options?.onStdout,
          onStderr: options?.onStderr,
        };

        const result = await this.env.execute(execOptions);
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
        };
      } finally {
        this.onExecEnd?.();
      }
    };
  }
}
