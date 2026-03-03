/**
 * Terminal Store — manages WebSocket connection to EC2 workspace
 * instances for interactive terminal sessions.
 *
 * State machine: disconnected → starting → connecting → connected → (error)
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
  executeProjectCommand,
} from '@/lib/api';
import { useBuildStore } from './buildStore';

export type ConnectionState =
  | 'disconnected'
  | 'starting'    // EC2 instance launching
  | 'connecting'  // WebSocket connecting
  | 'connected'   // Interactive terminal ready
  | 'error';

interface TerminalStore {
  // Connection state
  connectionState: ConnectionState;
  errorMessage: string | null;

  // Instance info (from API)
  sessionToken: string | null;
  instanceId: string | null;
  projectId: string | null;

  // WebSocket
  ws: WebSocket | null;

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
  executeCommand: (projectId: string, command: string) => Promise<void>;
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

// Reconnect with exponential backoff
const MAX_RECONNECT_DELAY = 30000;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// WebSocket keepalive — CloudFront closes idle WebSocket connections after 60s.
// Send a ping every 30s to keep the connection alive.
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function startKeepalive(ws: WebSocket) {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  // State
  connectionState: 'disconnected',
  errorMessage: null,
  sessionToken: null,
  instanceId: null,
  projectId: null,
  ws: null,

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
    reconnectAttempt = 0;

    set({
      connectionState: 'starting',
      errorMessage: null,
      projectId,
      sessionToken: null,
      instanceId: null,
      ws: null,
    });

    writeln('\x1b[36mStarting workspace instance...\x1b[0m');

    try {
      // Start the instance (or get existing)
      const info = await startWorkspace(projectId);
      set({ sessionToken: info.sessionToken, instanceId: info.instanceId });

      // Poll until RUNNING
      if (info.status !== 'RUNNING') {
        writeln(`\x1b[36mInstance status: ${info.status}, waiting...\x1b[0m`);

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
              writeln(`\x1b[36mInstance status: ${status} (${attempts}s)\x1b[0m`);
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

      writeln('\x1b[32mInstance running, connecting terminal...\x1b[0m');
      set({ connectionState: 'connecting' });

      // Connect WebSocket
      const currentState = get();
      const wsPath = await getWorkspaceWsUrl(projectId, currentState.sessionToken!);

      // Build absolute WebSocket URL from the current page origin
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${wsPath}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        reconnectAttempt = 0;
        set({ connectionState: 'connected', ws, errorMessage: null });
        writeln('\x1b[32mTerminal connected.\x1b[0m');
        writeln('');

        // Start keepalive pings to prevent CloudFront 60s idle timeout
        startKeepalive(ws);

        // Send a resize event with current terminal dimensions
        const term = (window as any).__terminal;
        if (term && term.cols && term.rows) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      ws.onmessage = (event) => {
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

            case 'status':
              if (msg.state === 'syncing') {
                writeln('\x1b[36mSyncing project files from S3...\x1b[0m');
              } else if (msg.state === 'ready') {
                writeln('\x1b[32mWorkspace ready.\x1b[0m');
              } else if (msg.state === 'error') {
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

            default:
              // Unknown message type — ignore
              break;
          }
        } catch {
          // Non-JSON message — write as raw output
          writeRaw(event.data);
        }
      };

      ws.onclose = (event) => {
        stopKeepalive();
        const state = get();
        set({ ws: null });

        // Don't reconnect if we intentionally disconnected
        if (state.connectionState === 'disconnected') {
          return;
        }

        writeln(`\x1b[33mTerminal disconnected (code ${event.code})\x1b[0m`);

        if (state.projectId && event.code !== 1000) {
          // Unexpected close — attempt reconnect
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
          reconnectAttempt++;
          writeln(`\x1b[36mReconnecting in ${(delay / 1000).toFixed(0)}s...\x1b[0m`);

          set({ connectionState: 'connecting', errorMessage: null });

          reconnectTimer = setTimeout(() => {
            const s = get();
            if (s.projectId && s.connectionState !== 'disconnected') {
              s.connect(s.projectId);
            }
          }, delay);
        } else {
          set({ connectionState: 'disconnected' });
        }
      };

      ws.onerror = () => {
        // The close handler will fire after this
        set({ errorMessage: 'WebSocket connection error' });
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeln(`\x1b[31mFailed to start workspace: ${msg}\x1b[0m`);
      set({ connectionState: 'error', errorMessage: msg });
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
    });
  },

  /**
   * Send keyboard input to the PTY.
   */
  sendInput: (data: string) => {
    const { ws, connectionState } = get();
    if (ws && connectionState === 'connected') {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  },

  /**
   * Send a resize event to the PTY.
   */
  resize: (cols: number, rows: number) => {
    const { ws, connectionState } = get();
    if (ws && connectionState === 'connected') {
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
    stopKeepalive();

    // Deactivate workspace routing
    setActiveWorkspace(null);

    set({
      connectionState: 'disconnected',
      ws: null,
      errorMessage: null,
      sessionToken: null,
      instanceId: null,
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

  /**
   * Legacy command execution — falls back to HTTP /exec when no WebSocket.
   * When connected via WebSocket, types the command into the PTY instead.
   */
  executeCommand: async (projectId: string, command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    const state = get();

    set((s) => ({
      isExecutingCommand: true,
      commandHistory: [...s.commandHistory, trimmed],
      historyIndex: -1,
    }));

    if (state.connectionState === 'connected' && state.ws) {
      // Send through the interactive terminal
      state.ws.send(JSON.stringify({ type: 'input', data: trimmed + '\n' }));
      // We don't know when the command finishes in PTY mode, so just clear the flag
      set({ isExecutingCommand: false });
    } else {
      // Fall back to HTTP execution
      writeln(`\x1b[1;32m$\x1b[0m ${trimmed}`);

      try {
        const result = await executeProjectCommand(projectId, trimmed);
        if (result.stdout) {
          for (const line of result.stdout.split('\n')) writeln(line);
        }
        if (result.stderr) {
          for (const line of result.stderr.split('\n')) {
            if (line) writeln(`\x1b[31m${line}\x1b[0m`);
          }
        }
        const seconds = (result.durationMs / 1000).toFixed(1);
        if (result.exitCode === 0) {
          writeln(`\x1b[32m\u2713 exit 0, ${seconds}s\x1b[0m`);
        } else {
          writeln(`\x1b[31m\u2717 exit ${result.exitCode}, ${seconds}s\x1b[0m`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeln(`\x1b[31m\u2717 ${msg}\x1b[0m`);
      }

      writeln('');
      set({ isExecutingCommand: false });
    }
  },
}));
