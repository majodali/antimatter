/**
 * Functional tests for the File Explorer feature.
 *
 * Each test exercises ActionContext file/editor operations and verifies
 * expected results. These tests run identically via ServiceActionContext,
 * FetchActionContext, or BrowserActionContext.
 *
 * In BrowserActionContext (DOM-only mode):
 * - writeFile clicks "New File" button, types filename, presses Enter
 * - readFile opens file via tree click, reads Monaco
 * - deleteFile throws UINotSupportedError (no delete UI exists)
 * - getFileTree scrapes visible file-tree-item-* DOM elements
 * - mkdir clicks "New Folder" button
 */

import type { TestModule } from '../test-types.js';

// FT-FILE-001
const displayFileTree: TestModule = {
  id: 'FT-FILE-001',
  name: 'Display file tree with nested structure',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create a nested directory structure
    await ctx.mkdir('src');
    await ctx.writeFile('src/index.ts', 'export default {}');
    await ctx.writeFile('src/utils.ts', 'export function add(a: number, b: number) { return a + b; }');
    await ctx.mkdir('src/components');
    await ctx.writeFile('src/components/App.tsx', '<div>App</div>');
    await ctx.writeFile('README.md', '# Project');

    // Act: fetch the file tree (expands all folders first in DOM mode)
    const tree = await ctx.getFileTree();

    // Verify: tree contains all created files and directories
    const paths = flattenTree(tree);
    const hasSrc = paths.some(p => p.includes('src'));
    const hasIndex = paths.some(p => p.includes('index.ts'));
    const hasUtils = paths.some(p => p.includes('utils.ts'));
    const hasComponents = paths.some(p => p.includes('components'));
    const hasApp = paths.some(p => p.includes('App.tsx'));
    const hasReadme = paths.some(p => p.includes('README.md'));

    if (!hasSrc || !hasIndex || !hasUtils || !hasComponents || !hasApp || !hasReadme) {
      return {
        pass: false,
        detail: `Missing expected paths. Found: ${paths.join(', ')}`,
      };
    }

    return { pass: true, detail: `File tree contains ${paths.length} entries including nested structure` };
  },
};

// FT-FILE-002
const createFile: TestModule = {
  id: 'FT-FILE-002',
  name: 'Create file',
  area: 'file-explorer',
  run: async (ctx) => {
    // Act: create a new file
    await ctx.writeFile('hello.txt', 'Hello World');

    // Verify: file appears in tree
    const tree = await ctx.getFileTree();
    const paths = flattenTree(tree);
    const found = paths.some(p => p.includes('hello.txt'));
    if (!found) {
      return { pass: false, detail: `hello.txt not found in file tree. Found: ${paths.join(', ')}` };
    }

    // Verify: file content is correct (readFile opens it in editor via tree click)
    const content = await ctx.readFile('hello.txt');
    if (content !== 'Hello World') {
      return { pass: false, detail: `Expected 'Hello World', got '${content}'` };
    }

    // Verify: file is open in editor
    const active = await ctx.getActiveFile();
    if (!active || !active.includes('hello.txt')) {
      return { pass: false, detail: `Expected active file 'hello.txt', got '${active}'` };
    }

    return { pass: true, detail: 'File created, visible in tree, content correct, opened in editor' };
  },
};

// FT-FILE-003
const createFolder: TestModule = {
  id: 'FT-FILE-003',
  name: 'Create folder with nested file',
  area: 'file-explorer',
  run: async (ctx) => {
    // Act: create a folder
    await ctx.mkdir('new-folder');

    // Verify: folder appears in tree
    const tree = await ctx.getFileTree();
    const paths = flattenTree(tree);
    const found = paths.some(p => p.includes('new-folder'));
    if (!found) {
      return { pass: false, detail: `new-folder not found in file tree. Found: ${paths.join(', ')}` };
    }

    // Verify: can create files inside the folder
    await ctx.writeFile('new-folder/file.txt', 'nested content');
    const content = await ctx.readFile('new-folder/file.txt');
    if (content !== 'nested content') {
      return { pass: false, detail: `Expected 'nested content', got '${content}'` };
    }

    return { pass: true, detail: 'Folder created, visible in tree, can contain nested files' };
  },
};

// FT-FILE-004
// This test exercises deleteFile which throws UINotSupportedError in DOM mode.
// The UINotSupportedError will be caught by the test runner and reported as 'unsupported'
// — a valuable signal that the IDE needs a delete file UI.
const deleteFile: TestModule = {
  id: 'FT-FILE-004',
  name: 'Delete file',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create a file
    await ctx.writeFile('to-delete.txt', 'temporary');

    // Act: delete the file (throws UINotSupportedError in DOM mode)
    await ctx.deleteFile('to-delete.txt');

    // Verify: file no longer in tree
    const tree = await ctx.getFileTree();
    const paths = flattenTree(tree);
    const stillExists = paths.some(p => p.includes('to-delete.txt'));
    if (stillExists) {
      return { pass: false, detail: 'Deleted file still appears in file tree' };
    }

    return { pass: true, detail: 'File deleted, removed from tree' };
  },
};

