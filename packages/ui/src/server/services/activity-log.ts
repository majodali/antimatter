/**
 * ActivityLog — unified append-only log for ActivityEvents.
 *
 * Reusable by Router (router/child/service events) and Worker
 * (worker/workflow/pty/service events). Events are persisted to JSONL,
 * held in a ring buffer, and pushed to subscribers (typically for WebSocket
 * broadcast).
 *
 * Pattern mirrors EventLog.ts but without deduplication (activity events
 * are distinct by nature).
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ActivityEvent, ActivityEventInput, ActivityListOptions, ActivitySource, ActivityLevel } from '../../shared/activity-types.js';
import { levelMeets } from '../../shared/activity-types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 10_000;              // In-memory ring buffer size
const COMPACT_RETAIN = 5_000;            // Keep this many entries after checkpoint on compaction
const MAX_JSONL_SIZE = 10 * 1024 * 1024; // 10 MB hard cap on JSONL file size
const COMPACT_INTERVAL_MS = 60_000;      // Compact every 60 seconds

// ---------------------------------------------------------------------------
// ActivityLog
// ---------------------------------------------------------------------------

export interface ActivityLogOptions {
  /** Path to the JSONL file (e.g. '.antimatter-cache/activity.jsonl'). */
  readonly logPath: string;
  /** Log label for console messages. */
  readonly label?: string;
}

export class ActivityLog {
  private readonly logPath: string;
  private readonly label: string;

  private entries: ActivityEvent[] = [];
  private nextSeq = 1;

  private subscribers = new Set<(event: ActivityEvent) => void>();

  private compactTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  /** Force the next autoCompact tick to truncate even if the file is small. */
  private pendingTruncate = false;

  constructor(options: ActivityLogOptions) {
    this.logPath = options.logPath;
    this.label = options.label ?? 'activity-log';
  }

  // ---- Lifecycle ----

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Ensure directory exists
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load existing entries from JSONL — with a safety cap so a runaway
    // file (e.g. from a missed compaction cycle) doesn't OOM the worker.
    if (existsSync(this.logPath)) {
      try {
        const stat = statSync(this.logPath);
        // If the file is wildly over the compaction cap (>5x), skip loading
        // and truncate on first compaction tick. The in-memory ring starts empty.
        if (stat.size > MAX_JSONL_SIZE * 5) {
          console.warn(
            `[${this.label}] JSONL is ${(stat.size / 1024 / 1024).toFixed(0)}MB (>5x cap); ` +
              `skipping load, will truncate on compaction.`,
          );
          this.entries = [];
          this.nextSeq = 1;
          // Schedule an immediate truncation so next appends don't grow further.
          this.pendingTruncate = true;
        } else {
          const content = readFileSync(this.logPath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const entry = JSON.parse(line) as ActivityEvent;
              this.entries.push(entry);
              if (entry.seq >= this.nextSeq) {
                this.nextSeq = entry.seq + 1;
              }
            } catch {
              // Skip malformed lines
            }
          }
          // Trim to max ring buffer size
          if (this.entries.length > MAX_ENTRIES) {
            this.entries = this.entries.slice(-MAX_ENTRIES);
          }
          console.log(`[${this.label}] Loaded ${this.entries.length} entries, nextSeq=${this.nextSeq}`);
        }
      } catch (err) {
        console.warn(`[${this.label}] Failed to load JSONL, starting fresh:`, err);
        this.entries = [];
        this.nextSeq = 1;
        this.pendingTruncate = true;
      }
    }

    // Start periodic compaction
    this.compactTimer = setInterval(() => {
      this.autoCompact().catch(err => {
        console.warn(`[${this.label}] Compaction failed:`, err);
      });
    }, COMPACT_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (this.compactTimer) {
      clearInterval(this.compactTimer);
      this.compactTimer = null;
    }
    this.subscribers.clear();
  }

  // ---- Emit ----

  /**
   * Append an event to the log. Assigns seq + loggedAt. Persists to JSONL,
   * notifies subscribers (typically for WebSocket broadcast).
   * Returns the full event.
   */
  emit(input: ActivityEventInput): ActivityEvent {
    const event: ActivityEvent = {
      seq: this.nextSeq++,
      loggedAt: new Date().toISOString(),
      ...input,
    };

    // Append to ring buffer
    this.entries.push(event);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    // Persist to JSONL
    this.appendToFile(event);

    // Notify subscribers synchronously (small number of subscribers expected)
    for (const sub of this.subscribers) {
      try { sub(event); } catch (err) {
        console.warn(`[${this.label}] Subscriber error:`, err);
      }
    }

    return event;
  }

  // ---- Subscription ----

  /** Subscribe to new events. Returns an unsubscribe function. */
  subscribe(fn: (event: ActivityEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  // ---- Query ----

  /** List entries, newest first, with optional filters. */
  list(opts?: ActivityListOptions): ActivityEvent[] {
    const limit = opts?.limit ?? 500;
    const sinceMs = opts?.since ? new Date(opts.since).getTime() : 0;

    // Iterate in reverse for newest-first
    const out: ActivityEvent[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (sinceMs && new Date(e.loggedAt).getTime() <= sinceMs) break; // Events before sinceMs — stop (ordered)
      if (opts?.source && e.source !== opts.source) continue;
      if (opts?.kind && !e.kind.startsWith(opts.kind)) continue;
      if (opts?.projectId && e.projectId !== opts.projectId) continue;
      if (opts?.environment !== undefined && e.environment !== opts.environment) continue;
      if (opts?.minLevel && !levelMeets(e.level, opts.minLevel)) continue;
      if (opts?.operationId && e.operationId !== opts.operationId) continue;
      if (opts?.correlationId && e.correlationId !== opts.correlationId && e.parentId !== opts.correlationId) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Get all events for an operation ID (end-to-end timeline). */
  byOperation(operationId: string): ActivityEvent[] {
    return this.entries.filter(e => e.operationId === operationId);
  }

  /** Get all events whose correlationId or parentId matches, in chronological order. */
  byCorrelation(correlationId: string): ActivityEvent[] {
    return this.entries.filter(e =>
      e.correlationId === correlationId || e.parentId === correlationId
    );
  }

  /** Total entry count. */
  get size(): number { return this.entries.length; }

  // ---- Internal ----

  private appendToFile(entry: ActivityEvent): void {
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.warn(`[${this.label}] appendToFile failed:`, err);
    }
  }

  private async autoCompact(): Promise<void> {
    if (!existsSync(this.logPath)) return;
    const stat = statSync(this.logPath);
    if (!this.pendingTruncate && stat.size < MAX_JSONL_SIZE) return;

    // Compact: rewrite file with only the last COMPACT_RETAIN in-memory entries.
    const retained = this.entries.slice(-COMPACT_RETAIN);
    const content = retained.length > 0
      ? retained.map(e => JSON.stringify(e)).join('\n') + '\n'
      : '';
    writeFileSync(this.logPath, content, 'utf-8');
    const before = (stat.size / 1024 / 1024).toFixed(1);
    console.log(
      `[${this.label}] Compacted JSONL: ${retained.length} entries retained (was ${before}MB)`,
    );
    this.pendingTruncate = false;
  }
}
