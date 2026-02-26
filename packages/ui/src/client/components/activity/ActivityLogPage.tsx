import { useState, useMemo } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ActivityEventRow } from './ActivityEventRow';
import { useActivityStore, type EventCategory, type EventLevel } from '@/stores/activityStore';

const ALL_CATEGORIES: EventCategory[] = ['build', 'chat', 'file', 'editor', 'project', 'network', 'system'];
const ALL_LEVELS: EventLevel[] = ['info', 'warn', 'error'];

export function ActivityLogPage() {
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);
  const [selectedCategories, setSelectedCategories] = useState<Set<EventCategory>>(new Set(ALL_CATEGORIES));
  const [selectedLevels, setSelectedLevels] = useState<Set<EventLevel>>(new Set(ALL_LEVELS));

  const filtered = useMemo(
    () => events.filter((e) => selectedCategories.has(e.category) && selectedLevels.has(e.level)),
    [events, selectedCategories, selectedLevels],
  );

  const counts = useMemo(() => {
    const byLevel = { info: 0, warn: 0, error: 0 };
    for (const e of events) byLevel[e.level]++;
    return byLevel;
  }, [events]);

  function toggleCategory(cat: EventCategory) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleLevel(level: EventLevel) {
    setSelectedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
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
            <Button variant="outline" size="sm" onClick={clear}>
              Clear All
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.history.back()}>
              Back
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-4 mb-4 p-3 bg-card rounded-lg border border-border">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Category:</span>
            {ALL_CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  selectedCategories.has(cat)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:border-primary/50'
                }`}
                onClick={() => toggleCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Level:</span>
            {ALL_LEVELS.map((level) => {
              const colors: Record<EventLevel, string> = {
                info: 'border-blue-500 bg-blue-500',
                warn: 'border-yellow-500 bg-yellow-500',
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

        {/* Event list */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <ScrollArea className="max-h-[70vh]">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No events match the current filters
              </div>
            ) : (
              filtered.map((event) => (
                <ActivityEventRow key={event.id} event={event} />
              ))
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
