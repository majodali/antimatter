/**
 * Functional tests for the File Explorer feature.
 *
 * Each test exercises ActionContext file/editor operations and verifies
 * expected results. These tests run identically via ServiceActionContext,
 * FetchActionContext, or BrowserActionContext.
 */

import type { TestModule } from '../test-types.js';

// FT-FILE-001
const displayFileTree: TestModule = {
  id: 'FT-FILE-001',
  name: 'Display file tree',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create a nested directory structure
    await ctx.mkdir('src');
    await ctx.writeFile('src/index.ts', 'export default {}');
    await ctx.writeFile('src/utils.ts', 'export function add(a: number, b: number) { return a + b; }');
    await ctx.mkdir('src/components');
    await ctx.writeFile('src/components/App.tsx', '<div>App</div>');
    await ctx.writeFile('README.md', '# Project');

    // Act: fetch the file tree
    const tree = await ctx.getFileTree();

    // Verify: tree contains all created files and directories
    const paths = flattenTree(tree);
    const hasSrc = paths.some(p => p.includes('src'));
    const hasIndex = paths.some(p => p.includes('index.ts'));
    const hasApp = paths.some(p => p.includes('App.tsx'));
    const hasReadme = paths.some(p => p.includes('README.md'));

    if (!hasSrc || !hasIndex || !hasApp || !hasReadme) {
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

    // Verify: file content is correct
    const content = await ctx.readFile('hello.txt');
    if (content !== 'Hello World') {
      return { pass: false, detail: `Expected 'Hello World', got '${content}'` };
    }

    // Verify: file opens in editor
    await ctx.openFileInEditor('hello.txt');
    const active = await ctx.getActiveFile();
    if (active !== 'hello.txt') {
      return { pass: false, detail: `Expected active file 'hello.txt', got '${active}'` };
    }

    return { pass: true, detail: 'File created, visible in tree, content correct, opened in editor' };
  },
};

// FT-FILE-003
const createFolder: TestModule = {
  id: 'FT-FILE-003',
  name: 'Create folder',
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

    return { pass: true, detail: 'Folder created, visible in tree, can contain files' };
  },
};

// FT-FILE-004
const deleteFile: TestModule = {
  id: 'FT-FILE-004',
  name: 'Delete file',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create a file and open it in editor
    await ctx.writeFile('to-delete.txt', 'temporary');
    await ctx.openFileInEditor('to-delete.txt');

    // Verify setup
    let active = await ctx.getActiveFile();
    if (active !== 'to-delete.txt') {
      return { pass: false, detail: `Setup failed: active file is '${active}' not 'to-delete.txt'` };
    }

    // Act: delete the file
    await ctx.deleteFile('to-delete.txt');

    // Verify: file no longer in tree
    const tree = await ctx.getFileTree();
    const paths = flattenTree(tree);
    const stillExists = paths.some(p => p.includes('to-delete.txt'));
    if (stillExists) {
      return { pass: false, detail: 'Deleted file still appears in file tree' };
    }

    // Verify: file no longer readable
    try {
      await ctx.readFile('to-delete.txt');
      return { pass: false, detail: 'Deleted file is still readable' };
    } catch {
      // Expected: file not found
    }

    return { pass: true, detail: 'File deleted, removed from tree, no longer readable' };
  },
};

// FT-FILE-005
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

    // Verify content preserved
    const newContent = await ctx.readFile('new-name.txt');
    if (newContent !== 'rename me') {
      return { pass: false, detail: `Content not preserved: '${newContent}'` };
    }

    return { pass: true, detail: 'File renamed: old path removed, new path present, content preserved' };
  },
};

// FT-FILE-006
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

    // Check that move-me.txt at root is gone
    const hasAtRoot = paths.some(p => p === 'move-me.txt');
    const hasInDest = paths.some(p => p.includes('destination') && p.includes('move-me.txt'));

    if (hasAtRoot) {
      return { pass: false, detail: 'File still at original location' };
    }
    if (!hasInDest) {
      return { pass: false, detail: `File not found in destination. Paths: ${paths.join(', ')}` };
    }

    // Verify content preserved
    const movedContent = await ctx.readFile('destination/move-me.txt');
    if (movedContent !== 'moving content') {
      return { pass: false, detail: `Content not preserved: '${movedContent}'` };
    }

    return { pass: true, detail: 'File moved to destination folder, content preserved' };
  },
};

// FT-FILE-007
const selectFileOpensEditor: TestModule = {
  id: 'FT-FILE-007',
  name: 'Select file opens editor',
  area: 'file-explorer',
  run: async (ctx) => {
    // Setup: create multiple files
    await ctx.writeFile('file-a.ts', 'const a = 1;');
    await ctx.writeFile('file-b.ts', 'const b = 2;');
    await ctx.writeFile('file-c.ts', 'const c = 3;');

    // Verify no file active initially
    let active = await ctx.getActiveFile();
    let tabs = await ctx.getOpenTabs();
    if (tabs.length !== 0) {
      return { pass: false, detail: `Expected 0 open tabs, got ${tabs.length}` };
    }

    // Act: open first file
    await ctx.openFileInEditor('file-a.ts');
    active = await ctx.getActiveFile();
    tabs = await ctx.getOpenTabs();
    if (active !== 'file-a.ts') {
      return { pass: false, detail: `Expected active 'file-a.ts', got '${active}'` };
    }
    if (tabs.length !== 1) {
      return { pass: false, detail: `Expected 1 tab, got ${tabs.length}` };
    }

    // Act: open second file — both should be in tabs, second active
    await ctx.openFileInEditor('file-b.ts');
    active = await ctx.getActiveFile();
    tabs = await ctx.getOpenTabs();
    if (active !== 'file-b.ts') {
      return { pass: false, detail: `Expected active 'file-b.ts', got '${active}'` };
    }
    if (tabs.length !== 2) {
      return { pass: false, detail: `Expected 2 tabs, got ${tabs.length}` };
    }

    // Act: open first file again — should reuse tab, not create new
    await ctx.openFileInEditor('file-a.ts');
    tabs = await ctx.getOpenTabs();
    if (tabs.length !== 2) {
      return { pass: false, detail: `Expected still 2 tabs after re-opening, got ${tabs.length}` };
    }
    active = await ctx.getActiveFile();
    if (active !== 'file-a.ts') {
      return { pass: false, detail: `Expected active 'file-a.ts' after re-open, got '${active}'` };
    }

    // Act: close a tab — verify tab list and active file update
    await ctx.closeTab('file-a.ts');
    tabs = await ctx.getOpenTabs();
    active = await ctx.getActiveFile();
    if (tabs.length !== 1) {
      return { pass: false, detail: `Expected 1 tab after close, got ${tabs.length}` };
    }
    if (active !== 'file-b.ts') {
      return { pass: false, detail: `Expected fallback to 'file-b.ts', got '${active}'` };
    }

    return { pass: true, detail: 'File selection opens tabs, reuses existing, closing falls back correctly' };
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
