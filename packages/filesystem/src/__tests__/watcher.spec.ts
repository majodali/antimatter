import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryFileSystem } from '../memory-fs.js';
import { watchDebounced } from '../watcher.js';

describe('watchDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('batches multiple events within debounce window', async () => {
    const fs = new MemoryFileSystem();
    const listener = vi.fn();

    watchDebounced(fs, '', listener, 100);

    // Trigger multiple file operations quickly
    await fs.writeFile('a.txt', 'a');
    await fs.writeFile('b.txt', 'b');
    await fs.writeFile('c.txt', 'c');

    // Listener should not be called yet
    expect(listener).not.toHaveBeenCalled();

    // Advance timers past debounce window
    vi.advanceTimersByTime(100);

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
    const listener = vi.fn();

    watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'a');
    vi.advanceTimersByTime(50);

    // New event resets the timer
    await fs.writeFile('b.txt', 'b');
    vi.advanceTimersByTime(50);

    // Should not have fired yet (only 100ms total but timer was reset)
    expect(listener).not.toHaveBeenCalled();

    // Advance past the reset timer
    vi.advanceTimersByTime(50);

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
    const listener = vi.fn();

    watchDebounced(fs, '', listener, 100);

    // First batch
    await fs.writeFile('a.txt', 'a');
    vi.advanceTimersByTime(100);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith([{ type: 'create', path: 'a.txt' }]);

    // Second batch after sufficient delay
    await fs.writeFile('b.txt', 'b');
    vi.advanceTimersByTime(100);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith([
      { type: 'create', path: 'b.txt' },
    ]);
  });

  it('stops emitting events after close', async () => {
    const fs = new MemoryFileSystem();
    const listener = vi.fn();

    const watcher = watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'a');
    watcher.close();

    // Advance timers - should not trigger listener after close
    vi.advanceTimersByTime(100);

    expect(listener).not.toHaveBeenCalled();

    // New events after close should also not trigger
    await fs.writeFile('b.txt', 'b');
    vi.advanceTimersByTime(100);

    expect(listener).not.toHaveBeenCalled();
  });

  it('cleans up pending events on close', async () => {
    const fs = new MemoryFileSystem();
    const listener = vi.fn();

    const watcher = watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'a');
    await fs.writeFile('b.txt', 'b');

    // Close before debounce timer fires
    watcher.close();

    vi.advanceTimersByTime(100);

    // Pending events should be discarded
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses custom debounce duration', async () => {
    const fs = new MemoryFileSystem();
    const listener = vi.fn();

    watchDebounced(fs, '', listener, 500);

    await fs.writeFile('a.txt', 'a');

    vi.advanceTimersByTime(100);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('defaults to 100ms debounce when not specified', async () => {
    const fs = new MemoryFileSystem();
    const listener = vi.fn();

    watchDebounced(fs, '', listener);

    await fs.writeFile('a.txt', 'a');

    vi.advanceTimersByTime(99);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('batches different event types together', async () => {
    const fs = new MemoryFileSystem();
    const listener = vi.fn();

    watchDebounced(fs, '', listener, 100);

    await fs.writeFile('a.txt', 'original');
    await fs.writeFile('a.txt', 'modified');
    await fs.deleteFile('a.txt');

    vi.advanceTimersByTime(100);

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
    const listener = vi.fn();

    watchDebounced(fs, 'src', listener, 100);

    await fs.writeFile('src/file.txt', 'content');
    await fs.writeFile('other/file.txt', 'content');

    vi.advanceTimersByTime(100);

    // Should only receive events from the watched directory
    expect(listener).toHaveBeenCalledTimes(1);
    const events = listener.mock.calls[0][0];
    expect(events.every((e: any) => e.path.startsWith('src/'))).toBe(true);
  });
});
