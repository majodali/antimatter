/**
 * EventLog — persistent, ordered, deduplicated event log for the workflow engine.
 *
 * All external events (file changes, REST mutations, startup events) flow through
 * the EventLog before reaching the WorkflowManager. Each event gets:
 *  - A monotonic sequence number
 *  - Deduplication against recent events (same type:path within a time window)
 *  - Persistence to an append-only JSONL file
 *  - Batched delivery to a subscriber via a drain timer
 *
 * Internal workflow events (wf.emit: install:success, build:success) are recorded
 * for audit but not replayed — they cascade within the runtime's cycle system.
 *
 * On startup, the log replays events since the last processed checkpoint so the
 * workflow engine can catch up on events that arrived while it was offline.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkflowEvent, EventLogEntry, EventSource } from '@antimatter/workflow';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 10_000;        // In-memory ring buffer size
const DEDUPE_WINDOW_MS = 2_000;    // Drop duplicate events within this window
const DRAIN_INTERVAL_MS = 50;      // Batch events for this long before delivering
const COMPACT_RETAIN = 1_000;      // Keep this many entries after checkpoint on compaction

// ---------------------------------------------------------------------------
// EventLog
// ---------------------------------------------------------------------------

export interface EventLogOptions {
  /** Path to the JSONL file (e.g. '.antimatter-cache/events.jsonl'). */
  readonly logPath: string;
}

export class EventLog {
  private readonly logPath: string;

  // In-memory ring buffer
  private entries: EventLogEntry[] = [];
  private nextSeq = 1;

  // Deduplication
  private dedupeWindow = new Map<string, { seq: number; loggedAt: number }>();

