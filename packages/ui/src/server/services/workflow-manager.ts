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
  ErrorTypes,
  parseEsbuildErrors,
  type ApplicationState,
  type WorkflowDefinition,
  type WorkflowDeclarations,
  type WorkflowEvent,
  type WorkflowInvocationResult,
  type PersistedWorkflowState,
  type PersistedRuleResult,
  type ExecOptions,
  type ExecResult,
  type ProjectError,
} from '@antimatter/workflow';
import type { WorkspaceEnvironment, ExecuteOptions } from '@antimatter/workspace';
import type { WatchEvent } from '@antimatter/filesystem';
import type { ErrorStore } from './error-store.js';
import { Kinds } from '../../shared/activity-types.js';
import { createAwsUtils } from './workflow-utils/aws.js';
import { createHttpUtils } from './workflow-utils/http.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowManagerOptions {
  /** The workspace environment for file I/O and command execution. */
  readonly env: WorkspaceEnvironment;
  /** Callback to broadcast messages to WebSocket clients. */
  readonly broadcast: (msg: object) => void;
  /** Server-side error store for persisting and broadcasting project errors. */
  readonly errorStore?: ErrorStore;
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
  /** Event log for persistent, ordered, deduplicated event sourcing. Optional for backward compat. */
  readonly eventLog?: import('./event-log.js').EventLog;
  /** Deployed resource store for wf.utils.registerResource. */
  readonly deployedResourceStore?: import('./deployed-resource-store.js').DeployedResourceStore;
  /** Activity log for workflow trace events (invocation/rule/exec/log). */
  readonly activityLog?: import('./activity-log.js').ActivityLog;
  /** Project ID for per-project scoping (secrets, resources, etc.). */
  readonly projectId?: string;
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
  /** Promise that resolves when a pending reload completes. Callers that need
   *  the runtime (emitEvent, processEvents, runRule) await this before proceeding. */
  private reloadPromise: Promise<void> | null = null;
  private reloadResolve: (() => void) | null = null;

  private readonly env: WorkspaceEnvironment;
  private readonly broadcast: (msg: object) => void;
  private readonly errorStore?: ErrorStore;
  private readonly preloadedDefinition?: WorkflowDefinition<any>;
  private readonly automationDir: string;
  private readonly statePath: string;
  private readonly onExecStart?: () => void;
  private readonly onExecEnd?: () => void;
  private readonly eventLog?: import('./event-log.js').EventLog;
  private readonly deployedResourceStore?: import('./deployed-resource-store.js').DeployedResourceStore;
  private readonly activityLog?: import('./activity-log.js').ActivityLog;
  private readonly projectId?: string;

  /** Tracks which files were loaded in the last definition load. */
  private loadedFiles: string[] = [];
  /** Loaded definitions by file path (for incremental reload). */
  private loadedDefinitions = new Map<string, WorkflowDefinition<any>>();
  /** Automation files that changed since last reload (for incremental reload). */
  private changedAutomationFiles = new Set<string>();

  constructor(options: WorkflowManagerOptions) {
    this.env = options.env;
    this.broadcast = options.broadcast;
    this.errorStore = options.errorStore;
    this.preloadedDefinition = options.definition;
    this.automationDir = options.automationDir ?? '.antimatter';
    this.statePath = options.statePath ?? '.antimatter/workflow-state.json';
    this.onExecStart = options.onExecStart;
    this.onExecEnd = options.onExecEnd;
    this.eventLog = options.eventLog;
    this.deployedResourceStore = options.deployedResourceStore;
    this.activityLog = options.activityLog;
    this.projectId = options.projectId;

    // Subscribe to event log drain — batched events arrive here
    if (this.eventLog) {
      this.eventLog.subscribe(this.handleEventLogDrain.bind(this));
    }
  }

  /**
   * Handle a batch of events drained from the EventLog.
   * Extracts WorkflowEvent payloads and processes them, updating the checkpoint.
   */
  private handleEventLogDrain(entries: import('@antimatter/workflow').EventLogEntry[]): void {
    if (entries.length === 0) return;

    const events = entries.map(e => e.event);
    const maxSeq = entries[entries.length - 1].seq;

    // Check for automation file changes in the batch
    for (const entry of entries) {
      if (entry.event.path) {
        const normalized = String(entry.event.path).replace(/^\//, '');
        if (this.isAutomationFile(normalized)) {
          this.changedAutomationFiles.add(normalized);
        }
      }
    }

    if (this.changedAutomationFiles.size > 0) {
      this.scheduleReload();
    }

    // Filter out .antimatter/ events (workflow definitions, not project files)
    const workflowEvents = events.filter(e =>
      !e.path || (!String(e.path).startsWith('/.antimatter/') && !String(e.path).startsWith('.antimatter/')),
    );

    if (workflowEvents.length === 0) {
      // Still update checkpoint even if no workflow events
      this.updateCheckpoint(maxSeq);
      return;
    }

    if (this.held) {
      this.pendingEvents.push(...workflowEvents);
      return;
    }

    this.processEventsWithCheckpoint(workflowEvents, maxSeq).catch(err => {
      console.error('[workflow-manager] Error processing event log drain:', err);
    });
  }

  private async processEventsWithCheckpoint(
    events: WorkflowEvent[],
    checkpoint: number,
  ): Promise<WorkflowInvocationResult | null> {
    const result = await this.processEvents(events);
    this.updateCheckpoint(checkpoint);
    return result;
  }

  private updateCheckpoint(seq: number): void {
    if (this.persisted) {
      this.persisted = { ...this.persisted, lastProcessedSeq: seq };
      // Don't save state just for checkpoint — it'll be saved on next processEvents
    }
  }

  // ---- Public API ----

  /**
   * Load (or reload) the workflow definition and persisted state.
   * If no prior state exists, fires `project:initialize`.
   */
  async start(): Promise<void> {
    const projectRoot = (this.env as any).rootPath ?? process.cwd();
    const utils = this.createUtils(projectRoot);
    const projectId = this.projectId;
    const activityLog = this.activityLog;
    const runtimeConfig = {
      onReportErrors: this.handleReportErrors.bind(this),
      projectRoot,
      utils,
      // Workflow trace hooks — emit activity events for every rule/exec/log/emit
      onInvocationStart: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowInvocationStart, level: 'info',
          message: `Invocation start: ${ctx.triggerEvents.map((e: any) => e.type).join(', ') || 'manual'}`,
          projectId, operationId: ctx.operationId, correlationId: ctx.invocationId,
          environment: ctx.environment ?? undefined,
          data: { triggerEvents: ctx.triggerEvents },
        });
      },
      onInvocationEnd: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowInvocationEnd, level: 'info',
          message: `Invocation end (${ctx.cycles} cycles, ${ctx.durationMs}ms)`,
          projectId, operationId: ctx.operationId, correlationId: ctx.invocationId,
          data: { durationMs: ctx.durationMs, cycles: ctx.cycles },
        });
      },
      onRuleStart: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info',
          message: `Rule start: ${ctx.ruleId}`,
          projectId, operationId: ctx.operationId, correlationId: ctx.ruleId, parentId: ctx.invocationId,
          data: { ruleId: ctx.ruleId, matchedCount: ctx.matchedCount },
        });
      },
      onRuleEnd: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowRuleEnd, level: ctx.error ? 'error' : 'info',
          message: ctx.error ? `Rule failed: ${ctx.ruleId}: ${ctx.error}` : `Rule end: ${ctx.ruleId} (${ctx.durationMs}ms)`,
          projectId, operationId: ctx.operationId, correlationId: ctx.ruleId, parentId: ctx.invocationId,
          data: { ruleId: ctx.ruleId, durationMs: ctx.durationMs, error: ctx.error },
        });
      },
      onLog: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowLog, level: ctx.level,
          message: ctx.message,
          projectId, operationId: ctx.operationId, correlationId: ctx.ruleId ?? undefined, parentId: ctx.invocationId,
        });
      },
      onExecStart: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowExecStart, level: 'info',
          message: `$ ${ctx.command}`,
          projectId, operationId: ctx.operationId, correlationId: ctx.execId, parentId: ctx.ruleId ?? ctx.invocationId,
          data: { command: ctx.command, cwd: ctx.cwd },
        });
      },
      onExecChunk: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowExecChunk, level: ctx.stream === 'stderr' ? 'warn' : 'debug',
          message: ctx.data.length > 200 ? ctx.data.slice(0, 200) + '...' : ctx.data,
          projectId, operationId: ctx.operationId, parentId: ctx.execId,
          data: { stream: ctx.stream, data: ctx.data },
        });
      },
      onExecEnd: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowExecEnd, level: ctx.exitCode === 0 ? 'info' : 'error',
          message: `exec complete: exit=${ctx.exitCode} (${ctx.durationMs}ms)`,
          projectId, operationId: ctx.operationId, correlationId: ctx.execId, parentId: ctx.invocationId,
          data: { durationMs: ctx.durationMs, exitCode: ctx.exitCode },
        });
      },
      onEmit: (ctx: any) => {
        activityLog?.emit({
          source: 'workflow', kind: Kinds.WorkflowEmit, level: 'debug',
          message: `emit: ${ctx.event.type}`,
          projectId, operationId: ctx.operationId, parentId: ctx.ruleId ?? ctx.invocationId,
          data: { event: ctx.event },
        });
      },
    };

    if (this.preloadedDefinition) {
      // Testing path — use pre-loaded definition directly
      this.runtime = new WorkflowRuntime(this.preloadedDefinition, {
        executor: this.createExecutor(),
        config: runtimeConfig,
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
        config: runtimeConfig,
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

    // Replay unprocessed events from the event log (startup catchup)
    if (this.eventLog) {
      const checkpoint = this.persisted?.lastProcessedSeq ?? 0;
      const unprocessed = this.eventLog.getEntriesSince(checkpoint);
      if (unprocessed.length > 0) {
        console.log(`[workflow-manager] Replaying ${unprocessed.length} events from event log (checkpoint=${checkpoint})`);
        const events = unprocessed
          .filter(e => e.source !== 'workflow-emit') // Don't replay audit-only events
          .map(e => e.event);
        if (events.length > 0) {
          const maxSeq = unprocessed[unprocessed.length - 1].seq;
          await this.processEventsWithCheckpoint(events, maxSeq);
        }
      }
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
  /**
   * Feed file change events from the FileChangeNotifier.
   * Converts WatchEvents to WorkflowEvents.
   *
   * When an EventLog is configured, events are appended to the log and
   * delivered via the drain callback (handleEventLogDrain). Otherwise,
   * events are processed directly (legacy path).
   */
  onFileChanges(events: readonly WatchEvent[], source?: import('@antimatter/workflow').EventSource): void {
    const eventSource = source ?? 'watcher';

    // Convert WatchEvent → WorkflowEvent (all events, including .antimatter/)
    const allWorkflowEvents: WorkflowEvent[] = events.map(e => ({
      type: e.type === 'delete' ? 'file:delete' as const : 'file:change' as const,
      path: e.path,
      timestamp: new Date().toISOString(),
    }));

    // If EventLog is available, route through it (dedup, persist, batch drain)
    if (this.eventLog) {
      this.eventLog.append(allWorkflowEvents, eventSource);
      return;
    }

    // Legacy path (no EventLog): direct processing
    // Check for automation file changes
    for (const e of events) {
      const normalized = e.path.replace(/^\//, '');
      if (this.isAutomationFile(normalized)) {
        this.changedAutomationFiles.add(normalized);
      }
    }

    if (this.changedAutomationFiles.size > 0) {
      this.scheduleReload();
    }

    const workflowEvents = allWorkflowEvents.filter(e =>
      !e.path || (!String(e.path).startsWith('/.antimatter/') && !String(e.path).startsWith('.antimatter/')),
    );

    if (workflowEvents.length === 0) return;

    if (this.held) {
      this.pendingEvents.push(...workflowEvents);
      return;
    }

    // processEvents will await any pending reload before accessing the runtime
    this.processEvents(workflowEvents).catch(err => {
      console.error('[workflow-manager] Error processing file change events:', err);
    });
  }

  /**
   * Wait for any pending reload to complete before accessing the runtime.
   * Returns true if a reload was awaited.
   */
  private async awaitPendingReload(): Promise<boolean> {
    if (this.reloadPromise) {
      await this.reloadPromise;
      return true;
    }
    return false;
  }

  /**
   * Manually emit a custom event and process it through the workflow.
   */
  async emitEvent(event: { type: string; [key: string]: unknown }): Promise<WorkflowInvocationResult | null> {
    // Wait for any pending reload to complete so the runtime is available
    await this.awaitPendingReload();
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
    // Wait for any pending reload to complete so the runtime is available
    await this.awaitPendingReload();
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

  /** Assemble full application state snapshot — all state in one object. */
  getApplicationState(): ApplicationState {
    return {
      version: 1,
      declarations: this.getDeclarations(),
      workflowState: this.state ?? {},
      ruleResults: this.persisted?.ruleResults ?? {},
      errors: this.errorStore?.getAllErrors() ?? [],
      lastInvocation: this.persisted?.lastInvocation ?? null,
      loadedFiles: this.loadedFiles,
      updatedAt: this.persisted?.updatedAt ?? new Date().toISOString(),
    };
  }

  /** Broadcast a partial state update to all connected clients. */
  broadcastStatePatch(patch: Partial<ApplicationState>): void {
    this.broadcast({
      type: 'application-state',
      state: { ...patch, updatedAt: new Date().toISOString() },
    });
  }

  /** Broadcast full application state (used on WS connect). */
  broadcastFullState(): void {
    this.broadcast({
      type: 'application-state',
      full: true,
      state: this.getApplicationState(),
    });
  }

  // ---- Private: Event Processing ----

  /**
   * Process events through the runtime, persist state, and broadcast results.
   */
  private async processEvents(events: WorkflowEvent[]): Promise<WorkflowInvocationResult | null> {
    // Wait for any pending reload to complete so the runtime is available.
    // Skip if we're already inside a reload (fullRefresh calls processEvents internally).
    if (!this.reloading) {
      await this.awaitPendingReload();
    }
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

    // Only update lastInvocation if at least one rule matched and ran.
    // This prevents file-change events that match no predicates from
    // overwriting useful invocation results.
    const lastInvocation = result.rulesExecuted.length > 0
      ? result
      : this.persisted?.lastInvocation;

    // Accumulate rule results across invocations
    const existingResults: Record<string, PersistedRuleResult> = this.persisted?.ruleResults
      ? { ...this.persisted.ruleResults }
      : {};
    const now = new Date().toISOString();
    for (const executed of result.rulesExecuted) {
      existingResults[executed.ruleId] = {
        status: executed.error ? 'failed' : 'success',
        lastRunAt: now,
        durationMs: executed.durationMs,
        error: executed.error,
      };
    }

    this.persisted = {
      version: 1,
      state: this.state,
      lastInvocation,
      updatedAt: new Date().toISOString(),
      fileDeclarations,
      ruleResults: existingResults,
      lastProcessedSeq: this.persisted?.lastProcessedSeq,
    };
    await this.saveState();

    // Record internal emitted events in the event log for audit
    if (this.eventLog && result.emittedEvents.length > 0) {
      this.eventLog.record(
        result.emittedEvents as WorkflowEvent[],
        'workflow-emit',
      );
    }

    // Broadcast partial state patch to connected clients
    this.broadcastStatePatch({
      workflowState: this.state,
      ruleResults: this.persisted!.ruleResults ?? {},
      lastInvocation: lastInvocation ?? undefined,
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

  /** If declarations changed during execution, broadcast declaration patch. */
  private broadcastIfDeclarationsChanged(declBefore: string): void {
    if (!this.runtime) return;
    const declAfter = JSON.stringify(this.runtime.declarations);
    if (declBefore !== declAfter) {
      this.broadcastStatePatch({
        declarations: this.runtime.declarations,
        loadedFiles: this.loadedFiles,
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

    // Create a reload promise that callers can await. If one already exists
    // (from a previous scheduleReload that hasn't fired yet), reuse it —
    // the debounce timer reset means the same promise will resolve when
    // the actual reload completes.
    if (!this.reloadPromise) {
      this.reloadPromise = new Promise<void>(resolve => {
        this.reloadResolve = resolve;
      });
    }

    this.reloadTimer = setTimeout(async () => {
      this.reloadTimer = null;

      if (this.reloading) return;
      this.reloading = true;
      this.changedAutomationFiles.clear();

      try {
        // Full refresh — reload definitions from new code, preserve state.
        // On compilation failure, previous rules are restored.
        await this.fullRefresh();

        // Broadcast full state after refresh — declarations, state, rules, etc. all changed
        this.broadcastStatePatch({
          declarations: this.getDeclarations(),
          loadedFiles: this.loadedFiles,
          workflowState: this.state ?? {},
          ruleResults: this.persisted?.ruleResults ?? {},
          lastInvocation: this.persisted?.lastInvocation ?? null,
        });

        console.log('[workflow-manager] Full refresh complete');

        // If no definitions were loaded (common when file was created empty
        // and content arrives shortly after), schedule a retry. This handles
        // the DOM "create file then write content" race condition.
        if (this.loadedFiles.length === 0) {
          console.log('[workflow-manager] No definitions loaded — scheduling retry in 2s');
          setTimeout(() => {
            this.changedAutomationFiles.add('retry');
            this.scheduleReload();
          }, 2000);
        }
      } catch (err) {
        console.error('[workflow-manager] Full refresh failed:', err);
        if (this.errorStore) {
          this.errorStore.setErrors('workflow-reload', [{
            errorType: { name: 'Reload Error', icon: '🔄', color: '#ef4444', highlightStyle: 'squiggly' as const },
            toolId: 'workflow-reload',
            file: '.antimatter/',
            message: err instanceof Error ? err.message : String(err),
          }]).catch(() => {});
        }
      } finally {
        this.reloading = false;
        // Resolve the reload promise so waiters can proceed
        const resolve = this.reloadResolve;
        this.reloadPromise = null;
        this.reloadResolve = null;
        resolve?.();
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
        // Report load errors via errorStore → triggers error patch
        if (this.errorStore) {
          this.errorStore.setErrors('workflow', [{
            errorType: { name: 'Build Error', icon: '🔨', color: '#ef4444', highlightStyle: 'squiggly' as const },
            toolId: 'workflow',
            file: filePath,
            message: err instanceof Error ? err.message : String(err),
          }]).catch(() => {});
        }
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

  /** Directories to exclude from file manifest (build artifacts, caches, VCS). */
  private static readonly MANIFEST_EXCLUDE = new Set([
    '.antimatter', '.antimatter-cache', 'node_modules', 'dist', 'dist-lambda',
    'dist-workspace', '.git', '.vite-temp', 'cdk.out', '.next', '__pycache__',
    '.turbo', '.cache', 'coverage',
  ]);

  /** Max file size (bytes) to hash. Larger files are skipped to avoid memory pressure. */
  private static readonly MAX_HASH_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

  /**
   * Compute a hash manifest of workspace source files.
   * Uses streaming hashes to avoid loading entire files into memory.
   * Skips build artifacts, caches, and files over 2 MB.
   */
  private async computeFileManifest(dir = '', result: Record<string, string> = {}): Promise<Record<string, string>> {
    const { createReadStream, statSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const rootPath = (this.env as any).rootPath ?? process.cwd();

    try {
      const entries = await this.env.readDirectory(dir || '.');
      for (const entry of entries) {
        if (WorkflowManager.MANIFEST_EXCLUDE.has(entry.name)) continue;
        // Also skip hidden directories (except .antimatter which is already excluded)
        if (entry.name.startsWith('.') && entry.isDirectory) continue;

        const relativePath = dir ? `${dir}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          await this.computeFileManifest(relativePath, result);
        } else {
          try {
            const absolutePath = resolve(rootPath, relativePath);
            const stat = statSync(absolutePath);
            if (stat.size > WorkflowManager.MAX_HASH_FILE_SIZE) continue;

            // Stream the file through a hash instead of reading into memory
            const hash = await new Promise<string>((res, rej) => {
              const h = createHash('md5');
              const stream = createReadStream(absolutePath);
              stream.on('data', (chunk: Buffer) => h.update(chunk));
              stream.on('end', () => res(h.digest('hex')));
              stream.on('error', rej);
            });
            result[relativePath] = hash;
          } catch {
            // Skip files that can't be read or hashed
          }
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
        .filter((e) => !e.isDirectory)
        .map((e) => `${this.automationDir}/${e.name}`)
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
          // Report load errors via errorStore → triggers error patch
          if (this.errorStore) {
            this.errorStore.setErrors(`workflow:${filePath}`, [{
              errorType: { name: 'Build Error', icon: 'circle-alert', color: '#ef4444', highlightStyle: 'squiggly' as const },
              toolId: `workflow:${filePath}`,
              file: filePath,
              message: err instanceof Error ? err.message : String(err),
            }]).catch(() => {});
          }
        }
      }

      this.loadedFiles = loaded;

      // If all files loaded successfully, clear any previous workflow errors
      if (loaded.length === tsFiles.length && this.errorStore) {
        this.errorStore.clearTool('workflow').catch(() => {});
      }

      return tagged.length > 0 ? tagged : null;
    } catch (err) {
      console.error('[workflow-manager] Failed to scan automation directory:', err);
      return null;
    }
  }

  /**
   * Load a single workflow definition file.
   * Transforms TypeScript to ESM JavaScript via esbuild.transform() (no bundling),
   * writes the result to .antimatter-cache/compiled/, and dynamic-imports it.
   *
   * Uses transform instead of build+bundle because:
   * - No need to bundle — the file executes on the workspace server where
   *   node_modules is available for regular module resolution.
   * - Bundling the antimatter monorepo's workflow packages consumed ~4GB RAM,
   *   causing std::bad_alloc crashes on resource-constrained instances.
   * - Transform is fast (~10ms) and memory-efficient (~50MB).
   */
  private async loadSingleDefinition(filePath: string): Promise<WorkflowDefinition<any> | null> {
    const esbuild = await import('esbuild');
    const { resolve } = await import('node:path');
    const { mkdir, readFile: fsReadFile, writeFile: fsWriteFile } = await import('node:fs/promises');

    const rootPath = (this.env as any).rootPath ?? process.cwd();
    const absoluteSourcePath = resolve(rootPath, filePath);
    const basename = filePath.split('/').pop()!.replace(/\.ts$/, '.compiled.mjs');
    const compiledPath = `.antimatter-cache/compiled/${basename}`;
    const absoluteCompiledPath = resolve(rootPath, compiledPath);

    // Ensure output directory exists
    const compiledDir = resolve(rootPath, '.antimatter-cache/compiled');
    await mkdir(compiledDir, { recursive: true });

    // Read source file — skip if empty (content write triggers another reload)
    let sourceContent: string;
    try {
      sourceContent = await fsReadFile(absoluteSourcePath, 'utf-8');
      if (sourceContent.trim().length === 0) {
        console.log(`[workflow-manager] ${filePath} is empty — skipping (will reload when content arrives)`);
        return null;
      }
    } catch {
      console.log(`[workflow-manager] ${filePath} not readable — skipping`);
      return null;
    }

    // Transform TypeScript → ESM JavaScript (no bundling, no dependency resolution)
    let code: string;
    try {
      const transformResult = await esbuild.transform(sourceContent, {
        loader: 'ts',
        format: 'esm',
        target: 'node20',
        sourcefile: absoluteSourcePath,
      });
      code = transformResult.code;

      if (transformResult.warnings.length > 0) {
        for (const w of transformResult.warnings) {
          console.warn(`[workflow-manager] ${filePath}: ${w.text}`);
        }
      }

      // Clear previous compilation errors for THIS file on success
      if (this.errorStore) {
        await this.errorStore.clearTool(`workflow:${filePath}`);
      }
    } catch (err: any) {
      // esbuild.transform throws on syntax errors
      console.error(`[workflow-manager] Failed to compile ${filePath}:`, err.message ?? err);
      if (this.errorStore && err.errors) {
        const projectErrors = parseEsbuildErrors(err);
        // Scope errors to this specific file
        for (const e of projectErrors) { e.toolId = `workflow:${filePath}`; }
        await this.errorStore.setErrors(`workflow:${filePath}`, projectErrors);
      }
      return null;
    }

    // Write compiled output
    await fsWriteFile(absoluteCompiledPath, code, 'utf-8');

    // Dynamic import with cache-busting query param
    const fileUrl = `file://${absoluteCompiledPath.replace(/\\/g, '/')}?t=${Date.now()}`;
    let module: any;
    try {
      module = await import(fileUrl);
    } catch (importErr: any) {
      const msg = importErr.message ?? String(importErr);
      console.error(`[workflow-manager] Failed to import compiled ${filePath}: ${msg}`);
      if (this.errorStore) {
        await this.errorStore.setErrors(`workflow:${filePath}`, [{
          errorType: { name: 'Import Error', icon: 'circle-alert', color: '#ef4444', highlightStyle: 'squiggly' as const },
          toolId: `workflow:${filePath}`,
          file: filePath,
          message: `Failed to load automation file: ${msg}`,
          line: 1,
          column: 1,
        }]);
      }
      return null;
    }

    const definition = module.default;
    if (typeof definition !== 'function') {
      const actual = definition === undefined ? 'undefined' : typeof definition;
      console.warn(`[workflow-manager] ${filePath} does not export a default function (got ${actual}) — skipping`);
      if (this.errorStore) {
        await this.errorStore.setErrors(`workflow:${filePath}`, [{
          errorType: { name: 'Export Error', icon: 'circle-alert', color: '#ef4444', highlightStyle: 'squiggly' as const },
          toolId: `workflow:${filePath}`,
          file: filePath,
          message: `Automation file must \`export default (wf) => { ... }\`. Got ${actual}.`,
          line: 1,
          column: 1,
        }]);
      }
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
   * Handle wf.reportErrors() calls from build scripts.
   * Routes errors to the ErrorStore for persistence and broadcast.
   */
  private handleReportErrors(toolId: string, errors: ProjectError[]): void {
    if (!this.errorStore) return;
    // Fire and forget — don't block the rule action on persistence
    this.errorStore.setErrors(toolId, errors).catch(err => {
      console.error(`[workflow-manager] Failed to report errors for ${toolId}:`, err);
    });
  }

  /**
   * Full workflow refresh — reloads definitions from disk, preserving user
   * state (including _ui widget values). If compilation fails, restores the
   * previous runtime so rules keep working. Emits file:change for every
   * workspace file so rules can react to the current state of the project.
   */
  private async fullRefresh(): Promise<void> {
    console.log('[workflow-manager] Full refresh — reloading definitions, preserving state');

    // Save old runtime + definitions so we can restore on compilation failure
    const prevRuntime = this.runtime;
    const prevDefinitions = new Map(this.loadedDefinitions);
    const prevLoadedFiles = [...this.loadedFiles];

    // 1. Clear runtime + definitions (will be rebuilt from new code)
    this.loadedDefinitions.clear();
    this.loadedFiles = [];
    this.runtime = null;

    // 2. Clear stale workflow compilation errors
    if (this.errorStore) {
      await this.errorStore.clearTool('workflow');
    }

    // 3. Call start() — reloads definitions from disk.
    //    Persisted state (including _ui widget values) is preserved on disk
    //    and restored by start() via loadState().
    try {
      await this.start();
    } catch (err) {
      // Compilation failed — restore previous runtime so rules keep working
      console.error('[workflow-manager] Reload failed — restoring previous rules:', err);
      this.runtime = prevRuntime;
      this.loadedDefinitions = prevDefinitions;
      this.loadedFiles = prevLoadedFiles;
      throw err; // Re-throw so scheduleReload's catch block reports the error
    }

    // If start() loaded no definitions (empty/broken file), restore previous
    if (this.loadedFiles.length === 0 && prevLoadedFiles.length > 0) {
      console.warn('[workflow-manager] No definitions loaded after refresh — keeping previous rules');
      this.runtime = prevRuntime;
      this.loadedDefinitions = prevDefinitions;
      this.loadedFiles = prevLoadedFiles;
      return;
    }

    // 5. Emit file:change for every workspace file so rules can react
    const manifest = await this.computeFileManifest();
    const now = new Date().toISOString();
    const events: WorkflowEvent[] = Object.keys(manifest).map(path => ({
      type: 'file:change' as const,
      path,
      timestamp: now,
    }));

    if (events.length > 0) {
      console.log(`[workflow-manager] Full refresh: emitting file:change for ${events.length} file(s)`);
      await this.processEvents(events);
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
        // Stream output to the Build terminal session via broadcast
        const broadcastChunk = (data: string) => {
          this.broadcast?.({ type: 'output', sessionId: 'build', data });
        };

        // Write a command header to the build terminal
        broadcastChunk(`\x1b[36m$ ${command}\x1b[0m\r\n`);

        const execOptions: ExecuteOptions = {
          command,
          cwd: options?.cwd,
          env: options?.env as Record<string, string>,
          timeout: options?.timeout,
          onStdout: (chunk) => {
            broadcastChunk(chunk);
            options?.onStdout?.(chunk);
          },
          onStderr: (chunk) => {
            broadcastChunk(chunk);
            options?.onStderr?.(chunk);
          },
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

  /**
   * Create server-provided utilities exposed as wf.utils in workflow rules.
   * These give rules access to AWS services without needing npm dependencies.
   */
  private createUtils(projectRoot: string): Record<string, unknown> {
    const projectId = this.projectId ?? projectRoot.split('/').pop() ?? 'default';

    // Trace context getter — accesses the runtime's current state.
    // Runtime may not exist yet at createUtils time, so we check at call time.
    const getTraceContext = () => ({
      invocationId: this.runtime?.getCurrentInvocationId?.() ?? null,
      ruleId: this.runtime?.getCurrentRuleId?.() ?? null,
      operationId: this.runtime?.getCurrentOperationId?.() ?? null,
      environment: this.runtime?.getCurrentEnvironment?.() ?? null,
    });

    // AWS utilities (high-level, traced) + escape hatch via aws.sdk.*
    const aws = createAwsUtils({
      projectId,
      region: process.env.AWS_REGION ?? 'us-west-2',
      activityLog: this.activityLog,
      getTraceContext,
    });
    // Traced HTTP client (auto-propagates operationId)
    const http = createHttpUtils({
      projectId,
      activityLog: this.activityLog,
      getTraceContext,
    });

    return {
      aws,
      http,
      /**
       * Upload a file to S3.
       * @param bucket - S3 bucket name
       * @param key - S3 object key
       * @param body - File content (string or Buffer)
       * @param contentType - MIME type (default: application/octet-stream)
       * @param cacheControl - Cache-Control header (default: no-cache)
       */
      s3Upload: async (bucket: string, key: string, body: string | Buffer, contentType?: string, cacheControl?: string) => {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-west-2' });
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType ?? 'application/octet-stream',
          CacheControl: cacheControl ?? 'no-cache',
        }));
      },

      /**
       * Upload all files from a local directory to S3.
       * @param bucket - S3 bucket name
       * @param localDir - Absolute path to local directory
       * @param prefix - S3 key prefix (default: '' = bucket root)
       * @returns Array of uploaded keys
       */
      s3UploadDir: async (bucket: string, localDir: string, prefix = ''): Promise<string[]> => {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { readFileSync, readdirSync, statSync } = await import('node:fs');
        const { resolve, relative } = await import('node:path');
        const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-west-2' });

        const uploaded: string[] = [];
        const uploads: Promise<void>[] = [];

        function mimeType(file: string): string {
          if (file.endsWith('.html')) return 'text/html; charset=utf-8';
          if (file.endsWith('.css')) return 'text/css; charset=utf-8';
          if (file.endsWith('.js') || file.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
          if (file.endsWith('.json')) return 'application/json; charset=utf-8';
          if (file.endsWith('.png')) return 'image/png';
          if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
          if (file.endsWith('.svg')) return 'image/svg+xml';
          if (file.endsWith('.woff2')) return 'font/woff2';
          if (file.endsWith('.woff')) return 'font/woff';
          if (file.endsWith('.ico')) return 'image/x-icon';
          if (file.endsWith('.webp')) return 'image/webp';
          if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
          if (file.endsWith('.xml')) return 'application/xml; charset=utf-8';
          return 'application/octet-stream';
        }

        function walk(dir: string) {
          for (const entry of readdirSync(dir)) {
            const full = resolve(dir, entry);
            if (statSync(full).isDirectory()) {
              walk(full);
            } else {
              const relPath = relative(localDir, full).replace(/\\/g, '/');
              const key = prefix ? `${prefix}/${relPath}` : relPath;
              const body = readFileSync(full);
              uploaded.push(key);
              uploads.push(
                s3.send(new PutObjectCommand({
                  Bucket: bucket,
                  Key: key,
                  Body: body,
                  ContentType: mimeType(relPath),
                  CacheControl: 'no-cache',
                })).then(() => {}).catch(err => {
                  console.error(`[wf.utils.s3UploadDir] Failed to upload ${key}:`, err.message ?? err);
                }),
              );
            }
          }
        }
        walk(localDir);
        // Wait for all uploads to complete before returning
        await Promise.all(uploads);
        return uploaded;
      },

      /**
       * Invalidate CloudFront distribution cache.
       * @param distributionId - CloudFront distribution ID
       * @param paths - Array of paths to invalidate (default: ['/*'])
       */
      cloudfrontInvalidate: async (distributionId: string, paths?: string[]) => {
        const { CloudFrontClient, CreateInvalidationCommand } = await import('@aws-sdk/client-cloudfront');
        const cf = new CloudFrontClient({ region: process.env.AWS_REGION ?? 'us-west-2' });
        await cf.send(new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            CallerReference: Date.now().toString(),
            Paths: {
              Quantity: (paths ?? ['/*']).length,
              Items: paths ?? ['/*'],
            },
          },
        }));
      },

      /**
       * Read a file from the project workspace.
       * @param path - Relative path from project root
       * @returns File content as string
       */
      readFile: async (path: string): Promise<string> => {
        const { readFile } = await import('node:fs/promises');
        const { resolve } = await import('node:path');
        return readFile(resolve(projectRoot, path), 'utf-8');
      },

      /**
       * Read a file from the project workspace as a Buffer.
       * @param path - Relative path from project root
       * @returns File content as Buffer
       */
      readFileBuffer: async (path: string): Promise<Buffer> => {
        const { readFile } = await import('node:fs/promises');
        const { resolve } = await import('node:path');
        return readFile(resolve(projectRoot, path));
      },

      /**
       * Run a headless browser E2E test against a URL.
       *
       * Launches Chromium, navigates to the URL, executes the script in the
       * page context, and returns the result. The script should return a value
       * (passed as the test result) or throw an error (test failure).
       *
       * @param url - URL to navigate to
       * @param script - JavaScript string to execute in the page context via page.evaluate()
       * @param options - Optional: timeout (default 30000ms), waitForSelector (CSS selector to wait for before running script)
       * @returns { success, result?, error?, consoleLogs, durationMs }
       *
       * @example
       * const r = await wf.utils.puppeteerTest('https://my-app.com', `
       *   const h1 = document.querySelector('h1');
       *   if (!h1) throw new Error('No h1 found');
       *   return h1.textContent;
       * `);
       * // r.success === true, r.result === 'My App'
       */
      puppeteerTest: async (
        url: string,
        script: string,
        options?: { timeout?: number; waitForSelector?: string },
      ): Promise<{
        success: boolean;
        result?: unknown;
        error?: string;
        consoleLogs: string[];
        durationMs: number;
      }> => {
        const startTime = Date.now();
        const timeout = options?.timeout ?? 30_000;
        const consoleLogs: string[] = [];

        let puppeteer: typeof import('puppeteer-core');
        try {
          puppeteer = await import('puppeteer-core');
        } catch {
          return {
            success: false,
            error: 'puppeteer-core not installed. Run: npm install puppeteer-core',
            consoleLogs: [],
            durationMs: Date.now() - startTime,
          };
        }

        const { findChromium } = await import('../automation/headless-test-runner.js');
        let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

        try {
          browser = await puppeteer.launch({
            headless: true,
            executablePath: findChromium(),
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
            ],
          });

          const page = await browser.newPage();

          // Capture console output
          page.on('console', (msg) => {
            consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
          });
          page.on('pageerror', (err) => {
            consoleLogs.push(`[pageerror] ${err.message}`);
          });

          // Navigate
          await page.goto(url, { waitUntil: 'networkidle0', timeout });

          // Optionally wait for a selector
          if (options?.waitForSelector) {
            await page.waitForSelector(options.waitForSelector, { timeout });
          }

          // Execute the script in page context
          const scriptFn = new Function(script) as () => unknown;
          const result = await page.evaluate(scriptFn);

          return {
            success: true,
            result,
            consoleLogs,
            durationMs: Date.now() - startTime,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message ?? String(err),
            consoleLogs,
            durationMs: Date.now() - startTime,
          };
        } finally {
          if (browser) {
            await browser.close().catch(() => {});
          }
        }
      },

      /**
       * Register a deployed resource (URL, service endpoint, database, etc.).
       * Resources appear in the Deploy panel with clickable URLs and optional actions.
       *
       * @param name - Human-readable name (e.g., "Production Site", "API Gateway")
       * @param resourceType - Type category (e.g., "website", "api", "database")
       * @param metadata - Arbitrary metadata. Include `url` for a clickable link.
       * @param actions - Optional action buttons (triggers for workflow rules)
       * @returns The registered resource with generated ID
       */
      /**
       * Get a secret value by name (per-project scoped).
       * Secrets are stored in AWS SSM Parameter Store as SecureString.
       * @param name - Secret name (e.g., "api-key", "db-password")
       * @returns The secret value, or null if not found
       */
      getSecret: async (name: string): Promise<string | null> => {
        const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
        const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-west-2' });
        const pid = projectId;
        const paramName = `/antimatter/projects/${pid}/secrets/${name}`;
        try {
          const result = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
          return result.Parameter?.Value ?? null;
        } catch (err: any) {
          if (err.name === 'ParameterNotFound') return null;
          throw err;
        }
      },

      /**
       * Set a secret value by name (per-project scoped).
       * Creates or updates the secret in AWS SSM Parameter Store.
       * Also registers the secret as a deployed resource.
       * @param name - Secret name
       * @param value - Secret value (stored encrypted)
       * @param description - Optional description
       */
      setSecret: async (name: string, value: string, description?: string): Promise<void> => {
        const { SSMClient, PutParameterCommand } = await import('@aws-sdk/client-ssm');
        const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-west-2' });
        const pid = projectId;
        const paramName = `/antimatter/projects/${pid}/secrets/${name}`;
        await ssm.send(new PutParameterCommand({
          Name: paramName,
          Value: value,
          Type: 'SecureString',
          Overwrite: true,
          Description: description,
        }));
        // Register as deployed resource so it appears in the deploy panel
        if (this.deployedResourceStore) {
          const existing = this.deployedResourceStore.get(`secret-${name}`);
          if (existing) {
            await this.deployedResourceStore.update(`secret-${name}`, {
              metadata: { ssmParameter: paramName, hasValue: true },
            });
          } else {
            await this.deployedResourceStore.register({
              name: `Secret: ${name}`,
              resourceType: 'secret',
              description,
              metadata: { ssmParameter: paramName, hasValue: true },
            });
          }
        }
      },

      /**
       * Delete a secret by name (per-project scoped).
       * @param name - Secret name
       */
      deleteSecret: async (name: string): Promise<void> => {
        const { SSMClient, DeleteParameterCommand } = await import('@aws-sdk/client-ssm');
        const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-west-2' });
        const pid = projectId;
        const paramName = `/antimatter/projects/${pid}/secrets/${name}`;
        try {
          await ssm.send(new DeleteParameterCommand({ Name: paramName }));
        } catch (err: any) {
          if (err.name !== 'ParameterNotFound') throw err;
        }
        // Remove from deployed resources
        if (this.deployedResourceStore) {
          await this.deployedResourceStore.deregister(`secret-${name}`);
        }
      },

      registerResource: async (
        name: string,
        resourceType: string,
        metadata?: Record<string, unknown>,
        actions?: { triggerId: string; label: string; icon?: string; enabled?: boolean }[],
      ) => {
        if (!this.deployedResourceStore) {
          console.warn('[wf.utils.registerResource] No deployed resource store available');
          return null;
        }
        return this.deployedResourceStore.register({
          name,
          resourceType,
          metadata,
          actions: actions?.map(a => ({ ...a, enabled: a.enabled ?? true })),
        });
      },
    };
  }
}
