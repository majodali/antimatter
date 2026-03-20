/**
 * Observability Service (stub)
 *
 * Platform service for system, build, and test event logging.
 *
 * Captures structured events from all services. Includes build/test events,
 * log statements from rules and tests, and system lifecycle events. Does NOT
 * include direct user interactions with the UI, but does include user actions
 * that trigger service operations (e.g., a user edit triggering a build rule).
 *
 * Events are persisted to S3 (JSONL, daily partitioned) with recent events
 * buffered in memory on workspace servers for quick retrieval.
 */

import type { OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface ObservabilityEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly projectId?: string;
  readonly source: string;
  readonly category: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ObservabilityEventsListQuery {
  readonly type: 'observability.events.list';
  readonly projectId?: string;
  readonly source?: string;
  readonly category?: string;
  readonly level?: 'info' | 'warn' | 'error';
  readonly days?: number;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type ObservabilityCommand = never;
export type ObservabilityQuery = ObservabilityEventsListQuery;
export type ObservabilityEvent_ = never;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface ObservabilityCommandResponseMap {
  // No commands yet
}

export interface ObservabilityQueryResponseMap {
  'observability.events.list': { events: readonly ObservabilityEvent[] };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

export const OBSERVABILITY_OPERATIONS: Record<string, OperationMeta> = {
  'observability.events.list': { kind: 'query', context: 'platform', description: 'List observability events' },
};
