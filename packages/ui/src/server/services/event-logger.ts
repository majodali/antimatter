/**
 * EventLogger — centralized event logging with S3 storage and EventBridge signaling.
 *
 * Used by both the API Lambda and EC2 workspace server to emit structured events.
 * Events are buffered in memory and flushed to S3 as JSONL batches.
 * Significant events can also be emitted to EventBridge for real-time signaling.
 *
 * Pattern: "log first, event second" — S3 write (durable) before EventBridge (signal).
 *
 * S3 key structure:
 *   events/{projectId}/{YYYY-MM-DD}/{timestamp}-{randomId}.jsonl
 */

import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SystemEventCategory =
  | 'workspace'
  | 'build'
  | 'deploy'
  | 'system'
  | 'file'
  | 'agent';

export type SystemEventLevel = 'info' | 'warn' | 'error';

export interface SystemEvent {
  id: string;
  timestamp: string;
  projectId: string;
  source: 'lambda' | 'workspace';
  category: SystemEventCategory;
  level: SystemEventLevel;
  message: string;
  detail?: Record<string, unknown>;
}

export interface EventLoggerConfig {
  s3Client: S3Client;
  bucket: string;
  source: 'lambda' | 'workspace';
  projectId: string;
  eventBridgeClient?: EventBridgeClient;
  eventBusName?: string;
}

export interface LoadEventsOptions {
  days?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// EventLogger
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(): string {
  return `ev-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

function randomId(): string {
  return randomUUID().slice(0, 8);
}

export class EventLogger {
  private buffer: SystemEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(private readonly config: EventLoggerConfig) {}

  // ---- Logging ----

  /** Log an event — buffers in memory for batch flush to S3 */
  log(
    category: SystemEventCategory,
    level: SystemEventLevel,
    message: string,
    detail?: Record<string, unknown>,
  ): void {
    const event: SystemEvent = {
      id: nextId(),
      timestamp: new Date().toISOString(),
      projectId: this.config.projectId,
      source: this.config.source,
      category,
      level,
      message,
      detail,
    };
    this.buffer.push(event);

    // Also log to console for CloudWatch/journalctl visibility
    const prefix = `[event-logger:${this.config.source}]`;
    if (level === 'error') {
      console.error(prefix, message, detail ? JSON.stringify(detail) : '');
    } else if (level === 'warn') {
      console.warn(prefix, message, detail ? JSON.stringify(detail) : '');
    } else {
      console.log(prefix, message, detail ? JSON.stringify(detail) : '');
    }
  }

  /** Convenience: log at info level */
  info(category: SystemEventCategory, message: string, detail?: Record<string, unknown>): void {
    this.log(category, 'info', message, detail);
  }

  /** Convenience: log at warn level */
  warn(category: SystemEventCategory, message: string, detail?: Record<string, unknown>): void {
    this.log(category, 'warn', message, detail);
  }

  /** Convenience: log at error level */
  error(category: SystemEventCategory, message: string, detail?: Record<string, unknown>): void {
    this.log(category, 'error', message, detail);
  }

  // ---- EventBridge signaling ----

  /**
   * Emit a significant event: log to S3, then signal via EventBridge.
   * "Log first, event second" — ensures durable record before signaling.
   */
  async emit(
    detailType: string,
    category: SystemEventCategory,
    level: SystemEventLevel,
    message: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    // 1. Log to buffer
    this.log(category, level, message, detail);

    // 2. Flush buffer to S3 (durable)
    await this.flush();

    // 3. Signal via EventBridge (if configured)
    if (this.config.eventBridgeClient) {
      try {
        await this.config.eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: `antimatter.${this.config.source}`,
                DetailType: detailType,
                Detail: JSON.stringify({
                  projectId: this.config.projectId,
                  category,
                  level,
                  message,
                  ...detail,
                }),
                EventBusName: this.config.eventBusName ?? 'antimatter',
              },
            ],
          }),
        );
      } catch (err) {
        // Don't fail the operation if EventBridge is unavailable
        console.error('[event-logger] EventBridge PutEvents failed:', err);
      }
    }
  }

  // ---- S3 persistence ----

  /** Flush buffered events to S3 as a JSONL batch */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.flushing) return;

    this.flushing = true;
    const events = this.buffer.splice(0);

    try {
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const key = `events/${this.config.projectId}/${date}/${Date.now()}-${randomId()}.jsonl`;
      const body = events.map((e) => JSON.stringify(e)).join('\n');

      await this.config.s3Client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/x-ndjson',
        }),
      );
    } catch (err) {
      // Put events back in buffer on failure so they aren't lost
      this.buffer.unshift(...events);
      console.error('[event-logger] S3 flush failed:', err);
    } finally {
      this.flushing = false;
    }
  }

  // ---- Lifecycle ----

  /** Start periodic flush (for long-running processes like workspace server) */
  startPeriodicFlush(intervalMs = 10_000): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('[event-logger] Periodic flush failed:', err);
      });
    }, intervalMs);
  }

  /** Stop periodic flush and do a final flush */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  // ---- Query ----

  /**
   * Load recent events for a project from S3.
   * Lists JSONL files under events/{projectId}/ for the last N days,
   * downloads and parses them, returns merged + sorted events.
   */
  static async loadRecentEvents(
    s3Client: S3Client,
    bucket: string,
    projectId: string,
    options?: LoadEventsOptions,
  ): Promise<SystemEvent[]> {
    const days = options?.days ?? 1;
    const limit = options?.limit ?? 200;

    // Generate date prefixes for the last N days
    const datePrefixes: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      datePrefixes.push(d.toISOString().slice(0, 10));
    }

    const allEvents: SystemEvent[] = [];

    for (const date of datePrefixes) {
      const prefix = `events/${projectId}/${date}/`;
      try {
        let continuationToken: string | undefined;
        do {
          const result = await s3Client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            }),
          );

          for (const obj of result.Contents ?? []) {
            if (!obj.Key) continue;
            try {
              const getResult = await s3Client.send(
                new GetObjectCommand({
                  Bucket: bucket,
                  Key: obj.Key,
                }),
              );
              const text = await getResult.Body?.transformToString('utf-8');
              if (text) {
                for (const line of text.split('\n')) {
                  if (!line.trim()) continue;
                  try {
                    allEvents.push(JSON.parse(line) as SystemEvent);
                  } catch {
                    // Skip malformed lines
                  }
                }
              }
            } catch {
              // Skip files that can't be read
            }
          }

          continuationToken = result.NextContinuationToken;
        } while (continuationToken);
      } catch {
        // Skip dates that don't have any events
      }

      // Early exit if we have enough events
      if (allEvents.length >= limit) break;
    }

    // Sort by timestamp descending (most recent first) and limit
    allEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return allEvents.slice(0, limit);
  }
}
