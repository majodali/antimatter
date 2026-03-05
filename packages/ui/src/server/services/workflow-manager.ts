/**
 * WorkflowManager — manages the lifecycle of a WorkflowRuntime instance.
 *
 * Responsibilities:
 *  - Loads workflow definition from `.antimatter/workflow.ts`
 *  - Persists state to `.antimatter/workflow-state.json`
 *  - Connects file change events to the workflow engine
 *  - Broadcasts invocation results to WebSocket clients
 *  - Hold/release pattern for pausing during batch operations
 */

import {
  WorkflowRuntime,
  type WorkflowDefinition,
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
  /** Path to the workflow definition file. Default: '.antimatter/workflow.ts' */
  readonly definitionPath?: string;
  /** Path to the persisted state file. Default: '.antimatter/workflow-state.json' */
  readonly statePath?: string;
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

  private readonly env: WorkspaceEnvironment;
  private readonly broadcast: (msg: object) => void;
  private readonly preloadedDefinition?: WorkflowDefinition<any>;
  private readonly definitionPath: string;
  private readonly statePath: string;

  constructor(options: WorkflowManagerOptions) {
    this.env = options.env;
    this.broadcast = options.broadcast;
    this.preloadedDefinition = options.definition;
    this.definitionPath = options.definitionPath ?? '.antimatter/workflow.ts';
    this.statePath = options.statePath ?? '.antimatter/workflow-state.json';
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

    console.log(`[workflow-manager] Loaded workflow with ${this.runtime.ruleCount} rules`);

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
   */
  onFileChanges(events: readonly WatchEvent[]): void {
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

  /** Get the current persisted workflow state, or null if no workflow is loaded. */
  getState(): PersistedWorkflowState<any> | null {
    return this.persisted;
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
   * Load the workflow definition from `.antimatter/workflow.ts`.
   * Transpiles TypeScript to ESM JavaScript, writes to a temp file, and imports it.
   */
  private async loadDefinition(): Promise<WorkflowDefinition<any> | null> {
    try {
      // Check if the definition file exists
      const exists = await this.env.exists(this.definitionPath);
      if (!exists) return null;

      // Read the TypeScript source
      const source = await this.env.readFile(this.definitionPath);

      // Transpile TS → ESM JS using esbuild
      const esbuild = await import('esbuild');
      const result = await esbuild.transform(source, {
        loader: 'ts',
        format: 'esm',
        target: 'node20',
        // Replace the workflow import with the actual resolved path
        // since the compiled file won't be in a node_modules context
      });

      // Write compiled output to a temp file (dynamic import needs a real file)
      const compiledPath = this.definitionPath.replace(/\.ts$/, '.compiled.mjs');
      await this.env.writeFile(compiledPath, result.code);

      // Resolve the absolute path for import()
      // The env root + compiled path gives us the real filesystem path
      const { fileURLToPath } = await import('node:url');
      const { resolve } = await import('node:path');

      // We need the actual filesystem path — get it from the env
      // The env.writeFile writes relative to its root, which for LocalWorkspaceEnvironment
      // is the project directory
      const absolutePath = resolve(
        (this.env as any).rootPath ?? process.cwd(),
        compiledPath,
      );

      // Dynamic import with cache-busting query param
      const fileUrl = `file://${absolutePath.replace(/\\/g, '/')}?t=${Date.now()}`;
      const module = await import(fileUrl);

      const definition = module.default;
      if (typeof definition !== 'function') {
        console.error('[workflow-manager] Workflow definition must export a default function');
        return null;
      }

      return definition;
    } catch (err) {
      console.error('[workflow-manager] Failed to load workflow definition:', err);
      return null;
    }
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
    };
  }
}
