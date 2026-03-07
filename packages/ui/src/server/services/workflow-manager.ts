/**
 * WorkflowManager — manages the lifecycle of a WorkflowRuntime instance.
 *
 * Responsibilities:
 *  - Loads workflow definitions from `.antimatter/*.ts` (multi-file)
 *  - Auto-reloads definitions when any automation file changes (debounced)
 *  - Persists state to `.antimatter/workflow-state.json`
 *  - Connects file change events to the workflow engine
 *  - Broadcasts invocation results to WebSocket clients
 *  - Hold/release pattern for pausing during batch operations
 *  - Exposes declarations (modules, targets, environments) from loaded definitions
 */

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
    const definition = this.preloadedDefinition ?? (await this.loadDefinition());
    if (!definition) {
      console.log('[workflow-manager] No workflow definition found — skipping');
      this.runtime = null;
      return;
    }

    this.runtime = new WorkflowRuntime(definition, {
      executor: this.createExecutor(),
    });

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
      console.log('[workflow-manager] Restored persisted state');
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
   * If the workflow definition file (`.antimatter/workflow.ts`) changes,
   * the manager automatically reloads the definition after a short debounce.
   */
  onFileChanges(events: readonly WatchEvent[]): void {
    // Check for automation file changes — auto-reload with debounce.
    // Triggers on any .ts file in the automation directory.
    // This runs even if runtime is null (files might be newly created).
    const automationChanged = events.some(e => {
      const normalized = e.path.replace(/^\//, '');
      return this.isAutomationFile(normalized);
    });

    if (automationChanged) {
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
   * Schedule a debounced reload of the workflow definition.
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

      try {
        console.log('[workflow-manager] Workflow definition changed — auto-reloading');

        await this.start();

        // start() restores persisted state from the state file,
        // so existing workflow state is preserved across reloads.

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

  /** Get the current persisted workflow state, or null if no workflow is loaded. */
  getState(): PersistedWorkflowState<any> | null {
    return this.persisted;
  }

  /** Get the declarations (modules, targets, environments) from the loaded workflow. */
  getDeclarations(): WorkflowDeclarations {
    if (!this.runtime) {
      return { modules: [], targets: [], environments: [] };
    }
    return this.runtime.declarations;
  }

  // ---- Private ----

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
      const { state: newState, result } = await this.runtime.processEvents(events, this.state);
      this.state = newState;

      // Persist state
      this.persisted = {
        version: 1,
        state: this.state,
        lastInvocation: result,
        updatedAt: new Date().toISOString(),
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

      return result;
    } catch (err) {
      console.error('[workflow-manager] Error processing events:', err);
      return null;
    } finally {
      this.processing = false;

      // Process any events that accumulated during processing
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
  }

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
   * Each file's default export is expected to be a WorkflowDefinition function.
   * Definitions are composed: all are called with the same wf handle, so
   * rules and declarations from all files are merged.
   *
   * If a file fails to transpile/load, it is skipped with a warning — other
   * files are still loaded (error isolation).
   */
  private async loadDefinition(): Promise<WorkflowDefinition<any> | null> {
    try {
      // Check if the automation directory exists
      const dirExists = await this.env.exists(this.automationDir);
      if (!dirExists) return null;

      // Read directory entries
      const entries = await this.env.readDirectory(this.automationDir);
      const tsFiles = entries
        .filter(e => e.type === 'file')
        .map(e => `${this.automationDir}/${e.name}`)
        .filter(path => this.isAutomationFile(path))
        .sort(); // deterministic order

      if (tsFiles.length === 0) return null;

      console.log(`[workflow-manager] Found ${tsFiles.length} automation file(s): ${tsFiles.map(f => f.split('/').pop()).join(', ')}`);

      // Load each file individually with error isolation
      const definitions: WorkflowDefinition<any>[] = [];
      const loaded: string[] = [];

      for (const filePath of tsFiles) {
        try {
          const def = await this.loadSingleDefinition(filePath);
          if (def) {
            definitions.push(def);
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

      if (definitions.length === 0) return null;

      // Compose all definitions into one: call each with the same wf handle
      const composite: WorkflowDefinition<any> = (wf) => {
        for (const def of definitions) {
          def(wf);
        }
      };

      return composite;
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
