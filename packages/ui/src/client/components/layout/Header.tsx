import { Moon, Sun, Settings, User, ArrowLeftRight } from 'lucide-react';
import { Button } from '../ui/button';
import { useTheme } from '../theme-provider';
import { useProjectStore } from '@/stores/projectStore';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

export function Header() {
  const { theme, setTheme } = useTheme();
  const { projects, currentProjectId, clearProject } = useProjectStore();
  const currentProject = projects.find((p) => p.id === currentProjectId);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleSwitchProject = () => {
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
          <span className="text-sm text-muted-foreground">
            / {currentProject.name}
          </span>
        )}
        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            Files
          </Button>
          <Button variant="ghost" size="sm">
            Chat
          </Button>
          <Button variant="ghost" size="sm">
            Build
          </Button>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={handleSwitchProject} title="Switch Project">
          <ArrowLeftRight className="h-4 w-4 mr-1" />
          Switch
        </Button>
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
