// ============================================================================
// Schedule interval parsing
//
// Small helper for turning friendly duration strings (`'5m'`, `'1h'`, `'1d'`)
// into millisecond counts. Used by `wf.every(name, interval, action)` in
// automation scripts and by the scheduler tick in WorkflowManager.
// ============================================================================

/** Suffix → milliseconds multiplier. */
const UNITS: Readonly<Record<string, number>> = {
  ms: 1,
  s:  1_000,
  m:  60_000,
  h:  60 * 60_000,
  d:  24 * 60 * 60_000,
};

/** Minimum allowed schedule interval (milliseconds). */
export const MIN_SCHEDULE_INTERVAL_MS = 10_000;

/**
 * Parse a schedule interval spec into milliseconds.
 *
 * Accepts:
 *   - a positive integer (milliseconds, returned as-is)
 *   - a duration string: `'\d+(ms|s|m|h|d)'` (case-insensitive)
 *   - `'PT{n}S'` / `'PT{n}M'` ISO 8601 fragments (convenience)
 *
 * Throws `Error` on invalid input OR if the resulting duration is less
 * than {@link MIN_SCHEDULE_INTERVAL_MS}. That minimum keeps the scheduler
 * honest — sub-second intervals would be a cycle-waster (tick granularity
 * is 30s anyway) and almost certainly a typo.
 */
export function parseInterval(spec: string | number): number {
  if (typeof spec === 'number') {
    if (!Number.isFinite(spec) || spec <= 0) {
      throw new Error(`Invalid interval: ${spec} (must be a positive finite number)`);
    }
    const ms = Math.round(spec);
    if (ms < MIN_SCHEDULE_INTERVAL_MS) {
      throw new Error(
        `Interval ${ms}ms is below the ${MIN_SCHEDULE_INTERVAL_MS}ms minimum`,
      );
    }
    return ms;
  }

  if (typeof spec !== 'string' || !spec.trim()) {
    throw new Error(`Invalid interval: ${JSON.stringify(spec)}`);
  }

  // ISO 8601 fragment: PT{n}S or PT{n}M (seconds or minutes)
  const iso = /^PT(\d+)([SMHD])$/i.exec(spec.trim());
  if (iso) {
    const n = parseInt(iso[1], 10);
    const unit = iso[2].toLowerCase();
    const unitMs = unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    const ms = n * unitMs;
    if (ms < MIN_SCHEDULE_INTERVAL_MS) {
      throw new Error(`Interval ${spec} is below the ${MIN_SCHEDULE_INTERVAL_MS}ms minimum`);
    }
    return ms;
  }

  // Shorthand: \d+(ms|s|m|h|d)
  const m = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(spec.trim());
  if (!m) {
    throw new Error(
      `Invalid interval spec: "${spec}" (expected e.g. "30s", "5m", "1h", "1d", or a number of ms)`,
    );
  }
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const unitMs = UNITS[unit];
  if (!unitMs) {
    throw new Error(`Unknown interval unit: ${unit}`);
  }
  const ms = n * unitMs;
  if (ms < MIN_SCHEDULE_INTERVAL_MS) {
    throw new Error(`Interval ${spec} is below the ${MIN_SCHEDULE_INTERVAL_MS}ms minimum`);
  }
  return ms;
}

/**
 * The synthetic event type injected by the scheduler when a schedule is
 * due. Automation files should not emit this directly — use `wf.every()`.
 */
export const SCHEDULE_FIRE_EVENT_TYPE = 'schedule:fire';
