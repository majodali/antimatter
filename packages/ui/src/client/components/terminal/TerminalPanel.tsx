import { useEffect, useState, useCallback } from 'react';
import {
  Terminal as TerminalIcon,
  Trash2,
  Play,
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
import { refreshWorkspace } from '@/lib/api';
import { eventLog } from '@/lib/eventLog';
import { cn } from '@/lib/utils';

/**
 * Connection status badge — shows the current state of the workspace terminal.
 * During silent reconnect (<5s), shows green "Connected" to avoid flicker.
 */
function ConnectionBadge({ state, showReconnectOverlay }: { state: string; showReconnectOverlay: boolean }) {
  switch (state) {
    case 'connected':
    case 'reconnecting':
      // During silent reconnect, keep showing "Connected" (no flicker)
      if (state === 'reconnecting' && showReconnectOverlay) {
        return (
          <span className="flex items-center gap-1 text-xs text-yellow-500 animate-pulse">
            <Wifi className="h-3 w-3" />
            Reconnecting...
          </span>
        );
      }
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
    statusMessage,
    showReconnectOverlay,
    isRunning,
    projectId: connectedProjectId,
    clear,
    connect,
    disconnect,
    sendInput,
    resize,
  } = useTerminalStore();

  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasActiveWorkspace =
    (connectionState === 'connected' || connectionState === 'reconnecting') && !!connectedProjectId;

  const handleRefresh = useCallback(async () => {
    if (!connectedProjectId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshWorkspace(connectedProjectId);
      eventLog.info('workspace', 'Workspace server refresh requested — restarting...', undefined, { toast: true });
    } catch (err) {
      eventLog.error('workspace', 'Failed to refresh workspace server', String(err), { toast: true });
    } finally {
      // Keep spinning briefly — the server will restart and WebSocket will reconnect
      setTimeout(() => setIsRefreshing(false), 3000);
    }
  }, [connectedProjectId, isRefreshing]);

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

  // Terminal data handler — sends keystrokes to the PTY via WebSocket.
  // Also buffers input during silent reconnect.
  const handleTerminalData = useCallback(
    (data: string) => {
      if (connectionState === 'connected' || connectionState === 'reconnecting') {
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

  // Include 'reconnecting' so buttons/terminal remain usable during brief reconnects
  const isConnectedOrConnecting =
    connectionState === 'connected' ||
    connectionState === 'connecting' ||
    connectionState === 'starting' ||
    connectionState === 'reconnecting';

  // Show overlay for: starting, connecting, or reconnecting after 5s grace period
  const shouldShowOverlay = statusMessage && (
    connectionState === 'starting' ||
    connectionState === 'connecting' ||
    (connectionState === 'reconnecting' && showReconnectOverlay)
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-8 px-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Terminal</span>
          <ConnectionBadge state={connectionState} showReconnectOverlay={showReconnectOverlay} />
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
          {(connectionState === 'connected' || connectionState === 'reconnecting') && (
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
          {hasActiveWorkspace && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh workspace server (download latest code from S3 and restart)"
            >
              <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
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
      <div className="flex-1 overflow-hidden relative">
        <XTerm
          onData={handleTerminalData}
          onResize={handleTerminalResize}
        />
        {shouldShowOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 z-10">
            <div className="flex flex-col items-center gap-2 text-sm">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              <span className="text-muted-foreground">{statusMessage}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
