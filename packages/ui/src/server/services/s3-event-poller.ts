/**
 * S3EventPoller — polls SQS for S3 object events (via EventBridge).
 *
 * Replaces inotify-based file watching. S3 Files syncs writes to S3 after ~60s,
 * which triggers EventBridge → SQS. This poller converts those events into
 * WatchEvent objects that feed the same workflow pipeline as the old file watcher.
 *
 * IDE-originated writes still trigger immediately via REST API synthetic events.
 * The EventLog deduplicates s3-event vs rest-api within a 5s window.
 */

import { SQSClient, ReceiveMessageCommand, DeleteMessageBatchCommand } from '@aws-sdk/client-sqs';

export interface WatchEvent {
  readonly type: 'create' | 'modify' | 'delete';
  readonly path: string;
}

export interface S3EventPollerOptions {
  /** SQS queue URL receiving EventBridge S3 events. */
  readonly queueUrl: string;
  /** S3 key prefix to match (e.g. "projects/{projectId}/files/"). Stripped from event paths. */
  readonly s3Prefix: string;
  /** Path prefixes to ignore (e.g. ['.git/', 'node_modules/']). */
  readonly ignorePatterns: string[];
  /** Callback when events are received. */
  readonly onEvents: (events: WatchEvent[]) => void;
  /** Optional SQS client (for testing). */
  readonly sqsClient?: SQSClient;
}

export class S3EventPoller {
  private readonly queueUrl: string;
  private readonly s3Prefix: string;
  private readonly ignorePatterns: string[];
  private readonly onEvents: (events: WatchEvent[]) => void;
  private readonly sqsClient: SQSClient;

  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: S3EventPollerOptions) {
    this.queueUrl = options.queueUrl;
    this.s3Prefix = options.s3Prefix;
    this.ignorePatterns = options.ignorePatterns;
    this.onEvents = options.onEvents;
    this.sqsClient = options.sqsClient ?? new SQSClient({});
  }

  /** Start polling SQS for S3 events. */
  start(pollIntervalMs = 2000): void {
    if (this.running) return;
    this.running = true;
    console.log(`[s3-event-poller] Started (interval=${pollIntervalMs}ms, prefix=${this.s3Prefix})`);
    this.poll(pollIntervalMs);
  }

  /** Stop polling and clean up. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[s3-event-poller] Stopped');
  }

  private poll(intervalMs: number): void {
    if (!this.running) return;

    this.pollOnce()
      .catch(err => console.warn('[s3-event-poller] Poll error:', err.message))
      .finally(() => {
        if (this.running) {
          this.pollTimer = setTimeout(() => this.poll(intervalMs), intervalMs);
        }
      });
  }

  private async pollOnce(): Promise<void> {
    const response = await this.sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1, // Long polling — returns immediately if messages available
    }));

    const messages = response.Messages;
    if (!messages || messages.length === 0) return;

    const events: WatchEvent[] = [];
    const receiptHandles: { Id: string; ReceiptHandle: string }[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.Body || !msg.ReceiptHandle) continue;

      receiptHandles.push({ Id: String(i), ReceiptHandle: msg.ReceiptHandle });

      try {
        const parsed = this.parseMessage(msg.Body);
        if (parsed) events.push(...parsed);
      } catch {
        // Skip malformed messages
      }
    }

    // Delete processed messages from SQS
    if (receiptHandles.length > 0) {
      await this.sqsClient.send(new DeleteMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: receiptHandles,
      })).catch(err => console.warn('[s3-event-poller] Delete batch error:', err.message));
    }

    // Deliver events to callback
    if (events.length > 0) {
      this.onEvents(events);
    }
  }

  /**
   * Parse an EventBridge-wrapped S3 event notification.
   *
   * EventBridge envelope:
   * {
   *   "source": "aws.s3",
   *   "detail-type": "Object Created" | "Object Deleted",
   *   "detail": {
   *     "bucket": { "name": "..." },
   *     "object": { "key": "..." }
   *   }
   * }
   */
  private parseMessage(body: string): WatchEvent[] | null {
    const envelope = JSON.parse(body);

    // SQS wraps EventBridge events — the envelope may be nested
    const event = envelope.detail ? envelope : (envelope.Message ? JSON.parse(envelope.Message) : null);
    if (!event?.detail?.object?.key) return null;

    const s3Key: string = decodeURIComponent(event.detail.object.key.replace(/\+/g, ' '));

    // Only process events matching our prefix
    if (!s3Key.startsWith(this.s3Prefix)) return null;

    // Strip prefix to get relative path
    const relativePath = s3Key.slice(this.s3Prefix.length);
    if (!relativePath) return null;

    // Filter ignored paths
    for (const pattern of this.ignorePatterns) {
      if (relativePath.startsWith(pattern) || relativePath.includes('/' + pattern)) {
        return null;
      }
    }

    const detailType: string = event['detail-type'] || event.detailType || '';
    const type: WatchEvent['type'] = detailType.includes('Deleted') ? 'delete' : 'modify';

    return [{ type, path: relativePath }];
  }
}
