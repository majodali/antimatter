/**
 * Modal form for adding a workflow rule to `.antimatter/build.ts`.
 *
 * Phase 2 keeps this simple:
 *   - id, name, description
 *   - on: trigger picker (event name OR file-change glob)
 *   - run: shell command (the most common shape)
 *   - reads / writes: comma-separated resource ids (looked up
 *     against the loaded model so the form catches typos before save)
 *   - manual flag
 *
 * Anything fancier (e.g. emit, code-action) is achieved by editing the
 * generated rule directly.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { addRule, type ContextModelSnapshot, type EmitRuleInput, type EmitResourceRefInput } from '@/lib/contexts-automation';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const FIELD_INPUT_CLASS = 'w-full px-2 py-1 text-sm bg-background border border-border rounded';

type TriggerKind = 'event' | 'fileChange';

export function AddRuleDialog({
  open, onOpenChange, snapshot,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  snapshot: ContextModelSnapshot | null;
}) {
  const projectId = useProjectStore((s) => s.currentProjectId);

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('event');
  const [eventName, setEventName] = useState('');
  const [pathGlob, setPathGlob] = useState('');
  const [command, setCommand] = useState('');
  const [reads, setReads] = useState('');
  const [writes, setWrites] = useState('');
  const [manual, setManual] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setId(''); setName(''); setDescription('');
    setTriggerKind('event'); setEventName(''); setPathGlob('');
    setCommand(''); setReads(''); setWrites('');
    setManual(false);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!projectId) return;
    setError(null);

    if (!ID_PATTERN.test(id)) { setError('id must match [a-z0-9][a-z0-9._-]*'); return; }
    if (!name.trim()) { setError('name is required'); return; }
    if (!command.trim()) { setError('command is required'); return; }

    let on: unknown;
    if (triggerKind === 'event') {
      if (!eventName.trim()) { setError('event name is required'); return; }
      on = { kind: 'event', name: eventName.trim() };
    } else {
      if (!pathGlob.trim()) { setError('file-change path is required'); return; }
      on = { kind: 'fileChange', path: pathGlob.trim() };
    }

    const declaredResourceIds = new Set((snapshot?.resources ?? []).map((r) => r.id));

    let readRefs: EmitResourceRefInput[];
    let writeRefs: EmitResourceRefInput[];
    try {
      readRefs = parseRefs('reads', reads, declaredResourceIds);
      writeRefs = parseRefs('writes', writes, declaredResourceIds);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    const payload: EmitRuleInput = {
      id, name: name.trim(),
      description: description.trim() || undefined,
      on,
      run: { kind: 'shell', command: command.trim() },
      reads: readRefs.length > 0 ? readRefs : undefined,
      writes: writeRefs.length > 0 ? writeRefs : undefined,
      manual: manual || undefined,
    };

    setSubmitting(true);
    try {
      await addRule(projectId, payload);
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg" data-testid="add-rule-dialog">
        <DialogHeader>
          <DialogTitle>Add workflow rule</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <Field label="id">
            <input
              type="text" value={id} onChange={(e) => setId(e.target.value)}
              className={FIELD_INPUT_CLASS}
              placeholder="e.g. type-check"
              data-testid="add-rule-id"
            />
          </Field>
          <Field label="name">
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className={FIELD_INPUT_CLASS}
              data-testid="add-rule-name"
            />
          </Field>
          <Field label="description" hint="Optional">
            <input
              type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className={FIELD_INPUT_CLASS}
              data-testid="add-rule-description"
            />
          </Field>

          <Field label="trigger" hint="When does this rule fire?">
            <div className="flex gap-2 mb-1">
              <label className="flex items-center gap-1">
                <input
                  type="radio" name="trigger" value="event"
                  checked={triggerKind === 'event'}
                  onChange={() => setTriggerKind('event')}
                  data-testid="add-rule-trigger-event"
                />
                event
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio" name="trigger" value="fileChange"
                  checked={triggerKind === 'fileChange'}
                  onChange={() => setTriggerKind('fileChange')}
                  data-testid="add-rule-trigger-file"
                />
                file change
              </label>
            </div>
            {triggerKind === 'event' ? (
              <input
                type="text" value={eventName} onChange={(e) => setEventName(e.target.value)}
                className={FIELD_INPUT_CLASS}
                placeholder="e.g. build"
                data-testid="add-rule-event-name"
              />
            ) : (
              <input
                type="text" value={pathGlob} onChange={(e) => setPathGlob(e.target.value)}
                className={FIELD_INPUT_CLASS}
                placeholder="e.g. src/**/*.ts"
                data-testid="add-rule-path-glob"
              />
            )}
          </Field>

          <Field label="command" hint="Shell command the rule runs">
            <input
              type="text" value={command} onChange={(e) => setCommand(e.target.value)}
              className={FIELD_INPUT_CLASS}
              placeholder="e.g. npx tsc --build"
              data-testid="add-rule-command"
            />
          </Field>

          <Field label="reads" hint="Resource ids the rule reads (comma-separated)">
            <input
              type="text" value={reads} onChange={(e) => setReads(e.target.value)}
              className={FIELD_INPUT_CLASS}
              placeholder="e.g. sources, tests"
              data-testid="add-rule-reads"
            />
          </Field>
          <Field label="writes" hint="Resource ids the rule writes (comma-separated)">
            <input
              type="text" value={writes} onChange={(e) => setWrites(e.target.value)}
              className={FIELD_INPUT_CLASS}
              placeholder="e.g. build-out"
              data-testid="add-rule-writes"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)}
              data-testid="add-rule-manual"
            />
            <span>manual — only fires when explicitly invoked</span>
          </label>

          {error && (
            <div className="text-sm text-destructive" data-testid="add-rule-error">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="add-rule-submit">
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

function parseRefs(label: string, raw: string, declared: ReadonlySet<string>): EmitResourceRefInput[] {
  const ids = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const refs: EmitResourceRefInput[] = [];
  for (const id of ids) {
    if (!ID_PATTERN.test(id)) {
      throw new Error(`${label}: '${id}' is not a valid resource id`);
    }
    if (declared.size > 0 && !declared.has(id)) {
      throw new Error(`${label}: '${id}' is not a declared resource`);
    }
    refs.push({ mode: 'resource', id });
  }
  return refs;
}
