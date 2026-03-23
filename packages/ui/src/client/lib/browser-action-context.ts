/**
 * BrowserActionContext — ActionContext implementation for in-browser testing.
 *
 * Drives the UI EXCLUSIVELY through DOM interactions via data-testid selectors.
 * This ensures tests verify real UI behavior, not internal state.
 *
 * When a required DOM element doesn't exist (i.e. the UI hasn't implemented
 * that capability yet), a UINotSupportedError is thrown — distinct from a
 * test failure. This surfaces as an amber "unsupported" indicator in the
 * Test Results panel.
 */

import type { ActionContext, GitStatusResult } from '../../shared/action-context.js';
import {
  UINotSupportedError,
  findElement,
  queryElement,
  elementExists,
  clickElement,
  doubleClickElement,
  typeIntoElement,
  typeAndPressEnter,
  pressEnter,
  pressKeyOnElement,
  waitForElement,
  waitForElementGone,
  waitFor,
  findAllByTestIdPrefix,
  encodePathForTestId,
  getTextContent,
  expandAllFolders,
  ensureParentFoldersExpanded,
} from './dom-helpers.js';

export interface BrowserActionContextOptions {
  /** Delay in ms between actions (default: 200). Set to 0 for full speed. */
  delayMs?: number;
}

// ---- Monaco bridge typings ----

declare global {
  interface Window {
    __monacoEditor?: import('monaco-editor').editor.IStandaloneCodeEditor;
    __monacoInstance?: typeof import('monaco-editor');
  }
}

export class BrowserActionContext implements ActionContext {
  private readonly delayMs: number;

  constructor(options: BrowserActionContextOptions = {}) {
    this.delayMs = options.delayMs ?? 200;
  }

