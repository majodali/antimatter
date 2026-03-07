/**
 * Terminal Store — manages WebSocket connection to EC2 workspace
 * instances for interactive terminal sessions.
 *
 * State machine: disconnected → starting → connecting → connected → (error)
 *                                                     → reconnecting (silent, <5s)
 * The store handles instance startup, WebSocket lifecycle, and auto-reconnect.
 * When the workspace reaches RUNNING, activates workspace-aware API routing
 * so all project-scoped calls go through the EC2 instance.
 */

import { create } from 'zustand';
import {
  startWorkspace,
  getWorkspaceStatus,
  stopWorkspace,
  getWorkspaceWsUrl,
  setActiveWorkspace,
} from '@/lib/api';
import { eventLog } from '@/lib/eventLog';
import { useBuildStore } from './buildStore';
import { useFileStore } from './fileStore';
import { useEditorStore } from './editorStore';
import { usePipelineStore } from './pipelineStore';

export type ConnectionState =
  | 'disconnected'
  | 'starting'      // EC2 instance launching
  | 'connecting'    // WebSocket connecting (initial)
  | 'connected'     // Interactive terminal ready
  | 'reconnecting'  // WebSocket reconnecting (brief — silent for <5s)
  | 'error';

interface TerminalStore {
  // Connection state
  connectionState: ConnectionState;
  errorMessage: string | null;
  statusMessage: string | null; // Shown as overlay spinner during startup/reconnect
  showReconnectOverlay: boolean; // True after 5s grace period elapses

  // Instance info (from API)
  sessionToken: string | null;
  instanceId: string | null;
  projectId: string | null;

  // WebSocket
  ws: WebSocket | null;

  // Input buffer — accumulates keystrokes during silent reconnect
  inputBuffer: string[];

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
  stopContainer: (projectId: string) => Promise<void>;

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

// Reconnect with exponential backoff — capped at 5 retries
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]; // exponential backoff
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Silent reconnect grace period — 5 seconds before showing spinner
const RECONNECT_GRACE_MS = 5000;
let graceTimer: ReturnType<typeof setTimeout> | null = null;

// Input buffer cap to prevent overflow during prolonged disconnects
const INPUT_BUFFER_MAX_CHARS = 1000;

// WebSocket keepalive — CloudFront/ALB close idle WebSocket connections.
// Send a ping every 15s and track pong responses to detect dead connections.
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let lastPongTime = 0;
const KEEPALIVE_INTERVAL_MS = 15_000; // 15 seconds — well under CloudFront idle timeout
const PONG_TIMEOUT_MS = 45_000; // 45 seconds without pong = dead connection

function startKeepalive(ws: WebSocket) {
  stopKeepalive();
  lastPongTime = Date.now();
  keepaliveTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;

    // Check for dead connection (no pong received within timeout)
    const elapsed = Date.now() - lastPongTime;
    if (elapsed > PONG_TIMEOUT_MS) {
      console.warn(`[terminal] No pong received for ${Math.round(elapsed / 1000)}s — closing connection`);
      ws.close(4000, 'Keepalive timeout');
      return;
    }

    ws.send(JSON.stringify({ type: 'ping' }));
  }, KEEPALIVE_INTERVAL_MS);
}

function onPongReceived() {
  lastPongTime = Date.now();
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function clearGraceTimer() {
  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
}

/**
 * Connect only the WebSocket (skip EC2 start/poll). Used during reconnects
 * when the instance is already running.
 */
function connectWebSocket(
  projectId: string,
  sessionToken: string,
  set: (partial: Partial<TerminalStore> | ((s: TerminalStore) => Partial<TerminalStore>)) => void,
  get: () => TerminalStore,
): void {
  getWorkspaceWsUrl(projectId, sessionToken).then(wsPath => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}${wsPath}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempt = 0;
      clearGraceTimer();

      // Flush input buffer
      const state = get();
      const buffered = state.inputBuffer;
      set({
        connectionState: 'connected',
        ws,
        errorMessage: null,
        statusMessage: null,
        showReconnectOverlay: false,
        inputBuffer: [],
      });

      // Start keepalive pings
      startKeepalive(ws);

      // Send buffered input
      for (const data of buffered) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }

      // Send a resize event with current terminal dimensions
      const term = (window as any).__terminal;
      if (term && term.cols && term.rows) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (event) => {
      handleWsMessage(event, set);
    };

    ws.onclose = (event) => {
      handleWsClose(event, set, get);
    };

    ws.onerror = () => {
      set({ errorMessage: 'WebSocket connection error' });
    };
  }).catch(err => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[terminal] Failed to get WebSocket URL during reconnect:', msg);
    set({ connectionState: 'error', errorMessage: msg, statusMessage: null, showReconnectOverlay: false });
  });
}

/**
 * Handle incoming WebSocket messages — shared between initial connect and reconnect.
 */
