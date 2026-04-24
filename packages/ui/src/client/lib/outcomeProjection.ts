/**
 * outcomeProjection — fold raw workflow activity events into one row per
 * rule invocation (or schedule fire).
 *
 * The Activity Panel's job (post-redesign) is an "outcome ticker" — not a
 * raw log. A single user action produces many activity events:
 *
 *   workflow:invocation:start
 *     workflow:rule:start     (one per matching rule)
 *       workflow:log           (N per wf.log call)
 *       workflow:util:start    (N per wf.utils.* call)
 *       workflow:util:end
 *       workflow:exec:start
 *       workflow:exec:chunk    (many)
 *       workflow:exec:end
 *     workflow:rule:end
 *   workflow:invocation:end
 *
 * What the user cares about is one row per rule:end, colored by outcome
 * (success / warn / error / running), with the child events reachable via
 * expansion. That's what this module produces.
 *
 * Design constraints:
 *  - Pure: same events in → same outcomes out. Easy to memoise.
 *  - Incremental-friendly: if called with a superset of prior events, it
 *    produces a superset of prior outcomes. The store already sorts events
 *    by (loggedAt, seq) so iteration order is stable.
 *  - Drops noise: non-workflow sources, zero-match invocations, pure
 *    invocation ceremony (start/end without any rule:start) never produce
 *    an outcome.
 *  - Schedule-aware: a `workflow:schedule:fire` event immediately before
 *    a rule:start (sharing operationId) supplies richer trigger metadata
 *    ("every 10m") attached to the outcome.
 */
import type { ActivityEvent } from '../../shared/activity-types';
import { Kinds } from '../../shared/activity-types';

export type OutcomeStatus = 'running' | 'success' | 'warn' | 'error';
export type OutcomeKind = 'rule' | 'schedule';

export interface RuleOutcome {
  /** Stable key for React lists. */
  readonly key: string;
  readonly operationId: string;
  readonly invocationId: string;
  readonly ruleId: string;
  /** Human-friendly label derived from ruleId or the schedule name. */
  readonly ruleName: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly status: OutcomeStatus;
  /** For errored outcomes: the first error message encountered. */
  readonly errorMessage?: string;
  readonly kind: OutcomeKind;
  /** Terse context about why this outcome ran — e.g. "every 10m". */
  readonly triggerSummary?: string;
  /** Child events (logs, execs, utils, emits) belonging to this outcome. */
  readonly childEvents: readonly ActivityEvent[];
}

/**
 * Convert an ordered stream of activity events into outcome rows.
 *
 * Assumes `events` is sorted ascending by (loggedAt, seq) — which
 * `useActivityStore` guarantees. Safe to call on every render; the work
 * is O(N) in the number of events.
 */
