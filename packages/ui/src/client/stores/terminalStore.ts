/**
 * Terminal Store — manages terminal UI state and delegates workspace
 * connection lifecycle to the WorkspaceConnection singleton.
 *
 * The store subscribes to WorkspaceConnection for:
 * - State changes (CONNECTED/DISCONNECTED/PENDING → UI overlays)
 * - Terminal-specific messages (output, replay, status)
 * - Build events → buildStore
 * - File changes → fileStore + editorStore
 * - Application state → applicationStore
 * - Automation requests → automationHandler
 */

import { create } from 'zustand';
import { workspaceConnection, type WsConnectionState } from '@/lib/workspace-connection';
import { useBuildStore } from './buildStore';
import { useFileStore } from './fileStore';
import { useEditorStore } from './editorStore';
import { useApplicationStore } from './applicationStore';
import { useProjectStore } from './projectStore';

// ---------------------------------------------------------------------------
// Automation handler — injected by App.tsx when a project loads
// ---------------------------------------------------------------------------

let _automationHandler: { handleMessage(msg: any): void } | null = null;

/** Register (or clear) the browser-side automation handler. */
export function setAutomationHandler(
  handler: { handleMessage(msg: any): void } | null,
): void {
  _automationHandler = handler;
}

export type ConnectionState =
  | 'disconnected'
  | 'starting'      // EC2 instance launching
  | 'connecting'    // WebSocket connecting (initial)
  | 'connected'     // Interactive terminal ready
  | 'reconnecting'  // WebSocket reconnecting (brief — silent for <5s)
  | 'error';

interface TerminalStore {
  // Connection state (derived from WorkspaceConnection + local UI state)
  connectionState: ConnectionState;
  errorMessage: string | null;
  statusMessage: string | null;
  showReconnectOverlay: boolean;

  // Instance info (from WorkspaceConnection)
  sessionToken: string | null;
  instanceId: string | null;
  projectId: string | null;

  // WebSocket (from WorkspaceConnection — for legacy compatibility)
  ws: WebSocket | null;

  // Input buffer — accumulates keystrokes during silent reconnect
  inputBuffer: string[];

  // Terminal sessions
  sessions: { id: string; name: string; running: boolean; virtual: boolean }[];
  activeSessionId: string;

  // Legacy support
  isRunning: boolean;
  isExecutingCommand: boolean;
  commandHistory: string[];
  historyIndex: number;

  // Actions
  connect: (projectId: string) => Promise<void>;
  disconnect: () => void;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  setActiveSession: (sessionId: string) => void;
  createSession: (name?: string) => void;
  closeSession: (sessionId: string) => void;

  // Legacy actions (kept for backward compat during migration)
  addLine: (text: string, type?: string) => void;
  addLines: (lines: string[], type?: string) => void;
  clear: () => void;
  setRunning: (isRunning: boolean) => void;
  setHistoryIndex: (index: number) => void;
}

function writeln(text: string) {
  const term = (window as any).__terminal;
  if (term) term.writeln(text);
}

function writeRaw(data: string) {
  const term = (window as any).__terminal;
  if (term) term.write(data);
}

/**
 * Write data to a session-specific terminal.
 * Uses the terminal pool exposed by XTerm component.
 */
function writeToSession(sessionId: string, data: string) {
  const pool = (window as any).__terminalPool as Map<string, { write: (d: string) => void }> | undefined;
  if (pool) {
    const entry = pool.get(sessionId);
    if (entry) {
      entry.write(data);
      return;
    }
  }
  // Fallback: write to the active terminal (backward compat)
  writeRaw(data);
}

// Silent reconnect grace period — 5 seconds before showing spinner
const RECONNECT_GRACE_MS = 5000;
let graceTimer: ReturnType<typeof setTimeout> | null = null;

// Input buffer cap to prevent overflow during prolonged disconnects
const INPUT_BUFFER_MAX_CHARS = 1000;

