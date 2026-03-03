import { useEffect } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { EditorPanel } from '../editor/EditorPanel';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { Separator } from '../ui/separator';
import { useProjectStore } from '@/stores/projectStore';
import { useTerminalStore } from '@/stores/terminalStore';

export function MainLayout() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // Auto-connect to workspace when project opens
  useEffect(() => {
    if (!currentProjectId) return;
    const { connectionState, projectId, connect } = useTerminalStore.getState();
    if (connectionState === 'disconnected' || connectionState === 'error' || projectId !== currentProjectId) {
      connect(currentProjectId);
    }
  }, [currentProjectId]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <Header />
      <Separator />
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* Sidebar */}
          <Panel defaultSize={20} minSize={15} maxSize={30}>
            <Sidebar />
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

          {/* Main content area */}
          <Panel defaultSize={80} minSize={50}>
            <PanelGroup direction="vertical">
              {/* Editor */}
              <Panel defaultSize={70} minSize={30}>
                <EditorPanel />
              </Panel>

              <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 transition-colors" />

              {/* Terminal/Output */}
              <Panel defaultSize={30} minSize={15} maxSize={50}>
                <TerminalPanel />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
