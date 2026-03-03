import { useState } from 'react';
import { MessageSquare, Folder, Hammer, Rocket, ScrollText, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { FileExplorer } from '../file-explorer/FileExplorer';
import { BuildPanel } from '../build/BuildPanel';
import { DeployPanel } from '../deploy/DeployPanel';
import { ActivityPanel } from '../activity/ActivityPanel';
import { GitPanel } from '../git/GitPanel';
import { useUIStore } from '@/stores/uiStore';

type SidebarView = 'files' | 'build' | 'deploy' | 'git' | 'activity';

export function Sidebar() {
  const [activeView, setActiveView] = useState<SidebarView>('files');
  const chatPanelVisible = useUIStore((s) => s.chatPanelVisible);

  return (
    <div className="h-full flex">
      {/* Icon bar */}
      <div className="w-12 bg-card border-r border-border flex flex-col items-center py-2 gap-2">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            activeView === 'files' && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setActiveView('files')}
        >
          <Folder className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            chatPanelVisible && 'bg-accent text-accent-foreground'
          )}
          onClick={() => useUIStore.getState().toggleChatPanel()}
          title="Toggle chat panel"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            activeView === 'build' && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setActiveView('build')}
        >
          <Hammer className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            activeView === 'deploy' && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setActiveView('deploy')}
        >
          <Rocket className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            activeView === 'git' && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setActiveView('git')}
        >
          <GitBranch className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            activeView === 'activity' && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setActiveView('activity')}
        >
          <ScrollText className="h-5 w-5" />
        </Button>
      </div>

      <Separator orientation="vertical" />

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'files' && <FileExplorer />}
        {activeView === 'build' && <BuildPanel />}
        {activeView === 'deploy' && <DeployPanel />}
        {activeView === 'git' && <GitPanel />}
        {activeView === 'activity' && <ActivityPanel />}
      </div>
    </div>
  );
}
