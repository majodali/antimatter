import { useEffect } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { EditorPanel } from '../editor/EditorPanel';
import { BottomPanelTabs } from './BottomPanelTabs';
import { ChatPanel } from '../chat/ChatPanel';
import { Separator } from '../ui/separator';
import { useProjectStore } from '@/stores/projectStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useUIStore } from '@/stores/uiStore';

export function MainLayout() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const chatPanelVisible = useUIStore((s) => s.chatPanelVisible);

  // Auto-connect to workspace when project opens.
  // Application state (declarations, errors, etc.) arrives via WebSocket
  // on connect — no separate REST loading needed.
  useEffect(() => {
    if (!currentProjectId) return;
    const { connectionState, projectId, connect } = useTerminalStore.getState();
    if (connectionState === 'disconnected' || connectionState === 'error' || projectId !== currentProjectId) {
      connect(currentProjectId);
    }
  }, [currentProjectId]);

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="main-layout">
      <Header />
      <Separator />
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* Sidebar */}
          <Panel defaultSize={18} minSize={15} maxSize={30}>
            <Sidebar />
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

          {/* Main content area */}
          <Panel minSize={35}>
            <PanelGroup direction="vertical">
              {/* Editor */}
              <Panel defaultSize={70} minSize={30}>
                <EditorPanel />
              </Panel>

              <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 transition-colors" />

              {/* Terminal + Problems */}
              <Panel defaultSize={30} minSize={15}>
                <BottomPanelTabs />
              </Panel>
            </PanelGroup>
          </Panel>

          {/* Agent chat panel (right side, toggleable) */}
          {chatPanelVisible && (
            <>
              <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
              <Panel defaultSize={25} minSize={15} maxSize={40}>
                <ChatPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  );
}
