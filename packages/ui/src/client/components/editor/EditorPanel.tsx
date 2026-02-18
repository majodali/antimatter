import { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor';
import { Button } from '../ui/button';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { detectLanguage } from '@/lib/languageDetection';
import { fetchFileContent } from '@/lib/api';
import type { WorkspacePath } from '@antimatter/filesystem';

export function EditorPanel() {
  const selectedFile = useFileStore((state) => state.selectedFile);
  const { openFiles, activeFile, openFile, closeFile, getActiveFileContent } =
    useEditorStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFile && !openFiles.has(selectedFile)) {
      loadFile(selectedFile);
    } else if (selectedFile) {
      useEditorStore.getState().setActiveFile(selectedFile);
    }
  }, [selectedFile]);

  async function loadFile(path: WorkspacePath) {
    setIsLoading(true);
    setError(null);
    try {
      const content = await fetchFileContent(path);
      const language = detectLanguage(path);
      openFile(path, content, language);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load file';
      setError(msg);
      console.error('Failed to load file:', err);
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
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-red-500">{error}</p>
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
