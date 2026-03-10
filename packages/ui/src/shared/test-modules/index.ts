/**
 * Barrel export for all functional test modules.
 *
 * Import this to get every test module for auto-discovery.
 * New test module files should be added here.
 */

import type { TestModule } from '../test-types.js';

import { fileExplorerTests } from './file-explorer-tests.js';
import { editorTests } from './editor-tests.js';

/** All registered functional test modules. */
export const allTestModules: readonly TestModule[] = [
  ...fileExplorerTests,
  ...editorTests,
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
