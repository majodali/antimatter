/**
 * ContextsPanel — bottom-panel surface for the new project context
 * model.
 *
 * Two states:
 *
 *   1. Cold start (no `.antimatter/{resources,contexts,build}.ts`)
 *      — render `ContextsEmptyState`: a list of templates the user can
 *        apply manually. The chat-bootstrapped flow is deferred to
 *        Phase N (agent integration).
 *
 *   2. Loaded — render `ContextTreeView`: a flat-with-indent list of
 *      contexts plus quick counts of resources / rules. Sidebar tree +
 *      detail view land in Phase 2.
 *
 * Data plane is the automation API (`contexts.model.get`,
 * `contexts.templates.list`, `contexts.templates.apply`) so the same
 * code path is exercised by functional tests and by the IDE UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Folder, Wrench, Boxes, RefreshCw, Plus, ChevronDown, CheckCircle2, XCircle, CircleDashed, Circle, AlertTriangle, Hammer } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { useApplicationStore } from '@/stores/applicationStore';
import {
  fetchContextModel,
  listContextTemplates,
  applyContextTemplate,
  type ContextModelSnapshot,
  type TemplateMetadata,
  type LifecycleStatus,
  type SerializedTransition,
} from '@/lib/contexts-automation';
import { AddContextDialog } from './AddContextDialog';
import { AddResourceDialog } from './AddResourceDialog';
import { AddRuleDialog } from './AddRuleDialog';
import { ContextDetailDialog } from './ContextDetailDialog';

export function ContextsPanel() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  // Snapshot lives in the application store: server pushes it on
  // connect (full snapshot) and on every `.antimatter/*.ts` edit. Fall
  // back to a one-shot REST fetch only if the store is empty.
  const storedSnapshot = useApplicationStore((s) => s.projectContextModel);
  const [restSnapshot, setRestSnapshot] = useState<ContextModelSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshot = storedSnapshot ?? restSnapshot;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchContextModel(projectId);
      setRestSnapshot(snap);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Only fall back to REST if the WebSocket-pushed snapshot hasn't arrived.
    if (projectId && !storedSnapshot) refresh();
  }, [projectId, storedSnapshot, refresh]);

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground" data-testid="contexts-panel-no-project">
        No project selected.
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground" data-testid="contexts-panel-loading">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading contexts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full p-4 text-sm" data-testid="contexts-panel-error">
        <div className="text-destructive">Failed to load context model: {error}</div>
        <Button variant="outline" size="sm" className="mt-2" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (!snapshot || !snapshot.present) {
    return <ContextsEmptyState onApplied={refresh} />;
  }

  return <ContextTreeView snapshot={snapshot} onRefresh={refresh} loading={loading} />;
}

// ---------------------------------------------------------------------------
// Cold-start empty state
// ---------------------------------------------------------------------------

function ContextsEmptyState({ onApplied }: { onApplied: () => void }) {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [templates, setTemplates] = useState<TemplateMetadata[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    listContextTemplates(projectId)
      .then((list) => {
        setTemplates(list);
        if (!selectedId && list.length > 0) setSelectedId(list[0].id);
      })
      .catch((err: unknown) => setApplyError(err instanceof Error ? err.message : String(err)));
  }, [projectId, selectedId]);

  const selected = templates?.find((t) => t.id === selectedId) ?? null;

  const handleApply = async () => {
    if (!projectId || !selected) return;
    setApplying(true);
    setApplyError(null);
    try {
      await applyContextTemplate(projectId, selected.id, paramValues);
      onApplied();
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <ScrollArea className="h-full" data-testid="contexts-empty-state">
      <div className="p-4 max-w-2xl mx-auto">
        <div className="mb-4">
          <h2 className="text-base font-semibold">No project context model yet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This project has no <code className="font-mono text-xs px-1 bg-muted rounded">.antimatter/contexts.ts</code>.
            Pick a template to scaffold one, or start blank and add contexts manually.
          </p>
        </div>

        {!templates && (
          <div className="text-sm text-muted-foreground flex items-center" data-testid="contexts-templates-loading">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading templates…
          </div>
        )}

        {templates && templates.length === 0 && (
          <div className="text-sm text-muted-foreground" data-testid="contexts-templates-empty">
            No templates registered.
          </div>
        )}

        {templates && templates.length > 0 && (
          <div className="space-y-3" data-testid="contexts-templates-list">
            {templates.map((t) => (
              <label
                key={t.id}
                className={`block border rounded-md p-3 cursor-pointer transition-colors ${
                  selectedId === t.id ? 'border-primary bg-accent/40' : 'border-border hover:bg-accent/20'
                }`}
                data-testid={`contexts-template-${t.id}`}
              >
                <input
                  type="radio"
                  name="template"
                  className="sr-only"
                  checked={selectedId === t.id}
                  onChange={() => {
                    setSelectedId(t.id);
                    setParamValues({});
                  }}
                />
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                {t.tags && t.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.tags.map((tag) => (
                      <span key={tag} className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </label>
            ))}
          </div>
        )}

        {selected && selected.params && selected.params.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-4" data-testid="contexts-template-params">
            {selected.params.map((p) => (
              <label key={p.name} className="block text-sm">
                <div className="font-medium">{p.label}{p.required && <span className="text-destructive ml-1">*</span>}</div>
                {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                <input
                  type="text"
                  className="mt-1 w-full px-2 py-1 text-sm bg-background border border-border rounded"
                  placeholder={p.default ?? ''}
                  value={paramValues[p.name] ?? ''}
                  onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                  data-testid={`contexts-template-param-${p.name}`}
                />
              </label>
            ))}
          </div>
        )}

        {applyError && (
          <div className="mt-3 text-sm text-destructive" data-testid="contexts-apply-error">
            {applyError}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            onClick={handleApply}
            disabled={!selected || applying}
            data-testid="contexts-apply-template-button"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            {applying ? 'Creating…' : 'Create from template'}
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Loaded state — basic context tree
// ---------------------------------------------------------------------------

function ContextTreeView({
  snapshot,
  onRefresh,
  loading,
}: {
  snapshot: ContextModelSnapshot;
  onRefresh: () => void;
  loading: boolean;
}) {
  const tree = buildTree(snapshot);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addContextOpen, setAddContextOpen] = useState(false);
  const [addResourceOpen, setAddResourceOpen] = useState(false);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  return (
    <div className="h-full flex flex-col" data-testid="contexts-tree-view">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
        <span data-testid="contexts-count-contexts">
          <Folder className="h-3 w-3 inline mr-1" />
          {snapshot.counts.contexts}
        </span>
        <span data-testid="contexts-count-resources">
          <Boxes className="h-3 w-3 inline mr-1" />
          {snapshot.counts.resources}
        </span>
        <span data-testid="contexts-count-rules">
          <Wrench className="h-3 w-3 inline mr-1" />
          {snapshot.counts.rules}
        </span>
        <Separator />
        <StatusChips snapshot={snapshot} />
        <div className="flex-1" />
        <div className="relative" ref={addMenuRef}>
          <button
            className="flex items-center gap-1 px-2 py-0.5 hover:bg-accent rounded text-foreground"
            onClick={() => setAddMenuOpen((v) => !v)}
            data-testid="contexts-add-button"
            title="Add"
          >
            <Plus className="h-3 w-3" />
            Add
            <ChevronDown className="h-3 w-3" />
          </button>
          {addMenuOpen && (
            <div
              className="absolute top-full right-0 mt-1 w-44 bg-popover border border-border rounded-md shadow-lg z-50 py-1"
              data-testid="contexts-add-menu"
            >
              <button
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => { setAddMenuOpen(false); setAddContextOpen(true); }}
                data-testid="contexts-add-context"
              >
                Add context…
              </button>
              <button
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => { setAddMenuOpen(false); setAddResourceOpen(true); }}
                data-testid="contexts-add-resource"
              >
                Add resource…
              </button>
              <button
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => { setAddMenuOpen(false); setAddRuleOpen(true); }}
                data-testid="contexts-add-rule"
              >
                Add rule…
              </button>
            </div>
          )}
        </div>
        <button
          className="hover:text-foreground"
          onClick={onRefresh}
          disabled={loading}
          data-testid="contexts-refresh-button"
          title="Reload"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <AddContextDialog open={addContextOpen} onOpenChange={setAddContextOpen} snapshot={snapshot} />
      <AddResourceDialog open={addResourceOpen} onOpenChange={setAddResourceOpen} />
      <AddRuleDialog open={addRuleOpen} onOpenChange={setAddRuleOpen} snapshot={snapshot} />
      <ContextDetailDialog
        open={selectedContextId !== null}
        onOpenChange={(next) => { if (!next) setSelectedContextId(null); }}
        contextId={selectedContextId}
        snapshot={snapshot}
        onContextSelect={setSelectedContextId}
      />

      <NeedsAttention snapshot={snapshot} onContextSelect={setSelectedContextId} />
      <RecentActivity transitions={snapshot.recentTransitions} onContextSelect={setSelectedContextId} />

      <ScrollArea className="flex-1">
        <ul className="py-1" data-testid="contexts-tree-list">
          {tree.map((node) => (
            <ContextRow key={node.id} node={node} depth={0} onSelect={setSelectedContextId} />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

interface TreeNode {
  id: string;
  name: string;
  objective: string;
  actionKind: string;
  validationCount: number;
  lifecycleStatus: LifecycleStatus;
  children: TreeNode[];
}

function buildTree(snapshot: ContextModelSnapshot): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const c of snapshot.contexts) {
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      objective: c.objectiveStatement,
      actionKind: c.actionKind,
      validationCount: c.validations.length,
      lifecycleStatus: c.lifecycleStatus,
      children: [],
    });
  }
  const roots: TreeNode[] = [];
  for (const c of snapshot.contexts) {
    const node = byId.get(c.id)!;
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function statusIcon(status: LifecycleStatus): { Icon: typeof CheckCircle2; tone: string; title: string } {
  switch (status) {
    case 'done':                  return { Icon: CheckCircle2,   tone: 'text-green-500',          title: 'Done' };
    case 'in-progress':           return { Icon: Hammer,         tone: 'text-amber-500',          title: 'In progress' };
    case 'ready':                 return { Icon: Circle,         tone: 'text-blue-500',           title: 'Ready' };
    case 'pending':               return { Icon: CircleDashed,   tone: 'text-muted-foreground',   title: 'Pending' };
    case 'regressed':             return { Icon: XCircle,        tone: 'text-destructive',        title: 'Regressed' };
    case 'dependency-regressed':  return { Icon: AlertTriangle,  tone: 'text-destructive/80',     title: 'Dependency regressed' };
  }
}

/** Inline vertical divider used in the panel header. */
function Separator() {
  return <span className="h-3 w-px bg-border" aria-hidden="true" />;
}

