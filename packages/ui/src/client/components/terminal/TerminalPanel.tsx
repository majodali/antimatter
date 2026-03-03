import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Terminal as TerminalIcon,
  Trash2,
  Play,
  Square,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../ui/button';
import { XTerm } from './XTerm';
import { useTerminalStore } from '@/stores/terminalStore';
import { useBuildStore } from '@/stores/buildStore';
import { useProjectStore } from '@/stores/projectStore';

/**
 * Connection status badge — shows the current state of the workspace terminal.
 */
function ConnectionBadge({ state }: { state: string }) {
  switch (state) {
    case 'connected':
      return (
        <span className="flex items-center gap-1 text-xs text-green-500">
          <Wifi className="h-3 w-3" />
          Connected
        </span>
      );
    case 'connecting':
      return (
        <span className="flex items-center gap-1 text-xs text-yellow-500 animate-pulse">
          <Wifi className="h-3 w-3" />
          Connecting...
        </span>
      );
    case 'starting':
      return (
        <span className="flex items-center gap-1 text-xs text-blue-500 animate-pulse">
          <Loader2 className="h-3 w-3 animate-spin" />
          Starting...
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <WifiOff className="h-3 w-3" />
          Error
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <WifiOff className="h-3 w-3" />
          Disconnected
        </span>
      );
  }
}

export function TerminalPanel() {
  const {
    connectionState,
    errorMessage,
    isRunning,
    isExecutingCommand,
    commandHistory,
    historyIndex,
    projectId: connectedProjectId,
    setHistoryIndex,
    executeCommand,
    clear,
    connect,
    disconnect,
    sendInput,
    resize,
    stopContainer,
  } = useTerminalStore();

  const buildOutput = useBuildStore((s) => s.buildOutput);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Show welcome message on first render
  useEffect(() => {
    const timer = setTimeout(() => {
      const term = (window as any).__terminal;
      if (term) {
        term.writeln('\x1b[1;32m=== Antimatter Terminal ===\x1b[0m');
        term.writeln('');
        if (currentProjectId) {
          term.writeln('\x1b[36mConnecting to workspace...\x1b[0m');
        } else {
          term.writeln('\x1b[36mSelect a project to start a workspace terminal.\x1b[0m');
        }
        term.writeln('');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const handleClear = () => {
    const term = (window as any).__terminal;
    if (term) {
      term.clear();
    }
    clear();
  };

  const handleConnect = useCallback(() => {
    if (!currentProjectId) return;
    connect(currentProjectId);
  }, [currentProjectId, connect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const handleStop = useCallback(() => {
    if (!currentProjectId) return;
    stopContainer(currentProjectId);
  }, [currentProjectId, stopContainer]);

  // Terminal data handler — sends keystrokes to the PTY via WebSocket
  const handleTerminalData = useCallback(
    (data: string) => {
      if (connectionState === 'connected') {
        sendInput(data);
      }
    },
    [connectionState, sendInput],
  );

  // Terminal resize handler
  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      resize(cols, rows);
    },
    [resize],
  );

  // Legacy: command input submission for fallback mode
  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !currentProjectId || isExecutingCommand) return;
    setInput('');
    setHistoryIndex(-1);
    executeCommand(currentProjectId, trimmed);
  }, [input, currentProjectId, isExecutingCommand, executeCommand, setHistoryIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length === 0) return;
        const newIndex =
          historyIndex === -1
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex === -1) return;
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIndex);
          setInput(commandHistory[newIndex]);
        }
      }
    },
    [handleSubmit, commandHistory, historyIndex, setHistoryIndex],
  );

  const isConnectedOrConnecting =
    connectionState === 'connected' ||
    connectionState === 'connecting' ||
    connectionState === 'starting';

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-8 px-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Terminal</span>
          <ConnectionBadge state={connectionState} />
          {isRunning && (
            <span className="text-xs text-muted-foreground animate-pulse">Building...</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Connect / Disconnect buttons */}
          {currentProjectId && !isConnectedOrConnecting && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1"
              onClick={handleConnect}
              title="Start workspace terminal"
            >
              <Play className="h-3 w-3" />
              Start
            </Button>
          )}
          {connectionState === 'connected' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1"
              onClick={handleDisconnect}
              title="Disconnect from terminal"
            >
              <WifiOff className="h-3 w-3" />
              Disconnect
            </Button>
          )}
          {connectionState === 'error' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1"
              onClick={handleConnect}
              title="Reconnect"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          )}
          {isConnectedOrConnecting && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 text-red-500 hover:text-red-400"
              onClick={handleStop}
              title="Stop workspace container"
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleClear}
            title="Clear terminal"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Terminal output — xterm.js handles all I/O when WebSocket is connected */}
      <div className="flex-1 overflow-hidden">
        <XTerm
          onData={handleTerminalData}
          onResize={handleTerminalResize}
        />
      </div>

      {/* Command input — shown only when NOT connected via WebSocket (fallback mode) */}
      {connectionState !== 'connected' && (
        <div className="border-t border-border bg-card px-3 py-1.5 flex items-center gap-2">
          {currentProjectId ? (
            <>
              <span className="text-xs font-mono text-green-500 select-none">$</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isExecutingCommand}
                placeholder={
                  isExecutingCommand
                    ? 'Running...'
                    : connectionState === 'starting'
                      ? 'Container starting...'
                      : 'Type a command (workspace auto-connects on project open)...'
                }
                className="flex-1 bg-transparent text-xs font-mono outline-none placeholder:text-muted-foreground disabled:opacity-50"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleSubmit}
                disabled={isExecutingCommand || !input.trim()}
                title="Run command"
              >
                {isExecutingCommand ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              Select a project to run commands
            </span>
          )}
        </div>
      )}
    </div>
  );
}
