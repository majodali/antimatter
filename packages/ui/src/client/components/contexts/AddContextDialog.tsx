/**
 * Modal form for adding a context to `.antimatter/contexts.ts`.
 *
 * Fields are intentionally minimal in Phase 2: id, name, parent picker
 * (existing contexts), objective, action kind. Validations / inputs /
 * outputs are added by editing the file directly — the form gets the
 * common case (sub-context with one objective + a single action) right
 * out of the box.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { addContext, type ContextModelSnapshot, type EmitContextInput, type EmitActionInput } from '@/lib/contexts-automation';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

const ACTION_KINDS: ReadonlyArray<{ value: EmitActionInput['kind']; label: string; hint: string }> = [
  { value: 'agent',       label: 'Agent',       hint: 'Hand the work to the agent' },
  { value: 'plan',        label: 'Plan',        hint: 'This context decomposes into sub-contexts' },
  { value: 'invoke-rule', label: 'Workflow rule', hint: 'Fire a workflow rule and use its outcome' },
  { value: 'human',       label: 'Human',       hint: "Tracked manually; IDE doesn't run anything" },
  { value: 'code',        label: 'Code',        hint: 'Run a registered function' },
];

export function AddContextDialog({
  open,
  onOpenChange,
  snapshot,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  snapshot: ContextModelSnapshot | null;
}) {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [objective, setObjective] = useState('');
  const [actionKind, setActionKind] = useState<EmitActionInput['kind']>('agent');
  const [actionDescription, setActionDescription] = useState('');
  const [actionRuleId, setActionRuleId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setId(''); setName(''); setParentId(''); setObjective('');
    setActionKind('agent'); setActionDescription(''); setActionRuleId('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!projectId) return;
    setError(null);

    if (!ID_PATTERN.test(id)) {
      setError('id must match [a-z0-9][a-z0-9._-]*'); return;
    }
    if (!name.trim()) { setError('name is required'); return; }
    if (!objective.trim()) { setError('objective is required'); return; }

    let action: EmitActionInput;
    const desc = actionDescription.trim() || `${actionKind} action for ${id}`;
    switch (actionKind) {
      case 'agent':       action = { kind: 'agent', description: desc };   break;
      case 'plan':        action = { kind: 'plan',  description: desc };   break;
      case 'human':       action = { kind: 'human', description: desc };   break;
      case 'invoke-rule':
        if (!ID_PATTERN.test(actionRuleId)) { setError('action rule id is required'); return; }
        action = { kind: 'invoke-rule', ruleId: actionRuleId, description: desc };
        break;
      case 'code':
        action = { kind: 'code', description: desc, fn: 'TODO' };
        break;
    }

    const input: EmitContextInput = {
      id: id.trim(),
      name: name.trim(),
      parentId: parentId || undefined,
      objective: objective.trim(),
      action,
    };

    setSubmitting(true);
    try {
      await addContext(projectId, input);
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const parentChoices = snapshot?.contexts ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg" data-testid="add-context-dialog">
        <DialogHeader>
          <DialogTitle>Add context</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <Field label="id" hint="kebab-case identifier; must be unique">
            <input
              type="text" value={id} onChange={(e) => setId(e.target.value)}
              className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
              placeholder="e.g. implement-validator"
              data-testid="add-context-id"
            />
          </Field>
          <Field label="name" hint="Human-readable label">
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
              placeholder="e.g. Implement validator"
              data-testid="add-context-name"
            />
          </Field>
          <Field label="parent" hint="Containing context (leave blank for root)">
            <select
              value={parentId} onChange={(e) => setParentId(e.target.value)}
              className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
              data-testid="add-context-parent"
            >
              <option value="">(none — root)</option>
              {parentChoices.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
              ))}
            </select>
          </Field>
          <Field label="objective" hint="What does done look like for this context?">
            <textarea
              value={objective} onChange={(e) => setObjective(e.target.value)}
              className="w-full px-2 py-1 text-sm bg-background border border-border rounded min-h-[60px]"
              placeholder="e.g. Author the validator code so that it type-checks against the spec."
              data-testid="add-context-objective"
            />
          </Field>
          <Field label="action" hint="How is this context driven toward done?">
            <select
              value={actionKind} onChange={(e) => setActionKind(e.target.value as EmitActionInput['kind'])}
              className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
              data-testid="add-context-action-kind"
            >
              {ACTION_KINDS.map((a) => (
                <option key={a.value} value={a.value}>{a.label} — {a.hint}</option>
              ))}
            </select>
          </Field>
          {actionKind === 'invoke-rule' && (
            <Field label="action: rule id" hint="The id of the workflow rule to invoke">
              <input
                type="text" value={actionRuleId} onChange={(e) => setActionRuleId(e.target.value)}
                className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
                placeholder="e.g. publish-bundle"
                data-testid="add-context-action-rule-id"
              />
            </Field>
          )}
          <Field label="action description" hint="Optional one-liner for the IDE to display">
            <input
              type="text" value={actionDescription} onChange={(e) => setActionDescription(e.target.value)}
              className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
              placeholder="(optional)"
              data-testid="add-context-action-description"
            />
          </Field>

          {error && (
            <div className="text-sm text-destructive" data-testid="add-context-error">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="add-context-submit">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="font-medium">{label}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
