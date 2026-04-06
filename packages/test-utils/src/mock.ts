/**
 * Mock helpers wrapping Node.js built-in mock API.
 *
 * Provides vitest-compatible `.mockResolvedValue()`, `.mockImplementation()`,
 * and `.mock.calls` array in `[[arg1, arg2], ...]` format.
 */

import { mock } from 'node:test';

export interface MockFunction<T extends (...args: any[]) => any = (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T>;
  mock: {
    calls: Parameters<T>[];
    callCount: () => number;
    resetCalls: () => void;
  };
  mockImplementation(impl: T): MockFunction<T>;
  mockReturnValue(val: ReturnType<T>): MockFunction<T>;
  mockResolvedValue(val: Awaited<ReturnType<T>>): MockFunction<T>;
  mockResolvedValueOnce(val: Awaited<ReturnType<T>>): MockFunction<T>;
  mockRejectedValue(err: unknown): MockFunction<T>;
  mockReset(): void;
}

/**
 * Create a mock function compatible with vitest's `vi.fn()` API.
 *
 * Usage:
 *   const fn = createMockFn();
 *   fn('hello');
 *   expect(fn).toHaveBeenCalledWith('hello');
 *   expect(fn.mock.calls).toEqual([['hello']]);
 */
export function createMockFn<T extends (...args: any[]) => any>(
  impl?: T,
): MockFunction<T> {
  const calls: any[][] = [];
  const onceQueue: Function[] = [];
  let currentImpl: Function = impl ?? (() => undefined);

  const mockFn = function (...args: any[]) {
    calls.push(args);
    if (onceQueue.length > 0) {
      return onceQueue.shift()!(...args);
    }
    return currentImpl(...args);
  } as unknown as MockFunction<T>;

  mockFn.mock = {
    calls,
    callCount: () => calls.length,
    resetCalls: () => { calls.length = 0; },
  };

  mockFn.mockImplementation = (newImpl: T) => {
    currentImpl = newImpl;
    return mockFn;
  };

  mockFn.mockReturnValue = (val: any) => {
    currentImpl = () => val;
    return mockFn;
  };

  mockFn.mockResolvedValue = (val: any) => {
    currentImpl = () => Promise.resolve(val);
    return mockFn;
  };

  mockFn.mockResolvedValueOnce = (val: any) => {
    onceQueue.push(() => Promise.resolve(val));
    return mockFn;
  };

  mockFn.mockRejectedValue = (err: unknown) => {
    currentImpl = () => Promise.reject(err);
    return mockFn;
  };

  mockFn.mockReset = () => {
    calls.length = 0;
    onceQueue.length = 0;
    currentImpl = () => undefined;
  };

  return mockFn;
}

/**
 * Re-export Node's built-in mock for timer mocking.
 *
 * Usage:
 *   import { mock } from '@antimatter/test-utils';
 *   mock.timers.enable({ apis: ['setTimeout'] });
 *   mock.timers.tick(1000);
 *   mock.timers.reset();
 */
export { mock };
