/**
 * OutcomeRow — one row per rule invocation or schedule fire.
 *
 * Phase B of the Activity Panel redesign. The row is the outcome-level
 * summary:
 *
 *   ✓ 09:32:36  Register Platform Resources         274ms
 *   ● 14:05:00  ops:health-check       every 10m
 *   ✗ 08:15:02  Deploy to staging                   4.2s
 *              └ connection refused
 *
 * Click the row to expand its child events (logs, execs, util calls).
 * That's the "I want to see what actually happened" UX.
 *
 * Double-click is reserved for Phase D navigation (rule source, test
 * panel focus, etc.) — not wired yet.
 */
import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Clock, ChevronRight, ChevronDown, Calendar } from 'lucide-react';
import type { RuleOutcome, OutcomeStatus } from '@/lib/outcomeProjection';
import type { ActivityEvent } from '../../../shared/activity-types';
import { Kinds } from '../../../shared/activity-types';

function shortTime(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return iso.slice(11, 19);
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function StatusIcon({ status }: { status: OutcomeStatus }) {
  const common = 'h-3.5 w-3.5 shrink-0';
  switch (status) {
    case 'running': return <Loader2 className={`${common} animate-spin text-muted-foreground`} />;
    case 'success': return <CheckCircle2 className={`${common} text-emerald-500`} />;
    case 'warn':    return <AlertTriangle className={`${common} text-yellow-500`} />;
    case 'error':   return <XCircle className={`${common} text-red-500`} />;
  }
}

/** Compact inline rendering for a single child event in the expand drawer. */
function ChildEventLine({ e }: { e: ActivityEvent }) {
  let label = e.kind.split(':').slice(1).join(':'); // drop "workflow:" prefix
  let body = e.message;

  if (e.kind === Kinds.WorkflowLog) {
    label = e.level;
  } else if (e.kind === Kinds.WorkflowExecStart) {
    label = '$';
    body = typeof e.data?.command === 'string' ? e.data.command : e.message;
  } else if (e.kind === Kinds.WorkflowExecEnd) {
    const code = e.data?.exitCode;
    const dur = e.data?.durationMs;
    label = typeof code === 'number' && code !== 0 ? `exit ${code}` : 'exit 0';
    body = typeof dur === 'number' ? `${formatDuration(dur)}` : '';
  } else if (e.kind === Kinds.WorkflowUtilStart) {
    label = 'util';
    body = typeof e.data?.command === 'string' ? e.data.command : e.message;
  } else if (e.kind === Kinds.WorkflowUtilEnd) {
    return null; // paired with util:start; the start is enough
  } else if (e.kind === Kinds.WorkflowExecChunk) {
    return null; // too noisy at outcome level; surface via /logs
  } else if (e.kind === Kinds.WorkflowEmit) {
    label = 'emit';
    body = String((e.data as any)?.event?.type ?? e.message);
  }

  const levelClass =
    e.level === 'error' ? 'text-red-500' :
    e.level === 'warn' ? 'text-yellow-500' :
    'text-muted-foreground';

  return (
    <div className="flex gap-2 text-[11px] font-mono leading-5">
      <span className={`shrink-0 w-12 ${levelClass}`}>{label}</span>
      <span className="flex-1 break-all whitespace-pre-wrap">{body}</span>
    </div>
  );
}

interface Props {
  outcome: RuleOutcome;
}

export function OutcomeRow({ outcome }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = outcome.childEvents.length > 0 || !!outcome.errorMessage;

  // Error lines always render even when collapsed — they're the point of the
  // panel. Success outcomes expand on click to show the trace.
  const showError = outcome.status === 'error' && outcome.errorMessage;

  return (
    <div
      className={`px-3 py-1 text-xs border-b border-border hover:bg-accent/30 ${hasChildren ? 'cursor-pointer' : ''}`}
      onClick={() => hasChildren && setExpanded((x) => !x)}
    >
      <div className="flex items-center gap-2">
        {hasChildren
          ? (expanded
              ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />)
          : <span className="w-3" />}
        <StatusIcon status={outcome.status} />
        <span className="text-[10px] font-mono text-muted-foreground shrink-0" title={outcome.startedAt}>
          {shortTime(outcome.startedAt)}
        </span>
        {outcome.kind === 'schedule' && (
          <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="scheduled" />
        )}
        <span className="flex-1 truncate" title={outcome.ruleId}>
          {outcome.ruleName}
        </span>
        {outcome.triggerSummary && (
          <span className="text-[10px] text-muted-foreground shrink-0">{outcome.triggerSummary}</span>
        )}
        {outcome.status === 'running'
          ? <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              running
            </span>
          : outcome.durationMs != null
            ? <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {formatDuration(outcome.durationMs)}
              </span>
            : null}
      </div>
      {showError && !expanded && (
        <div className="mt-0.5 ml-8 text-[10px] text-red-500 truncate" title={outcome.errorMessage}>
          {outcome.errorMessage}
        </div>
      )}
      {expanded && (
        <div className="mt-1 ml-8 bg-accent/20 rounded p-2 space-y-0.5">
          {showError && (
            <div className="text-[11px] text-red-500 whitespace-pre-wrap break-all mb-1.5 pb-1.5 border-b border-border">
              {outcome.errorMessage}
            </div>
          )}
          {outcome.childEvents.length === 0 ? (
            <div className="text-[10px] text-muted-foreground italic">no child events</div>
          ) : (
            outcome.childEvents.map((e) => (
              <ChildEventLine key={`${e.projectId ?? ''}#${e.seq}`} e={e} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
