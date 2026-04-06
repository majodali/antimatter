/**
 * Thin expect() wrapper over node:assert/strict.
 *
 * Provides vitest-compatible assertion syntax so test files only need
 * to change their import line, not their assertion logic.
 */

import assert from 'node:assert/strict';

// Sentinel symbols for subset matchers
const ARRAY_CONTAINING = Symbol('arrayContaining');
const OBJECT_CONTAINING = Symbol('objectContaining');
const ANY_INSTANCE = Symbol('anyInstance');

interface MockLike {
  mock: { calls: unknown[][]; callCount: () => number };
}

function isMock(val: unknown): val is MockLike {
  return val !== null && (typeof val === 'object' || typeof val === 'function') && 'mock' in val &&
    typeof (val as any).mock === 'object' && Array.isArray((val as any).mock.calls);
}

function deepContains(actual: unknown, expected: unknown): boolean {
  // Sentinel: expect.any(Constructor)
  if (expected && typeof expected === 'object' && (expected as any)[ANY_INSTANCE]) {
    return actual instanceof (expected as any).constructor;
  }
  // Sentinel: expect.arrayContaining([...])
  if (expected && typeof expected === 'object' && (expected as any)[ARRAY_CONTAINING]) {
    if (!Array.isArray(actual)) return false;
    return (expected as any).expected.every((item: unknown) =>
      actual.some(a => deepContains(a, item)),
    );
  }
  // Sentinel: expect.objectContaining({...})
  if (expected && typeof expected === 'object' && (expected as any)[OBJECT_CONTAINING]) {
    if (!actual || typeof actual !== 'object') return false;
    const subset = (expected as any).expected as Record<string, unknown>;
    for (const [key, val] of Object.entries(subset)) {
      if (!deepContains((actual as any)[key], val)) return false;
    }
    return true;
  }
  // Recursive object comparison to support nested sentinels
  if (expected && typeof expected === 'object' && !Array.isArray(expected) &&
      actual && typeof actual === 'object' && !Array.isArray(actual)) {
    const expEntries = Object.entries(expected);
    const actKeys = Object.keys(actual);
    if (expEntries.length !== actKeys.length) return false;
    for (const [key, val] of expEntries) {
      if (!(key in (actual as any))) return false;
      if (!deepContains((actual as any)[key], val)) return false;
    }
    return true;
  }
  // Recursive array comparison
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return false;
    return expected.every((item, i) => deepContains(actual[i], item));
  }
  // Primitive / fallback
  try { assert.deepStrictEqual(actual, expected); return true; } catch { return false; }
}

/**
 * Creates an async matcher proxy for .resolves / .rejects.
 * Every property access returns an async function that awaits the promise
 * first, then delegates to the corresponding matcher on the resolved/rejected value.
 */
function asyncMatcherProxy(promise: Promise<unknown>, expectReject: boolean, negated: boolean): any {
  const fail = (msg: string) => { throw new assert.AssertionError({ message: msg }); };
  const check = (condition: boolean, msg: string) => {
    if (negated ? condition : !condition) fail(msg);
  };

  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'not') {
        return asyncMatcherProxy(promise, expectReject, !negated);
      }
      // Return an async function that awaits the promise then runs the matcher
      return async (...args: unknown[]) => {
        let resolved: unknown;
        let error: unknown;
        let rejected = false;
        try { resolved = await promise; } catch (e) { rejected = true; error = e; }

        if (expectReject) {
          // Special handling for rejects.toThrow — the error is already captured
          if (prop === 'toThrow') {
            check(rejected, `Expected promise ${negated ? 'not ' : ''}to reject`);
            if (rejected && args[0] !== undefined && !negated) {
              const expected = args[0];
              if (typeof expected === 'string') {
                check((error as Error).message?.includes(expected),
                  `Expected error message to contain "${expected}", got "${(error as Error).message}"`);
              } else if (expected instanceof RegExp) {
                check(expected.test((error as Error).message),
                  `Expected error to match ${expected}`);
              } else if (typeof expected === 'function') {
                check(error instanceof expected,
                  `Expected error to be instance of ${(expected as Function).name}`);
              }
            }
            return;
          }
          if (!rejected) {
            fail('Expected promise to reject, but it resolved');
          }
          const m = createMatchers(error, negated);
          (m as any)[prop](...args);
        } else {
          // Special handling for resolves + toThrow
          if (prop === 'toThrow') {
            if (!negated) {
              fail('resolves.toThrow() is not meaningful — use rejects.toThrow()');
            } else {
              // resolves.not.toThrow() — just verify the promise resolved (didn't reject)
              if (rejected) {
                fail(`Expected promise not to reject, but it rejected with: ${(error as Error)?.message || error}`);
              }
            }
            return;
          }
          if (rejected) {
            fail(`Expected promise to resolve, but it rejected with: ${(error as Error)?.message || error}`);
          }
          const m = createMatchers(resolved, negated);
          (m as any)[prop](...args);
        }
      };
    },
  };
  return new Proxy({}, handler);
}