function handleWsMessage(
  event: MessageEvent,
  set: (partial: Partial<TerminalStore> | ((s: TerminalStore) => Partial<TerminalStore>)) => void,
): void {
  try {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'output':
        writeRaw(msg.data);
        break;

      case 'replay':
        // Replay buffer from server for newly connected clients
        if (msg.data) {
          writeRaw(msg.data);
        }
        break;

      case 'pong':
      case 'heartbeat':
        // Server pong or proactive heartbeat — update keepalive tracker
        onPongReceived();
        break;

      case 'status':
        if (msg.state === 'syncing') {
          set({ statusMessage: 'Syncing project files...' });
        } else if (msg.state === 'ready') {
          set({ statusMessage: null });
        } else if (msg.state === 'error') {
          set({ statusMessage: null });
          writeln(`\x1b[31mWorkspace error: ${msg.message ?? 'Unknown'}\x1b[0m`);
        }
        break;

      // Build events from EC2 BuildWatcher → forward to buildStore
      case 'build-started':
        useBuildStore.getState().clearResults();
        break;
      case 'rule-started':
        if (msg.ruleId) {
          useBuildStore.getState().setResult({
            ruleId: msg.ruleId,
            status: 'running',
            startedAt: msg.timestamp || new Date().toISOString(),
            diagnostics: [],
          });
        }
        break;
      case 'rule-output':
        if (msg.ruleId && msg.line) {
          useBuildStore.getState().appendOutput(msg.ruleId, msg.line);
        }
        break;
      case 'rule-completed':
        if (msg.result) {
          useBuildStore.getState().setResult(msg.result);
        }
        break;
      case 'build-complete':
        if (msg.results) {
          useBuildStore.getState().setResults(msg.results);
        }
        break;

      // File change events from workspace FileChangeNotifier
      case 'file-changes':
        if (msg.changes) {
          useFileStore.getState().handleExternalChanges(msg.changes);
          useEditorStore.getState().handleExternalChanges(msg.changes);
        }
        break;

      // Workflow engine events
      case 'workflow-reloaded':
        if (msg.declarations) {
          usePipelineStore.getState().setDeclarations(msg.declarations);
        }
        break;

      case 'workflow-result':
        if (msg.result) {
          usePipelineStore.getState().handleWorkflowResult(msg.result, msg.state);
        }
        break;

      default:
        // Unknown message type — ignore
        break;
    }
  } catch {
    // Non-JSON message — write as raw output
    writeRaw(event.data);
  }
}

/**
 * Handle WebSocket close — shared between initial connect and reconnect.
 */
