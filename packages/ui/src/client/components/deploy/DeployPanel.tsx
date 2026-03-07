import { useEffect, useState } from 'react';
import { Rocket, Play, Trash2, Settings, Hammer, Pause, Globe, Server } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { EnvironmentList } from './EnvironmentList';
import { SecretsPanel } from './SecretsPanel';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useProjectStore } from '@/stores/projectStore';
import { cn } from '@/lib/utils';
import type { EnvironmentActionDeclaration } from '@/lib/api';

type DeployView = 'deploy' | 'environments' | 'secrets';

export function DeployPanel() {
  const [view, setView] = useState<DeployView>('deploy');
  const {
    declarations,
    workflowState,
    loaded,
    loadDeclarations,
    emitEvent,
  } = usePipelineStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // Load declarations on mount
  useEffect(() => {
    loadDeclarations(currentProjectId ?? undefined);
  }, [currentProjectId]);

  const environments = declarations.environments ?? [];
  const targets = declarations.targets ?? [];
  const modules = declarations.modules ?? [];

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
                view === 'environments'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setView('environments')}
            >
              Environments
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
      ) : view === 'environments' ? (
        <EnvironmentList />
      ) : (
        <ScrollArea className="flex-1">
          {environments.length === 0 && targets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Rocket className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">No deployment configuration</p>
              <p className="text-xs text-muted-foreground mt-1">
                {loaded
                  ? 'Add environments and targets to .antimatter/*.ts files'
                  : 'Loading workflow definitions...'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Environments with action buttons */}
              {environments.map((env) => (
                <EnvironmentItem
                  key={env.name}
                  name={env.name}
                  stackName={env.stackName}
                  domain={env.domain}
                  actions={env.actions}
                  workflowState={workflowState}
                  onAction={(action) => {
                    emitEvent(action.event, currentProjectId ?? undefined);
                  }}
                />
              ))}

              {/* Targets (read-only metadata) */}
              {targets.length > 0 && (
                <div className="px-3 py-2">
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
                    Targets
                  </h4>
                  <div className="space-y-1.5">
                    {targets.map((target) => {
                      const mod = modules.find(m => m.name === target.module);
                      return (
                        <TargetItem
                          key={target.name}
                          name={target.name}
                          type={target.type}
                          moduleName={target.module}
                          moduleType={mod?.type}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environment Item
// ---------------------------------------------------------------------------

function EnvironmentItem({
  name,
  stackName,
  domain,
  actions,
  workflowState,
  onAction,
}: {
  name: string;
  stackName?: string;
  domain?: string;
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
      {domain && (
        <p className="text-[10px] text-muted-foreground mt-0.5 ml-5.5">{domain}</p>
      )}

      {/* Workflow state summary for this environment */}
      {workflowState && (
        <WorkflowStateSummary state={workflowState} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target Item
// ---------------------------------------------------------------------------

function TargetItem({
  name,
  type,
  moduleName,
  moduleType,
}: {
  name: string;
  type: string;
  moduleName: string;
  moduleType?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <Server className="h-3 w-3 text-muted-foreground" />
      <span className="text-[11px] font-medium truncate">{name}</span>
      <span className="text-[10px] text-muted-foreground">
        {type}
      </span>
      {moduleType && (
        <span className={cn(
          'text-[9px] px-1 py-0.5 rounded',
          moduleType === 'frontend' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
          moduleType === 'lambda' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
          'bg-muted text-muted-foreground',
        )}>
          {moduleType}
        </span>
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
