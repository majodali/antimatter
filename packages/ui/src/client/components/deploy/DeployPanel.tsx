import { useState, useEffect, useRef } from 'react';
import { Rocket, Play, Trash2, Settings, Hammer, Pause, Globe, ExternalLink, Eye, ChevronDown, Check } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { WidgetBar } from '../widgets/WidgetRenderer';
import { SecretsPanel } from './SecretsPanel';
import { useApplicationStore } from '@/stores/applicationStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import type { EnvironmentActionDeclaration } from '@/lib/api';
import type { WidgetState } from '@antimatter/workflow';

type OpsView = 'ops' | 'secrets';

/**
 * Runtime-context selector for the Operations panel header.
 *
 * Today there's typically one declared environment per project (the
 * project's `wf.environment(...)` call), so this dropdown is often
 * single-item. The surface is here so future multi-runtime work
 * (deploy targets, blue-green flips, preview envs) doesn't require
 * a header redesign — it just adds entries to the same dropdown.
 *
 * Selection persists per user via `useUIStore.currentRuntimeContextId`.
 * No filtering is wired yet — see `docs/contexts.md` § Perspectives
 * for the long-term semantics.
 */
function RuntimeContextSelector() {
  const declarations = useApplicationStore((s) => s.getDeclarations());
  const currentId = useUIStore((s) => s.currentRuntimeContextId);
  const setCurrentId = useUIStore((s) => s.setCurrentRuntimeContextId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Build the option list from declared environments. If the project
  // doesn't declare any, fall back to a single 'production' entry so
  // the selector still has a label rather than appearing empty.
  const envs = declarations.environments ?? [];
  const options = envs.length > 0
    ? envs.map((e) => ({ id: e.name, label: e.name, url: e.url }))
    : [{ id: 'production', label: 'production', url: undefined as string | undefined }];

  // Self-correct stale selection: if the persisted id no longer matches
  // any declared env, snap to the first available.
  useEffect(() => {
    if (!options.find((o) => o.id === currentId) && options.length > 0) {
      setCurrentId(options[0].id);
    }
  }, [options, currentId, setCurrentId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = options.find((o) => o.id === currentId) ?? options[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
        title="Select the runtime context this panel operates on"
        data-testid="runtime-context-selector"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{current?.label ?? 'production'}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 min-w-[10rem] bg-popover border border-border rounded-md shadow-lg z-50 py-1"
          role="listbox"
        >
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={opt.id === currentId}
              onClick={() => { setCurrentId(opt.id); setOpen(false); }}
              className={cn(
                'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                opt.id === currentId ? 'text-foreground' : 'text-muted-foreground',
              )}
              data-testid={`runtime-context-option-${opt.id}`}
            >
              <span className="font-mono flex-1 truncate">{opt.label}</span>
              {opt.id === currentId && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DeployPanel() {
  // Panel is now labelled "Operations" but the component name stays the same
  // to avoid a large rename churn. Widget section accepts 'ops' or 'deploy'.
  const [view, setView] = useState<OpsView>('ops');
  const declarations = useApplicationStore((s) => s.getDeclarations());
  const workflowState = useApplicationStore((s) => s.getWorkflowState()) as any;
  const loaded = useApplicationStore((s) => s.loaded);
  const emitEvent = useApplicationStore((s) => s.emitEvent);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // No useEffect needed — state arrives via WebSocket on connect

  const environments = declarations.environments ?? [];
  // Accept both 'ops' (new) and 'deploy' (legacy) section values.
  const deployWidgets = (declarations.widgets ?? []).filter(
    (w) => w.section === 'ops' || w.section === 'deploy',
  );
  const uiState: Record<string, WidgetState | undefined> = workflowState?._ui ?? {};

  const handleWidgetEvent = (event: { type: string; [key: string]: unknown }) => {
    emitEvent(event, currentProjectId ?? undefined);
  };

  const handleOpenConfig = () => {
    const { openFile } = (window as any).__editorActions ?? {};
    if (openFile) {
      openFile('.antimatter/deploy.ts');
    }
  };

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          {/* Runtime-context selector — claims the surface for multi-runtime
              work. Today usually shows the single declared environment. */}
          <RuntimeContextSelector />
          {/* View toggle tabs */}
          <div className="flex items-center gap-0.5 bg-accent/40 rounded p-0.5">
            <button
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                view === 'ops'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setView('ops')}
            >
              Operations
            </button>
            <button
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                view === 'secrets'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setView('secrets')}
            >
              Secrets
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {view === 'ops' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleOpenConfig}
              title="Open workflow configuration"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {view === 'secrets' ? (
        <SecretsPanel />
      ) : (
        <>
          {/* Deployed resources — preview + workflow-registered resources */}
          <ResourceList
            projectId={currentProjectId}
            onAction={handleWidgetEvent}
          />

          {/* Deploy widgets */}
          {deployWidgets.length > 0 && (
            <WidgetBar widgets={deployWidgets} widgetStates={uiState} onEvent={handleWidgetEvent} />
          )}

          <ScrollArea className="flex-1">
            {environments.length === 0 && deployWidgets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <Rocket className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">No deployment configuration</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {loaded
                    ? 'Add environments to .antimatter/*.ts files'
                    : 'Loading workflow definitions...'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {environments.map((env) => (
                  <EnvironmentItem
                    key={env.name}
                    name={env.name}
                    stackName={env.stackName}
                    url={env.url}
                    actions={env.actions}
                    workflowState={workflowState}
                    onAction={(action) => {
                      emitEvent(action.event, currentProjectId ?? undefined);
                    }}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deployed Resources — preview + workflow-registered resources
// ---------------------------------------------------------------------------

interface DeployedResourceUI {
  id: string;
  name: string;
  resourceType: string;
  url?: string;
  description?: string;
  builtIn?: boolean;
  actions?: { triggerId: string; label: string; icon?: string; enabled: boolean }[];
}

function ResourceList({
  projectId,
  onAction,
}: {
  projectId: string | null;
  onAction: (event: { type: string; [key: string]: unknown }) => void;
}) {
  const [resources, setResources] = useState<DeployedResourceUI[]>([]);

  // Fetch resources on mount and listen for updates
  useEffect(() => {
    if (!projectId) return;
    const fetchResources = async () => {
      try {
        const res = await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'deployed-resources.list', params: {} }),
        });
        if (res.ok) {
          const data = await res.json();
          const list = (data.data?.resources ?? data.resources ?? []).map((r: any) => ({
            id: r.id,
            name: r.name,
            resourceType: r.resourceType,
            url: r.metadata?.url as string | undefined,
            description: r.description,
            builtIn: r.builtIn,
            actions: r.actions,
          }));
          setResources(list);
        }
      } catch { /* ignore */ }
    };
    fetchResources();
    // Re-fetch periodically to catch broadcast updates
    const interval = setInterval(fetchResources, 10000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleDeregister = async (resourceId: string) => {
    if (!projectId) return;
    try {
      await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'deployed-resources.deregister', params: { resourceId } }),
      });
      setResources(prev => prev.filter(r => r.id !== resourceId));
    } catch { /* ignore */ }
  };

  if (resources.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        Resources
      </div>
      <div className="space-y-1.5">
        {resources.map((r) => (
          <div key={r.id} className="flex items-center gap-1.5 group">
            {r.resourceType === 'preview' ? (
              <Eye className="h-3 w-3 text-blue-400 flex-shrink-0" />
            ) : (
              <Globe className="h-3 w-3 text-green-400 flex-shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{r.name}</span>
            {r.url && (
              <a
                href={r.url.startsWith('/') ? r.url : r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline truncate flex items-center gap-0.5"
                title={r.url}
              >
                {r.url.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 50)}
                <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-0 group-hover:opacity-100" />
              </a>
            )}
            {/* Action buttons */}
            {r.actions?.map((a) => (
              <Button
                key={a.triggerId}
                variant="ghost"
                size="icon"
                className="h-4 w-4 opacity-0 group-hover:opacity-100"
                onClick={() => onAction({ type: a.triggerId })}
                disabled={!a.enabled}
                title={a.label}
              >
                <ActionIcon icon={a.icon} className="h-2.5 w-2.5" />
              </Button>
            ))}
            {/* Delete button (only for non-built-in) */}
            {!r.builtIn && (
              <button
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 flex-shrink-0"
                onClick={() => handleDeregister(r.id)}
                title="Remove resource"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environment Item
// ---------------------------------------------------------------------------

function EnvironmentItem({
  name,
  stackName,
  url,
  actions,
  workflowState,
  onAction,
}: {
  name: string;
  stackName?: string;
  url?: string;
  actions?: Record<string, EnvironmentActionDeclaration>;
  workflowState: any;
  onAction: (action: EnvironmentActionDeclaration) => void;
}) {
  const actionEntries = actions ? Object.entries(actions) : [];

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">{name}</span>
          {stackName && (
            <span className="text-[10px] text-muted-foreground font-mono">{stackName}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {actionEntries.map(([actionName, action]) => (
            <Button
              key={actionName}
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onAction(action)}
              title={actionName}
            >
              <ActionIcon icon={action.icon} className="h-3 w-3" />
            </Button>
          ))}
        </div>
      </div>
      {url && (
        <p className="text-[10px] text-muted-foreground mt-0.5 ml-5.5">{url}</p>
      )}

      {/* Workflow state summary for this environment */}
      {workflowState && (
        <WorkflowStateSummary state={workflowState} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow State Summary
// ---------------------------------------------------------------------------

function WorkflowStateSummary({ state }: { state: any }) {
  if (!state) return null;

  // Display bundle statuses if available (from deploy.ts state shape)
  const bundle = state.bundle;
  const deploy = state.deploy;
  if (!bundle && !deploy) return null;

  return (
    <div className="mt-1.5 ml-5.5 space-y-0.5">
      {bundle && Object.entries(bundle).map(([key, val]: [string, any]) => (
        <div key={key} className="flex items-center gap-1.5 text-[10px]">
          <StatusDot status={val?.status} />
          <span className="text-muted-foreground">{key}:</span>
          <span className={cn(
            'font-medium',
            val?.status === 'success' ? 'text-green-600 dark:text-green-500' :
            val?.status === 'failed' ? 'text-red-600 dark:text-red-500' :
            val?.status === 'running' ? 'text-yellow-600 dark:text-yellow-500' :
            'text-muted-foreground',
          )}>
            {val?.status ?? 'pending'}
          </span>
        </div>
      ))}
      {deploy && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <StatusDot status={deploy.status} />
          <span className="text-muted-foreground">deploy:</span>
          <span className={cn(
            'font-medium',
            deploy.status === 'success' ? 'text-green-600 dark:text-green-500' :
            deploy.status === 'failed' ? 'text-red-600 dark:text-red-500' :
            deploy.status === 'deploying' ? 'text-yellow-600 dark:text-yellow-500' :
            'text-muted-foreground',
          )}>
            {deploy.status}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ActionIcon({ icon, className }: { icon?: string; className?: string }) {
  switch (icon) {
    case 'build':
      return <Hammer className={className} />;
    case 'destroy':
      return <Trash2 className={className} />;
    case 'pause':
      return <Pause className={className} />;
    case 'play':
    default:
      return <Play className={className} />;
  }
}

function StatusDot({ status }: { status?: string }) {
  return (
    <div className={cn(
      'h-1.5 w-1.5 rounded-full',
      status === 'success' ? 'bg-green-500' :
      status === 'failed' ? 'bg-red-500' :
      status === 'running' || status === 'deploying' ? 'bg-yellow-500 animate-pulse' :
      'bg-muted-foreground/30',
    )} />
  );
}
