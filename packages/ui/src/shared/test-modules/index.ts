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
import { m2Tests } from './m2-tests.js';
import { coldstartTests } from './coldstart-tests.js';
import { decompTests } from './decomp-tests.js';
import { focusTests } from './focus-tests.js';
import { statusTests } from './status-tests.js';
import { regressTests } from './regress-tests.js';

/** All registered functional test modules. */
export const allTestModules: readonly TestModule[] = [
  ...fileExplorerTests,
  ...editorTests,
  ...crossTabTests,
  ...workspaceTests,
  ...projectsTests,
  ...m1Tests,
  ...m2Tests,
  ...coldstartTests,
  ...decompTests,
  ...focusTests,
  ...statusTests,
  ...regressTests,
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
export { m2Tests } from './m2-tests.js';
export { coldstartTests } from './coldstart-tests.js';
export { decompTests } from './decomp-tests.js';
export { focusTests } from './focus-tests.js';
export { statusTests } from './status-tests.js';
export { regressTests } from './regress-tests.js';
