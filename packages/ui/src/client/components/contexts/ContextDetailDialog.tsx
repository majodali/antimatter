/**
 * Context detail view — modal that opens when a user clicks a context
 * in the tree. The "home base" for working on a context.
 *
 * Phase 3 surface: objective, inputs, validations with live status,
 * action with Start button, outputs, sub-contexts. Drives action
 * invocation through `contexts.action.invoke`.
 *
 * Cross-cutting affordances (focus, attribution, freshness) land in
 * later phases — for now we surface what we have and leave room.
 */
import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, CircleDashed, Play, ArrowRight } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useProjectStore } from '@/stores/projectStore';
import {
  invokeContextAction,
  type ContextModelSnapshot,
  type SerializedContext,
  type SerializedValidation,
  type LifecycleStatus,
} from '@/lib/contexts-automation';

const STATUS_LABEL: Record<LifecycleStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  'in-progress': 'In progress',
  done: 'Done',
  regressed: 'Regressed',
  'dependency-regressed': 'Dependency regressed',
};

const STATUS_TONE: Record<LifecycleStatus, string> = {
  pending: 'text-muted-foreground',
  ready: 'text-blue-500',
  'in-progress': 'text-amber-500',
  done: 'text-green-500',
  regressed: 'text-destructive',
  'dependency-regressed': 'text-destructive/80',
};

export function ContextDetailDialog({
  open,
  onOpenChange,
  contextId,
  snapshot,
  onContextSelect,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  contextId: string | null;
  snapshot: ContextModelSnapshot | null;
  onContextSelect: (id: string) => void;
}) {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [invoking, setInvoking] = useState(false);
  const [invokeMessage, setInvokeMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const context = contextId ? snapshot?.contexts.find((c) => c.id === contextId) ?? null : null;
  const children = context && snapshot ? snapshot.contexts.filter((c) => c.parentId === context.id) : [];
  const parent = context?.parentId && snapshot
    ? snapshot.contexts.find((c) => c.id === context.parentId) ?? null
    : null;

  const handleInvoke = async () => {
    if (!projectId || !context) return;
    setInvoking(true);
    setInvokeMessage(null);
    try {
      const res = await invokeContextAction(projectId, context.id);
      setInvokeMessage({ kind: 'ok', text: `Invoked: ${res.eventType ? `event "${res.eventType}"` : res.kind} (${res.operationId})` });
    } catch (err: unknown) {
      setInvokeMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setInvoking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="context-detail-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {context ? (
              <>
                <span data-testid="context-detail-name">{context.name}</span>
                <code className="text-xs font-normal text-muted-foreground">{context.id}</code>
                <span className={`ml-auto text-xs uppercase tracking-wide ${STATUS_TONE[context.lifecycleStatus]}`}
                  data-testid="context-detail-status">
                  {STATUS_LABEL[context.lifecycleStatus]}
                </span>
              </>
            ) : (
              'Context not found'
            )}
          </DialogTitle>
        </DialogHeader>

        {context ? (
          <div className="space-y-4 py-2 text-sm" data-testid="context-detail-body">
            <Section label="Objective">
              <p className="whitespace-pre-line">{context.objectiveStatement}</p>
              {context.objectiveNotes && (
                <p className="text-muted-foreground mt-1 whitespace-pre-line">{context.objectiveNotes}</p>
              )}
            </Section>

            {parent && (
              <Section label="Parent">
                <button
                  className="flex items-center gap-1 text-foreground hover:underline"
                  onClick={() => onContextSelect(parent.id)}
                  data-testid="context-detail-parent-link"
                >
                  <ArrowRight className="h-3 w-3" />
                  {parent.name}
                </button>
              </Section>
            )}

            {context.inputNames.length > 0 && (
              <Section label="Inputs">
                <ul className="space-y-0.5">
                  {context.inputNames.map((name) => (
                    <li key={name} className="font-mono text-xs">{name}</li>
                  ))}
                </ul>
              </Section>
            )}

            {context.outputNames.length > 0 && (
              <Section label="Outputs">
                <ul className="space-y-0.5">
                  {context.outputNames.map((name) => (
                    <li key={name} className="font-mono text-xs">{name}</li>
                  ))}
                </ul>
              </Section>
            )}

            <Section label={`Validations (${context.validations.length})`}>
              {context.validations.length === 0 ? (
                <p className="text-muted-foreground">No validations declared. Effective requirement falls through to children = done.</p>
              ) : (
                <ul className="space-y-1" data-testid="context-detail-validations">
                  {context.validations.map((v) => (
                    <ValidationRow key={v.id} validation={v} />
                  ))}
                </ul>
              )}
            </Section>

            <Section label="Action">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    {context.actionKind}
                  </div>
                  <p className="mt-0.5">{context.actionDescription}</p>
                </div>
                <Button
                  size="sm"
                  onClick={handleInvoke}
                  disabled={invoking}
                  data-testid="context-detail-invoke"
                >
                  {invoking ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                  Start
                </Button>
              </div>
              {invokeMessage && (
                <div
                  className={`mt-2 text-xs ${invokeMessage.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                  data-testid="context-detail-invoke-message"
                >
                  {invokeMessage.text}
                </div>
              )}
            </Section>

            {children.length > 0 && (
              <Section label={`Sub-contexts (${children.length})`}>
                <ul className="space-y-1" data-testid="context-detail-children">
                  {children.map((c) => (
                    <li key={c.id}>
                      <button
                        className="flex items-baseline gap-2 hover:underline"
                        onClick={() => onContextSelect(c.id)}
                        data-testid={`context-detail-child-${c.id}`}
                      >
                        <span>{c.name}</span>
                        <span className={`text-[10px] uppercase tracking-wide ${STATUS_TONE[c.lifecycleStatus]}`}>
                          {STATUS_LABEL[c.lifecycleStatus]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">
            The context you requested is not in the current model snapshot.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ValidationRow({ validation }: { validation: SerializedValidation }) {
  const Icon =
    validation.status === 'passing' ? CheckCircle2 :
    validation.status === 'failing' ? XCircle :
    CircleDashed;
  const tone =
    validation.status === 'passing' ? 'text-green-500' :
    validation.status === 'failing' ? 'text-destructive' :
    'text-muted-foreground';
  return (
    <li
      className="flex items-start gap-2"
      data-testid={`context-detail-validation-${validation.id}`}
      data-status={validation.status}
    >
      <Icon className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${tone}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{validation.id}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{validation.kind}</span>
        </div>
        <div className="text-xs text-muted-foreground">{validation.description}</div>
      </div>
    </li>
  );
}

// Helper component re-export
export { ValidationRow as _ValidationRow };

// Lifecycle status helpers re-exported for tree-row use.
export const LIFECYCLE_LABEL = STATUS_LABEL;
export const LIFECYCLE_TONE = STATUS_TONE;
