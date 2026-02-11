import type { FileSystem, WatchEvent, WatchListener, Watcher, WorkspacePath } from './types.js';

/**
 * Wraps `FileSystem.watch` with event debouncing.
 * Batches events over a configurable time window and delivers them together.
 */
export function watchDebounced(
  fs: FileSystem,
  path: WorkspacePath,
  listener: WatchListener,
  debounceMs = 100,
): Watcher {
  let pending: WatchEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const inner = fs.watch(path, (events) => {
    pending.push(...events);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      const batch = pending;
      pending = [];
      timer = undefined;
      listener(batch);
    }, debounceMs);
  });

  return {
    close() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      inner.close();
    },
  };
}
