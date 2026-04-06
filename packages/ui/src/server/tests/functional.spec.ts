/**
 * Vitest auto-discovery wrapper for functional test modules.
 *
 * Imports all test modules from the shared barrel and wraps each in
 * a Vitest describe/it block with ServiceActionContext.
 *
 * Run: npm test -w @antimatter/ui
 * Or:  npx vitest run src/server/tests/functional.spec.ts
 */

import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { allTestModules, getTestsByArea } from '../../shared/test-modules/index.js';
import { ServiceActionContext } from './service-action-context.js';

// Group tests by area for organized output
const byArea = getTestsByArea();

for (const [area, tests] of byArea) {
  describe(`Functional: ${area}`, () => {
    for (const test of tests) {
      it(`${test.id}: ${test.name}`, async () => {
        // Each test gets a fresh ServiceActionContext (isolated MemoryFileSystem)
        const ctx = new ServiceActionContext();
        const result = await test.run(ctx);
        expect(result.pass, result.detail).toBe(true);
      });
    }
  });
}
