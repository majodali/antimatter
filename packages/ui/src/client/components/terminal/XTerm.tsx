import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../theme-provider';

interface XTermProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  initialLines?: string[];
}

export function XTerm({ onData, onResize, initialLines = [] }: XTermProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const { theme } = useTheme();

  // Keep callback refs up to date
  onDataRef.current = onData;
  onResizeRef.current = onResize;

  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
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
      },
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    // Handle data input (keyboard → PTY)
    terminal.onData((data) => {
      onDataRef.current?.(data);
    });

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      onResizeRef.current?.(cols, rows);
    });

    // Write initial lines
    if (initialLines.length > 0) {
      initialLines.forEach((line) => terminal.writeln(line));
    }

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Expose terminal for writing by other components
    (window as any).__terminal = {
      write: (data: string) => xtermRef.current?.write(data),
      writeln: (data: string) => xtermRef.current?.writeln(data),
      clear: () => xtermRef.current?.clear(),
      cols: terminal.cols,
      rows: terminal.rows,
    };

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
      // Update stored dimensions
      if ((window as any).__terminal) {
        (window as any).__terminal.cols = terminal.cols;
        (window as any).__terminal.rows = terminal.rows;
      }
    };

    window.addEventListener('resize', handleResize);

    // Use ResizeObserver for container-driven resizes (e.g., panel drag)
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if ((window as any).__terminal) {
            (window as any).__terminal.cols = terminal.cols;
            (window as any).__terminal.rows = terminal.rows;
          }
        } catch {
          // Ignore fit errors during unmount
        }
      });
    });

    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      terminal.dispose();
      (window as any).__terminal = null;
    };
  }, []);

  // Update theme when it changes
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = {
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
  }, [theme]);

  return <div ref={terminalRef} className="h-full w-full" />;
}