export function projectOutcomes(events: readonly ActivityEvent[]): RuleOutcome[] {
  const outcomes = new Map<string, MutableOutcome>();
  const scheduleFiresByOp = new Map<string, ActivityEvent>();

  for (const e of events) {
    if (e.source !== 'workflow') continue;

    // Stash schedule:fire events so the following rule:start can enrich its
    // outcome with the fire's metadata (intervalSpec, scheduleName).
    if (e.kind === Kinds.WorkflowScheduleFire) {
      if (e.operationId) scheduleFiresByOp.set(e.operationId, e);
      continue;
    }

    if (e.kind === Kinds.WorkflowRuleStart) {
      const opId = e.operationId;
      const ruleId = (e.data?.ruleId as string | undefined) ?? e.correlationId;
      if (!opId || !ruleId) continue;
      const key = outcomeKey(opId, ruleId);
      if (outcomes.has(key)) continue; // idempotent
      const fire = scheduleFiresByOp.get(opId);
      const isSchedule = ruleId.startsWith('schedule:');
      const scheduleName = isSchedule ? ruleId.slice('schedule:'.length) : null;
      outcomes.set(key, {
        key,
        operationId: opId,
        invocationId: e.parentId ?? opId,
        ruleId,
        ruleName: humanizeName(scheduleName ?? ruleId, fire),
        startedAt: e.loggedAt,
        endedAt: undefined,
        durationMs: undefined,
        status: 'running',
        errorMessage: undefined,
        kind: isSchedule ? 'schedule' : 'rule',
        triggerSummary: deriveTriggerSummary(fire, isSchedule),
        childEvents: [],
      });
      continue;
    }

    if (e.kind === Kinds.WorkflowRuleEnd) {
      const opId = e.operationId;
      const ruleId = (e.data?.ruleId as string | undefined) ?? e.correlationId;
      if (!opId || !ruleId) continue;
      const o = outcomes.get(outcomeKey(opId, ruleId));
      if (!o) continue;
      o.endedAt = e.loggedAt;
      o.durationMs = typeof e.data?.durationMs === 'number' ? e.data.durationMs : undefined;
      const err = e.data?.error;
      if (err) {
        o.status = 'error';
        o.errorMessage ??= String(err);
      } else if (o.status === 'running') {
        o.status = 'success';
      }
      continue;
    }

    // Everything else (log, exec, util, emit) is a child of a rule within
    // an operation. Attach by (operationId, parentId) — parentId is the
    // ruleId for direct-rule children and utilId→ruleId chains collapse to
    // the same ruleId anyway via wf.utils' trace context.
    if (isChildKind(e.kind)) {
      const opId = e.operationId;
      if (!opId) continue;
      // Find a matching outcome. Prefer explicit parentId match, fall back
      // to correlationId (logs use correlationId=ruleId; execs/utils use
      // parentId=ruleId).
      const candidates: Array<string | undefined> = [e.parentId, e.correlationId];
      let attached = false;
      for (const ruleId of candidates) {
        if (!ruleId) continue;
        const o = outcomes.get(outcomeKey(opId, ruleId));
        if (!o) continue;
        (o.childEvents as ActivityEvent[]).push(e);
        promoteStatus(o, e);
        attached = true;
        break;
      }
      if (!attached) {
        // Orphan child — the parent rule:start hasn't been seen (likely
        // truncated out of the ring buffer). Skip silently; the /logs page
        // still shows it.
      }
      continue;
    }

    // Everything else (invocation:start/end, anything unknown) is ceremony.
    // We don't want a row per no-op file:change invocation, so we ignore.
  }

  // Stable sort: ascending startedAt for tail scrolling.
  return Array.from(outcomes.values()).sort((a, b) => {
    if (a.startedAt === b.startedAt) return a.key.localeCompare(b.key);
    return a.startedAt.localeCompare(b.startedAt);
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Mutable during projection; frozen-ish on return (TS has no deep freeze). */
interface MutableOutcome {
  key: string;
  operationId: string;
  invocationId: string;
  ruleId: string;
  ruleName: string;
  startedAt: string;
  endedAt: string | undefined;
  durationMs: number | undefined;
  status: OutcomeStatus;
  errorMessage: string | undefined;
  kind: OutcomeKind;
  triggerSummary: string | undefined;
  childEvents: ActivityEvent[];
}

function outcomeKey(operationId: string, ruleId: string): string {
  return `${operationId}#${ruleId}`;
}

const CHILD_KINDS = new Set<string>([
  Kinds.WorkflowLog,
  Kinds.WorkflowExecStart,
  Kinds.WorkflowExecChunk,
  Kinds.WorkflowExecEnd,
  Kinds.WorkflowUtilStart,
  Kinds.WorkflowUtilEnd,
  Kinds.WorkflowEmit,
]);

function isChildKind(kind: string): boolean {
  return CHILD_KINDS.has(kind);
}

function promoteStatus(o: MutableOutcome, e: ActivityEvent): void {
  if (o.status === 'error') return; // already worst
  if (e.kind === Kinds.WorkflowLog) {
    if (e.level === 'error') {
      o.status = 'error';
      o.errorMessage ??= e.message;
    } else if (e.level === 'warn') {
      // Latch onto warn whether we're currently running or succeeded — rule:end
      // must not silently downgrade back to 'success'. See rule:end handling,
      // which only promotes running→success, not warn→success.
      if (o.status === 'running' || o.status === 'success') o.status = 'warn';
    }
  }
  if (e.kind === Kinds.WorkflowUtilEnd && e.level === 'error') {
    o.status = 'error';
    const msg = typeof e.data?.error === 'string' ? e.data.error : e.message;
    o.errorMessage ??= msg;
  }
  if (e.kind === Kinds.WorkflowExecEnd) {
    const exitCode = e.data?.exitCode;
    if (typeof exitCode === 'number' && exitCode !== 0) {
      o.status = 'error';
      o.errorMessage ??= `exit ${exitCode}`;
    }
  }
}

/**
 * Convert a rule id slug into a human label. Schedule fires carry their
 * original schedule name inside the fire event's data; prefer that over
 * the auto-generated `schedule:foo` slug.
 */
function humanizeName(raw: string, fire: ActivityEvent | undefined): string {
  const fromFire = fire?.data?.scheduleName as string | undefined;
  if (fromFire) return fromFire;
  // kebab-case → Title Case
  return raw
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function deriveTriggerSummary(
  fire: ActivityEvent | undefined,
  isSchedule: boolean,
): string | undefined {
  if (isSchedule && fire?.data?.intervalSpec) {
    return `every ${String(fire.data.intervalSpec)}`;
  }
  return undefined;
}
