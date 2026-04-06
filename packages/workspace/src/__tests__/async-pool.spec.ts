import { describe, it, beforeEach } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { asyncPool } from '../async-pool.js';

describe('asyncPool', () => {
  it('processes all items and returns results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await asyncPool(items, 3, async (n) => n * 2);

    expect(results).toHaveLength(5);
    for (let i = 0; i < items.length; i++) {
      expect(results[i]).toEqual({ status: 'fulfilled', value: items[i] * 2 });
    }
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const concurrency = 2;

    const items = Array.from({ length: 10 }, (_, i) => i);
    await asyncPool(items, concurrency, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    });

    expect(maxRunning).toBeLessThanOrEqual(concurrency);
  });

  it('handles errors without losing remaining items', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await asyncPool(items, 2, async (n) => {
      if (n === 3) throw new Error('fail');
      return n;
    });

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1]).toEqual({ status: 'fulfilled', value: 2 });
    expect(results[2].status).toBe('rejected');
    expect(results[3]).toEqual({ status: 'fulfilled', value: 4 });
    expect(results[4]).toEqual({ status: 'fulfilled', value: 5 });
  });

  it('works with empty input', async () => {
    const results = await asyncPool([], 5, async () => 'never');
    expect(results).toEqual([]);
  });

  it('works when concurrency exceeds item count', async () => {
    const items = [10, 20];
    const results = await asyncPool(items, 100, async (n) => n + 1);

    expect(results).toEqual([
      { status: 'fulfilled', value: 11 },
      { status: 'fulfilled', value: 21 },
    ]);
  });
});