  // Drain batching
  private pendingDrain: EventLogEntry[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriber: ((entries: EventLogEntry[]) => void) | null = null;

  // Compaction timer
  private compactTimer: ReturnType<typeof setInterval> | null = null;
  private lastCompactedSeq = 0;

  constructor(options: EventLogOptions) {
    this.logPath = options.logPath;
  }

  // ---- Lifecycle ----

  /**
   * Initialize the event log: load existing JSONL file into the ring buffer,
   * restore sequence numbers and deduplication window.
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load existing entries from JSONL
    if (existsSync(this.logPath)) {
      try {
        const content = readFileSync(this.logPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as EventLogEntry;
            this.entries.push(entry);
            if (entry.seq >= this.nextSeq) {
              this.nextSeq = entry.seq + 1;
            }
            // Rebuild dedup window for recent entries
            if (entry.dedupeKey) {
              this.dedupeWindow.set(entry.dedupeKey, {
                seq: entry.seq,
                loggedAt: new Date(entry.loggedAt).getTime(),
              });
            }
          } catch {
            // Skip malformed lines
          }
        }
        // Trim to max ring buffer size
        if (this.entries.length > MAX_ENTRIES) {
          this.entries = this.entries.slice(-MAX_ENTRIES);
        }
        console.log(`[event-log] Loaded ${this.entries.length} entries, nextSeq=${this.nextSeq}`);
      } catch (err) {
        console.warn('[event-log] Failed to load JSONL, starting fresh:', err);
        this.entries = [];
        this.nextSeq = 1;
      }
    }

    // Clean stale dedup entries
    this.pruneDedupeWindow();

    // Start periodic compaction (every 5 minutes)
    this.compactTimer = setInterval(() => {
      this.compact(this.lastCompactedSeq).catch(err => {
        console.warn('[event-log] Compaction failed:', err);
      });
    }, 5 * 60 * 1000);
  }

  /**
   * Flush pending writes and clean up timers.
   */
  async shutdown(): Promise<void> {
    // Flush any pending drain
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    if (this.pendingDrain.length > 0) {
      this.flushDrain();
    }

    // Stop compaction timer
    if (this.compactTimer) {
      clearInterval(this.compactTimer);
      this.compactTimer = null;
    }

    // Final compaction
    await this.compact(this.lastCompactedSeq);
  }

  // ---- Append ----

  /**
   * Append events to the log. Assigns sequence numbers, deduplicates,
   * persists to JSONL, and schedules delivery to the subscriber.
   *
   * Returns the entries that were actually appended (after dedup).
   */
  append(events: WorkflowEvent[], source: EventSource): EventLogEntry[] {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const appended: EventLogEntry[] = [];

    for (const event of events) {
      // Compute dedup key for file events
      const dedupeKey = event.path
        ? `${event.type}:${event.path}`
        : null;

      // Check dedup window
      if (dedupeKey) {
        const prev = this.dedupeWindow.get(dedupeKey);
        if (prev && (now - prev.loggedAt) < DEDUPE_WINDOW_MS) {
          continue; // Skip duplicate
        }
      }

      const entry: EventLogEntry = {
        seq: this.nextSeq++,
        loggedAt: nowIso,
        source,
        dedupeKey,
        event,
      };

      // Update dedup window
      if (dedupeKey) {
        this.dedupeWindow.set(dedupeKey, { seq: entry.seq, loggedAt: now });
      }

      // Append to ring buffer
      this.entries.push(entry);
      if (this.entries.length > MAX_ENTRIES) {
        this.entries.shift();
      }

      // Persist to JSONL (synchronous for durability)
      try {
        appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
      } catch (err) {
        console.warn('[event-log] Failed to append to JSONL:', err);
      }

      appended.push(entry);
    }

    // Schedule drain to subscriber
    if (appended.length > 0) {
      this.pendingDrain.push(...appended);
      this.scheduleDrain();
    }

    return appended;
  }

  /**
   * Record an event for audit purposes only (not delivered to subscriber).
   * Used for internal workflow events (wf.emit) that cascade within the runtime.
   */
  record(events: WorkflowEvent[], source: EventSource): void {
    const nowIso = new Date().toISOString();
    for (const event of events) {
      const entry: EventLogEntry = {
        seq: this.nextSeq++,
        loggedAt: nowIso,
        source,
        dedupeKey: null, // Never deduplicate audit entries
        event,
      };

      this.entries.push(entry);
      if (this.entries.length > MAX_ENTRIES) {
        this.entries.shift();
      }

      try {
        appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
      } catch {
        // Best effort for audit
      }
    }
  }

  // ---- Subscription ----

  /**
   * Subscribe to the event log. The handler is called with batches of new entries
   * after a short drain interval (50ms by default).
   * Only one subscriber is supported (the WorkflowManager).
   */
  subscribe(handler: (entries: EventLogEntry[]) => void): void {
    this.subscriber = handler;
  }

  // ---- Replay ----

  /**
   * Get all entries with sequence numbers greater than the given checkpoint.
   * Used for startup catchup and rule reload replay.
   */
  getEntriesSince(seq: number): EventLogEntry[] {
    return this.entries.filter(e => e.seq > seq);
  }

  /**
   * Get the current highest sequence number.
   */
  getLatestSeq(): number {
    return this.nextSeq - 1;
  }

  // ---- Compaction ----

  /**
   * Compact the JSONL file by removing entries before the checkpoint.
   * Keeps a buffer of COMPACT_RETAIN entries for debugging.
   */
  async compact(checkpointSeq: number): Promise<void> {
    this.lastCompactedSeq = checkpointSeq;
    const retainFrom = Math.max(0, checkpointSeq - COMPACT_RETAIN);
    const retained = this.entries.filter(e => e.seq > retainFrom);

    if (retained.length === this.entries.length) return; // Nothing to compact

    this.entries = retained;

    // Rewrite JSONL
    try {
      const content = retained.map(e => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(this.logPath, content);
      console.log(`[event-log] Compacted: retained ${retained.length} entries (checkpoint=${checkpointSeq})`);
    } catch (err) {
      console.warn('[event-log] Compaction write failed:', err);
    }
  }

  // ---- Internal ----

  private scheduleDrain(): void {
    if (this.drainTimer) return; // Already scheduled
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.flushDrain();
    }, DRAIN_INTERVAL_MS);
  }

  private flushDrain(): void {
    if (this.pendingDrain.length === 0 || !this.subscriber) return;
    const batch = this.pendingDrain;
    this.pendingDrain = [];
    this.subscriber(batch);
  }

  private pruneDedupeWindow(): void {
    const cutoff = Date.now() - DEDUPE_WINDOW_MS * 2;
    for (const [key, val] of this.dedupeWindow) {
      if (val.loggedAt < cutoff) {
        this.dedupeWindow.delete(key);
      }
    }
  }
}
