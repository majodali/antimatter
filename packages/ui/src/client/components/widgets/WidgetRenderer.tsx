import {
  Play,
  Rocket,
  Hammer,
  Trash2,
  Pause,
  RefreshCw,
  Undo2,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Zap,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import type { WidgetDeclaration, WidgetState, WidgetVariant } from '@antimatter/workflow';

// ---------------------------------------------------------------------------
// Icon lookup — maps string names to Lucide icon components.
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  play: Play,
  rocket: Rocket,
  hammer: Hammer,
  build: Hammer,
  destroy: Trash2,
  trash: Trash2,
  pause: Pause,
  refresh: RefreshCw,
  undo: Undo2,
  rollback: Undo2,
  check: CheckCircle,
  success: CheckCircle,
  error: XCircle,
  fail: XCircle,
  loading: Loader2,
  clock: Clock,
  zap: Zap,
  shield: Shield,
};

function resolveIcon(name?: string): LucideIcon | null {
  if (!name) return null;
  return ICON_MAP[name.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Effective state — merges static declaration with dynamic overrides.
// ---------------------------------------------------------------------------

interface EffectiveState {
  enabled: boolean;
  visible: boolean;
  label: string;
  variant: WidgetVariant;
  value: unknown;
}

function resolveState(widget: WidgetDeclaration, state?: WidgetState): EffectiveState {
  return {
    enabled: state?.enabled ?? true,
    visible: state?.visible ?? true,
    label: state?.label ?? widget.label,
    variant: state?.variant ?? widget.variant ?? 'default',
    value: state?.value,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WidgetRendererProps {
  widget: WidgetDeclaration;
  state?: WidgetState;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}

export function WidgetRenderer({ widget, state, onEvent }: WidgetRendererProps) {
  const effective = resolveState(widget, state);
  if (!effective.visible) return null;

  switch (widget.type) {
    case 'button':
      return <WidgetButton widget={widget} effective={effective} onEvent={onEvent} />;
    case 'toggle':
      return <WidgetToggle widget={widget} effective={effective} onEvent={onEvent} />;
    case 'status':
      return <WidgetStatus widget={widget} effective={effective} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Button widget — emits an event on click.
// ---------------------------------------------------------------------------

function WidgetButton({
  widget,
  effective,
  onEvent,
}: {
  widget: WidgetDeclaration;
  effective: EffectiveState;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}) {
  const Icon = resolveIcon(widget.icon);

  const handleClick = () => {
    if (widget.event) {
      onEvent(widget.event);
    }
  };

  return (
    <Button
      variant={effective.variant === 'danger' ? 'destructive' : effective.variant === 'primary' ? 'default' : 'outline'}
      size="sm"
      className="h-7 text-xs gap-1.5"
      disabled={!effective.enabled}
      onClick={handleClick}
      title={effective.label}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {effective.label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Toggle widget — emits an event with a boolean value.
// ---------------------------------------------------------------------------

function WidgetToggle({
  widget,
  effective,
  onEvent,
}: {
  widget: WidgetDeclaration;
  effective: EffectiveState;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}) {
  const isOn = Boolean(effective.value);
  const ToggleIcon = isOn ? ToggleRight : ToggleLeft;

  const handleToggle = () => {
    if (widget.event) {
      onEvent({ ...widget.event, value: !isOn });
    }
  };

  return (
    <button
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
        effective.enabled
          ? 'hover:bg-accent cursor-pointer'
          : 'opacity-50 cursor-not-allowed',
      )}
      disabled={!effective.enabled}
      onClick={handleToggle}
      title={`${effective.label}: ${isOn ? 'on' : 'off'}`}
    >
      <ToggleIcon
        className={cn(
          'h-4 w-4',
          isOn ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      <span className="text-muted-foreground">{effective.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status widget — read-only indicator showing a label and value.
// ---------------------------------------------------------------------------

function WidgetStatus({
  widget,
  effective,
}: {
  widget: WidgetDeclaration;
  effective: EffectiveState;
}) {
  const Icon = resolveIcon(widget.icon);
  const statusValue = effective.value != null ? String(effective.value) : 'idle';

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {Icon ? (
        <Icon className={cn('h-3 w-3', statusColorClass(statusValue))} />
      ) : (
        <StatusDot status={statusValue} />
      )}
      <span className="text-muted-foreground">{effective.label}:</span>
      <span className={cn('font-medium', statusColorClass(statusValue))}>
        {statusValue}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColorClass(status: string): string {
  switch (status) {
    case 'success':
    case 'complete':
    case 'ready':
      return 'text-green-600 dark:text-green-500';
    case 'failed':
    case 'error':
      return 'text-red-600 dark:text-red-500';
    case 'running':
    case 'deploying':
    case 'bundling':
    case 'building':
      return 'text-yellow-600 dark:text-yellow-500';
    default:
      return 'text-muted-foreground';
  }
}

function StatusDot({ status }: { status: string }) {
  const isActive = ['running', 'deploying', 'bundling', 'building'].includes(status);
  return (
    <div
      className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'success' || status === 'complete' || status === 'ready' ? 'bg-green-500' :
        status === 'failed' || status === 'error' ? 'bg-red-500' :
        isActive ? 'bg-yellow-500 animate-pulse' :
        'bg-muted-foreground/30',
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// WidgetBar — renders a row of widgets for a given section.
// ---------------------------------------------------------------------------

export interface WidgetBarProps {
  widgets: readonly WidgetDeclaration[];
  widgetStates: Record<string, WidgetState | undefined>;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}

export function WidgetBar({ widgets, widgetStates, onEvent }: WidgetBarProps) {
  if (widgets.length === 0) return null;

  // Split into interactive (button/toggle) and informational (status)
  const interactive = widgets.filter((w) => w.type === 'button' || w.type === 'toggle');
  const statuses = widgets.filter((w) => w.type === 'status');

  return (
    <div className="px-3 py-2 border-b border-border space-y-1.5">
      {interactive.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {interactive.map((w) => (
            <WidgetRenderer
              key={w.id}
              widget={w}
              state={widgetStates[w.id]}
              onEvent={onEvent}
            />
          ))}
        </div>
      )}
      {statuses.length > 0 && (
        <div className="space-y-0.5">
          {statuses.map((w) => (
            <WidgetRenderer
              key={w.id}
              widget={w}
              state={widgetStates[w.id]}
              onEvent={onEvent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
