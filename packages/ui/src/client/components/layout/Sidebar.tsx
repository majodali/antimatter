import { useState } from 'react';
import { FileText, MessageSquare, Folder, Hammer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { FileExplorer } from '../file-explorer/FileExplorer';
import { ChatPanel } from '../chat/ChatPanel';
import { BuildPanel } from '../build/BuildPanel';

type SidebarView = 'files' | 'chat' | 'docs' | 'build';

export function Sidebar() {
  const [activeView, setActiveView] = useState<SidebarView>('files');

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
            activeView === 'chat' && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setActiveView('chat')}
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            activeView === 'docs' && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setActiveView('docs')}
        >
          <FileText className="h-5 w-5" />
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
      </div>

      <Separator orientation="vertical" />

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'files' && <FileExplorer />}
        {activeView === 'chat' && <ChatPanel />}
        {activeView === 'docs' && (
          <div className="p-4">
            <h3 className="text-sm font-medium">Documentation</h3>
            <p className="text-xs text-muted-foreground mt-2">
              Coming soon...
            </p>
          </div>
        )}
        {activeView === 'build' && <BuildPanel />}
      </div>
    </div>
  );
}
