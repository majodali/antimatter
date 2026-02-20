import { useEffect, useCallback, useState, useRef } from 'react';
import { X, FileText, Circle } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor';
import { Button } from '../ui/button';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore, scheduleAutoSave } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useBuildStore } from '@/stores/buildStore';
import { detectLanguage } from '@/lib/languageDetection';
import { fetchFileContent } from '@/lib/api';
import type { WorkspacePath } from '@antimatter/filesystem';
import type { editor as monacoEditor } from 'monaco-editor';

export function EditorPanel() {
  const selectedFile = useFileStore((state) => state.selectedFile);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const { openFiles, activeFile, openFile, closeFile, getActiveFileContent, saveActiveFile, updateFileContent } =
    useEditorStore();
  const saveState = useEditorStore((s) => s.saveState);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorInstanceRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const results = useBuildStore((s) => s.results);
  const getDiagnosticsForFile = useBuildStore((s) => s.getDiagnosticsForFile);

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
      const content = await fetchFileContent(path, currentProjectId ?? undefined);
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

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || !activeFile) return;
      updateFileContent(activeFile, value);
      scheduleAutoSave(activeFile, currentProjectId ?? undefined);
    },
    [activeFile, currentProjectId, updateFileContent],
  );

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile(currentProjectId ?? undefined);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentProjectId, saveActiveFile]);

  // Set Monaco markers from build diagnostics
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorInstanceRef.current;
    if (!monaco || !editor || !activeFile) return;

    const model = editor.getModel();
    if (!model) return;

    const diagnostics = getDiagnosticsForFile(activeFile);
    const markers: monacoEditor.IMarkerData[] = diagnostics.map((d) => ({
      severity:
        d.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : d.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
      message: d.message,
      startLineNumber: d.line ?? 1,
      startColumn: d.column ?? 1,
      endLineNumber: d.line ?? 1,
      endColumn: (d.column ?? 1) + 1,
      source: 'Build',
    }));

    monaco.editor.setModelMarkers(model, 'build-diagnostics', markers);

    return () => {
      if (model && !model.isDisposed()) {
        monaco.editor.setModelMarkers(model, 'build-diagnostics', []);
      }
    };
  }, [activeFile, results, getDiagnosticsForFile]);

  const handleEditorReady = useCallback(
    (editor: monacoEditor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
      editorInstanceRef.current = editor;
      monacoRef.current = monaco;
    },
    [],
  );

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

  // Status bar text
  let statusText: string;
  let statusColor: string;
  switch (saveState.status) {
    case 'saving':
      statusText = 'Saving...';
      statusColor = 'text-yellow-500';
      break;
    case 'saved':
      statusText = 'Saved';
      statusColor = 'text-green-500';
      break;
    case 'error':
      statusText = `Save failed: ${saveState.error ?? 'Unknown error'}`;
      statusColor = 'text-red-500';
      break;
    default:
      statusText = activeFileContent.isDirty ? 'Unsaved changes' : 'Saved';
      statusColor = 'text-muted-foreground';
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
              {file.isDirty && (
                <Circle className="h-2 w-2 fill-current text-amber-400" />
              )}
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
            onChange={handleEditorChange}
            onEditorReady={handleEditorReady}
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
        <div className={statusColor}>{statusText}</div>
      </div>
    </div>
  );
}
