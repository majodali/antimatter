import { useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useTheme } from '../theme-provider';
import type { editor } from 'monaco-editor';

interface MonacoEditorProps {
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string | undefined) => void;
  onEditorReady?: (editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => void;
}

export function MonacoEditor({
  value,
  language,
  readOnly = false,
  onChange,
  onEditorReady,
}: MonacoEditorProps) {
  const { theme } = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

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
