/**
 * @antimatter/test-utils
 *
 * Test utilities for the Antimatter project, replacing vitest with
 * Node.js built-in test runner (`node:test` + `node:assert`).
 *
 * - expect() — vitest-compatible assertions backed by node:assert
 * - createMockFn() — vitest-compatible mock functions backed by node:test mock
 * - mock — re-exported from node:test for timer mocking
 */

export { expect } from './expect.js';
export { createMockFn, mock } from './mock.js';
export type { MockFunction } from './mock.js';