/** Order chips show in the header — most-positive first, problems last. */
const STATUS_ORDER: readonly LifecycleStatus[] = [
  'done', 'in-progress', 'ready', 'pending', 'regressed', 'dependency-regressed',
];

function StatusChips({ snapshot }: { snapshot: ContextModelSnapshot }) {
  const items: { status: LifecycleStatus; n: number }[] = STATUS_ORDER
    .map((s) => ({ status: s, n: snapshot.counts.byStatus[s] ?? 0 }))
    .filter((it) => it.n > 0);
  if (items.length === 0) return null;
  return (
    <span className="flex items-center gap-2" data-testid="contexts-status-chips">
      {items.map(({ status, n }) => {
        const { Icon, tone, title } = statusIcon(status);
        return (
          <span
            key={status}
            className={`inline-flex items-center gap-0.5 ${tone}`}
            title={title}
            data-testid={`contexts-status-chip-${status}`}
          >
            <Icon className="h-3 w-3" />
            {n}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Banner that surfaces:
 *   - Model errors (cycles, unresolved refs, …)
 *   - Regressed / dependency-regressed contexts
 *   - Contexts with at least one failing validation that aren't already
 *     surfaced by status (`in-progress` with a failing val gets listed
 *     because it explicitly needs attention).
 *
 * Hidden when there's nothing to show.
 */
function NeedsAttention({
  snapshot, onContextSelect,
}: {
  snapshot: ContextModelSnapshot;
  onContextSelect: (id: string) => void;
}) {
  const regressedCtxs = snapshot.contexts.filter(
    (c) => c.lifecycleStatus === 'regressed' || c.lifecycleStatus === 'dependency-regressed',
  );
  const failingValCtxs = snapshot.contexts.filter(
    (c) =>
      c.lifecycleStatus !== 'regressed' &&
      c.lifecycleStatus !== 'dependency-regressed' &&
      c.validations.some((v) => v.status === 'failing'),
  );
  const errors = snapshot.modelErrors;
  if (regressedCtxs.length === 0 && failingValCtxs.length === 0 && errors.length === 0) {
    return null;
  }
  return (
    <div
      className="px-3 py-2 border-b border-border bg-amber-500/10 text-xs"
      data-testid="contexts-needs-attention"
    >
      <div className="font-semibold text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Needs attention
      </div>
      {errors.length > 0 && (
        <ul className="space-y-0.5 mb-1">
          {errors.map((e, i) => (
            <li key={i} className="text-destructive/90" data-testid="contexts-attention-model-error">
              [{e.code}] {e.message}
            </li>
          ))}
        </ul>
      )}
      {regressedCtxs.length > 0 && (
        <ul className="space-y-0.5 mb-1">
          {regressedCtxs.map((c) => (
            <li key={c.id}>
              <button
                className="hover:underline"
                onClick={() => onContextSelect(c.id)}
                data-testid={`contexts-attention-regressed-${c.id}`}
              >
                <span className="text-destructive">{c.lifecycleStatus}</span>
                {' — '}
                <span className="font-medium">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {failingValCtxs.length > 0 && (
        <ul className="space-y-0.5">
          {failingValCtxs.map((c) => {
            const failing = c.validations.filter((v) => v.status === 'failing');
            return (
              <li key={c.id}>
                <button
                  className="hover:underline"
                  onClick={() => onContextSelect(c.id)}
                  data-testid={`contexts-attention-failing-${c.id}`}
                >
                  <span className="text-amber-700 dark:text-amber-300">failing</span>
                  {' — '}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground"> ({failing.map((v) => v.id).join(', ')})</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Inline list of recent transitions (most-recent first). Hidden when
 * empty. Capped to 10 visible rows; the snapshot retains up to 50.
 */
function RecentActivity({
  transitions, onContextSelect,
}: {
  transitions: readonly SerializedTransition[];
  onContextSelect: (id: string) => void;
}) {
  if (transitions.length === 0) return null;
  const visible = transitions.slice(0, 10);
  return (
    <div
      className="px-3 py-2 border-b border-border bg-muted/30"
      data-testid="contexts-recent-activity"
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
        Recent activity
      </div>
      <ul className="space-y-0.5 text-xs">
        {visible.map((t, i) => (
          <li key={`${t.contextId}-${t.at}-${i}`}>
            <button
              className="text-left hover:underline"
              onClick={() => onContextSelect(t.contextId)}
              data-testid={`contexts-activity-${t.contextId}`}
            >
              <span className="font-medium">{t.contextName}</span>
              <span className="text-muted-foreground">
                {' — '}{t.from ?? '∅'} → {t.to}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContextRow({
  node, depth, onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (id: string) => void;
}) {
  const { Icon, tone, title } = statusIcon(node.lifecycleStatus);
  return (
    <>
      <li>
        <button
          type="button"
          className="w-full text-left px-3 py-1 text-sm hover:bg-accent/40 flex items-start gap-2"
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => onSelect(node.id)}
          data-testid={`contexts-tree-row-${node.id}`}
          data-status={node.lifecycleStatus}
        >
          <Icon className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${tone}`} aria-label={title} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{node.name}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{node.actionKind}</span>
              {node.validationCount > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {node.validationCount} validation{node.validationCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">{node.objective}</div>
          </div>
        </button>
      </li>
      {node.children.map((c) => (
        <ContextRow key={c.id} node={c} depth={depth + 1} onSelect={onSelect} />
      ))}
    </>
  );
}
