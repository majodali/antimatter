// ============================================================================
// WorkflowRuntime — Event-driven rule engine
//
// Loads a workflow definition, collects rules, then processes events against
// the current state. Rules fire in declaration order. Emitted events trigger
// additional cycles until the queue drains or the cycle limit is reached.
// ============================================================================

import type {
  ExecOptions,
  ExecResult,
  ModuleDeclaration,
  TargetDeclaration,
  EnvironmentDeclaration,
  WorkflowDeclarations,
  Workflow,
  WorkflowAction,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowInvocationResult,
  WorkflowLogEntry,
  WorkflowRuntimeConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a URL-safe slug from a human-readable name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/** Options for constructing a WorkflowRuntime. */
export interface WorkflowRuntimeOptions {
  /** How to execute shell commands invoked by `wf.exec()`. */
  readonly executor: (command: string, options?: ExecOptions) => Promise<ExecResult>;
  /** Runtime configuration (cycle limits, debounce, etc.). */
  readonly config?: WorkflowRuntimeConfig;
}

/**
 * The workflow runtime. Constructed with a workflow definition and an
 * executor for shell commands. Stateless — receives current state and
 * returns new state after processing events.
 *
 * Usage:
 * ```typescript
 * const runtime = new WorkflowRuntime(definition, { executor });
 * const { state, result } = await runtime.processEvents(events, currentState);
 * ```
 */
export class WorkflowRuntime<S> {
  private rules: RegisteredRule<S>[] = [];
  private readonly executor: WorkflowRuntimeOptions['executor'];
  private readonly maxCycles: number;

  // Declarations — collected during definition phase.
  private readonly _modules = new Map<string, ModuleDeclaration>();
  private readonly _targets = new Map<string, TargetDeclaration>();
  private readonly _environments = new Map<string, EnvironmentDeclaration>();

  // Source file tracking — which file declared each element.
  private _currentSourceFile: string | null = null;
  private readonly _fileDeclarations = new Map<string, string[]>(); // filePath → elementIds

  // Mutable execution context — set during processEvents, null otherwise.
  private emitQueue: WorkflowEvent[] | null = null;
  private logs: WorkflowLogEntry[] = [];

  // The single handle object that actions close over.
  private readonly handle: Workflow<S>;

  constructor(
    definition: WorkflowDefinition<S>,
    options: WorkflowRuntimeOptions,
  ) {
    this.executor = options.executor;
    this.maxCycles = options.config?.maxCycles ?? 10;

    // Build the handle — a single object captured by all action closures.
    // rule() collects rules; module/target/environment collect declarations;
    // exec/emit/log delegate to runtime state.
    this.handle = {
      rule: (name, predicate, action, options) => {
        const id = options?.id ?? slugify(name);
        const manual = options?.manual !== false;
        this.rules.push({ id, name, predicate, action: action as WorkflowAction<S, any>, manual, sourceFile: this._currentSourceFile ?? undefined });
        this.trackDeclaration(id);
      },
      module: (name, opts) => {
        this._modules.set(name, { name, ...opts });
        this.trackDeclaration(name);
      },
      target: (name, opts) => {
        this._targets.set(name, { name, ...opts });
        this.trackDeclaration(name);
      },
      environment: (name, opts) => {
        this._environments.set(name, { name, ...opts });
        this.trackDeclaration(name);
      },
      exec: (command, opts) => {
        return this.executor(command, opts);
      },
      emit: (event) => {
        if (!this.emitQueue) {
          throw new Error('emit() can only be called during action execution');
        }
        this.emitQueue.push({ ...event, timestamp: new Date().toISOString() });
      },
      log: (message, level) => {
        this.logs.push({ message, level: level ?? 'info', timestamp: new Date().toISOString() });
      },
    };

    // Call the definition function to register rules.
    definition(this.handle);
  }

  /** The registered rules, in declaration order. */
  get ruleCount(): number {
    return this.rules.length;
  }

  /** All declarations collected from the workflow definition. */
  get declarations(): WorkflowDeclarations {
    return {
      modules: Array.from(this._modules.values()),
      targets: Array.from(this._targets.values()),
      environments: Array.from(this._environments.values()),
      rules: this.rules.map(r => ({ id: r.id, name: r.name, manual: r.manual, sourceFile: r.sourceFile })),
    };
  }

  /** The file→elementId tracking map (for persistence). */
  get fileDeclarations(): ReadonlyMap<string, readonly string[]> {
    return this._fileDeclarations;
  }

  /** Get the workflow handle for running additional definitions. */
  getHandle(): Workflow<S> {
    return this.handle;
  }

  // ---- Source file tracking ----

  /**
   * Set the current source file context. All declarations registered
   * while this is set will be tagged with this file path.
   */
  setSourceFile(file: string | null): void {
    this._currentSourceFile = file;
  }

  /** Track an element ID under the current source file. */
  private trackDeclaration(id: string): void {
    if (!this._currentSourceFile) return;
    const list = this._fileDeclarations.get(this._currentSourceFile);
    if (list) {
      list.push(id);
    } else {
      this._fileDeclarations.set(this._currentSourceFile, [id]);
    }
  }

  /**
   * Remove all declarations (rules, modules, targets, environments)
   * that were registered from a specific source file.
   */
  removeDeclarationsFromFile(filePath: string): void {
    const ids = this._fileDeclarations.get(filePath);
    if (!ids) return;

    const idSet = new Set(ids);
    this.rules = this.rules.filter(r => !idSet.has(r.id));
    for (const id of ids) {
      this._modules.delete(id);
      this._targets.delete(id);
      this._environments.delete(id);
    }
    this._fileDeclarations.delete(filePath);
  }

  /**
   * Restore the file→declaration map from persisted state.
   * Called during startup to re-establish tracking without re-running definitions.
   */
  restoreFileDeclarations(map: Record<string, readonly string[]>): void {
    this._fileDeclarations.clear();
    for (const [file, ids] of Object.entries(map)) {
      this._fileDeclarations.set(file, [...ids]);
    }
  }

  // ---- Event processing ----

  /**
   * Process a batch of events against the current state.
   *
   * Returns the mutated state and an invocation result snapshot.
   * The input state is deep-cloned — the caller's copy is not modified.
   *
   * Execution:
   * 1. Clone the state.
   * 2. For each rule in declaration order, filter events by predicate.
   *    If any match, call the action with matched events and mutable state.
   * 3. Collect emitted events; they become the next cycle's input.
   * 4. Repeat until no events are emitted or maxCycles is reached.
   */
  async processEvents(
    events: readonly WorkflowEvent[],
    currentState: S,
  ): Promise<{ state: S; result: WorkflowInvocationResult }> {
    const startTime = Date.now();
    const state = structuredClone(currentState);

    const allRulesExecuted: WorkflowInvocationResult['rulesExecuted'][number][] = [];
    const allEmittedEvents: WorkflowEvent[] = [];
    this.logs = [];

    let pendingEvents: readonly WorkflowEvent[] = events;
    let cycles = 0;

    while (pendingEvents.length > 0 && cycles < this.maxCycles) {
      cycles++;

      // Set up the emit queue for this cycle.
      this.emitQueue = [];

      for (const rule of this.rules) {
        const matched = pendingEvents.filter(e => rule.predicate(e));
        if (matched.length === 0) continue;

        const ruleStart = Date.now();
        let error: string | undefined;

        try {
          await rule.action(matched, state);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }

        allRulesExecuted.push({
          ruleId: rule.id,
          matchedEvents: matched.length,
          durationMs: Date.now() - ruleStart,
          error,
        });
      }

      // Emitted events become the next cycle's input.
      allEmittedEvents.push(...this.emitQueue);
      pendingEvents = this.emitQueue;
      this.emitQueue = null;
    }

    return {
      state,
      result: {
        triggerEvents: events,
        rulesExecuted: allRulesExecuted,
        emittedEvents: allEmittedEvents,
        logs: this.logs,
        durationMs: Date.now() - startTime,
        cycles,
      },
    };
  }

  /**
   * Run a specific rule by ID, skipping its predicate.
   * The action is invoked with an empty event array.
   * Any events emitted by the action are processed through subsequent cycles.
   */
  async runRule(
    ruleId: string,
    currentState: S,
  ): Promise<{ state: S; result: WorkflowInvocationResult }> {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    const startTime = Date.now();
    const state = structuredClone(currentState);
    this.logs = [];

    const allRulesExecuted: WorkflowInvocationResult['rulesExecuted'][number][] = [];
    const allEmittedEvents: WorkflowEvent[] = [];

    // Cycle 1: run the target rule with empty events (predicate skipped).
    this.emitQueue = [];
    const ruleStart = Date.now();
    let error: string | undefined;

    try {
      await rule.action([], state);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    allRulesExecuted.push({
      ruleId: rule.id,
      matchedEvents: 0,
      durationMs: Date.now() - ruleStart,
      error,
    });

    // Collect emitted events from the target rule.
    allEmittedEvents.push(...this.emitQueue);
    let pendingEvents: readonly WorkflowEvent[] = this.emitQueue;
    this.emitQueue = null;

    // Subsequent cycles: process emitted events through normal predicate matching.
    let cycles = 1;
    while (pendingEvents.length > 0 && cycles < this.maxCycles) {
      cycles++;
      this.emitQueue = [];

      for (const r of this.rules) {
        const matched = pendingEvents.filter(e => r.predicate(e));
        if (matched.length === 0) continue;

        const rStart = Date.now();
        let rError: string | undefined;

        try {
          await r.action(matched, state);
        } catch (e) {
          rError = e instanceof Error ? e.message : String(e);
        }

        allRulesExecuted.push({
          ruleId: r.id,
          matchedEvents: matched.length,
          durationMs: Date.now() - rStart,
          error: rError,
        });
      }

      allEmittedEvents.push(...this.emitQueue);
      pendingEvents = this.emitQueue;
      this.emitQueue = null;
    }

    const triggerEvent: WorkflowEvent = {
      type: 'rule:refresh',
      ruleId,
      timestamp: new Date().toISOString(),
    };

    return {
      state,
      result: {
        triggerEvents: [triggerEvent],
        rulesExecuted: allRulesExecuted,
        emittedEvents: allEmittedEvents,
        logs: this.logs,
        durationMs: Date.now() - startTime,
        cycles,
      },
    };
  }
}

// ----------------------------------------------------------------------------
// Internal types
// ----------------------------------------------------------------------------

interface RegisteredRule<S> {
  readonly id: string;
  readonly name: string;
  readonly predicate: (event: WorkflowEvent) => boolean;
  readonly action: WorkflowAction<S, any>;
  readonly manual: boolean;
  readonly sourceFile?: string;
}
