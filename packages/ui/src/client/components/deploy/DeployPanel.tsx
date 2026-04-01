import { useState, useMemo } from 'react';
import { Rocket, Play, Trash2, Settings, Hammer, Pause, Globe, ExternalLink, Eye } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { WidgetBar } from '../widgets/WidgetRenderer';
import { SecretsPanel } from './SecretsPanel';
import { useApplicationStore } from '@/stores/applicationStore';
import { useProjectStore } from '@/stores/projectStore';
import { cn } from '@/lib/utils';
import type { EnvironmentActionDeclaration } from '@/lib/api';
import type { WidgetState } from '@antimatter/workflow';

type DeployView = 'deploy' | 'secrets';

export function DeployPanel() {
  const [view, setView] = useState<DeployView>('deploy');
  const declarations = useApplicationStore((s) => s.getDeclarations());
  const workflowState = useApplicationStore((s) => s.getWorkflowState()) as any;
  const loaded = useApplicationStore((s) => s.loaded);
  const emitEvent = useApplicationStore((s) => s.emitEvent);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // No useEffect needed — state arrives via WebSocket on connect

  const environments = declarations.environments ?? [];
  const deployWidgets = (declarations.widgets ?? []).filter((w) => w.section === 'deploy');
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
          {/* View toggle tabs */}
          <div className="flex items-center gap-0.5 bg-accent/40 rounded p-0.5">
            <button
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                view === 'deploy'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setView('deploy')}
            >
              Deploy
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
          {view === 'deploy' && (
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
          {/* Deployed URLs — preview + workflow-defined URLs */}
          <DeployedLinks
            projectId={currentProjectId}
            workflowState={workflowState}
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
// Deployed Links — preview URL + URLs from workflow state
// ---------------------------------------------------------------------------

interface DeployedLink {
  label: string;
  url: string;
  source: 'preview' | 'workflow';
  stateKey?: string; // key path in workflow state for deletion
}

function DeployedLinks({
  projectId,
  workflowState,
  onRemoveUrl,
}: {
  projectId: string | null;
  workflowState: any;
  onRemoveUrl?: (stateKey: string) => void;
}) {
  // Collect URLs from workflow state
  const links = useMemo(() => {
    const result: DeployedLink[] = [];

    // Auto-detect preview URL
    if (projectId) {
      result.push({
        label: 'Preview',
        url: `${window.location.origin}/workspace/${encodeURIComponent(projectId)}/preview/`,
        source: 'preview',
      });
    }

    // Scan workflow state for URLs (common patterns)
    if (workflowState) {
      const scan = (obj: any, prefix: string) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, val] of Object.entries(obj)) {
          if (key === '_ui') continue; // skip widget state
          const path = prefix ? `${prefix}.${key}` : key;
          if (typeof val === 'string' && (val.startsWith('https://') || val.startsWith('http://'))) {
            // Found a URL in state
            const label = key === 'siteUrl' ? 'Site' : key === 'url' ? prefix || 'URL' : key;
            result.push({ label, url: val, source: 'workflow', stateKey: path });
          } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            scan(val, path);
          }
        }
      };
      scan(workflowState, '');
    }

    return result;
  }, [projectId, workflowState]);

  if (links.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        Deployed URLs
      </div>
      <div className="space-y-1">
        {links.map((link, i) => (
          <div key={i} className="flex items-center gap-1.5 group">
            {link.source === 'preview' ? (
              <Eye className="h-3 w-3 text-blue-400 flex-shrink-0" />
            ) : (
              <Globe className="h-3 w-3 text-green-400 flex-shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{link.label}:</span>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline truncate flex items-center gap-0.5"
              title={link.url}
            >
              {link.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-0 group-hover:opacity-100" />
            </a>
            {link.source === 'workflow' && link.stateKey && onRemoveUrl && (
              <button
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 flex-shrink-0"
                onClick={() => onRemoveUrl(link.stateKey!)}
                title="Remove URL"
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