function clearGraceTimer() {
  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Map WorkspaceConnection states to terminal UI states
// ---------------------------------------------------------------------------

function mapWsState(wsState: WsConnectionState, currentTermState: ConnectionState): ConnectionState {
  switch (wsState) {
    case 'CONNECTED': return 'connected';
    case 'DISCONNECTED': return 'disconnected';
    case 'PENDING':
      // Distinguish between initial startup and reconnect
      if (currentTermState === 'connected' || currentTermState === 'reconnecting') {
        return 'reconnecting';
      }
      return currentTermState === 'starting' ? 'starting' : 'connecting';
  }
}

// ---------------------------------------------------------------------------
// Message subscription setup (called once at module init)
// ---------------------------------------------------------------------------

let subscriptionsRegistered = false;

function registerMessageSubscriptions(
  set: (partial: Partial<TerminalStore> | ((s: TerminalStore) => Partial<TerminalStore>)) => void,
  get: () => TerminalStore,
): void {
  if (subscriptionsRegistered) return;
  subscriptionsRegistered = true;

  // Terminal output — route to session-specific xterm instance
  workspaceConnection.onMessage((msg) => {
    const sessionId = msg.sessionId || 'main';
    writeToSession(sessionId, msg.data);
  }, { type: 'output' });

  // Replay buffer — route to session-specific xterm instance
  workspaceConnection.onMessage((msg) => {
    if (msg.data) {
      const sessionId = msg.sessionId || 'main';
      writeToSession(sessionId, msg.data);
    }
  }, { type: 'replay' });

  // Terminal session list update
  workspaceConnection.onMessage((msg) => {
    if (msg.sessions) {
      set({ sessions: msg.sessions });
      // Auto-switch to build session when it appears
      const current = get();
      if (!current.sessions.some(s => s.id === 'build') && msg.sessions.some((s: any) => s.id === 'build')) {
        // Build session just appeared — don't auto-switch, let user click
      }
    }
  }, { type: 'terminal.list' });

  // Terminal session created
  workspaceConnection.onMessage((msg) => {
    // Session list update follows via terminal.list broadcast
  }, { type: 'terminal.created' });

  // Terminal session closed
  workspaceConnection.onMessage((msg) => {
    const current = get();
    if (current.activeSessionId === msg.sessionId) {
      set({ activeSessionId: 'main' });
    }
  }, { type: 'terminal.closed' });

  // Workspace status
  workspaceConnection.onMessage((msg) => {
    if (msg.state === 'syncing') {
      set({ statusMessage: 'Syncing project files...' });
    } else if (msg.state === 'ready') {
      set({ statusMessage: null });
    } else if (msg.state === 'error') {
      set({ statusMessage: null });
      writeln(`\x1b[31mWorkspace error: ${msg.message ?? 'Unknown'}\x1b[0m`);
    }
  }, { type: 'status' });

  // Build events → buildStore
  workspaceConnection.onMessage(() => { useBuildStore.getState().clearResults(); }, { type: 'build-started' });
  workspaceConnection.onMessage((msg) => {
    if (msg.ruleId) {
      useBuildStore.getState().setResult({
        ruleId: msg.ruleId,
        status: 'running',
        startedAt: msg.timestamp || new Date().toISOString(),
        diagnostics: [],
      });
    }
  }, { type: 'rule-started' });
  workspaceConnection.onMessage((msg) => {
    if (msg.ruleId && msg.line) useBuildStore.getState().appendOutput(msg.ruleId, msg.line);
  }, { type: 'rule-output' });
  workspaceConnection.onMessage((msg) => {
    if (msg.result) useBuildStore.getState().setResult(msg.result);
  }, { type: 'rule-completed' });
  workspaceConnection.onMessage((msg) => {
    if (msg.results) useBuildStore.getState().setResults(msg.results);
  }, { type: 'build-complete' });

  // File change events → fileStore + editorStore
  workspaceConnection.onMessage((msg) => {
    if (msg.changes) {
      useFileStore.getState().handleExternalChanges(msg.changes);
      useEditorStore.getState().handleExternalChanges(msg.changes);
    }
  }, { type: 'file-changes' });

  // Application state → applicationStore
  workspaceConnection.onMessage((msg) => {
    useApplicationStore.getState().handleStateMessage(msg);
  }, { type: 'application-state' });

  // Automation requests → automationHandler
  workspaceConnection.onMessage((msg) => {
    if (_automationHandler) _automationHandler.handleMessage(msg);
  }, { type: 'automation-request' });

  // Raw (non-JSON) data → terminal output
  workspaceConnection.onRawData((data) => { writeRaw(data); });

  // State changes → update terminal store
  workspaceConnection.onStateChange((wsState) => {
    const current = get();
    const newState = mapWsState(wsState, current.connectionState);

    if (wsState === 'CONNECTED') {
      clearGraceTimer();

      // Flush input buffer
      const buffered = current.inputBuffer;
      set({
        connectionState: 'connected',
        ws: workspaceConnection.getWebSocket(),
        errorMessage: null,
        statusMessage: null,
        showReconnectOverlay: false,
        inputBuffer: [],
        sessionToken: workspaceConnection.sessionToken,
        instanceId: workspaceConnection.instanceId,
      });

      // Send buffered input
      for (const data of buffered) {
        workspaceConnection.send({ type: 'input', data });
      }

      // Send resize event
      const term = (window as any).__terminal;
      if (term && term.cols && term.rows) {
        workspaceConnection.send({ type: 'resize', cols: term.cols, rows: term.rows });
      }

      // Signal that workspace routing is active.
      // FileExplorer gates its initial load on this flag so the tree is
      // fetched from the workspace server, not Lambda/S3.
      useProjectStore.getState().setWorkspaceReady(true);
    } else if (wsState === 'PENDING' && current.connectionState === 'connected') {
      // Transition from connected → reconnecting
      set({
        connectionState: 'reconnecting',
        ws: null,
        errorMessage: null,
        statusMessage: 'Reconnecting...',
        showReconnectOverlay: false,
      });

      // Start grace timer — show overlay after 5s
      clearGraceTimer();
      graceTimer = setTimeout(() => {
        const s = get();
        if (s.connectionState === 'reconnecting') {
          set({ showReconnectOverlay: true });
        }
        graceTimer = null;
      }, RECONNECT_GRACE_MS);
    } else if (wsState === 'DISCONNECTED') {
      clearGraceTimer();
      set({
        connectionState: newState,
        ws: null,
        statusMessage: null,
        showReconnectOverlay: false,
      });
      useProjectStore.getState().setWorkspaceReady(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTerminalStore = create<TerminalStore>((set, get) => {
  // Register message subscriptions (once, at module init)
  registerMessageSubscriptions(set, get);

  return {
    // State
    connectionState: 'disconnected',
    errorMessage: null,
    statusMessage: null,
    showReconnectOverlay: false,
    sessionToken: null,
    instanceId: null,
    projectId: null,
    ws: null,
    inputBuffer: [],
    sessions: [{ id: 'main', name: 'Terminal', running: false, virtual: false }],
    activeSessionId: 'main',

    // Legacy
    isRunning: false,
    isExecutingCommand: false,
    commandHistory: [],
    historyIndex: -1,

    /**
     * Connect to a workspace. Delegates to WorkspaceConnection.
     */
    connect: async (projectId: string) => {
      const state = get();

      // Already connected to this project
      if (state.connectionState === 'connected' && state.projectId === projectId) {
        return;
      }

      set({
        connectionState: 'starting',
        errorMessage: null,
        statusMessage: 'Starting workspace instance...',
        showReconnectOverlay: false,
        projectId,
        sessionToken: null,
        instanceId: null,
        ws: null,
        inputBuffer: [],
      });

      try {
        await workspaceConnection.connect(projectId);
        // State updates happen via onStateChange subscription above
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeln(`\x1b[31mFailed to start workspace: ${msg}\x1b[0m`);
        set({ connectionState: 'error', errorMessage: msg, statusMessage: null });
      }
    },

    /**
     * Disconnect from the current workspace.
     */
    disconnect: () => {
      workspaceConnection.disconnect();
      clearGraceTimer();

      set({
        connectionState: 'disconnected',
        ws: null,
        errorMessage: null,
        statusMessage: null,
        showReconnectOverlay: false,
        inputBuffer: [],
      });
    },

    /**
     * Send keyboard input to the PTY.
     * During reconnecting state, buffers input for replay on reconnect.
     */
    sendInput: (data: string) => {
      const { connectionState, activeSessionId } = get();
      if (connectionState === 'connected') {
        workspaceConnection.send({ type: 'input', sessionId: activeSessionId, data });
      } else if (connectionState === 'reconnecting') {
        set((s) => {
          const totalChars = s.inputBuffer.reduce((sum, d) => sum + d.length, 0);
          if (totalChars + data.length <= INPUT_BUFFER_MAX_CHARS) {
            return { inputBuffer: [...s.inputBuffer, data] };
          }
          return {};
        });
      }
    },

    /**
     * Send a resize event to the active PTY session.
     */
    resize: (cols: number, rows: number) => {
      const { connectionState, activeSessionId } = get();
      if (connectionState === 'connected' || connectionState === 'reconnecting') {
        workspaceConnection.send({ type: 'resize', sessionId: activeSessionId, cols, rows });
      }
    },

    /**
     * Switch the active terminal session.
     */
    setActiveSession: (sessionId: string) => {
      set({ activeSessionId: sessionId });
    },

    /**
     * Create a new terminal session via WebSocket.
     */
    createSession: (name?: string) => {
      const sessionId = `term-${Date.now().toString(36)}`;
      workspaceConnection.send({ type: 'terminal.create', sessionId, name });
      set({ activeSessionId: sessionId });
    },

    /**
     * Close a terminal session via WebSocket.
     */
    closeSession: (sessionId: string) => {
      if (sessionId === 'main') return; // Can't close main
      workspaceConnection.send({ type: 'terminal.close', sessionId });
      const { activeSessionId } = get();
      if (activeSessionId === sessionId) {
        set({ activeSessionId: 'main' });
      }
    },

    // ---- Legacy actions ----

    addLine: (text, _type = 'output') => { writeln(text); },
    addLines: (lines, _type = 'output') => { for (const line of lines) writeln(line); },
    clear: () => { const term = (window as any).__terminal; if (term) term.clear(); },
    setRunning: (isRunning) => set({ isRunning }),
    setHistoryIndex: (index) => set({ historyIndex: index }),
  };
});
