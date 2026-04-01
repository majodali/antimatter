/**
 * Automation API — shared type definitions.
 *
 * Defines the command protocol for the IDE automation endpoint.
 * Used by both the workspace server (command routing, WebSocket relay)
 * and the browser (automation handler).
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type AutomationErrorCode =
  | 'not-found'
  | 'invalid-params'
  | 'timeout'
  | 'no-browser'
  | 'unsupported'
  | 'execution-error';

// ---------------------------------------------------------------------------
// REST request / response envelopes
// ---------------------------------------------------------------------------

export interface AutomationRequest {
  readonly command: string;
  readonly params?: Record<string, unknown>;
  readonly requestId?: string;
}

export interface AutomationResponse<T = unknown> {
  readonly ok: boolean;
  readonly requestId: string;
  readonly command: string;
  readonly data?: T;
  readonly error?: {
    readonly code: AutomationErrorCode;
    readonly message: string;
  };
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// WebSocket relay messages
// ---------------------------------------------------------------------------

/** Server → Browser: execute a command in the browser context. */
export interface AutomationWsRequest {
  readonly type: 'automation-request';
  readonly requestId: string;
  readonly command: string;
  readonly params?: Record<string, unknown>;
}

/** Browser → Server: result of a browser command execution. */
export interface AutomationWsResponse {
  readonly type: 'automation-response';
  readonly requestId: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: {
    readonly code: AutomationErrorCode;
    readonly message: string;
  };
}

// ---------------------------------------------------------------------------
// Command catalog
// ---------------------------------------------------------------------------

export type CommandExecution = 'server' | 'browser';

export interface CommandDefinition {
  readonly command: string;
  readonly execution: CommandExecution;
  readonly description: string;
}

/** All registered automation commands. */
export const COMMAND_CATALOG: readonly CommandDefinition[] = [
  // File operations
  { command: 'file.read', execution: 'server', description: 'Read file contents' },
  { command: 'file.write', execution: 'server', description: 'Write file contents' },
  { command: 'file.delete', execution: 'server', description: 'Delete a file' },
  { command: 'file.mkdir', execution: 'server', description: 'Create directory' },
  { command: 'file.tree', execution: 'server', description: 'Get file tree' },

  // Git operations
  { command: 'git.status', execution: 'server', description: 'Get git status' },
  { command: 'git.stage', execution: 'server', description: 'Stage files for commit' },
  { command: 'git.unstage', execution: 'server', description: 'Unstage files' },
  { command: 'git.commit', execution: 'server', description: 'Create a commit' },
  { command: 'git.push', execution: 'server', description: 'Push to remote' },
  { command: 'git.pull', execution: 'server', description: 'Pull from remote' },

  // Build
  { command: 'build.run', execution: 'server', description: 'Execute build' },

  // Annotations
  { command: 'files.annotate', execution: 'server', description: 'Set file annotations (errors, warnings, etc.)' },
  { command: 'files.clearAnnotations', execution: 'server', description: 'Clear file annotations by source and/or path' },
  { command: 'files.annotations', execution: 'server', description: 'Query file annotations with optional filters' },

  // Project tests
  { command: 'tests.discover-project', execution: 'server', description: 'Discover project tests via vitest/jest' },
  { command: 'tests.run-project', execution: 'server', description: 'Run project tests and return JSON results' },
  { command: 'tests.project-results', execution: 'server', description: 'Get persisted project test results' },

  // Terminal sessions
  { command: 'terminal.list', execution: 'server', description: 'List terminal sessions' },
  { command: 'terminal.create', execution: 'server', description: 'Create a new terminal session' },
  { command: 'terminal.close', execution: 'server', description: 'Close a terminal session' },
  { command: 'terminal.send', execution: 'server', description: 'Send input to a terminal session' },

  // Workflow / errors
  { command: 'workflow.state', execution: 'server', description: 'Get workflow state' },
  { command: 'workflow.errors', execution: 'server', description: 'Get project errors' },
  { command: 'workflow.emit', execution: 'server', description: 'Emit workflow event' },

  // Editor (browser-only — requires Zustand stores)
  { command: 'editor.open', execution: 'browser', description: 'Open file in editor' },
  { command: 'editor.active', execution: 'browser', description: 'Get active editor tab path' },
  { command: 'editor.tabs', execution: 'browser', description: 'List open editor tabs' },
  { command: 'editor.close', execution: 'browser', description: 'Close an editor tab' },

  // Tests — fixture-based routing (browser=orchestrator tab, headless=server Puppeteer)
  { command: 'tests.run', execution: 'browser', description: 'Run functional tests (fixture: browser|headless)' },
  { command: 'tests.list', execution: 'browser', description: 'List available test modules' },
  { command: 'tests.results', execution: 'browser', description: 'Get latest test results' },

  // Client lifecycle & inspection
  { command: 'client.refresh', execution: 'browser', description: 'Hard-refresh the browser (reload from server)' },
  { command: 'client.navigate', execution: 'browser', description: 'Navigate to a URL or IDE view' },
  { command: 'client.state', execution: 'browser', description: 'Get comprehensive UI state snapshot (editor, files, problems, workflow, git, tests, terminal)' },

  // Meta
  { command: 'commands.list', execution: 'server', description: 'List all available commands' },
] as const;

// ---------------------------------------------------------------------------
// Per-command timeout overrides (milliseconds)
// ---------------------------------------------------------------------------

export const COMMAND_TIMEOUTS: Record<string, number> = {
  'tests.run': 300_000,    // 5 minutes — tests can be slow
  'build.run': 120_000,    // 2 minutes
  'git.push': 60_000,      // 1 minute
  'git.pull': 60_000,      // 1 minute
};

export const DEFAULT_COMMAND_TIMEOUT = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const serverCommands = new Set(
  COMMAND_CATALOG.filter(c => c.execution === 'server').map(c => c.command),
);

/** Returns true if the command executes on the server (not relayed to browser). */
export function isServerCommand(command: string): boolean {
  return serverCommands.has(command);
}

/** Generate a unique request ID for correlation. */
export function generateRequestId(): string {
  return `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
