// ============================================================================
// @antimatter/workflow — Core Types
//
// The workflow engine is a stateful, event-driven rule engine for managing
// a project's development process. Projects define their workflow as a TS
// script using these types. The runtime evaluates rules, executes actions,
// persists state, and presents status to the IDE.
// ============================================================================

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------

/**
 * Base event interface. All events have a type and timestamp.
 * Custom events extend this with additional fields.
 */
export interface WorkflowEvent {
  readonly type: string;
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

/** A file was created or modified. */
export interface FileChangeEvent extends WorkflowEvent {
  readonly type: 'file:change';
  readonly path: string;
}

/** A file was deleted. */
export interface FileDeleteEvent extends WorkflowEvent {
  readonly type: 'file:delete';
  readonly path: string;
}

/**
 * First invocation — no persisted workflow state exists.
 * The matching rule should initialize the state object.
 */
export interface ProjectInitializeEvent extends WorkflowEvent {
  readonly type: 'project:initialize';
}

// Custom events: any WorkflowEvent with a project-defined type string.
// Created via wf.emit({ type: 'build:success', ruleId: 'compile' }).

// ----------------------------------------------------------------------------
// Rules
// ----------------------------------------------------------------------------

/**
 * Synchronous predicate — determines if a rule should fire for a given event.
 * Must be pure and fast. Called once per event per rule.
 */
export type WorkflowPredicate = (event: WorkflowEvent) => boolean;

/**
 * Action executed when a rule's predicate matches one or more events.
 *
 * Receives all matching events from the current batch and the mutable
 * workflow state. Can be sync or async — async actions are awaited
 * before the next rule runs.
 *
 * When the rule is declared with a type parameter (e.g. `wf.rule<FileChangeEvent>(...)`),
 * the events array is narrowed to that type.
 *
 * To modify state, mutate the `state` object directly.
 * To run commands, use `wf.exec()` (captured via closure).
 * To trigger other rules, use `wf.emit()` to queue custom events.
 */
export type WorkflowAction<S, E extends WorkflowEvent = WorkflowEvent> = (
  events: E[],
  state: S,
) => void | Promise<void>;

/** Options for wf.rule() declaration. */
export interface RuleOptions {
  /** Override the auto-generated slug. Default: slugify(name). */
  readonly id?: string;
  /** Whether this rule can be run manually from the Build panel. Default: true. */
  readonly manual?: boolean;
}

/** A workflow rule: predicate selects events, action handles them. */
export interface WorkflowRule<S = unknown> {
  readonly id: string;
  readonly name: string;
  readonly predicate: WorkflowPredicate;
  readonly action: WorkflowAction<S, any>;
  readonly manual: boolean;
}

// ----------------------------------------------------------------------------
// Errors — project error types for IDE display
// ----------------------------------------------------------------------------

/**
 * Describes a category of project error — controls display in the IDE.
 * Build scripts use built-in types (ErrorTypes) or define custom ones.
 */
export interface ErrorType {
  /** Human-readable name, e.g. 'SyntaxError', 'BundleError'. */
  readonly name: string;
  /** Lucide icon name for the editor margin glyph and Problems panel. */
  readonly icon: string;
  /** CSS color for icon, badge, and underline. */
  readonly color: string;
  /** Underline style in the editor. */
  readonly highlightStyle: 'squiggly' | 'dotted' | 'solid' | 'double';
}

/** Built-in error types — covers the common cases. Build scripts can define custom ones. */
export const ErrorTypes = {
  SyntaxError:  { name: 'SyntaxError',  icon: 'circle-x',           color: '#ef4444', highlightStyle: 'squiggly' } as ErrorType,
  TypeError:    { name: 'TypeError',    icon: 'circle-alert',       color: '#f97316', highlightStyle: 'squiggly' } as ErrorType,
  TestFailure:  { name: 'TestFailure',  icon: 'test-tube-diagonal', color: '#ef4444', highlightStyle: 'dotted'   } as ErrorType,
  Warning:      { name: 'Warning',      icon: 'triangle-alert',     color: '#eab308', highlightStyle: 'squiggly' } as ErrorType,
  Info:         { name: 'Info',         icon: 'info',               color: '#3b82f6', highlightStyle: 'dotted'   } as ErrorType,
} as const satisfies Record<string, ErrorType>;

/**
 * A project error reported by a build tool, displayed in the IDE.
 *
 * Errors are keyed by (toolId, file) — calling `wf.reportErrors(toolId, errors)`
 * replaces all previous errors from that tool.
 */
export interface ProjectError {
  /** The category of error — controls display (icon, color, underline style). */
  readonly errorType: ErrorType;
  /** Identifier of the tool that reported this error (e.g. 'tsc', 'eslint', 'workflow'). */
  readonly toolId: string;
  /** Workspace-relative file path. */
  readonly file: string;
  /** Short error message. */
  readonly message: string;
  /** Additional details — supports limited HTML for styling and links. Shown on hover / expander. */
  readonly detail?: string;
  /** 1-based line number. */
  readonly line?: number;
  /** 1-based column number. */
  readonly column?: number;
  /** 1-based end line number for range highlighting. */
  readonly endLine?: number;
  /** 1-based end column number for range highlighting. */
  readonly endColumn?: number;
}

// ----------------------------------------------------------------------------
// Command Execution
// ----------------------------------------------------------------------------

/** Options for executing a shell command via `wf.exec()`. */
export interface ExecOptions {
  /** Working directory (relative to project root). */
  readonly cwd?: string;
  /** Additional environment variables. */
  readonly env?: Readonly<Record<string, string>>;
  /** Timeout in milliseconds. */
  readonly timeout?: number;
  /** Called with each chunk of stdout as it arrives. */
  readonly onStdout?: (chunk: string) => void;
  /** Called with each chunk of stderr as it arrives. */
  readonly onStderr?: (chunk: string) => void;
}

/** Result of a completed command execution. */
export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

// ----------------------------------------------------------------------------
// Declarations — metadata about modules, targets, environments
// ----------------------------------------------------------------------------

/** A build module — a unit of code that can be built and tested. */
export interface ModuleDeclaration {
  readonly name: string;
  readonly type: 'frontend' | 'lambda' | 'infrastructure' | 'library';
  readonly build: string;
  readonly test?: string;
  readonly cwd?: string;
  readonly output: string;
  readonly outputType: 'directory' | 'file';
}

/** Configuration for a Lambda deploy target. */
export interface LambdaTargetConfig {
  readonly functionName: string;
  readonly region?: string;
}

/** Configuration for an S3 deploy target. */
export interface S3TargetConfig {
  readonly bucket: string;
  readonly prefix?: string;
  readonly distributionId?: string;
}

/** A deployment target — defines how a module is deployed. */
export interface TargetDeclaration {
  readonly name: string;
  readonly module: string; // references module by name
  readonly type: 'lambda-update' | 's3-upload';
  readonly config: LambdaTargetConfig | S3TargetConfig;
}

/** An action that can be triggered on an environment (build, deploy, destroy, etc.). */
export interface EnvironmentAction {
  /** The workflow event to emit when this action is triggered. */
  readonly event: { type: string; [key: string]: unknown };
  /** Icon hint for the UI: 'build' | 'destroy' | 'pause' | 'play' */
  readonly icon?: string;
}

/** An environment — a deployment context (dev, staging, production). */
export interface EnvironmentDeclaration {
  readonly name: string;
  readonly stackName?: string;
  /** URL for this environment (e.g. 'ide.antimatter.solutions' or 'ide.antimatter.solutions/env/dev'). */
  readonly url?: string;
  /** Actions available for this environment (e.g. build, deploy, destroy). */
  readonly actions?: Readonly<Record<string, EnvironmentAction>>;
}

/** A workflow rule declaration — metadata exposed to the IDE. */
export interface RuleDeclaration {
  readonly id: string;
  readonly name: string;
  readonly manual: boolean;
  /** The source file that declared this rule (e.g. '.antimatter/build.ts'). */
  readonly sourceFile?: string;
}

// ----------------------------------------------------------------------------
// Widgets — UI elements declared by build scripts
// ----------------------------------------------------------------------------

/** Widget types supported by the Build and Deploy panels. */
export type WidgetType = 'button' | 'toggle' | 'status';

/** Visual variant for button/status widgets. */
export type WidgetVariant = 'primary' | 'danger' | 'default';

/** Which IDE panel should render this widget. */
export type WidgetSection = 'build' | 'deploy';

/**
 * A UI widget declared by a build script.
 *
 * Static declaration (serializable) — the shape, label, and event are fixed.
 * Dynamic state (enabled, visible, value) comes from `workflowState._ui[widgetId]`.
 */
export interface WidgetDeclaration {
  readonly id: string;
  readonly type: WidgetType;
  readonly label: string;
  readonly section: WidgetSection;
  /** Lucide icon name (e.g. 'rocket', 'check-circle', 'toggle-left'). */
  readonly icon?: string;
  /** Visual variant for the widget. Default: 'default'. */
  readonly variant?: WidgetVariant;
  /** Event emitted on button click or toggle change. */
  readonly event?: { readonly type: string; readonly [key: string]: unknown };
}

/**
 * Dynamic state for a widget, stored at `workflowState._ui[widgetId]`.
 * Build scripts set these values in rule actions to control widget behavior.
 */
export interface WidgetState {
  /** Whether the widget is interactive. Default: true. */
  readonly enabled?: boolean;
  /** Whether the widget is visible. Default: true. */
  readonly visible?: boolean;
  /** Current value — toggle boolean, status text, etc. */
  readonly value?: unknown;
  /** Override the static label text. */
  readonly label?: string;
  /** Override the static variant. */
  readonly variant?: WidgetVariant;
}

/** All declarations collected from workflow files. */
export interface WorkflowDeclarations {
  readonly modules: readonly ModuleDeclaration[];
  readonly targets: readonly TargetDeclaration[];
  readonly environments: readonly EnvironmentDeclaration[];
  readonly rules: readonly RuleDeclaration[];
  readonly widgets: readonly WidgetDeclaration[];
}

// ----------------------------------------------------------------------------
// Workflow Handle
// ----------------------------------------------------------------------------

/**
 * The workflow handle — passed to the workflow definition function.
 *
 * Used in two phases:
 * 1. **Declaration** — call `wf.rule()` to register rules.
 * 2. **Execution** — actions call `wf.exec()`, `wf.emit()`, etc.
 *    via closure over `wf`.
 *
 * The handle is created by the runtime and scoped to one workflow.
 * Sequential execution is guaranteed — no concurrent invocations.
 */
export interface Workflow<S> {
  // --- Declaration ---

