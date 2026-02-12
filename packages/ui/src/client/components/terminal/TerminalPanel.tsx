import { useEffect, useState } from 'react';
import { Terminal as TerminalIcon, Trash2, Play, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { XTerm } from './XTerm';
import { useTerminalStore } from '@/stores/terminalStore';

export function TerminalPanel() {
  const { isRunning, setRunning, clear } = useTerminalStore();
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    // Show welcome message after a short delay
    const timer = setTimeout(() => {
      if ((window as any).__terminal) {
        const term = (window as any).__terminal;
        term.writeln('\x1b[1;32m╔═══════════════════════════════════════╗\x1b[0m');
        term.writeln('\x1b[1;32m║    Antimatter IDE Terminal v1.0.0    ║\x1b[0m');
        term.writeln('\x1b[1;32m╚═══════════════════════════════════════╝\x1b[0m');
        term.writeln('');
        term.writeln('\x1b[36mWelcome to the Antimatter Terminal!\x1b[0m');
        term.writeln('');
        term.writeln('This terminal displays build output, test results,');
        term.writeln('and command execution.');
        term.writeln('');
        term.writeln('\x1b[33mClick the Play button to see a demo build...\x1b[0m');
        term.writeln('');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  const runDemoBuild = async () => {
    const term = (window as any).__terminal;
    if (!term) return;

    setRunning(true);

    // Clear terminal
    term.clear();

    // Simulate build output
    term.writeln('\x1b[1;36m$ npm run build\x1b[0m');
    term.writeln('');

    await sleep(500);
    term.writeln('\x1b[32m>\x1b[0m @antimatter/ui@0.0.0 build');
    term.writeln('\x1b[32m>\x1b[0m tsc && vite build');
    term.writeln('');

    await sleep(800);
    term.writeln('\x1b[36mvite v5.4.21\x1b[0m building for production...');
    term.writeln('');

    await sleep(600);
    term.writeln('transforming...');
    await sleep(400);
    term.writeln('\x1b[32m✓\x1b[0m 47 modules transformed.');

    await sleep(500);
    term.writeln('');
    term.writeln('rendering chunks...');
    await sleep(600);

    term.writeln('computing gzip size...');
    await sleep(400);

    term.writeln('');
    term.writeln('\x1b[32mdist/index.html\x1b[0m                   0.46 kB │ gzip:  0.30 kB');
    term.writeln('\x1b[32mdist/assets/index-a1b2c3d4.css\x1b[0m   1.23 kB │ gzip:  0.67 kB');
    term.writeln('\x1b[32mdist/assets/index-e5f6g7h8.js\x1b[0m  142.45 kB │ gzip: 45.23 kB');
    term.writeln('');

    await sleep(300);
    term.writeln('\x1b[1;32m✓ built in 3.42s\x1b[0m');
    term.writeln('');

    await sleep(400);
    term.writeln('\x1b[36mRunning tests...\x1b[0m');
    term.writeln('');

    await sleep(600);
    term.writeln(' \x1b[32m✓\x1b[0m src/__tests__/FileExplorer.test.tsx (4 tests) 234ms');
    await sleep(300);
    term.writeln(' \x1b[32m✓\x1b[0m src/__tests__/Editor.test.tsx (3 tests) 156ms');
    await sleep(300);
    term.writeln(' \x1b[32m✓\x1b[0m src/__tests__/Chat.test.tsx (5 tests) 289ms');
    term.writeln('');

    await sleep(400);
    term.writeln(' \x1b[1;32mTest Files\x1b[0m  3 passed (3)');
    term.writeln(' \x1b[1;32m     Tests\x1b[0m  12 passed (12)');
    term.writeln(' \x1b[1;32m  Duration\x1b[0m  1.23s');
    term.writeln('');

    await sleep(500);
    term.writeln('\x1b[1;32m✨ Build completed successfully!\x1b[0m');
    term.writeln('');

    setRunning(false);
  };

  const handleClear = () => {
    const term = (window as any).__terminal;
    if (term) {
      term.clear();
      term.writeln('\x1b[2mTerminal cleared\x1b[0m');
      term.writeln('');
    }
    clear();
  };

  const handleStop = () => {
    setRunning(false);
    const term = (window as any).__terminal;
    if (term) {
      term.writeln('');
      term.writeln('\x1b[33m⚠ Build cancelled by user\x1b[0m');
      term.writeln('');
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-8 px-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Terminal</span>
          {isRunning && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Running...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isRunning ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={runDemoBuild}
              title="Run demo build"
            >
              <Play className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleStop}
              title="Stop build"
            >
              <Square className="h-3 w-3" />
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

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <XTerm />
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