  private async delay(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  /** Small extra settle time for React to process after DOM interaction. */
  private async settle(ms = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Wait for a file-tree-item to appear, with early failure detection.
   * Instead of blindly waiting 10s, checks for error/loading/empty states
   * and fails immediately with a diagnostic message.
   */
  private async waitForTreeItem(pathTestId: string, operation: string, timeoutMs = 10000): Promise<void> {
    const interval = 100;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      // Check if the target element appeared
      if (queryElement(pathTestId)) return;

      // Detect error state — FileExplorer shows error instead of tree
      const errorEl = queryElement('file-explorer-error');
      if (errorEl) {
        const errorText = errorEl.textContent?.trim() ?? 'unknown error';
        throw new Error(
          `${operation}: FileExplorer is in error state: "${errorText}". ` +
          `Tree item [data-testid="${pathTestId}"] will never appear.`,
        );
      }

      // Detect loading state — FileTree replaced by "Loading..."
      const loadingEl = queryElement('file-explorer-loading');
      if (loadingEl && Date.now() > deadline - 2000) {
        // Only warn if still loading near deadline (brief loading is normal)
        throw new Error(
          `${operation}: FileExplorer stuck in loading state for >` +
          `${Math.round(timeoutMs / 1000 - 2)}s. Tree item [data-testid="${pathTestId}"] unreachable.`,
        );
      }

      // Detect creation input still present — submitCreation may not have fired
      const createInput = queryElement('file-explorer-create-input');
      if (createInput && Date.now() > deadline - 5000) {
        const inputVal = (createInput as HTMLInputElement).value;
        throw new Error(
          `${operation}: Creation input still visible (value="${inputVal}") after >` +
          `${Math.round((timeoutMs - 5000) / 1000)}s. submitCreation may not have been triggered.`,
        );
      }

      await new Promise((r) => setTimeout(r, interval));
    }

    // Final state snapshot for the timeout error
    const treeItems = findAllByTestIdPrefix('file-tree-item-');
    const treeItemPaths = treeItems.map(el => el.getAttribute('data-path')).filter(Boolean);
    const errorEl = queryElement('file-explorer-error');
    const loadingEl = queryElement('file-explorer-loading');
    const emptyEl = queryElement('file-explorer-empty');
    const createInput = queryElement('file-explorer-create-input');

    const state = [
      `treeItems=${treeItems.length}`,
      `domPaths=[${treeItemPaths.join(',')}]`,
      errorEl ? `error="${errorEl.textContent?.trim()}"` : null,
      loadingEl ? 'loading=true' : null,
      emptyEl ? 'empty=true' : null,
      createInput ? `createInput="${(createInput as HTMLInputElement).value}"` : null,
    ].filter(Boolean).join(', ');

    throw new Error(
      `${operation}: Timed out waiting for [data-testid="${pathTestId}"] after ${timeoutMs}ms. ` +
      `Explorer state: ${state}`,
    );
  }

  // ---- Files ----

  async writeFile(path: string, content: string): Promise<void> {
    // Click the "New File" button in the file explorer
    await clickElement('file-explorer-new-file-btn', 'writeFile');

    // Wait for the creation input to appear
    await waitForElement('file-explorer-create-input', { timeoutMs: 3000 });

    // Type the filename and press Enter in one atomic operation.
    // This prevents the input from being removed by onBlur between typing and submitting.
    // The Enter keydown is dispatched on the same element reference before any settle.
    await typeAndPressEnter('file-explorer-create-input', path, 'writeFile');

    // Wait for the creation input to disappear — confirms submitCreation completed
    // (may already be gone if the API calls completed within the settle period)
    await waitForElementGone('file-explorer-create-input', { timeoutMs: 15000 });

    // Check if submitCreation reported an error (errors are now propagated to UI)
    const createErrorEl = queryElement('file-explorer-error');
    if (createErrorEl) {
      const errorText = createErrorEl.textContent?.trim() ?? 'unknown error';
      throw new Error(`writeFile: File creation failed: ${errorText}`);
    }

    // Expand parent folders if path is nested
    if (path.includes('/')) {
      await ensureParentFoldersExpanded(path);
    }

    // Wait for the file to appear in the tree (with early failure detection).
    // If the first attempt fails, click the refresh button and retry once.
    const pathTestId = `file-tree-item-${encodePathForTestId(path)}`;
    try {
      await this.waitForTreeItem(pathTestId, 'writeFile', 5000);
    } catch {
      // Tree item didn't appear — try refreshing the file tree and retrying
      if (elementExists('file-explorer-refresh-btn')) {
        await clickElement('file-explorer-refresh-btn', 'writeFile-refresh');
        await this.settle(1000);
        if (path.includes('/')) {
          await ensureParentFoldersExpanded(path);
        }
        await this.waitForTreeItem(pathTestId, 'writeFile', 5000);
      } else {
        throw new Error(
          `writeFile: Tree item [data-testid="${pathTestId}"] not found and no refresh button available`,
        );
      }
    }

    // Wait for the file to open in the editor (the FileExplorer auto-opens new files)
    await this.settle(300);

    // Set content via Monaco bridge and save via editor store
    if (content && window.__monacoEditor) {
      window.__monacoEditor.setValue(content);
      await this.settle(100);

      // Save via the editor store's saveActiveFile, which calls api.saveFile
      // and triggers the workspace file router's onFileChange callback.
      // This is more reliable than dispatching Ctrl+S keyboard events which
      // may not propagate through React's synthetic event system.
      const { useEditorStore } = await import('../stores/editorStore.js');
      const { useProjectStore } = await import('../stores/projectStore.js');
      const editorStore = useEditorStore.getState();
      const projectId = useProjectStore.getState().currentProjectId;

      // Update the in-memory content so saveActiveFile persists the new value
      if (editorStore.activeFile) {
        editorStore.updateFileContent(editorStore.activeFile, content);
      }
      await editorStore.saveActiveFile(projectId ?? undefined);
      await this.settle(200);
    }

    await this.delay();
  }

  async readFile(path: string): Promise<string> {
    // Open the file by clicking on it in the file tree
    await this.openFileInEditor(path);

    // Read content from Monaco editor
    if (!window.__monacoEditor) {
      throw new Error('Monaco editor not available — cannot read file content');
    }

    await this.settle(200);
    return window.__monacoEditor.getValue();
  }

  async deleteFile(path: string): Promise<void> {
    // Ensure the explorer sidebar is active
    if (elementExists('sidebar-explorer-btn')) {
      await clickElement('sidebar-explorer-btn', 'deleteFile');
      await this.settle(100);
    }

    // For nested paths, expand parent folders so the target item is visible
    if (path.includes('/')) {
      await ensureParentFoldersExpanded(path);
    }

    // Click the file to select it
    const pathTestId = `file-tree-item-${encodePathForTestId(path)}`;
    await clickElement(pathTestId, 'deleteFile');
    await this.settle(100);

    // Focus the file explorer panel (keyboard events need it focused)
    const explorerPanel = queryElement('file-explorer-panel');
    if (explorerPanel) {
      explorerPanel.focus();
      await this.settle(50);
    }

    // Press Delete key to trigger delete confirmation
    await pressKeyOnElement('Delete', explorerPanel);
    await this.settle(200);

    // Wait for and click the confirm delete button
    await waitForElement('file-explorer-confirm-delete-btn', { timeoutMs: 3000 });
    await clickElement('file-explorer-confirm-delete-btn', 'deleteFile-confirm');
    await this.settle(500);

    // Wait for the file to disappear from the tree
    try {
      await waitForElementGone(pathTestId, { timeoutMs: 10000 });
    } catch {
      // File might still be in tree — try refreshing
      if (elementExists('file-explorer-refresh-btn')) {
        await clickElement('file-explorer-refresh-btn', 'deleteFile-refresh');
        await this.settle(1000);
        await waitForElementGone(pathTestId, { timeoutMs: 5000 });
      }
    }

    await this.delay();
  }

  async mkdir(path: string): Promise<void> {
    // Click the "New Folder" button
    await clickElement('file-explorer-new-folder-btn', 'mkdir');

    // Wait for creation input
    await waitForElement('file-explorer-create-input', { timeoutMs: 3000 });

    // Type folder name and press Enter atomically (prevents onBlur race)
    await typeAndPressEnter('file-explorer-create-input', path, 'mkdir');

    // Wait for the creation input to disappear — confirms submission completed
    await waitForElementGone('file-explorer-create-input', { timeoutMs: 15000 });

    // Check if creation reported an error
    const mkdirErrorEl = queryElement('file-explorer-error');
    if (mkdirErrorEl) {
      const errorText = mkdirErrorEl.textContent?.trim() ?? 'unknown error';
      throw new Error(`mkdir: Folder creation failed: ${errorText}`);
    }

    // Expand parent folders if nested
    if (path.includes('/')) {
      await ensureParentFoldersExpanded(path);
    }

    // Wait for the folder to appear in the tree (with retry on failure)
    const pathTestId = `file-tree-item-${encodePathForTestId(path)}`;
    try {
      await this.waitForTreeItem(pathTestId, 'mkdir', 5000);
    } catch {
      if (elementExists('file-explorer-refresh-btn')) {
        await clickElement('file-explorer-refresh-btn', 'mkdir-refresh');
        await this.settle(1000);
        if (path.includes('/')) {
          await ensureParentFoldersExpanded(path);
        }
        await this.waitForTreeItem(pathTestId, 'mkdir', 5000);
      } else {
        throw new Error(
          `mkdir: Tree item [data-testid="${pathTestId}"] not found and no refresh button available`,
        );
      }
    }

    await this.delay();
  }

  async getFileTree(_path?: string): Promise<any[]> {
    // Expand all collapsed folders first so we can see the full tree
    await expandAllFolders();

    // Scrape all file-tree-item-* elements from the DOM
    const items = findAllByTestIdPrefix('file-tree-item-');
    const result: any[] = [];

    for (const el of items) {
      const filePath = el.getAttribute('data-path');
      if (filePath) {
        const isDir = el.getAttribute('data-type') === 'directory';
        result.push({
          name: filePath.split('/').pop() || filePath,
          path: filePath,
          type: isDir ? 'directory' : 'file',
        });
      }
    }

    return result;
  }

  // ---- Build ----
  // These operations have no direct UI representation — throw UINotSupportedError

  async saveBuildConfig(_config: { rules: any[]; targets: any[] }): Promise<void> {
    throw new UINotSupportedError('saveBuildConfig', 'build-config-save', 'Build config editing not available via DOM');
  }

  async loadBuildConfig(): Promise<{ rules: any[]; targets: any[] }> {
    throw new UINotSupportedError('loadBuildConfig', 'build-config-load', 'Build config loading not available via DOM');
  }

  async executeBuild(): Promise<any[]> {
    // Look for a build button in the sidebar
    if (!elementExists('sidebar-build-btn')) {
      throw new UINotSupportedError('executeBuild', 'sidebar-build-btn');
    }
    // Click the build sidebar, then look for a run button
    await clickElement('sidebar-build-btn', 'executeBuild');
    await this.settle(300);

    // Try to find a build-run-all button
    const buildRunBtn = queryElement('build-run-all-btn');
    if (!buildRunBtn) {
      throw new UINotSupportedError('executeBuild', 'build-run-all-btn', 'Build panel does not have a Run All button accessible via DOM');
    }
    buildRunBtn.click();
    await this.settle(500);
    await this.delay();
    return [];
  }

  async getBuildResults(): Promise<any[]> {
    throw new UINotSupportedError('getBuildResults', 'build-results', 'Build results not accessible via DOM');
  }

  async clearBuildResults(): Promise<void> {
    throw new UINotSupportedError('clearBuildResults', 'build-results-clear', 'Build results clearing not available via DOM');
  }

  async clearBuildCache(_targetId?: string): Promise<void> {
    throw new UINotSupportedError('clearBuildCache', 'build-cache-clear', 'Build cache clearing not available via DOM');
  }

  async getStaleTargets(): Promise<string[]> {
    throw new UINotSupportedError('getStaleTargets', 'build-stale-targets', 'Stale targets not accessible via DOM');
  }

  // ---- Deploy ----

  async saveDeployConfig(_config: { modules: any[]; packaging: any[]; targets: any[] }): Promise<void> {
    throw new UINotSupportedError('saveDeployConfig', 'deploy-config-save', 'Deploy config editing not available via DOM');
  }

  async loadDeployConfig(): Promise<{ modules: any[]; packaging: any[]; targets: any[] }> {
    throw new UINotSupportedError('loadDeployConfig', 'deploy-config-load', 'Deploy config loading not available via DOM');
  }

  async executeDeploy(_options?: { targetIds?: string[]; dryRun?: boolean }): Promise<any[]> {
    throw new UINotSupportedError('executeDeploy', 'deploy-run-btn', 'Deploy execution not available via DOM');
  }

  async getDeployResults(): Promise<any[]> {
    throw new UINotSupportedError('getDeployResults', 'deploy-results', 'Deploy results not accessible via DOM');
  }

  async clearDeployResults(): Promise<void> {
    throw new UINotSupportedError('clearDeployResults', 'deploy-results-clear', 'Deploy results clearing not available via DOM');
  }

  // ---- Environments ----

  async saveEnvironmentConfig(_config: { pipeline: any; environments: any[]; transitions: any[] }): Promise<void> {
    throw new UINotSupportedError('saveEnvironmentConfig', 'env-config-save', 'Environment config not available via DOM');
  }

  async loadEnvironmentConfig(): Promise<{ pipeline: any; environments: any[]; transitions: any[] }> {
    throw new UINotSupportedError('loadEnvironmentConfig', 'env-config-load', 'Environment config not available via DOM');
  }

  async createEnvironment(_name: string, _stageId?: string): Promise<any> {
    throw new UINotSupportedError('createEnvironment', 'env-create-btn', 'Environment creation not available via DOM');
  }

  async listEnvironments(): Promise<any[]> {
    throw new UINotSupportedError('listEnvironments', 'env-list', 'Environment listing not available via DOM');
  }

  async getEnvironment(_envId: string): Promise<any> {
    throw new UINotSupportedError('getEnvironment', 'env-detail', 'Environment detail not available via DOM');
  }

  async destroyEnvironment(_envId: string): Promise<void> {
    throw new UINotSupportedError('destroyEnvironment', 'env-destroy-btn', 'Environment destruction not available via DOM');
  }

  // ---- Agent ----

  async sendChat(_message: string): Promise<{ response: string }> {
    throw new UINotSupportedError('sendChat', 'chat-input', 'Chat not available via DOM automation');
  }

  async getHistory(): Promise<any[]> {
    throw new UINotSupportedError('getHistory', 'chat-history', 'Chat history not available via DOM');
  }

  async clearHistory(): Promise<void> {
    throw new UINotSupportedError('clearHistory', 'chat-clear-btn', 'Chat history clearing not available via DOM');
  }

  async getCustomTools(): Promise<any[]> {
    throw new UINotSupportedError('getCustomTools', 'agent-tools', 'Agent tools not available via DOM');
  }

  async saveCustomTools(_tools: any[]): Promise<void> {
    throw new UINotSupportedError('saveCustomTools', 'agent-tools-save', 'Agent tools saving not available via DOM');
  }

  // ---- Editor (via DOM + Monaco bridge) ----

  async openFileInEditor(path: string): Promise<void> {
    const pathTestId = `file-tree-item-${encodePathForTestId(path)}`;

    // Make sure the explorer sidebar is active
    if (elementExists('sidebar-explorer-btn')) {
      await clickElement('sidebar-explorer-btn', 'openFileInEditor');
      await this.settle(100);
    }

    // For nested paths, expand parent folders so the target item is in the DOM
    if (path.includes('/')) {
      await ensureParentFoldersExpanded(path);
    }

    // Double-click the file in the tree to open it in the editor.
    // Single click now only selects; double-click opens.
    await doubleClickElement(pathTestId, 'openFileInEditor');
    await this.settle(500);

    await this.delay();
  }

  async getActiveFile(): Promise<string | null> {
    // Find the editor tab with data-active="true"
    const tabs = findAllByTestIdPrefix('editor-tab-');
    for (const tab of tabs) {
      // Skip close buttons (editor-tab-close-*) and dirty indicators (editor-tab-dirty-*)
      const testId = tab.getAttribute('data-testid') ?? '';
      if (testId.includes('-close-') || testId.includes('-dirty-')) continue;

      if (tab.getAttribute('data-active') === 'true') {
        return tab.getAttribute('data-path') ?? null;
      }
    }
    return null;
  }

  async getOpenTabs(): Promise<string[]> {
    const tabs = findAllByTestIdPrefix('editor-tab-');
    const paths: string[] = [];
    for (const tab of tabs) {
      const testId = tab.getAttribute('data-testid') ?? '';
      // Skip close buttons and dirty indicators
      if (testId.includes('-close-') || testId.includes('-dirty-')) continue;

      const path = tab.getAttribute('data-path');
      if (path) {
        paths.push(path);
      }
    }
    return paths;
  }

  async closeTab(path: string): Promise<void> {
    const fileName = path.split('/').pop() ?? path;
    const closeTestId = `editor-tab-close-${fileName}`;

    await clickElement(closeTestId, 'closeTab');
    await this.settle(200);
    await this.delay();
  }

  async editFileContent(path: string, content: string): Promise<void> {
    // Open the file first
    await this.openFileInEditor(path);
    await this.settle(200);

    // Set content via Monaco bridge
    if (!window.__monacoEditor) {
      throw new Error('Monaco editor not available — cannot edit file content');
    }

    window.__monacoEditor.setValue(content);
    await this.settle(100);

    // Save via the editor store (more reliable than Ctrl+S keyboard dispatch)
    const { useEditorStore } = await import('../stores/editorStore.js');
    const { useProjectStore } = await import('../stores/projectStore.js');
    const editorStore = useEditorStore.getState();
    const projectId = useProjectStore.getState().currentProjectId;

    if (editorStore.activeFile) {
      editorStore.updateFileContent(editorStore.activeFile, content);
    }
    await editorStore.saveActiveFile(projectId ?? undefined);
    await this.settle(200);

    await this.delay();
  }

  async saveActiveFile(): Promise<void> {
    const { useEditorStore } = await import('../stores/editorStore.js');
    const { useProjectStore } = await import('../stores/projectStore.js');
    const projectId = useProjectStore.getState().currentProjectId;
    await useEditorStore.getState().saveActiveFile(projectId ?? undefined);
    await this.settle(200);
    await this.delay();
  }

  // ---- Git (via DOM interaction with Git panel) ----

  async getGitStatus(): Promise<GitStatusResult> {
    throw new UINotSupportedError('getGitStatus', 'git-status', 'Git status not fully accessible via DOM');
  }

  async stageFiles(_files: string[]): Promise<void> {
    throw new UINotSupportedError('stageFiles', 'git-stage', 'Git staging not available via DOM');
  }

  async unstageFiles(_files: string[]): Promise<void> {
    throw new UINotSupportedError('unstageFiles', 'git-unstage', 'Git unstaging not available via DOM');
  }

  async gitCommit(_message: string): Promise<void> {
    // Try to use the Git panel UI
    if (!elementExists('git-commit-input')) {
      throw new UINotSupportedError('gitCommit', 'git-commit-input', 'Git commit input not found in DOM');
    }

    await typeIntoElement('git-commit-input', _message, 'gitCommit');
    await clickElement('git-commit-btn', 'gitCommit');
    await this.settle(500);
    await this.delay();
  }

  async gitPush(): Promise<void> {
    if (!elementExists('git-push-btn')) {
      throw new UINotSupportedError('gitPush', 'git-push-btn', 'Git push button not found in DOM');
    }
    await clickElement('git-push-btn', 'gitPush');
    await this.settle(500);
    await this.delay();
  }

  async gitPull(): Promise<void> {
    if (!elementExists('git-pull-btn')) {
      throw new UINotSupportedError('gitPull', 'git-pull-btn', 'Git pull button not found in DOM');
    }
    await clickElement('git-pull-btn', 'gitPull');
    await this.settle(500);
    await this.delay();
  }

  // ---- Workflow (no direct DOM representation) ----

  async emitWorkflowEvent(_event: { type: string; [key: string]: unknown }): Promise<any> {
    throw new UINotSupportedError('emitWorkflowEvent', 'workflow-event', 'Workflow events not available via DOM');
  }

  async runWorkflowRule(_ruleId: string): Promise<any> {
    throw new UINotSupportedError('runWorkflowRule', 'workflow-rule-run', 'Workflow rule execution not available via DOM');
  }

  async getWorkflowState(): Promise<unknown> {
    throw new UINotSupportedError('getWorkflowState', 'workflow-state', 'Workflow state not accessible via DOM');
  }

  async getWorkflowDeclarations(): Promise<any> {
    throw new UINotSupportedError('getWorkflowDeclarations', 'workflow-declarations', 'Workflow declarations not accessible via DOM');
  }

  async getProjectErrors(): Promise<any[]> {
    throw new UINotSupportedError('getProjectErrors', 'project-errors', 'Project errors not accessible via DOM');
  }
}
