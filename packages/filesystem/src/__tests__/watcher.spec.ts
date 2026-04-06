import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { expect, createMockFn } from '@antimatter/test-utils';
import { MemoryFileSystem } from '../memory-fs.js';
import { watchDebounced } from '../watcher.js';

describe('watchDebounced', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it('batches multiple events within debounce window', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    watchDebounced(fs, '', listener, 100);

    // Trigger multiple file operations quickly
    await fs.writeFile('a.txt', 'a');
    await fs.writeFile('b.txt', 'b');
    await fs.writeFile('c.txt', 'c');

    // Listener should not be called yet
    expect(listener).not.toHaveBeenCalled();

    // Advance timers past debounce window
    mock.timers.tick(100);

    // Should have received all events in a single batch
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([
        { type: 'create', path: 'a.txt' },
        { type: 'create', path: 'b.txt' },
        { type: 'create', path: 'c.txt' },
      ])
    );
  });

  it('resets debounce timer on new events', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'a');
    mock.timers.tick(50);

    // New event resets the timer
    await fs.writeFile('b.txt', 'b');
    mock.timers.tick(50);

    // Should not have fired yet (only 100ms total but timer was reset)
    expect(listener).not.toHaveBeenCalled();

    // Advance past the reset timer
    mock.timers.tick(50);

    // Now should have fired with both events
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([
        { type: 'create', path: 'a.txt' },
        { type: 'create', path: 'b.txt' },
      ])
    );
  });

  it('delivers separate batches after debounce window', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    watchDebounced(fs, '', listener, 100);

    // First batch
    await fs.writeFile('a.txt', 'a');
    mock.timers.tick(100);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith([{ type: 'create', path: 'a.txt' }]);

    // Second batch after sufficient delay
    await fs.writeFile('b.txt', 'b');
    mock.timers.tick(100);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith([
      { type: 'create', path: 'b.txt' },
    ]);
  });

  it('stops emitting events after close', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    const watcher = watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'a');
    watcher.close();

    // Advance timers - should not trigger listener after close
    mock.timers.tick(100);

    expect(listener).not.toHaveBeenCalled();

    // New events after close should also not trigger
    await fs.writeFile('b.txt', 'b');
    mock.timers.tick(100);

    expect(listener).not.toHaveBeenCalled();
  });

  it('cleans up pending events on close', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    const watcher = watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'a');
    await fs.writeFile('b.txt', 'b');

    // Close before debounce timer fires
    watcher.close();

    mock.timers.tick(100);

    // Pending events should be discarded
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses custom debounce duration', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    watchDebounced(fs, '', listener, 500);

    await fs.writeFile('a.txt', 'a');

    mock.timers.tick(100);
    expect(listener).not.toHaveBeenCalled();

    mock.timers.tick(400);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('defaults to 100ms debounce when not specified', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    watchDebounced(fs, '', listener);

    await fs.writeFile('a.txt', 'a');

    mock.timers.tick(99);
    expect(listener).not.toHaveBeenCalled();

    mock.timers.tick(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('batches different event types together', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'original');
    await fs.writeFile('a.txt', 'modified');
    await fs.deleteFile('a.txt');

    mock.timers.tick(100);

    expect(listener).toHaveBeenCalledTimes(1);
    const events = listener.mock.calls[0][0];
    expect(events).toHaveLength(3);
    expect(events.map((e: any) => e.type)).toEqual([
      'create',
      'modify',
      'delete',
    ]);
  });

  it('watches specific directory path', async () => {
    const fs = new MemoryFileSystem();
    const listener = createMockFn();

    watchDebounced(fs, 'src', listener, 100);

    await fs.writeFile('src/file.txt', 'content');
    await fs.writeFile('other/file.txt', 'content');

    mock.timers.tick(100);

    // Should only receive events from the watched directory
    expect(listener).toHaveBeenCalledTimes(1);
    const events = listener.mock.calls[0][0];
    expect(events.every((e: any) => e.path.startsWith('src/'))).toBe(true);
  });
});
