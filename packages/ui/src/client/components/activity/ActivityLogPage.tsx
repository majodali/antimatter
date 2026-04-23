/**
 * ActivityLogPage — full-stream explorer at /logs.
 *
 * Phase A: minimum viable swap from the old `category`/`level` client
 * filters to `source`/`level` filters over the real server events. The
 * richer explorer (kind tree, correlation-id paste, time range, trace
 * tree) can land in a later phase; for now this page is mainly useful
 * for agent or rare-investigation reading.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ActivityEventRow } from './ActivityEventRow';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';
import type { ActivityLevel, ActivitySource } from '../../../shared/activity-types';

const ALL_SOURCES: ActivitySource[] = [
  'router', 'child', 'worker', 'workflow', 'pty', 'service', 'instance', 'client',
];
const ALL_LEVELS: ActivityLevel[] = ['debug', 'info', 'warn', 'error'];

export function ActivityLogPage() {
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);
  const loadBackfill = useActivityStore((s) => s.loadBackfill);
  const projectId = useProjectStore((s) => s.currentProjectId);

  const [selectedSources, setSelectedSources] = useState<Set<ActivitySource>>(new Set(ALL_SOURCES));
  const [selectedLevels, setSelectedLevels] = useState<Set<ActivityLevel>>(new Set(ALL_LEVELS));

  useEffect(() => {
    if (projectId) void loadBackfill(projectId, 1000);
  }, [projectId, loadBackfill]);

  const filtered = useMemo(
    () => events.filter((e) => selectedSources.has(e.source) && selectedLevels.has(e.level)),
    [events, selectedSources, selectedLevels],
  );

  const counts = useMemo(() => {
    const byLevel = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const e of events) byLevel[e.level]++;
    return byLevel;
  }, [events]);

  function toggleSource(src: ActivitySource) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src); else next.add(src);
      return next;
    });
  }
  function toggleLevel(level: ActivityLevel) {
    setSelectedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Activity Log</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {events.length} events ({counts.error} errors, {counts.warn} warnings)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={clear}>Clear local view</Button>
            <Button variant="outline" size="sm" onClick={() => window.history.back()}>Back</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mb-4 p-3 bg-card rounded-lg border border-border">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Source:</span>
            {ALL_SOURCES.map((src) => (
              <button
                key={src}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  selectedSources.has(src)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:border-primary/50'
                }`}
                onClick={() => toggleSource(src)}
              >
                {src}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Level:</span>
            {ALL_LEVELS.map((level) => {
              const colors: Record<ActivityLevel, string> = {
                debug: 'border-gray-500 bg-gray-500',
                info:  'border-blue-500 bg-blue-500',
                warn:  'border-yellow-500 bg-yellow-500',
                error: 'border-red-500 bg-red-500',
              };
              return (
                <button
                  key={level}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    selectedLevels.has(level)
                      ? `${colors[level]} text-white`
                      : 'bg-transparent text-muted-foreground border-border hover:border-primary/50'
                  }`}
                  onClick={() => toggleLevel(level)}
                >
                  {level} ({counts[level]})
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <ScrollArea className="max-h-[70vh]">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No events match the current filters
              </div>
            ) : (
              filtered.map((event) => (
                <ActivityEventRow key={`${event.projectId ?? ''}#${event.seq}`} event={event} />
              ))
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
