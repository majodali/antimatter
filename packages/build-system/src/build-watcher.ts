import type { FileSystem, WatchEvent, Watcher, WorkspacePath } from '@antimatter/filesystem';
import { watchDebounced } from '@antimatter/filesystem';
import type { BuildRule } from '@antimatter/project-model';
import { matchesAnyGlob } from './glob-matcher.js';

export interface BuildWatcherOptions {
  /** File system to watch */
  readonly fs: FileSystem;
  /** Workspace root directory */
  readonly workspaceRoot: string;
  /** Debounce interval in ms (default: 500) */
  readonly debounceMs?: number;
  /** Called when file changes match rule inputs */
  readonly onTriggered: (ruleIds: string[], changedPaths: string[]) => void;
}

/**
 * Watches the filesystem for changes and triggers builds when
 * changed files match build rule input globs.
 *
 * Features:
 * - Debounced file watching (default 500ms)
 * - Glob matching against rule inputs
 * - Hold/release for agent batch edits
 * - Ignores changes in .antimatter-cache and node_modules
 */
export class BuildWatcher {
  private rules: BuildRule[] = [];
  private watcher: Watcher | null = null;
  private held = false;
  private heldChanges: string[] = [];
  private readonly options: BuildWatcherOptions;

  /** Paths to ignore (build artifacts, cache, etc.) */
  private static readonly IGNORE_PATTERNS = [
    '.antimatter-cache/**',
    'node_modules/**',
    '.git/**',
    '.antimatter/build.json',
  ];

  constructor(options: BuildWatcherOptions) {
    this.options = options;
  }

  /**
   * Set the build rules used for matching.
   * Restarts the watcher if it's already running.
   */
  setRules(rules: BuildRule[]): void {
    this.rules = rules;
  }

  /**
   * Start watching for file changes.
   */
  start(): void {
    if (this.watcher) {
      this.stop();
    }

    const debounceMs = this.options.debounceMs ?? 500;

    this.watcher = watchDebounced(
      this.options.fs,
      '' as WorkspacePath,
      (events: readonly WatchEvent[]) => {
        this.handleChanges(events);
      },
      debounceMs,
    );
  }

  /**
   * Stop watching for file changes.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.heldChanges = [];
    this.held = false;
  }

  /**
   * Pause auto-triggering. Changes accumulate but don't trigger builds.
   * Use during agent batch edits.
   */
  hold(): void {
    this.held = true;
  }

  /**
   * Resume auto-triggering and flush accumulated changes.
   * Triggers a build for all changes accumulated during hold.
   */
  release(): void {
    this.held = false;

    if (this.heldChanges.length > 0) {
      const paths = [...this.heldChanges];
      this.heldChanges = [];
      this.triggerForPaths(paths);
    }
  }

  /**
   * Whether the watcher is currently running.
   */
  get isRunning(): boolean {
    return this.watcher !== null;
  }

  /**
   * Whether the watcher is currently held (paused).
   */
  get isHeld(): boolean {
    return this.held;
  }

  /**
   * Handle a batch of debounced file change events.
   */
  private handleChanges(events: readonly WatchEvent[]): void {
    if (this.rules.length === 0) return;

    // Extract unique changed paths, filtering out ignored paths
    const changedPaths = new Set<string>();
    for (const event of events) {
      const normalizedPath = event.path.replace(/\\/g, '/');

      // Skip ignored patterns
      if (matchesAnyGlob(normalizedPath, BuildWatcher.IGNORE_PATTERNS)) {
        continue;
      }

      changedPaths.add(normalizedPath);
    }

    if (changedPaths.size === 0) return;

    const pathsArray = Array.from(changedPaths);

    if (this.held) {
      // Accumulate changes during hold
      this.heldChanges.push(...pathsArray);
      return;
    }

    this.triggerForPaths(pathsArray);
  }

  /**
   * Match changed paths against rule input globs and trigger callback.
   */
  private triggerForPaths(changedPaths: string[]): void {
    const triggeredRuleIds = new Set<string>();

    for (const rule of this.rules) {
      if (rule.inputs.length === 0) continue;

      for (const changedPath of changedPaths) {
        if (matchesAnyGlob(changedPath, rule.inputs)) {
          triggeredRuleIds.add(rule.id);
          break; // One match is enough to trigger the rule
        }
      }
    }

    if (triggeredRuleIds.size > 0) {
      this.options.onTriggered(Array.from(triggeredRuleIds), changedPaths);
    }
  }
}
