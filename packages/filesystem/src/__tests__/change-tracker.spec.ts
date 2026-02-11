import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../memory-fs.js';
import {
  createSnapshot,
  diffSnapshots,
  createIncrementalSnapshot,
} from '../change-tracker.js';

describe('createSnapshot', () => {
  it('creates a snapshot of specified files', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('a.txt', 'aaa');
    await fs.writeFile('b.txt', 'bbb');

    const snapshot = await createSnapshot(fs, ['a.txt', 'b.txt']);
    expect(snapshot.files.size).toBe(2);
    expect(snapshot.files.get('a.txt')).toBeDefined();
    expect(snapshot.files.get('b.txt')).toBeDefined();
    expect(snapshot.files.get('a.txt')!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.createdAt).toBeTruthy();
  });
});

describe('diffSnapshots', () => {
  it('detects added files', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('a.txt', 'aaa');
    const before = await createSnapshot(fs, ['a.txt']);

    await fs.writeFile('b.txt', 'bbb');
    const after = await createSnapshot(fs, ['a.txt', 'b.txt']);

    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: 'b.txt', kind: 'added' });
    expect(changes[0]!.afterHash).toBeTruthy();
  });

  it('detects deleted files', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('a.txt', 'aaa');
    await fs.writeFile('b.txt', 'bbb');
    const before = await createSnapshot(fs, ['a.txt', 'b.txt']);

    const after = await createSnapshot(fs, ['a.txt']);

    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: 'b.txt', kind: 'deleted' });
    expect(changes[0]!.beforeHash).toBeTruthy();
  });

  it('detects modified files', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('a.txt', 'original');
    const before = await createSnapshot(fs, ['a.txt']);

    await fs.writeFile('a.txt', 'modified');
    const after = await createSnapshot(fs, ['a.txt']);

    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: 'a.txt', kind: 'modified' });
    expect(changes[0]!.beforeHash).not.toBe(changes[0]!.afterHash);
  });

  it('returns empty array for identical snapshots', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('a.txt', 'same');
    const before = await createSnapshot(fs, ['a.txt']);
    const after = await createSnapshot(fs, ['a.txt']);

    expect(diffSnapshots(before, after)).toEqual([]);
  });
});

describe('createIncrementalSnapshot', () => {
  it('reuses hashes for unchanged files', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('a.txt', 'aaa');
    await fs.writeFile('b.txt', 'bbb');

    const first = await createSnapshot(fs, ['a.txt', 'b.txt']);

    // Only modify b.txt
    await fs.writeFile('b.txt', 'new-bbb');

    const incremental = await createIncrementalSnapshot(
      fs,
      ['a.txt', 'b.txt'],
      first,
    );

    // a.txt should be reused (same hash), b.txt re-hashed
    expect(incremental.files.get('a.txt')!.hash).toBe(
      first.files.get('a.txt')!.hash,
    );
    expect(incremental.files.get('b.txt')!.hash).not.toBe(
      first.files.get('b.txt')!.hash,
    );
  });
});