  /**
   * Register a workflow rule.
   *
   * Provide a human-readable name — the system generates a stable slug (id) from it.
   * Override the auto-slug via `options.id` if needed.
   *
   * Optionally provide a type parameter to narrow the events passed to the action:
   *   wf.rule<FileChangeEvent>('Type-check on change', pred, action)
   */
  rule<E extends WorkflowEvent = WorkflowEvent>(
    name: string,
    predicate: WorkflowPredicate,
    action: WorkflowAction<S, E>,
    options?: RuleOptions,
  ): void;

  /** Declare a build module. */
  module(name: string, opts: Omit<ModuleDeclaration, 'name'>): void;

  /** Declare a deployment target. */
  target(name: string, opts: Omit<TargetDeclaration, 'name'>): void;

  /** Declare an environment. */
  environment(name: string, opts: Omit<EnvironmentDeclaration, 'name'>): void;

  /** Declare a UI widget (button, toggle, or status indicator). */
  widget(id: string, opts: Omit<WidgetDeclaration, 'id'>): void;

  // --- Execution utilities (called from within actions) ---

  /** Execute a shell command. Resolves when the command completes. */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  /**
   * Emit a custom event. The event is queued and processed in the
   * current WorkflowInvocation after the current event batch completes.
   * The runtime adds the `timestamp` field automatically.
   */
  emit(event: { type: string; [key: string]: unknown }): void;

