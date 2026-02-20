import { useEffect } from 'react';
import { Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { XTerm } from './XTerm';
import { useTerminalStore } from '@/stores/terminalStore';
import { useBuildStore } from '@/stores/buildStore';

export function TerminalPanel() {
  const { isRunning, clear } = useTerminalStore();
  const buildOutput = useBuildStore((s) => s.buildOutput);

  useEffect(() => {
    const timer = setTimeout(() => {
      const term = (window as any).__terminal;
      if (term) {
        term.writeln('\x1b[1;32m=== Antimatter Build Terminal ===\x1b[0m');
        term.writeln('');
        term.writeln('\x1b[36mBuild output will appear here when you run builds.\x1b[0m');
        term.writeln('');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Write new build output lines to terminal as they arrive
  useEffect(() => {
    const term = (window as any).__terminal;
    if (!term) return;

    for (const [targetId, lines] of buildOutput.entries()) {
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        // Only write the latest line (streaming already writes via BuildPanel's onEvent handler)
        // This is a fallback for output that arrives through store updates
      }
    }
  }, [buildOutput]);

  const handleClear = () => {
    const term = (window as any).__terminal;
    if (term) {
      term.clear();
      term.writeln('\x1b[2mTerminal cleared\x1b[0m');
      term.writeln('');
    }
    clear();
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-8 px-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Build Output</span>
          {isRunning && (
            <span className="text-xs text-muted-foreground animate-pulse">Building...</span>
          )}
        </div>
        <div className="flex items-center gap-1">
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
