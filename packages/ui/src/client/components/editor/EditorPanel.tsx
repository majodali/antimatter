import { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor';
import { Button } from '../ui/button';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { detectLanguage } from '@/lib/languageDetection';
import type { WorkspacePath } from '@antimatter/filesystem';

export function EditorPanel() {
  const selectedFile = useFileStore((state) => state.selectedFile);
  const { openFiles, activeFile, openFile, closeFile, getActiveFileContent } =
    useEditorStore();

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (selectedFile && !openFiles.has(selectedFile)) {
      loadFile(selectedFile);
    } else if (selectedFile) {
      useEditorStore.getState().setActiveFile(selectedFile);
    }
  }, [selectedFile]);

  async function loadFile(path: WorkspacePath) {
    setIsLoading(true);
    try {
      const content = DEMO_FILES[path] || '// File content not available';
      const language = detectLanguage(path);
      openFile(path, content, language);
    } catch (error) {
      console.error('Failed to load file:', error);
    } finally {
      setIsLoading(false);
    }
  }

  const activeFileContent = getActiveFileContent();
  const openFilesList = Array.from(openFiles.values());

  if (!activeFile || !activeFileContent) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Select a file from the explorer to view
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tabs */}
      <div className="flex items-center gap-px bg-border overflow-x-auto">
        {openFilesList.map((file) => {
          const isActive = file.path === activeFile;
          const fileName = file.path.split('/').pop() || file.path;

          return (
            <div
              key={file.path}
              className={`
                flex items-center gap-2 px-3 py-2 text-sm cursor-pointer
                ${
                  isActive
                    ? 'bg-background text-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }
              `}
              onClick={() => useEditorStore.getState().setActiveFile(file.path)}
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">{fileName}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 p-0 hover:bg-background/20"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.path);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <MonacoEditor
            value={activeFileContent.content}
            language={activeFileContent.language}
            readOnly={true}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="h-6 px-3 flex items-center justify-between text-xs bg-card border-t border-border">
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground">
            {activeFileContent.language}
          </span>
          <span className="text-muted-foreground">
            {activeFileContent.content.split('\n').length} lines
          </span>
        </div>
        <div className="text-muted-foreground">Read-only</div>
      </div>
    </div>
  );
}

// Demo file contents
const DEMO_FILES: Record<string, string> = {
  'README.md': `# Antimatter IDE

A modern development environment with AI-powered assistance.

## Features

- File explorer with tree view
- Monaco code editor
- AI chat integration
- Terminal output
- Build system integration

## Getting Started

Select a file from the explorer to view its contents.`,

  'package.json': JSON.stringify(
    {
      name: 'antimatter-demo',
      version: '1.0.0',
      description: 'Demo project for Antimatter IDE',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        test: 'vitest',
      },
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
    },
    null,
    2
  ),

  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        lib: ['ES2020', 'DOM'],
        jsx: 'react-jsx',
        strict: true,
      },
    },
    null,
    2
  ),

  'src/index.ts': `export { App } from './App';
export { Header } from './components/Header';
export { Sidebar } from './components/Sidebar';
`,

  'src/App.tsx': `import { BrowserRouter as Router } from 'react-router-dom';
import { ThemeProvider } from './components/theme-provider';
import { MainLayout } from './components/layout/MainLayout';

export default function App() {
  return (
    <Router>
      <ThemeProvider defaultTheme="dark">
        <MainLayout />
      </ThemeProvider>
    </Router>
  );
}
`,

  'src/components/Button.tsx': `import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center rounded-md',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
`,

  'src/lib/utils.ts': `import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
`,

  'tests/example.test.ts': `import { describe, it, expect } from 'vitest';

describe('Example Test Suite', () => {
  it('should pass this test', () => {
    expect(true).toBe(true);
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });
});
`,
};
