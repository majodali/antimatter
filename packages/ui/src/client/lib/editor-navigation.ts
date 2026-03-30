/**
 * Shared "navigate to file:line:column" utility.
 *
 * Used by ProblemsPanel (double-click on error) and TestResultsPanel
 * (double-click on test result) to open a file in the editor and
 * optionally scroll to a specific position.
 */

import { useFileStore } from '@/stores/fileStore';
import { useEditorStore } from '@/stores/editorStore';
import { fetchFileContent } from '@/lib/api';
import { detectLanguage } from '@/lib/languageDetection';
import type { WorkspacePath } from '@antimatter/filesystem';

/**
 * Open a file in the editor and optionally navigate to a specific line/column.
 * Selects the file in the file tree, opens it in the editor, and scrolls to
 * the target position once Monaco is ready.
 */
export function navigateToFile(file: string, line?: number, column?: number): void {
  const { selectFile } = useFileStore.getState();
  const editorState = useEditorStore.getState();

  // Select in file tree
  selectFile(file as WorkspacePath);

  // Poll until Monaco has the correct file model active, then reveal the location.
  const revealWhenReady = () => {
    if (!line) return;
    let attempts = 0;
    const check = () => {
      attempts++;
      const editor = (window as any).__monacoEditor;
      if (!editor) { if (attempts < 20) setTimeout(check, 50); return; }
      const model = editor.getModel();
      const uri = model?.uri?.path ?? '';
      if (uri.endsWith(file) || uri.includes(file)) {
        const pos = { lineNumber: line, column: column ?? 1 };
        editor.setPosition(pos);
        editor.revealLineInCenter(line);
        editor.focus();
      } else if (attempts < 20) {
        setTimeout(check, 50);
      }
    };
    setTimeout(check, 50);
  };

  if (editorState.openFiles.has(file as WorkspacePath)) {
    editorState.setActiveFile(file as WorkspacePath);
    revealWhenReady();
  } else {
    fetchFileContent(file).then((content) => {
      editorState.openFile(file as WorkspacePath, content, detectLanguage(file));
      revealWhenReady();
    }).catch(() => {});
  }
}
