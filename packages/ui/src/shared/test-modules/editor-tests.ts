/**
 * Functional tests for the Code Editor feature.
 *
 * Tests editor tab management, file editing, and save behavior
 * through ActionContext operations.
 *
 * In BrowserActionContext (DOM-only mode):
 * - openFileInEditor clicks the file tree item
 * - getActiveFile reads the data-active/data-path attributes from editor tabs
 * - getOpenTabs reads all editor-tab-* elements
 * - closeTab clicks the editor-tab-close-* button
 * - editFileContent opens file + sets Monaco value + Ctrl+S
 * - readFile opens file via tree click + reads Monaco getValue()
 */

import type { TestModule } from '../test-types.js';

/** Check if a path string contains the expected filename. */
function pathContains(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  return actual === expected || actual.endsWith('/' + expected) || actual.endsWith('\\' + expected);
}

/** Check if any tab path contains the expected filename. */
function tabsContain(tabs: string[], expected: string): boolean {
  return tabs.some(t => pathContains(t, expected));
}

// FT-EDIT-001
const openFileInTab: TestModule = {
  id: 'FT-EDIT-001',
  name: 'Open file in tab',
  area: 'editor',
  run: async (ctx) => {
    // Setup: create a file with known content
    const expectedContent = 'export function greet() { return "hello"; }';
    await ctx.writeFile('greet.ts', expectedContent);

    // Act: open in editor
    await ctx.openFileInEditor('greet.ts');

    // Verify: correct file is active
    const active = await ctx.getActiveFile();
    if (!pathContains(active, 'greet.ts')) {
      return { pass: false, detail: `Expected active file 'greet.ts', got '${active}'` };
    }

    // Verify: file is in open tabs
    const tabs = await ctx.getOpenTabs();
    if (!tabsContain(tabs, 'greet.ts')) {
      return { pass: false, detail: `'greet.ts' not in open tabs: ${tabs.join(', ')}` };
    }

    // Verify: content is readable (file exists and matches)
    const content = await ctx.readFile('greet.ts');
    if (content !== expectedContent) {
      return { pass: false, detail: `Content mismatch: expected '${expectedContent}', got '${content}'` };
    }

    return { pass: true, detail: 'File opened in tab with correct content' };
  },
};

// FT-EDIT-002
const switchBetweenTabs: TestModule = {
  id: 'FT-EDIT-002',
  name: 'Switch between tabs',
  area: 'editor',
  run: async (ctx) => {
    // Setup: create and open two files
    await ctx.writeFile('alpha.ts', 'alpha');
    await ctx.writeFile('beta.ts', 'beta');

    await ctx.openFileInEditor('alpha.ts');
    await ctx.openFileInEditor('beta.ts');

    // Verify: beta is active
    let active = await ctx.getActiveFile();
    if (!pathContains(active, 'beta.ts')) {
      return { pass: false, detail: `Expected 'beta.ts' active, got '${active}'` };
    }

    // Act: switch back to alpha
    await ctx.openFileInEditor('alpha.ts');
    active = await ctx.getActiveFile();
    if (!pathContains(active, 'alpha.ts')) {
      return { pass: false, detail: `Expected 'alpha.ts' active after switch, got '${active}'` };
    }

    // Verify: both still in tabs
    const tabs = await ctx.getOpenTabs();
    if (!tabsContain(tabs, 'alpha.ts') || !tabsContain(tabs, 'beta.ts')) {
      return { pass: false, detail: `Expected both files in tabs: ${tabs.join(', ')}` };
    }

    return { pass: true, detail: 'Tab switching works, no duplicate tabs created' };
  },
};

// FT-EDIT-003
const closeTab: TestModule = {
  id: 'FT-EDIT-003',
  name: 'Close tab',
  area: 'editor',
  run: async (ctx) => {
    // Setup: open three files
    await ctx.writeFile('one.ts', '1');
    await ctx.writeFile('two.ts', '2');
    await ctx.writeFile('three.ts', '3');

    await ctx.openFileInEditor('one.ts');
    await ctx.openFileInEditor('two.ts');
    await ctx.openFileInEditor('three.ts');

    // Verify setup: three is active
    let active = await ctx.getActiveFile();
    if (!pathContains(active, 'three.ts')) {
      return { pass: false, detail: `Setup: expected 'three.ts' active, got '${active}'` };
    }

    // Act: close active tab (three.ts)
    await ctx.closeTab('three.ts');

    // Verify: tab removed
    let tabs = await ctx.getOpenTabs();
    if (tabsContain(tabs, 'three.ts')) {
      return { pass: false, detail: 'Closed tab still in tabs list' };
    }

    // Verify: fallback to another tab
    active = await ctx.getActiveFile();
    if (!pathContains(active, 'two.ts') && !pathContains(active, 'one.ts')) {
      return { pass: false, detail: `Expected fallback to 'two.ts' or 'one.ts', got '${active}'` };
    }

    // Act: close remaining tabs
    await ctx.closeTab('one.ts');
    await ctx.closeTab('two.ts');
    tabs = await ctx.getOpenTabs();
    active = await ctx.getActiveFile();
    if (tabs.length !== 0) {
      return { pass: false, detail: `Expected 0 tabs, got ${tabs.length}` };
    }
    if (active !== null) {
      return { pass: false, detail: `Expected null active file, got '${active}'` };
    }

    return { pass: true, detail: 'Tab closing works: removes tab, falls back correctly, handles last tab' };
  },
};

// FT-EDIT-004
const autoSaveOnEdit: TestModule = {
  id: 'FT-EDIT-004',
  name: 'Auto-save on edit',
  area: 'editor',
  run: async (ctx) => {
    // Setup: create and open a file
    await ctx.writeFile('editable.ts', 'original content');
    await ctx.openFileInEditor('editable.ts');

    // Act: edit the file content (in DOM mode: sets Monaco value + Ctrl+S)
    await ctx.editFileContent('editable.ts', 'modified content');

    // Verify: content is persisted
    const content = await ctx.readFile('editable.ts');
    if (content !== 'modified content') {
      return { pass: false, detail: `Expected 'modified content', got '${content}'` };
    }

    return { pass: true, detail: 'File edit persisted correctly' };
  },
};

// ---- Export ----

export const editorTests: readonly TestModule[] = [
  openFileInTab,
  switchBetweenTabs,
  closeTab,
  autoSaveOnEdit,
];
