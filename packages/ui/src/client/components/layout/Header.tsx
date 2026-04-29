import { useState, useRef, useEffect } from 'react';
import { Moon, Sun, Settings, User, ChevronDown, ExternalLink, Check, Lock, Hammer, Server, LogOut } from 'lucide-react';
import { Button } from '../ui/button';
import { useTheme } from '../theme-provider';
import { useProjectStore } from '@/stores/projectStore';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useUIStore, type Perspective } from '@/stores/uiStore';
import { isLockedByOther } from '@/lib/tab-lock';
import { cn } from '@/lib/utils';
import { signOut, getUserEmail } from '@/lib/auth';

/**
 * Two-state segmented control for the active perspective.
 * See `docs/contexts.md` § Perspectives — Build vs Ops drives which
 * axis is primary in the layout.
 *
 * Today the toggle is a placeholder for future filtering/highlighting
 * behaviour — it persists user preference but no panel reacts to it
 * yet. The real estate is claimed where the selector will live so
 * future work doesn't churn the header.
 */
function PerspectiveToggle() {
  const perspective = useUIStore((s) => s.perspective);
  const setPerspective = useUIStore((s) => s.setPerspective);

  const Btn = ({ value, label, icon: Icon, hint }: { value: Perspective; label: string; icon: typeof Hammer; hint: string }) => (
    <button
      type="button"
      onClick={() => setPerspective(value)}
      title={hint}
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors',
        perspective === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      data-testid={`perspective-${value}`}
      aria-pressed={perspective === value}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 bg-accent/40 rounded p-0.5" role="group" aria-label="Perspective">
      <Btn value="build" label="Build" icon={Hammer} hint="Build perspective: work context is primary." />
      <Btn value="ops" label="Ops" icon={Server} hint="Ops perspective: runtime context is primary." />
    </div>
  );
}

export function Header() {
  const { theme, setTheme } = useTheme();
  const { projects, currentProjectId, clearProject, selectProject } = useProjectStore();
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserEmail().then((email) => {
      if (!cancelled) setUserEmail(email);
    });
    return () => { cancelled = true; };
  }, []);

  const handleSignOut = async () => {
    setUserMenuOpen(false);
    try {
      await signOut();
    } catch (err) {
      console.error('[Header] Sign-out failed:', err);
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleSwitchProject = () => {
    useTerminalStore.getState().disconnect();
    useFileStore.getState().setFiles([]);
    useFileStore.getState().selectFile(null as any);
    useEditorStore.getState().closeAllFiles();
    useChatStore.getState().clearMessages();
    clearProject();
  };

  const handleSelectProject = (projectId: string) => {
    if (projectId === currentProjectId) {
      setDropdownOpen(false);
      return;
    }
    handleSwitchProject();
    selectProject(projectId);
    setDropdownOpen(false);
  };

  const handleOpenInNewTab = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    window.open(`/?project=${projectId}`, '_blank');
    setDropdownOpen(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

  return (
    <header className="h-12 px-4 flex items-center justify-between border-b border-border bg-card">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">
          Antimatter IDE
        </h1>
        {currentProject && (
          <div className="relative" ref={dropdownRef}>
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              title="Switch project"
              data-testid="project-dropdown"
            >
              <span data-testid="header-project-name">/ {currentProject.name}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>

            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-popover border border-border rounded-md shadow-lg z-50 py-1" data-testid="project-dropdown-content">
                {projects.map((project) => {
                  const locked = isLockedByOther(project.id);
                  const isCurrent = project.id === currentProjectId;
                  return (
                    <div
                      key={project.id}
                      className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                        locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent'
                      } ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}
                      onClick={() => !locked && handleSelectProject(project.id)}
                      data-testid={`header-project-${project.id}`}
                      data-locked={locked ? 'true' : undefined}
                    >
                      <span className="flex-1 truncate">{project.name}</span>
                      {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
                      {locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" data-testid="project-lock-icon" />}
                      <button
                        className="p-0.5 hover:bg-accent-foreground/10 rounded shrink-0"
                        onClick={(e) => handleOpenInNewTab(e, project.id)}
                        title="Open in new tab"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                <div className="border-t border-border mt-1 pt-1">
                  <div
                    className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent cursor-pointer"
                    onClick={() => { setDropdownOpen(false); handleSwitchProject(); }}
                  >
                    Browse all projects...
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <PerspectiveToggle />
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
        <div className="relative" ref={userMenuRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setUserMenuOpen((v) => !v)}
            title={userEmail ?? 'Account'}
            data-testid="user-menu-button"
          >
            <User className="h-4 w-4" />
          </Button>
          {userMenuOpen && (
            <div
              className="absolute top-full right-0 mt-1 w-56 bg-popover border border-border rounded-md shadow-lg z-50 py-1"
              data-testid="user-menu-content"
            >
              {userEmail && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border truncate" title={userEmail}>
                  {userEmail}
                </div>
              )}
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                onClick={handleSignOut}
                data-testid="sign-out-button"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
