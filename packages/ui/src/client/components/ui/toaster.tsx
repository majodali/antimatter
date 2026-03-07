import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useToastStore, type Toast, type ToastLevel } from '@/stores/toastStore';
import { cn } from '@/lib/utils';

const levelConfig: Record<
  ToastLevel,
  { icon: typeof Info; containerClass: string; iconClass: string }
> = {
  info: {
    icon: Info,
    containerClass: 'border-primary/30 bg-primary/5',
    iconClass: 'text-primary',
  },
  success: {
    icon: CheckCircle,
    containerClass: 'border-green-500/30 bg-green-500/5',
    iconClass: 'text-green-500',
  },
  warning: {
    icon: AlertTriangle,
    containerClass: 'border-yellow-500/30 bg-yellow-500/5',
    iconClass: 'text-yellow-500',
  },
  error: {
    icon: AlertCircle,
    containerClass: 'border-destructive/30 bg-destructive/5',
    iconClass: 'text-destructive',
  },
};

function ToastItem({ toast }: { toast: Toast }) {
  const [expanded, setExpanded] = useState(false);
  const [exiting, setExiting] = useState(false);
  const dismissToast = useToastStore((s) => s.dismissToast);

  const config = levelConfig[toast.level];
  const Icon = config.icon;

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => dismissToast(toast.id), 200);
  };

  return (
    <div
      className={cn(
        'relative flex items-start gap-2 rounded-md border px-3 py-2 shadow-lg backdrop-blur-sm',
        'transition-all duration-200',
        exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0',
        'animate-in slide-in-from-right-5 fade-in duration-200',
        config.containerClass,
      )}
      style={{ maxWidth: '360px', minWidth: '280px' }}
    >
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', config.iconClass)} />

      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => toast.detail && setExpanded(!expanded)}
      >
        <p className="text-xs font-medium text-foreground leading-snug">{toast.message}</p>
        {toast.detail && (
          <div
            className={cn(
              'overflow-hidden transition-all duration-200',
              expanded ? 'max-h-40 mt-1' : 'max-h-0',
            )}
          >
            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
              {toast.detail}
            </p>
          </div>
        )}
        {toast.detail && !expanded && (
          <p className="text-[10px] text-muted-foreground mt-0.5">Click for details</p>
        )}
        {toast.action && (
          <button
            className="text-xs text-primary hover:underline mt-1 font-medium"
            onClick={(e) => {
              e.stopPropagation();
              toast.action!.onClick();
              handleDismiss();
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        className="shrink-0 p-0.5 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-auto">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
