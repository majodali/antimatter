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
  private readonly rules: RegisteredRule<S>[] = [];
  private readonly executor: WorkflowRuntimeOptions['executor'];
  private readonly maxCycles: number;

  // Declarations — collected during definition phase.
  private readonly _modules = new Map<string, ModuleDeclaration>();
  private readonly _targets = new Map<string, TargetDeclaration>();
  private readonly _environments = new Map<string, EnvironmentDeclaration>();

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
      rule: (id, description, predicate, action) => {
        this.rules.push({ id, description, predicate, action: action as WorkflowAction<S, any> });
      },
      module: (name, opts) => {
        this._modules.set(name, { name, ...opts });
      },
      target: (name, opts) => {
        this._targets.set(name, { name, ...opts });
      },
      environment: (name, opts) => {
        this._environments.set(name, { name, ...opts });
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
    };
  }

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
}

// ----------------------------------------------------------------------------
// Internal types
// ----------------------------------------------------------------------------

interface RegisteredRule<S> {
  readonly id: string;
  readonly description: string;
  readonly predicate: (event: WorkflowEvent) => boolean;
  readonly action: WorkflowAction<S, any>;
}
