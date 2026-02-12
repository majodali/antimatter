import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../theme-provider';

interface XTermProps {
  onData?: (data: string) => void;
  initialLines?: string[];
}

export function XTerm({ onData, initialLines = [] }: XTermProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
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
      scrollback: 1000,
      convertEol: true,
    });

    // Create fit addon
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Open terminal
    terminal.open(terminalRef.current);
    fitAddon.fit();

    // Handle data input
    if (onData) {
      terminal.onData(onData);
    }

    // Write initial lines
    if (initialLines.length > 0) {
      initialLines.forEach((line) => {
        terminal.writeln(line);
      });
    }

    // Store refs
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      terminal.dispose();
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

  // Expose methods for writing to terminal
  useEffect(() => {
    if (xtermRef.current) {
      (window as any).__terminal = {
        write: (data: string) => xtermRef.current?.write(data),
        writeln: (data: string) => xtermRef.current?.writeln(data),
        clear: () => xtermRef.current?.clear(),
      };
    }
  }, []);

  return <div ref={terminalRef} className="h-full w-full" />;
}
