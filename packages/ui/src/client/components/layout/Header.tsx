import { Moon, Sun, Settings, User, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { useTheme } from '../theme-provider';
import { useProjectStore } from '@/stores/projectStore';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { useTerminalStore } from '@/stores/terminalStore';

export function Header() {
  const { theme, setTheme } = useTheme();
  const { projects, currentProjectId, clearProject } = useProjectStore();
  const currentProject = projects.find((p) => p.id === currentProjectId);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleSwitchProject = () => {
    // Disconnect workspace terminal before clearing state
    useTerminalStore.getState().disconnect();
    // Clear workspace state when switching projects
    useFileStore.getState().setFiles([]);
    useFileStore.getState().selectFile(null as any);
    useEditorStore.getState().closeAllFiles();
    useChatStore.getState().clearMessages();
    clearProject();
  };

  return (
    <header className="h-12 px-4 flex items-center justify-between border-b border-border bg-card">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">
          Antimatter IDE
        </h1>
        {currentProject && (
          <button
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleSwitchProject}
            title="Switch project"
            data-testid="header-project-switch"
          >
            <span data-testid="header-project-name">/ {currentProject.name}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
        <Button variant="ghost" size="icon">
          <Settings className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon">
          <User className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
