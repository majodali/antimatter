import { Moon, Sun, Settings, User } from 'lucide-react';
import { Button } from '../ui/button';
import { useTheme } from '../theme-provider';

export function Header() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <header className="h-12 px-4 flex items-center justify-between border-b border-border bg-card">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">
          Antimatter IDE
        </h1>
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
