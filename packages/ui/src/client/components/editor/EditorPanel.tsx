import { useEffect, useCallback, useState, useRef } from 'react';
import { X, FileText, Circle } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor';
import type { CodeAction } from './MonacoEditor';
import { useChatStore } from '@/stores/chatStore';
import { Button } from '../ui/button';
import { useFileStore } from '@/stores/fileStore';
import { useEditorStore, scheduleAutoSave } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useApplicationStore } from '@/stores/applicationStore';
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
  const decorationsRef = useRef<string[]>([]);
  const projectErrors = useApplicationStore((s) => s.getErrors());

  // Note: File opening is now driven by double-click in FileTree → FileExplorer.handleOpenFile.
  // The old auto-open on selectedFile change has been removed to support the new
  // single-click=select, double-click=open interaction model.

  // At startup and when project changes, validate that all open tabs still exist.
  // Closes tabs for files that were deleted while the browser was closed.
  useEffect(() => {
    if (currentProjectId && openFiles.size > 0) {
      useEditorStore.getState().validateOpenTabs(currentProjectId);
    }
  }, [currentProjectId]);

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

  // Set Monaco decorations + markers from project errors (errorStore)
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorInstanceRef.current;
    if (!monaco || !editor || !activeFile) return;

    const model = editor.getModel();
    if (!model) return;

    const fileErrors = useApplicationStore.getState().getErrorsForFile(activeFile);

    // Map highlight styles to Monaco CSS classes
    const styleToClass: Record<string, string> = {
      squiggly: 'squiggly-error',
      dotted: 'dotted-underline',
      solid: 'solid-underline',
      double: 'double-underline',
    };

    // Create decorations for custom error rendering
    const decorations: monacoEditor.IModelDeltaDecoration[] = fileErrors.map((err) => {
      const startLine = err.line ?? 1;
      const startCol = err.column ?? 1;
      const endLine = err.endLine ?? startLine;
      let endCol = err.endColumn ?? 0;

      // When endColumn is not provided, try to highlight the word at the error position
      if (!endCol && model) {
        const wordInfo = model.getWordAtPosition({ lineNumber: startLine, column: startCol });
        if (wordInfo) {
          endCol = wordInfo.endColumn;
        } else {
          // No word found — highlight to end of line
          const lineContent = model.getLineContent(startLine);
          endCol = lineContent.length + 1;
        }
      }
      if (!endCol) endCol = startCol + 1;
      const cssClass = styleToClass[err.errorType.highlightStyle] ?? 'squiggly-error';

      return {
        range: new monaco.Range(startLine, startCol, endLine, endCol),
        options: {
          className: cssClass,
          glyphMarginClassName: 'error-glyph-margin',
          hoverMessage: {
            value: err.detail
              ? `**${err.errorType.name}**: ${err.message}\n\n${err.detail}`
              : `**${err.errorType.name}**: ${err.message}`,
          },
          overviewRuler: {
            color: err.errorType.color,
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      };
    });

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);

    // Also set markers for the problems widget (F8 navigation, etc.)
    const markers: monacoEditor.IMarkerData[] = fileErrors.map((err) => {
      const sLine = err.line ?? 1;
      const sCol = err.column ?? 1;
      let eCol = err.endColumn ?? 0;
      if (!eCol && model) {
        const w = model.getWordAtPosition({ lineNumber: sLine, column: sCol });
        eCol = w ? w.endColumn : (model.getLineContent(sLine).length + 1);
      }
      if (!eCol) eCol = sCol + 1;
      return {
        severity:
          err.errorType.name === 'Warning' || err.errorType.name === 'Info'
            ? err.errorType.name === 'Info'
              ? monaco.MarkerSeverity.Info
              : monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Error,
        message: err.message,
        startLineNumber: sLine,
        startColumn: sCol,
        endLineNumber: err.endLine ?? sLine,
        endColumn: eCol,
        source: err.toolId,
      };
    });

    monaco.editor.setModelMarkers(model, 'project-errors', markers);

    return () => {
      if (model && !model.isDisposed()) {
        monaco.editor.setModelMarkers(model, 'project-errors', []);
      }
      // Clear decorations on cleanup
      if (editor && decorationsRef.current.length > 0) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
    };
  }, [activeFile, projectErrors]);

  const handleEditorReady = useCallback(
    (editor: monacoEditor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
      editorInstanceRef.current = editor;
      monacoRef.current = monaco;
    },
    [],
  );

  const handleCodeAction = useCallback(
    (action: CodeAction) => {
      const prompts: Record<CodeAction['action'], string> = {
        fix: 'Fix the following code',
        explain: 'Explain the following code',
        refactor: 'Refactor the following code',
      };
      const message = `${prompts[action.action]}:\n\nFile: ${action.filePath} (lines ${action.startLine}-${action.endLine})\n\`\`\`${action.language}\n${action.code}\n\`\`\``;
      useChatStore.getState().setPendingMessage(message);
    },
    [],
  );

  const activeFileContent = getActiveFileContent();
  const openFilesList = Array.from(openFiles.values());

  if (!activeFile || !activeFileContent) {
    return (
      <div className="h-full flex items-center justify-center bg-background" data-testid="editor-empty">
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
    <div className="h-full flex flex-col bg-background" data-testid="editor-panel">
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
              data-testid={`editor-tab-${fileName}`}
              data-path={file.path}
              data-active={isActive ? 'true' : 'false'}
              onClick={() => useEditorStore.getState().setActiveFile(file.path)}
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">{fileName}</span>
              {file.isDirty && (
                <Circle className="h-2 w-2 fill-current text-amber-400" data-testid={`editor-tab-dirty-${fileName}`} />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 p-0 hover:bg-background/20"
                data-testid={`editor-tab-close-${fileName}`}
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
            filePath={activeFile}
            onChange={handleEditorChange}
            onEditorReady={handleEditorReady}
            onCodeAction={handleCodeAction}
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
        <div className={statusColor} data-testid="editor-save-status">{statusText}</div>
      </div>
    </div>
  );
}
