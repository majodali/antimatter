import { useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useTheme } from '../theme-provider';
import type { editor } from 'monaco-editor';

export interface CodeAction {
  action: 'fix' | 'explain' | 'refactor';
  code: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
}

interface MonacoEditorProps {
  value: string;
  language: string;
  filePath?: string;
  readOnly?: boolean;
  onChange?: (value: string | undefined) => void;
  onEditorReady?: (editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => void;
  onCodeAction?: (action: CodeAction) => void;
}

export function MonacoEditor({
  value,
  language,
  filePath = '',
  readOnly = false,
  onChange,
  onEditorReady,
  onCodeAction,
}: MonacoEditorProps) {
  const { theme } = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const onCodeActionRef = useRef(onCodeAction);
  const filePathRef = useRef(filePath);
  const languageRef = useRef(language);

  // Keep refs in sync
  onCodeActionRef.current = onCodeAction;
  filePathRef.current = filePath;
  languageRef.current = language;

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Configure editor options
    editor.updateOptions({
      readOnly,
      minimap: { enabled: true },
      fontSize: 14,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'off',
      folding: true,
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 3,
      glyphMargin: false,
    });

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      editor.getAction('actions.find')?.run();
    });

    // Suppress browser "Save Page As" dialog when editor is focused
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});

    // Register AI context menu actions
    const actions: { id: string; label: string; action: CodeAction['action'] }[] = [
      { id: 'ai.fix', label: 'AI: Fix this code', action: 'fix' },
      { id: 'ai.explain', label: 'AI: Explain this code', action: 'explain' },
      { id: 'ai.refactor', label: 'AI: Refactor this code', action: 'refactor' },
    ];

    for (const def of actions) {
      editor.addAction({
        id: def.id,
        label: def.label,
        contextMenuGroupId: '9_ai',
        contextMenuOrder: actions.indexOf(def) + 1,
        precondition: 'editorHasSelection',
        run: (ed) => {
          const selection = ed.getSelection();
          const selectedText = selection ? ed.getModel()?.getValueInRange(selection) : '';
          if (!selectedText || !selection) return;

          onCodeActionRef.current?.({
            action: def.action,
            code: selectedText,
            filePath: filePathRef.current,
            language: languageRef.current,
            startLine: selection.startLineNumber,
            endLine: selection.endLineNumber,
          });
        },
      });
    }

    onEditorReady?.(editor, monaco as any);
  };

  useEffect(() => {
    // Update editor when value changes externally
    if (editorRef.current && editorRef.current.getValue() !== value) {
      const model = editorRef.current.getModel();
      if (model) {
        model.setValue(value);
      }
    }
  }, [value]);

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      onMount={handleEditorDidMount}
      onChange={onChange}
      options={{
        readOnly,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: 'on',
        automaticLayout: true,
      }}
    />
  );
}
