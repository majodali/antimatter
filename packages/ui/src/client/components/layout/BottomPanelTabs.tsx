/**
 * BottomPanelTabs — tabbed bottom panel with Terminal and Problems tabs.
 *
 * Both panels stay mounted (CSS visibility toggle) so terminal state
 * and xterm.js instances are preserved when switching tabs.
 */

import { useState } from 'react';
import { Terminal as TerminalIcon, AlertCircle } from 'lucide-react';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { ProblemsPanel } from '../problems/ProblemsPanel';
import { useErrorStore } from '@/stores/errorStore';

type BottomTab = 'terminal' | 'problems';

export function BottomPanelTabs() {
  const [activeTab, setActiveTab] = useState<BottomTab>('terminal');
  const errorCount = useErrorStore((s) => s.errors.length);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-card px-1 gap-px flex-shrink-0">
        <TabButton
          active={activeTab === 'terminal'}
          onClick={() => setActiveTab('terminal')}
        >
          <TerminalIcon className="h-3.5 w-3.5" />
          Terminal
        </TabButton>
        <TabButton
          active={activeTab === 'problems'}
          onClick={() => setActiveTab('problems')}
          badge={errorCount > 0 ? errorCount : undefined}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Problems
        </TabButton>
      </div>

      {/* Panel content — both stay mounted, toggled with CSS */}
      <div className="flex-1 overflow-hidden relative">
        <div className={activeTab === 'terminal' ? 'h-full' : 'h-0 overflow-hidden'}>
          <TerminalPanel />
        </div>
        <div className={activeTab === 'problems' ? 'h-full' : 'h-0 overflow-hidden'}>
          <ProblemsPanel />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
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
