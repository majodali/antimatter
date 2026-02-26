import { useState } from 'react';
import { Hammer, MessageSquare, FolderOpen, FileText, Globe, Monitor, ChevronDown, ChevronRight } from 'lucide-react';
import type { ActivityEvent, EventCategory } from '@/stores/activityStore';

const categoryIcons: Record<EventCategory, typeof Hammer> = {
  build: Hammer,
  chat: MessageSquare,
  file: FolderOpen,
  editor: FileText,
  project: FolderOpen,
  network: Globe,
  system: Monitor,
};

const levelColors: Record<string, string> = {
  info: 'bg-blue-500',
  warn: 'bg-yellow-500',
  error: 'bg-red-500',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

interface Props {
  event: ActivityEvent;
}

export function ActivityEventRow({ event }: Props) {
  const [expanded, setExpanded] = useState(false);
  const Icon = categoryIcons[event.category];
  const hasDetail = !!event.detail;

  return (
    <div
      className={`px-3 py-1.5 text-xs border-b border-border hover:bg-accent/30 ${hasDetail ? 'cursor-pointer' : ''}`}
      onClick={() => hasDetail && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        {hasDetail ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3" />
        )}
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${levelColors[event.level]}`} />
        <span className="flex-1 truncate">{event.message}</span>
        <span className="text-muted-foreground shrink-0">{relativeTime(event.timestamp)}</span>
      </div>
      {expanded && event.detail && (
        <pre className="mt-1 ml-8 text-[10px] text-muted-foreground whitespace-pre-wrap break-all bg-accent/20 rounded p-2">
          {event.detail}
        </pre>
      )}
    </div>
  );
}
