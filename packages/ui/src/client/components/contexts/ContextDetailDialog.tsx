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
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, CircleDashed, Play, ArrowRight, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useProjectStore } from '@/stores/projectStore';
import {
  invokeContextAction,
  traceContextRegression,
  type ContextModelSnapshot,
  type SerializedContext,
  type SerializedValidation,
  type LifecycleStatus,
  type RegressionTrace,
  type ValidationExplanation,
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
  const [trace, setTrace] = useState<RegressionTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const context = contextId ? snapshot?.contexts.find((c) => c.id === contextId) ?? null : null;
  const children = context && snapshot ? snapshot.contexts.filter((c) => c.parentId === context.id) : [];
  const parent = context?.parentId && snapshot
    ? snapshot.contexts.find((c) => c.id === context.parentId) ?? null
    : null;

  // Fetch the trace whenever a non-done context is opened (or its
  // status changes while the dialog is open). 'done' contexts have
  // nothing to explain and we skip the round-trip.
  useEffect(() => {
    if (!projectId || !context || !contextId) {
      setTrace(null); return;
    }
    if (context.lifecycleStatus === 'done') {
      setTrace(null); return;
    }
    let cancelled = false;
    setTraceLoading(true);
    traceContextRegression(projectId, contextId)
      .then((t) => { if (!cancelled) setTrace(t); })
      .catch(() => { if (!cancelled) setTrace(null); })
      .finally(() => { if (!cancelled) setTraceLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, contextId, context?.lifecycleStatus, context]);

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

            <TraceSection
              status={context.lifecycleStatus}
              trace={trace}
              loading={traceLoading}
              onContextSelect={onContextSelect}
            />

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

function TraceSection({
  status, trace, loading, onContextSelect,
}: {
  status: LifecycleStatus;
  trace: RegressionTrace | null;
  loading: boolean;
  onContextSelect: (id: string) => void;
}) {
  if (status === 'done') return null;
  if (loading && !trace) {
    return (
      <Section label="Why isn't this done?">
        <div className="text-xs text-muted-foreground flex items-center" data-testid="context-detail-trace-loading">
          <Loader2 className="h-3 w-3 animate-spin mr-1" /> Loading trace…
        </div>
      </Section>
    );
  }
  if (!trace) return null;

  const empty =
    trace.validationFailures.length === 0 &&
    trace.childBlockers.length === 0 &&
    trace.dependencyCulprits.length === 0;

  return (
    <Section label="Why isn't this done?">
      {empty ? (
        <p className="text-xs text-muted-foreground" data-testid="context-detail-trace-empty">
          Nothing surfaced — current status: <span className="font-medium">{STATUS_LABEL[trace.status]}</span>.
        </p>
      ) : (
        <div className="space-y-2 text-xs" data-testid="context-detail-trace">
          {trace.dependencyCulprits.length > 0 && (
            <div>
              <div className="font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Upstream dependencies
              </div>
              <ul className="ml-4 mt-1 space-y-0.5">
                {trace.dependencyCulprits.map((d) => (
                  <li key={d.contextId}>
                    <button
                      className="hover:underline"
                      onClick={() => onContextSelect(d.contextId)}
                      data-testid={`context-detail-trace-dep-${d.contextId}`}
                    >
                      <span className="font-medium">{d.contextName}</span>
                      <span className="text-muted-foreground"> — {d.status}</span>
                      {d.path.length > 1 && (
                        <span className="text-muted-foreground"> ({d.path.join(' → ')})</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {trace.validationFailures.length > 0 && (
            <div>
              <div className="font-medium">Failing or unevaluable validations</div>
              <ul className="ml-4 mt-1 space-y-0.5">
                {trace.validationFailures.map((f) => (
                  <li key={f.validationId} data-testid={`context-detail-trace-validation-${f.validationId}`}>
                    <span className="font-mono">{f.validationId}</span>
                    <span className="text-muted-foreground"> — {explainText(f)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {trace.childBlockers.length > 0 && (
            <div>
              <div className="font-medium">Sub-contexts not yet done</div>
              <ul className="ml-4 mt-1 space-y-0.5">
                {trace.childBlockers.map((b) => (
                  <li key={b.contextId}>
                    <button
                      className="hover:underline"
                      onClick={() => onContextSelect(b.contextId)}
                      data-testid={`context-detail-trace-child-${b.contextId}`}
                    >
                      <span className="font-medium">{b.contextName}</span>
                      <span className="text-muted-foreground"> — {b.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function explainText(f: ValidationExplanation): string {
  switch (f.kind) {
    case 'rule-outcome':
      if (!f.ruleDeclared) return `references undeclared rule "${f.ruleId}"`;
      if (f.ruleStatus === 'failed') return `rule "${f.ruleId}" last run failed`;
      return `rule "${f.ruleId}" hasn't run yet`;
    case 'test-pass':
      if (f.passing === null) return `test "${f.testId}" hasn't run yet`;
      return `test "${f.testId}" failed`;
    case 'test-set-pass': {
      const parts: string[] = [];
      if (f.failingMembers.length > 0) parts.push(`${f.failingMembers.length} failing (${f.failingMembers.slice(0, 3).join(', ')}${f.failingMembers.length > 3 ? '…' : ''})`);
      if (f.unobservedMembers.length > 0) parts.push(`${f.unobservedMembers.length} not yet run`);
      if (parts.length === 0) return `test set "${f.testSetId}" — no member tests recorded`;
      return `test set "${f.testSetId}": ${parts.join(', ')}`;
    }
    case 'deployed-resource-present':
      return `deployed resource "${f.resourceId}" is not present`;
    case 'deployed-resource-healthy':
      return `deployed resource "${f.resourceId}" is not healthy`;
    case 'manual-confirm':
      return `awaiting confirmation: ${f.description}`;
    case 'code':
      return `code validation${f.fn ? ` (${f.fn})` : ''}: ${f.description}`;
  }
}

// Helper component re-export
export { ValidationRow as _ValidationRow };

// Lifecycle status helpers re-exported for tree-row use.
export const LIFECYCLE_LABEL = STATUS_LABEL;
export const LIFECYCLE_TONE = STATUS_TONE;
