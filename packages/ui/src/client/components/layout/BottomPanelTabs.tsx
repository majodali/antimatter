/**
 * BottomPanelTabs — tabbed bottom panel with Terminal, Problems, and Tests tabs.
 *
 * All panels stay mounted (CSS visibility toggle) so terminal state,
 * xterm.js instances, and test results are preserved when switching tabs.
 */

import { useState } from 'react';
import { Terminal as TerminalIcon, AlertCircle, TestTube2 } from 'lucide-react';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { ProblemsPanel } from '../problems/ProblemsPanel';
import { TestResultsPanel } from '../tests/TestResultsPanel';
import { useApplicationStore } from '@/stores/applicationStore';
import { useTestResultStore } from '@/stores/testResultStore';

type BottomTab = 'terminal' | 'problems' | 'tests';

export function BottomPanelTabs() {
  const [activeTab, setActiveTab] = useState<BottomTab>('terminal');
  const errorCount = useApplicationStore((s) => s.getErrorCount());
  const failedTests = useTestResultStore((s) => s.results.filter((r) => !r.pass).length);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-card px-1 gap-px flex-shrink-0">
        <TabButton
          active={activeTab === 'terminal'}
          onClick={() => setActiveTab('terminal')}
          testId="bottom-panel-terminal-tab"
        >
          <TerminalIcon className="h-3.5 w-3.5" />
          Terminal
        </TabButton>
        <TabButton
          active={activeTab === 'problems'}
          onClick={() => setActiveTab('problems')}
          badge={errorCount > 0 ? errorCount : undefined}
          testId="bottom-panel-problems-tab"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Problems
        </TabButton>
        <TabButton
          active={activeTab === 'tests'}
          onClick={() => setActiveTab('tests')}
          badge={failedTests > 0 ? failedTests : undefined}
          testId="bottom-panel-tests-tab"
        >
          <TestTube2 className="h-3.5 w-3.5" />
          Tests
        </TabButton>
      </div>

      {/* Panel content — all stay mounted, toggled with CSS */}
      <div className="flex-1 overflow-hidden relative">
        <div className={activeTab === 'terminal' ? 'h-full' : 'h-0 overflow-hidden'}>
          <TerminalPanel />
        </div>
        <div className={activeTab === 'problems' ? 'h-full' : 'h-0 overflow-hidden'}>
          <ProblemsPanel />
        </div>
        <div className={activeTab === 'tests' ? 'h-full' : 'h-0 overflow-hidden'}>
          <TestResultsPanel />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  badge,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`
        flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
        border-b-2 transition-colors
        ${active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
        }
      `}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] font-medium text-red-500 bg-red-500/10 rounded-full px-1.5 min-w-[18px] text-center">
          {badge}
        </span>
      )}
    </button>
  );
}
