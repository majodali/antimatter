import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../theme-provider';

interface XTermProps {
  projectId: string | null;
  sessionId?: string;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

// ---------------------------------------------------------------------------
// Per-project terminal pool — survives re-renders, preserves scrollback
// ---------------------------------------------------------------------------

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
}

const terminalPool = new Map<string, TerminalEntry>();

function getTerminalTheme(theme: string) {
  return {
    background: theme === 'dark' ? '#1e1e1e' : '#ffffff',
    foreground: theme === 'dark' ? '#cccccc' : '#333333',
    cursor: theme === 'dark' ? '#ffffff' : '#000000',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  };
}

/** Remove a project's terminal from the pool and dispose it. */
export function disposeProjectTerminal(projectId: string): void {
  const entry = terminalPool.get(projectId);
  if (entry) {
    entry.terminal.dispose();
    terminalPool.delete(projectId);
  }
}

export function XTerm({ projectId, sessionId = 'main', onData, onResize }: XTermProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeKeyRef = useRef<string | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const { theme } = useTheme();

  // Keep callback refs up to date
  onDataRef.current = onData;
  onResizeRef.current = onResize;

  // Pool key combines project + session
  const poolKey = projectId ? `${projectId}:${sessionId}` : null;

  // Attach / detach terminals when poolKey changes
  useEffect(() => {
    if (!containerRef.current || !poolKey) return;

    const container = containerRef.current;
    const prevKey = activeKeyRef.current;

    // Detach previous terminal (keep it alive in the pool)
    if (prevKey && prevKey !== poolKey) {
      const prev = terminalPool.get(prevKey);
      if (prev) {
        const el = prev.terminal.element;
        if (el && el.parentElement === container) {
          container.removeChild(el);
        }
      }
    }

    activeKeyRef.current = poolKey;

    // Get or create terminal for this session
    let entry = terminalPool.get(poolKey);
    if (!entry) {
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Consolas, "Courier New", monospace',
        theme: getTerminalTheme(theme),
        scrollback: 5000,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      // Wire up data + resize callbacks
      terminal.onData((data) => { onDataRef.current?.(data); });
      terminal.onResize(({ cols, rows }) => { onResizeRef.current?.(cols, rows); });

      entry = { terminal, fitAddon };
      terminalPool.set(poolKey, entry);

      // First-time open
      terminal.open(container);
      fitAddon.fit();
    } else {
      // Re-attach existing terminal to the container
      const el = entry.terminal.element;
      if (el && el.parentElement !== container) {
        container.appendChild(el);
      }
      requestAnimationFrame(() => {
        try { entry!.fitAddon.fit(); } catch { /* ignore */ }
      });
    }

    // Update global terminal reference (active terminal)
    const { terminal, fitAddon } = entry;
    (window as any).__terminal = {
      write: (data: string) => terminal.write(data),
      writeln: (data: string) => terminal.writeln(data),
      clear: () => terminal.clear(),
      cols: terminal.cols,
      rows: terminal.rows,
    };

    // Expose terminal pool for session-targeted writes from terminalStore
    if (!(window as any).__terminalPool) {
      (window as any).__terminalPool = new Map();
    }
    (window as any).__terminalPool.set(sessionId, {
      write: (data: string) => terminal.write(data),
    });

    // Resize handlers
    const handleResize = () => {
      try {
        fitAddon.fit();
        if ((window as any).__terminal) {
          (window as any).__terminal.cols = terminal.cols;
          (window as any).__terminal.rows = terminal.rows;
        }
      } catch { /* ignore */ }
    };

    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(handleResize);
    });
    observer.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      // Don't dispose — terminal stays in the pool
    };
  }, [poolKey, theme]);

  // Update theme on all pooled terminals when it changes
  useEffect(() => {
    const t = getTerminalTheme(theme);
    for (const entry of terminalPool.values()) {
      entry.terminal.options.theme = t;
    }
  }, [theme]);

  return <div ref={containerRef} className="h-full w-full" />;
}