function handleWsClose(
  event: CloseEvent,
  set: (partial: Partial<TerminalStore> | ((s: TerminalStore) => Partial<TerminalStore>)) => void,
  get: () => TerminalStore,
): void {
  stopKeepalive();
  const state = get();
  set({ ws: null });

  // Don't reconnect if we intentionally disconnected
  if (state.connectionState === 'disconnected') {
    return;
  }

  if (state.projectId && event.code !== 1000) {
    // Unexpected close — attempt reconnect with limit
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      clearGraceTimer();
      set({
        connectionState: 'error',
        errorMessage: 'Connection lost after multiple retries',
        showReconnectOverlay: false,
      });
      eventLog.error(
        'workspace',
        'Terminal connection lost',
        `Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnection attempts. Click Retry to try again.`,
        { toast: true },
      );
      reconnectAttempt = 0;
      return;
    }

    const delay = RECONNECT_DELAYS[reconnectAttempt] ?? 16000;
    reconnectAttempt++;

    // Enter silent reconnecting state — no spinner for 5s
    set({
      connectionState: 'reconnecting',
      errorMessage: null,
      statusMessage: 'Reconnecting...',
      showReconnectOverlay: false,
    });

    // Start 5-second grace timer — if reconnect doesn't complete in 5s, show spinner
    clearGraceTimer();
    graceTimer = setTimeout(() => {
      const s = get();
      if (s.connectionState === 'reconnecting') {
        set({ showReconnectOverlay: true });
        // Log an error for frequency tracking
        eventLog.error(
          'workspace',
          'WebSocket reconnect taking >5s',
          `Reconnect attempt ${reconnectAttempt} exceeded 5s grace period`,
        );
      }
      graceTimer = null;
    }, RECONNECT_GRACE_MS);

    // Attempt reconnect after backoff delay — WebSocket-only (skip EC2 start/poll)
    reconnectTimer = setTimeout(() => {
      const s = get();
      if (s.projectId && s.sessionToken && s.connectionState !== 'disconnected') {
        connectWebSocket(s.projectId, s.sessionToken, set, get);
      }
    }, delay);
  } else {
    set({ connectionState: 'disconnected' });
  }
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
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

  // Legacy
  isRunning: false,
  isExecutingCommand: false,
  commandHistory: [],
  historyIndex: -1,

  /**
   * Connect to a workspace container. Starts the container if needed,
   * waits for it to be RUNNING, then opens a WebSocket.
   */
  connect: async (projectId: string) => {
    const state = get();

    // Already connected to this project
    if (state.connectionState === 'connected' && state.projectId === projectId) {
      return;
    }

    // Disconnect from any existing connection
    if (state.ws) {
      state.ws.close();
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearGraceTimer();
    reconnectAttempt = 0;

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
      // Start the instance (or get existing)
      const info = await startWorkspace(projectId);
      set({ sessionToken: info.sessionToken, instanceId: info.instanceId });

      // Poll until RUNNING
      if (info.status !== 'RUNNING') {
        set({ statusMessage: `Instance ${info.status}, waiting...` });

        let attempts = 0;
        const maxAttempts = 180; // 3 minutes at 1s intervals (EC2 takes longer than Fargate)
        let status = info.status;

        while (status !== 'RUNNING' && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000));
          attempts++;

          try {
            const statusInfo = await getWorkspaceStatus(projectId);
            status = statusInfo.status;

            // Update session token if we got a new one
            if (statusInfo.sessionToken) {
              set({ sessionToken: statusInfo.sessionToken });
            }

            if (attempts % 5 === 0) {
              set({ statusMessage: `Instance ${status} (${attempts}s)` });
            }
          } catch {
            // Ignore transient errors during polling
          }
        }

        if (status !== 'RUNNING') {
          throw new Error(`Instance failed to start (last status: ${status})`);
        }
      }

      // Activate workspace-aware API routing — all project-scoped
      // calls now go through the EC2 instance instead of Lambda
      setActiveWorkspace(projectId);

      set({ connectionState: 'connecting', statusMessage: 'Connecting terminal...' });

      // Connect WebSocket
      const currentState = get();
      const wsPath = await getWorkspaceWsUrl(projectId, currentState.sessionToken!);

      // Build absolute WebSocket URL from the current page origin
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${wsPath}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        reconnectAttempt = 0;
        set({ connectionState: 'connected', ws, errorMessage: null, statusMessage: null, showReconnectOverlay: false });

        // Start keepalive pings to prevent CloudFront 60s idle timeout
        startKeepalive(ws);

        // Send a resize event with current terminal dimensions
        const term = (window as any).__terminal;
        if (term && term.cols && term.rows) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      ws.onmessage = (event) => {
        handleWsMessage(event, set);
      };

      ws.onclose = (event) => {
        handleWsClose(event, set, get);
      };

      ws.onerror = () => {
        // The close handler will fire after this
        set({ errorMessage: 'WebSocket connection error' });
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeln(`\x1b[31mFailed to start workspace: ${msg}\x1b[0m`);
      set({ connectionState: 'error', errorMessage: msg, statusMessage: null });
      eventLog.error('workspace', 'Failed to start workspace', msg, { toast: true });
    }
  },

  /**
   * Disconnect from the current workspace.
   * Does NOT stop the instance — it will auto-shutdown after idle timeout.
   */
  disconnect: () => {
    const { ws } = get();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearGraceTimer();
    stopKeepalive();
    reconnectAttempt = 0;

    if (ws) {
      ws.close(1000, 'User disconnected');
    }

    // Deactivate workspace routing — falls back to Lambda
    setActiveWorkspace(null);

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
    const { ws, connectionState } = get();
    if (ws && connectionState === 'connected') {
      ws.send(JSON.stringify({ type: 'input', data }));
    } else if (connectionState === 'reconnecting') {
      // Buffer input during silent reconnect — capped to prevent overflow
      set((s) => {
        const totalChars = s.inputBuffer.reduce((sum, d) => sum + d.length, 0);
        if (totalChars + data.length <= INPUT_BUFFER_MAX_CHARS) {
          return { inputBuffer: [...s.inputBuffer, data] };
        }
        return {}; // Drop input if buffer is full
      });
    }
  },

  /**
   * Send a resize event to the PTY.
   */
  resize: (cols: number, rows: number) => {
    const { ws, connectionState } = get();
    if (ws && (connectionState === 'connected' || connectionState === 'reconnecting')) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  },

  /**
   * Stop the workspace instance for a project.
   */
  stopContainer: async (projectId: string) => {
    const state = get();
    if (state.ws) {
      state.ws.close(1000, 'Stopping instance');
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearGraceTimer();
    stopKeepalive();

    // Deactivate workspace routing
    setActiveWorkspace(null);

    set({
      connectionState: 'disconnected',
      ws: null,
      errorMessage: null,
      statusMessage: null,
      showReconnectOverlay: false,
      sessionToken: null,
      instanceId: null,
      inputBuffer: [],
    });

    try {
      await stopWorkspace(projectId);
      writeln('\x1b[33mWorkspace instance stopped.\x1b[0m');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeln(`\x1b[31mFailed to stop instance: ${msg}\x1b[0m`);
    }
  },

  // ---- Legacy actions (backward compat during migration) ----

  addLine: (text, _type = 'output') => {
    writeln(text);
  },

  addLines: (lines, _type = 'output') => {
    for (const line of lines) writeln(line);
  },

  clear: () => {
    const term = (window as any).__terminal;
    if (term) term.clear();
  },

  setRunning: (isRunning) => set({ isRunning }),

  setHistoryIndex: (index) => set({ historyIndex: index }),
}));
