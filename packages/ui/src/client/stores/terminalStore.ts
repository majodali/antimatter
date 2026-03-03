/**
 * Terminal Store — manages WebSocket connection to Fargate workspace
 * containers for interactive terminal sessions.
 *
 * State machine: disconnected → starting → connecting → connected → (error)
 * The store handles container startup, WebSocket lifecycle, and auto-reconnect.
 */

import { create } from 'zustand';
import {
  startWorkspace,
  getWorkspaceStatus,
  stopWorkspace,
  getWorkspaceWsUrl,
  executeProjectCommand,
} from '@/lib/api';

export type ConnectionState =
  | 'disconnected'
  | 'starting'    // Fargate task launching
  | 'connecting'  // WebSocket connecting
  | 'connected'   // Interactive terminal ready
  | 'error';

interface TerminalStore {
  // Connection state
  connectionState: ConnectionState;
  errorMessage: string | null;

  // Container info (from API)
  sessionToken: string | null;
  taskArn: string | null;
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

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  // State
  connectionState: 'disconnected',
  errorMessage: null,
  sessionToken: null,
  taskArn: null,
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
      taskArn: null,
      ws: null,
    });

    writeln('\x1b[36mStarting workspace container...\x1b[0m');

    try {
      // Start the container (or get existing)
      const info = await startWorkspace(projectId);
      set({ sessionToken: info.sessionToken, taskArn: info.taskArn });

      // Poll until RUNNING
      if (info.status !== 'RUNNING') {
        writeln(`\x1b[36mContainer status: ${info.status}, waiting...\x1b[0m`);

        let attempts = 0;
        const maxAttempts = 120; // 2 minutes at 1s intervals
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
              writeln(`\x1b[36mContainer status: ${status} (${attempts}s)\x1b[0m`);
            }
          } catch {
            // Ignore transient errors during polling
          }
        }

        if (status !== 'RUNNING') {
          throw new Error(`Container failed to start (last status: ${status})`);
        }
      }

      writeln('\x1b[32mContainer running, connecting terminal...\x1b[0m');
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
   * Does NOT stop the container — it will auto-shutdown after idle timeout.
   */
  disconnect: () => {
    const { ws } = get();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;

    if (ws) {
      ws.close(1000, 'User disconnected');
    }

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
   * Stop the workspace container for a project.
   */
  stopContainer: async (projectId: string) => {
    const state = get();
    if (state.ws) {
      state.ws.close(1000, 'Stopping container');
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    set({
      connectionState: 'disconnected',
      ws: null,
      errorMessage: null,
      sessionToken: null,
      taskArn: null,
    });

    try {
      await stopWorkspace(projectId);
      writeln('\x1b[33mWorkspace container stopped.\x1b[0m');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeln(`\x1b[31mFailed to stop container: ${msg}\x1b[0m`);
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
