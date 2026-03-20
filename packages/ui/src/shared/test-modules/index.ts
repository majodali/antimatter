/**
 * Barrel export for all functional test modules.
 *
 * Import this to get every test module for auto-discovery.
 * New test module files should be added here.
 */

import type { TestModule } from '../test-types.js';

import { fileExplorerTests } from './file-explorer-tests.js';
import { editorTests } from './editor-tests.js';
import { crossTabTests } from './cross-tab-tests.js';
import { workspaceTests } from './workspace-tests.js';
import { projectsTests } from './projects-tests.js';
import { m1Tests } from './m1-tests.js';

/** All registered functional test modules. */
export const allTestModules: readonly TestModule[] = [
  ...fileExplorerTests,
  ...editorTests,
  ...crossTabTests,
  ...workspaceTests,
  ...projectsTests,
  ...m1Tests,
];

/** Test modules grouped by area. */
export function getTestsByArea(): Map<string, readonly TestModule[]> {
  const byArea = new Map<string, TestModule[]>();
  for (const test of allTestModules) {
    const list = byArea.get(test.area) ?? [];
    list.push(test);
    byArea.set(test.area, list);
  }
  return byArea;
}

// Re-export individual arrays for selective imports
export { fileExplorerTests } from './file-explorer-tests.js';
export { editorTests } from './editor-tests.js';
export { crossTabTests } from './cross-tab-tests.js';
export { workspaceTests } from './workspace-tests.js';
export { projectsTests } from './projects-tests.js';
export { m1Tests } from './m1-tests.js';