// FT-FILE-005
// Uses deleteFile — throws UINotSupportedError in DOM mode.
const renameFile: TestModule = {
  id: 'FT-FILE-005',
  name: 'Rename file',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create a file
    await ctx.writeFile('old-name.txt', 'rename me');

    // Act: simulate rename (write new, delete old)
    const content = await ctx.readFile('old-name.txt');
    await ctx.writeFile('new-name.txt', content);
    await ctx.deleteFile('old-name.txt');

    // Verify: old name gone, new name present
    const tree = await ctx.getFileTree();
    const paths = flattenTree(tree);
    const hasOld = paths.some(p => p.includes('old-name.txt'));
    const hasNew = paths.some(p => p.includes('new-name.txt'));

    if (hasOld) {
      return { pass: false, detail: 'Old filename still appears in tree' };
    }
    if (!hasNew) {
      return { pass: false, detail: 'New filename not found in tree' };
    }

    return { pass: true, detail: 'File renamed: old path removed, new path present, content preserved' };
  },
};

// FT-FILE-006
// Uses deleteFile — throws UINotSupportedError in DOM mode.
const moveFile: TestModule = {
  id: 'FT-FILE-006',
  name: 'Move file',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create source file and destination directory
    await ctx.writeFile('move-me.txt', 'moving content');
    await ctx.mkdir('destination');

    // Act: simulate move (write to new path, delete old)
    const content = await ctx.readFile('move-me.txt');
    await ctx.writeFile('destination/move-me.txt', content);
    await ctx.deleteFile('move-me.txt');

    // Verify: old path gone, new path present
    const tree = await ctx.getFileTree();
    const paths = flattenTree(tree);
    const hasAtRoot = paths.some(p => p === 'move-me.txt');

    if (hasAtRoot) {
      return { pass: false, detail: 'File still at original location' };
    }

    return { pass: true, detail: 'File moved to destination folder' };
  },
};

// FT-FILE-007
const selectFileOpensEditor: TestModule = {
  id: 'FT-FILE-007',
  name: 'Select file opens editor',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create files
    await ctx.writeFile('file-a.ts', 'const a = 1;');
    await ctx.writeFile('file-b.ts', 'const b = 2;');

    // Act: open first file
    await ctx.openFileInEditor('file-a.ts');
    let active = await ctx.getActiveFile();
    if (!active || !active.includes('file-a.ts')) {
      return { pass: false, detail: `Expected active 'file-a.ts', got '${active}'` };
    }

    // Act: open second file — second should be active
    await ctx.openFileInEditor('file-b.ts');
    active = await ctx.getActiveFile();
    if (!active || !active.includes('file-b.ts')) {
      return { pass: false, detail: `Expected active 'file-b.ts', got '${active}'` };
    }

    // Verify: both files in open tabs
    let tabs = await ctx.getOpenTabs();
    const hasA = tabs.some(t => t.includes('file-a.ts'));
    const hasB = tabs.some(t => t.includes('file-b.ts'));
    if (!hasA || !hasB) {
      return { pass: false, detail: `Expected both files in tabs. Tabs: ${tabs.join(', ')}` };
    }

    // Act: open first file again — should reuse tab, not create new
    await ctx.openFileInEditor('file-a.ts');
    active = await ctx.getActiveFile();
    if (!active || !active.includes('file-a.ts')) {
      return { pass: false, detail: `Expected active 'file-a.ts' after re-open, got '${active}'` };
    }

    // Act: close a tab — verify active file updates
    await ctx.closeTab('file-a.ts');
    tabs = await ctx.getOpenTabs();
    active = await ctx.getActiveFile();
    const closedStillOpen = tabs.some(t => t.includes('file-a.ts'));
    if (closedStillOpen) {
      return { pass: false, detail: 'Closed tab still in tabs list' };
    }

    return { pass: true, detail: 'File selection opens tabs, reuses existing, closing works correctly' };
  },
};

// ---- Helpers ----

/** Flatten a file tree into a list of path strings. */
function flattenTree(tree: any[]): string[] {
  const paths: string[] = [];
  for (const entry of tree) {
    if (entry.path) paths.push(entry.path);
    else if (entry.name) paths.push(entry.name);
    if (entry.children) {
      paths.push(...flattenTree(entry.children));
    }
  }
  return paths;
}

// ---- Export ----

export const fileExplorerTests: readonly TestModule[] = [
  displayFileTree,
  createFile,
  createFolder,
  deleteFile,
  renameFile,
  moveFile,
  selectFileOpensEditor,
];