  /**
   * Log a structured message visible in the IDE's build panel.
   * The runtime captures these for display.
   */
  log(message: string, level?: 'info' | 'warn' | 'error'): void;

  /**
   * Report errors from a tool. Replaces all previous errors from this toolId.
   * Errors are persisted server-side and broadcast to all connected IDE clients.
   *
   * Pass an empty array to clear previous errors from this tool.
   */
  reportErrors(toolId: string, errors: ProjectError[]): void;
}

// ----------------------------------------------------------------------------
// Workflow Definition
// ----------------------------------------------------------------------------

/**
 * Workflow definition function. Receives the workflow handle for
 * declaring rules and accessing runtime utilities.
 *
 * The default export of a project's workflow script (e.g. `.antimatter/workflow.ts`).
 */
export type WorkflowDefinition<S> = (wf: Workflow<S>) => void;

/**
 * Entry point for workflow scripts. Wraps the definition function
 * for the runtime to discover and invoke.
 *
 * @example
 * ```typescript
 * import { defineWorkflow, type FileChangeEvent } from '@antimatter/workflow';
 *
 * interface MyState {
 *   compile: { status: string; lastRun?: string };
 *   deploy: { envId?: string; url?: string };
 * }
 *
 * export default defineWorkflow<MyState>((wf) => {
 *   wf.rule('Initialize workflow state',
 *     (e) => e.type === 'project:initialize',
 *     (_events, state) => {
 *       state.compile = { status: 'pending' };
 *       state.deploy = {};
 *     },
 *   );
 *
 *   // Type parameter narrows events to FileChangeEvent[]
 *   wf.rule<FileChangeEvent>('Compile TypeScript sources',
 *     (e) => e.type === 'file:change' && String(e.path).endsWith('.ts'),
 *     async (events, state) => {
 *       const result = await wf.exec('tsc --build');
 *       state.compile.status = result.exitCode === 0 ? 'success' : 'failed';
 *       state.compile.lastRun = new Date().toISOString();
 *       if (result.exitCode === 0) {
 *         wf.emit({ type: 'compile:success' });
 *       }
 *     },
 *   );
 *
 *   wf.rule('Run tests after successful compile',
 *     (e) => e.type === 'compile:success',
 *     async (_events, state) => {
 *       const result = await wf.exec('vitest run');
 *       wf.log(`Tests ${result.exitCode === 0 ? 'passed' : 'failed'}`);
 *     },
 *   );
 * });
 * ```
 */
export function defineWorkflow<S>(
  definition: WorkflowDefinition<S>,
): WorkflowDefinition<S> {
  // Identity function — the runtime calls the definition directly.
  // This exists for type inference and as a documentation marker.
  return definition;
}

// ----------------------------------------------------------------------------
// Runtime Types (used by the runtime, not by workflow scripts)
// ----------------------------------------------------------------------------

/** Configuration for the workflow runtime. */
export interface WorkflowRuntimeConfig {
  /** Maximum event processing cycles per invocation (loop detection). Default: 10. */
  readonly maxCycles?: number;
  /** Debounce window in ms for batching file events. Default: 300. */
  readonly debounceMs?: number;
  /** Callback invoked when a rule calls wf.reportErrors(). */
  readonly onReportErrors?: (toolId: string, errors: ProjectError[]) => void;
  /** Absolute path to the project workspace root. Available as wf.projectRoot in rules. */
  readonly projectRoot?: string;
  /** Server-provided utilities exposed as wf.utils in rules. */
  readonly utils?: Record<string, unknown>;
}

/** A log message captured during workflow execution. */
export interface WorkflowLogEntry {
  readonly message: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly timestamp: string;
}

/**
 * Snapshot of a completed WorkflowInvocation — for diagnostics and display.
 * The runtime produces one of these each time it processes events.
 */
export interface WorkflowInvocationResult {
  /** Events that triggered this invocation. */
  readonly triggerEvents: readonly WorkflowEvent[];
  /** Rules that fired, in execution order. */
  readonly rulesExecuted: readonly {
    readonly ruleId: string;
    readonly matchedEvents: number;
    readonly durationMs: number;
    readonly error?: string;
  }[];
  /** Custom events emitted during execution. */
  readonly emittedEvents: readonly WorkflowEvent[];
  /** Log messages emitted during execution. */
  readonly logs: readonly WorkflowLogEntry[];
  /** Total duration of the invocation. */
  readonly durationMs: number;
  /** Number of event processing cycles (>1 means custom events triggered more rules). */
  readonly cycles: number;
}

/**
 * Persisted workflow state envelope. The runtime wraps the script's
 * state object with metadata for lifecycle management.
 */
/** Persisted per-rule execution state for display in the IDE. */
export interface PersistedRuleResult {
  readonly status: 'success' | 'failed';
  readonly lastRunAt: string;
  readonly durationMs?: number;
  readonly error?: string;
}

export interface PersistedWorkflowState<S = unknown> {
  readonly version: number;
  readonly state: S;
  readonly lastInvocation?: WorkflowInvocationResult;
  readonly updatedAt: string;
  /** Maps source file paths to the element IDs declared in that file. */
  readonly fileDeclarations?: Readonly<Record<string, readonly string[]>>;
  /** Maps workspace file paths to content hashes for startup diff detection. */
  readonly fileManifest?: Readonly<Record<string, string>>;
  /** Accumulated rule execution results — persisted across invocations. */
  readonly ruleResults?: Readonly<Record<string, PersistedRuleResult>>;
  /** Sequence number of the last event processed from the EventLog. */
  readonly lastProcessedSeq?: number;
}

// ---------------------------------------------------------------------------
// Event Log types — persistent, ordered event sourcing
// ---------------------------------------------------------------------------

/** Source of an event entering the log. */
export type EventSource = 'watcher' | 'rest-api' | 'workflow-emit' | 'startup';

/**
 * A single entry in the append-only event log.
 * Events are assigned monotonic sequence numbers and persisted to JSONL.
 */
export interface EventLogEntry {
  /** Monotonically increasing sequence number, assigned by the log. */
  readonly seq: number;
  /** ISO 8601 timestamp of when the event was appended to the log. */
  readonly loggedAt: string;
  /** Source of the event. */
  readonly source: EventSource;
  /**
   * Deduplication key — derived from (type + path) for file events.
   * Null for non-file events (custom workflow events, project:initialize).
   * Events with the same dedupeKey within a time window are dropped.
   */
  readonly dedupeKey: string | null;
  /** The actual workflow event payload. */
  readonly event: WorkflowEvent;
}

/**
 * Complete application state — identical on server and client.
 * Sent as full snapshot on WebSocket connect, then partial patches on mutations.
 */
export interface ApplicationState {
  readonly version: 1;
  readonly declarations: WorkflowDeclarations;
  readonly workflowState: unknown;
  readonly ruleResults: Readonly<Record<string, PersistedRuleResult>>;
  readonly errors: readonly ProjectError[];
  readonly lastInvocation: WorkflowInvocationResult | null;
  readonly loadedFiles: readonly string[];
  readonly updatedAt: string;
}
