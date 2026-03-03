/**
 * Project-scoped Zustand persistence utilities.
 *
 * Provides custom storage that scopes persistence keys by the current project ID,
 * plus serialization helpers for Map and Set types that don't natively serialize to JSON.
 */
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const PROJECT_STORAGE_KEY = 'antimatter-current-project';

function getCurrentProjectId(): string | null {
  return localStorage.getItem(PROJECT_STORAGE_KEY);
}

/**
 * Creates a Zustand-compatible storage backend that scopes keys by project ID.
 * Key format: `antimatter-{storeName}-{projectId}`
 */
export function createProjectStorage(storeName: string) {
  const storage: StateStorage = {
    getItem(name: string): string | null {
      const projectId = getCurrentProjectId();
      if (!projectId) return null;
      return localStorage.getItem(`antimatter-${storeName}-${projectId}`);
    },
    setItem(name: string, value: string): void {
      const projectId = getCurrentProjectId();
      if (!projectId) return;
      localStorage.setItem(`antimatter-${storeName}-${projectId}`, value);
    },
    removeItem(name: string): void {
      const projectId = getCurrentProjectId();
      if (!projectId) return;
      localStorage.removeItem(`antimatter-${storeName}-${projectId}`);
    },
  };

  return createJSONStorage(() => storage);
}

/** Serialize a Map to an array of [key, value] entries for JSON storage. */
export function serializeMap<K, V>(map: Map<K, V>): [K, V][] {
  return Array.from(map.entries());
}

/** Deserialize an array of [key, value] entries back to a Map. */
export function deserializeMap<K, V>(entries: [K, V][] | undefined): Map<K, V> {
  return new Map(entries || []);
}

/** Serialize a Set to an array for JSON storage. */
export function serializeSet<T>(set: Set<T>): T[] {
  return Array.from(set);
}

/** Deserialize an array back to a Set. */
export function deserializeSet<T>(array: T[] | undefined): Set<T> {
  return new Set(array || []);
}
