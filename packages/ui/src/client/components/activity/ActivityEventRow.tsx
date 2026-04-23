/**
 * ActivityEventRow — minimum-viable renderer for a raw ActivityEvent.
 *
 * Phase A: the panel still shows every raw server event one per row.
 * Phase B will introduce outcome-level grouping (one row per rule
 * invocation, derived by pairing rule:start / rule:end). This component
 * is likely to shrink to a "raw log leaf" role inside the expandable
 * outcome rows at that point.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ActivityEvent, ActivitySource } from '../../../shared/activity-types';

/** Source → left-border color. Keeps the eye grouping visually. */
const sourceBorder: Record<ActivitySource, string> = {
  router:   'border-l-gray-500',
  child:    'border-l-amber-500',
  worker:   'border-l-blue-500',
  workflow: 'border-l-emerald-500',
  pty:      'border-l-pink-500',
  service:  'border-l-purple-500',
  instance: 'border-l-orange-500',
  client:   'border-l-teal-500',
};

const levelDot: Record<string, string> = {
  debug: 'bg-gray-400',
  info:  'bg-blue-500',
  warn:  'bg-yellow-500',
  error: 'bg-red-500',
};

function shortTime(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19); // HH:MM:SS
  } catch {
    return iso.slice(11, 19);
  }
}

interface Props {
  event: ActivityEvent;
}

export function ActivityEventRow({ event }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasData = event.data && Object.keys(event.data).length > 0;
  const border = sourceBorder[event.source] ?? 'border-l-transparent';

  return (
    <div
      className={`px-3 py-1 text-xs border-b border-l-2 border-border hover:bg-accent/30 ${border} ${hasData ? 'cursor-pointer' : ''}`}
      onClick={() => hasData && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        {hasData ? (
          expanded
            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3" />
        )}
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${levelDot[event.level] ?? 'bg-gray-400'}`} />
        <span className="text-[9px] font-mono text-muted-foreground shrink-0 uppercase">{event.source}</span>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0" title={event.kind}>
          {event.kind.split(':').pop()}
        </span>
        <span className="flex-1 truncate">{event.message}</span>
        <span className="text-[10px] text-muted-foreground shrink-0 font-mono" title={event.loggedAt}>
          {shortTime(event.loggedAt)}
        </span>
      </div>
      {expanded && event.data && (
        <pre className="mt-1 ml-8 text-[10px] text-muted-foreground whitespace-pre-wrap break-all bg-accent/20 rounded p-2">
          {JSON.stringify(event.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