function createMatchers(actual: unknown, negated = false) {
  const fail = (msg: string) => { throw new assert.AssertionError({ message: msg }); };
  const check = (condition: boolean, msg: string) => {
    if (negated ? condition : !condition) fail(msg);
  };

  const matchers = {
    toBe(expected: unknown) {
      check(Object.is(actual, expected), `Expected ${String(actual)} ${negated ? 'not ' : ''}to be ${String(expected)}`);
    },
    toEqual(expected: unknown) {
      const match = deepContains(actual, expected);
      check(match, `Expected deep equality${negated ? ' to fail' : ''}`);
    },
    toStrictEqual(expected: unknown) {
      let match: boolean;
      try { assert.deepStrictEqual(actual, expected); match = true; } catch { match = false; }
      check(match, `Expected strict deep equality${negated ? ' to fail' : ''}`);
    },
    toBeDefined() { check(actual !== undefined, `Expected ${negated ? '' : 'not '}to be undefined`); },
    toBeUndefined() { check(actual === undefined, `Expected ${negated ? 'not ' : ''}to be undefined`); },
    toBeNull() { check(actual === null, `Expected ${negated ? 'not ' : ''}to be null`); },
    toBeTruthy() { check(!!actual, `Expected ${String(actual)} ${negated ? 'not ' : ''}to be truthy`); },
    toBeFalsy() { check(!actual, `Expected ${String(actual)} ${negated ? 'not ' : ''}to be falsy`); },
    toContain(item: unknown) {
      if (typeof actual === 'string') {
        check(actual.includes(item as string), `Expected string ${negated ? 'not ' : ''}to contain "${item}"`);
      } else if (Array.isArray(actual)) {
        check(actual.includes(item), `Expected array ${negated ? 'not ' : ''}to contain ${String(item)}`);
      } else {
        fail('toContain requires string or array');
      }
    },
    toHaveLength(len: number) {
      const actualLen = (actual as any)?.length;
      check(actualLen === len, `Expected length ${actualLen} ${negated ? 'not ' : ''}to be ${len}`);
    },
    toBeInstanceOf(cls: Function) {
      check(actual instanceof cls, `Expected ${negated ? 'not ' : ''}to be instance of ${cls.name}`);
    },
    toBeGreaterThan(n: number) { check((actual as number) > n, `Expected ${actual} ${negated ? 'not ' : ''}to be > ${n}`); },
    toBeGreaterThanOrEqual(n: number) { check((actual as number) >= n, `Expected ${actual} ${negated ? 'not ' : ''}to be >= ${n}`); },
    toBeLessThan(n: number) { check((actual as number) < n, `Expected ${actual} ${negated ? 'not ' : ''}to be < ${n}`); },
    toBeLessThanOrEqual(n: number) { check((actual as number) <= n, `Expected ${actual} ${negated ? 'not ' : ''}to be <= ${n}`); },
    toMatch(pattern: RegExp | string) {
      const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      check(re.test(actual as string), `Expected "${actual}" ${negated ? 'not ' : ''}to match ${re}`);
    },
    toMatchObject(expected: Record<string, unknown>) {
      if (!actual || typeof actual !== 'object') fail('toMatchObject requires an object');
      for (const [key, val] of Object.entries(expected)) {
        let match: boolean;
        try { assert.deepStrictEqual((actual as any)[key], val); match = true; } catch { match = false; }
        check(match, `Property "${key}": expected ${JSON.stringify(val)}, got ${JSON.stringify((actual as any)[key])}`);
      }
    },
    toThrow(expected?: string | RegExp | Function) {
      let threw = false;
      let error: unknown;
      try { (actual as Function)(); } catch (e) { threw = true; error = e; }
      check(threw, `Expected function ${negated ? 'not ' : ''}to throw`);
      if (threw && expected !== undefined && !negated) {
        if (typeof expected === 'string') {
          check((error as Error).message?.includes(expected), `Expected error message to contain "${expected}"`);
        } else if (expected instanceof RegExp) {
          check(expected.test((error as Error).message), `Expected error to match ${expected}`);
        } else if (typeof expected === 'function') {
          check(error instanceof expected, `Expected error to be instance of ${expected.name}`);
        }
      }
    },

    // Mock-aware matchers
    toHaveBeenCalled() {
      if (!isMock(actual)) fail('toHaveBeenCalled requires a mock function');
      check((actual as MockLike).mock.calls.length > 0, `Expected mock ${negated ? 'not ' : ''}to have been called`);
    },
    toHaveBeenCalledTimes(n: number) {
      if (!isMock(actual)) fail('toHaveBeenCalledTimes requires a mock function');
      const count = (actual as MockLike).mock.calls.length;
      check(count === n, `Expected mock to have been called ${n} times, but was called ${count} times`);
    },
    toHaveBeenCalledWith(...args: unknown[]) {
      if (!isMock(actual)) fail('toHaveBeenCalledWith requires a mock function');
      const calls = (actual as MockLike).mock.calls;
      const match = calls.some(call => {
        if (call.length !== args.length) return false;
        return args.every((arg, i) => deepContains(call[i], arg));
      });
      check(match, `Expected mock ${negated ? 'not ' : ''}to have been called with ${JSON.stringify(args)}`);
    },
    toHaveBeenLastCalledWith(...args: unknown[]) {
      if (!isMock(actual)) fail('toHaveBeenLastCalledWith requires a mock function');
      const calls = (actual as MockLike).mock.calls;
      if (calls.length === 0) { check(false, 'Expected mock to have been called'); return; }
      const lastCall = calls[calls.length - 1];
      const match = args.every((arg, i) => deepContains(lastCall[i], arg));
      check(match, `Expected last call ${negated ? 'not ' : ''}to be ${JSON.stringify(args)}`);
    },

    get not() { return createMatchers(actual, !negated); },

    get resolves() {
      // Returns a proxy that awaits the promise, then applies matchers on the resolved value
      return asyncMatcherProxy(actual as Promise<unknown>, false, negated);
    },

    get rejects() {
      // Returns a proxy that expects the promise to reject, then applies matchers on the error
      return asyncMatcherProxy(actual as Promise<unknown>, true, negated);
    },
  };

  return matchers;
}

/**
 * expect(actual) — returns matcher object with vitest-compatible assertions.
 * Backed by node:assert/strict.
 */
export function expect(actual: unknown) {
  return createMatchers(actual);
}

/** Sentinel for subset array matching in deep equality checks. */
expect.arrayContaining = (expected: unknown[]) => ({ [ARRAY_CONTAINING]: true, expected });

/** Sentinel for subset object matching in deep equality checks. */
expect.objectContaining = (expected: Record<string, unknown>) => ({ [OBJECT_CONTAINING]: true, expected });

/** Sentinel for expect.any(Constructor) — matches any instance of the given class. */
expect.any = (constructor: Function) => ({ [ANY_INSTANCE]: true, constructor });

/** Shorthand for strict assertion (direct assert access). */
expect.assertions = assert;
