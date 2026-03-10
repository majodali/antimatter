/**
 * Functional tests for the Code Editor feature.
 *
 * Tests editor tab management, file editing, and save behavior
 * through ActionContext operations.
 */

import type { TestModule } from '../test-types.js';

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
    if (active !== 'greet.ts') {
      return { pass: false, detail: `Expected active file 'greet.ts', got '${active}'` };
    }

    // Verify: file is in open tabs
    const tabs = await ctx.getOpenTabs();
    if (!tabs.includes('greet.ts')) {
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
    if (active !== 'beta.ts') {
      return { pass: false, detail: `Expected 'beta.ts' active, got '${active}'` };
    }

    // Act: switch back to alpha
    await ctx.openFileInEditor('alpha.ts');
    active = await ctx.getActiveFile();
    if (active !== 'alpha.ts') {
      return { pass: false, detail: `Expected 'alpha.ts' active after switch, got '${active}'` };
    }

    // Verify: both still in tabs (no duplicates)
    const tabs = await ctx.getOpenTabs();
    if (tabs.length !== 2) {
      return { pass: false, detail: `Expected 2 tabs, got ${tabs.length}: ${tabs.join(', ')}` };
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
    if (active !== 'three.ts') {
      return { pass: false, detail: `Setup: expected 'three.ts' active, got '${active}'` };
    }

    // Act: close active tab (three.ts)
    await ctx.closeTab('three.ts');

    // Verify: tab removed, fallback to adjacent
    let tabs = await ctx.getOpenTabs();
    if (tabs.includes('three.ts')) {
      return { pass: false, detail: 'Closed tab still in tabs list' };
    }
    if (tabs.length !== 2) {
      return { pass: false, detail: `Expected 2 tabs, got ${tabs.length}` };
    }

    active = await ctx.getActiveFile();
    if (active !== 'two.ts') {
      return { pass: false, detail: `Expected fallback to 'two.ts', got '${active}'` };
    }

    // Act: close non-active tab (one.ts) — active should stay two.ts
    await ctx.closeTab('one.ts');
    tabs = await ctx.getOpenTabs();
    active = await ctx.getActiveFile();
    if (tabs.length !== 1) {
      return { pass: false, detail: `Expected 1 tab, got ${tabs.length}` };
    }
    if (active !== 'two.ts') {
      return { pass: false, detail: `Active changed after closing non-active tab: '${active}'` };
    }

    // Act: close last tab — no active file
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

    // Act: edit the file content
    await ctx.editFileContent('editable.ts', 'modified content');

    // Verify: content is persisted (in API/service context, editFileContent writes immediately)
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
