/**
 * Modal form for adding a resource to `.antimatter/resources.ts`.
 *
 * The kind picker drives which fields are visible. Phase 2 supports:
 *   - file-set          (id + include globs)
 *   - test              (id + name + testType)
 *   - test-set          (id + member ids)
 *   - deployed-resource (id + resourceType + target)
 *   - environment       (id + provider)
 *
 * config / secret / signal / authorization are handled by direct edit
 * for now — they're rarely added interactively and need more nuance
 * (config sources, secret backends) than the form gives.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { addResource, type EmitResourceInput } from '@/lib/contexts-automation';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

const RESOURCE_KINDS = [
  { value: 'file-set',          label: 'File set',          hint: 'Glob-matched group of files' },
  { value: 'test',              label: 'Test',              hint: 'A single test case' },
  { value: 'test-set',          label: 'Test set',          hint: 'Named group of tests' },
  { value: 'deployed-resource', label: 'Deployed resource', hint: 'Lambda, S3 object, npm package, …' },
  { value: 'environment',       label: 'Environment',       hint: 'AWS account, npm registry, …' },
] as const;

type Kind = typeof RESOURCE_KINDS[number]['value'];

const FIELD_INPUT_CLASS = 'w-full px-2 py-1 text-sm bg-background border border-border rounded';

export function AddResourceDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const projectId = useProjectStore((s) => s.currentProjectId);

  const [kind, setKind] = useState<Kind>('file-set');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  // file-set
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  // test
  const [testType, setTestType] = useState<'unit' | 'functional' | 'smoke' | 'integration'>('unit');
  // test-set
  const [members, setMembers] = useState('');
  // deployed-resource
  const [resourceType, setResourceType] = useState('');
  const [target, setTarget] = useState('');
  // environment
  const [provider, setProvider] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setId(''); setName(''); setInclude(''); setExclude('');
    setTestType('unit'); setMembers('');
    setResourceType(''); setTarget(''); setProvider('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!projectId) return;
    setError(null);

    if (!ID_PATTERN.test(id)) { setError('id must match [a-z0-9][a-z0-9._-]*'); return; }

    let payload: EmitResourceInput;
    try {
      payload = buildPayload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    setSubmitting(true);
    try {
      await addResource(projectId, payload);
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  function buildPayload(): EmitResourceInput {
    const baseName = name.trim() || undefined;
    switch (kind) {
      case 'file-set': {
        const includes = parseLines(include);
        if (includes.length === 0) throw new Error('include must have at least one glob');
        const excludes = parseLines(exclude);
        return { kind: 'file-set', resource: { id, name: baseName, include: includes, exclude: excludes.length > 0 ? excludes : undefined } };
      }
      case 'test':
        return { kind: 'test', resource: { id, name: baseName, testType } };
      case 'test-set': {
        const list = parseLines(members);
        if (list.length === 0) throw new Error('members must list at least one test id');
        return { kind: 'test-set', resource: { id, name: baseName, members: list } };
      }
      case 'deployed-resource':
        if (!resourceType) throw new Error('resourceType is required');
        if (!target) throw new Error('target is required');
        return { kind: 'deployed-resource', resource: { id, name: baseName, resourceType, target } };
      case 'environment':
        if (!provider) throw new Error('provider is required');
        return { kind: 'environment', resource: { id, name: baseName, provider } };
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg" data-testid="add-resource-dialog">
        <DialogHeader>
          <DialogTitle>Add resource</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <Field label="kind" hint="What kind of resource is this?">
            <select
              value={kind} onChange={(e) => setKind(e.target.value as Kind)}
              className={FIELD_INPUT_CLASS}
              data-testid="add-resource-kind"
            >
              {RESOURCE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label} — {k.hint}</option>
              ))}
            </select>
          </Field>

          <Field label="id" hint="kebab-case identifier; must be unique">
            <input
              type="text" value={id} onChange={(e) => setId(e.target.value)}
              className={FIELD_INPUT_CLASS}
              placeholder="e.g. sources"
              data-testid="add-resource-id"
            />
          </Field>

          <Field label="name" hint="Human-readable label (optional)">
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className={FIELD_INPUT_CLASS}
              data-testid="add-resource-name"
            />
          </Field>

          {kind === 'file-set' && (
            <>
              <Field label="include" hint="Glob patterns, one per line">
                <textarea
                  value={include} onChange={(e) => setInclude(e.target.value)}
                  className={FIELD_INPUT_CLASS + ' min-h-[60px]'}
                  placeholder="src/**/*.ts"
                  data-testid="add-resource-include"
                />
              </Field>
              <Field label="exclude" hint="Optional excludes, one per line">
                <textarea
                  value={exclude} onChange={(e) => setExclude(e.target.value)}
                  className={FIELD_INPUT_CLASS + ' min-h-[40px]'}
                  data-testid="add-resource-exclude"
                />
              </Field>
            </>
          )}

          {kind === 'test' && (
            <Field label="test type">
              <select
                value={testType} onChange={(e) => setTestType(e.target.value as typeof testType)}
                className={FIELD_INPUT_CLASS}
                data-testid="add-resource-test-type"
              >
                <option value="unit">unit</option>
                <option value="functional">functional</option>
                <option value="smoke">smoke</option>
                <option value="integration">integration</option>
              </select>
            </Field>
          )}

          {kind === 'test-set' && (
            <Field label="members" hint="Test ids, one per line">
              <textarea
                value={members} onChange={(e) => setMembers(e.target.value)}
                className={FIELD_INPUT_CLASS + ' min-h-[60px]'}
                placeholder="FT-X-001"
                data-testid="add-resource-members"
              />
            </Field>
          )}

          {kind === 'deployed-resource' && (
            <>
              <Field label="resource type" hint="e.g. lambda, s3-object, npm-package, cloudfront">
                <input
                  type="text" value={resourceType} onChange={(e) => setResourceType(e.target.value)}
                  className={FIELD_INPUT_CLASS}
                  data-testid="add-resource-resource-type"
                />
              </Field>
              <Field label="target" hint="ARN, URL, package name, …">
                <input
                  type="text" value={target} onChange={(e) => setTarget(e.target.value)}
                  className={FIELD_INPUT_CLASS}
                  data-testid="add-resource-target"
                />
              </Field>
            </>
          )}

          {kind === 'environment' && (
            <Field label="provider" hint="e.g. aws, npm, github, local">
              <input
                type="text" value={provider} onChange={(e) => setProvider(e.target.value)}
                className={FIELD_INPUT_CLASS}
                data-testid="add-resource-provider"
              />
            </Field>
          )}

          {error && (
            <div className="text-sm text-destructive" data-testid="add-resource-error">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="add-resource-submit">
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

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
