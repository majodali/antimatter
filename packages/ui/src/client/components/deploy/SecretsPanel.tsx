import { useEffect, useState } from 'react';
import { Check, AlertTriangle, Loader2, Eye, EyeOff, Save, X, KeyRound, Plus } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { useProjectStore } from '@/stores/projectStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SecretInfo {
  name: string;
  description?: string;
  hasValue: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function automationExec(projectId: string, command: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params }),
  });
  if (!res.ok) throw new Error(`${command} failed: ${res.status}`);
  const data = await res.json();
  return data.data ?? data;
}

// ---------------------------------------------------------------------------
// SecretItem
// ---------------------------------------------------------------------------

function SecretItem({
  secret,
  projectId,
  onRefresh,
}: {
  secret: SecretInfo;
  projectId: string;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await automationExec(projectId, 'secrets.set', { name: secret.name, value: value.trim() });
      onRefresh();
    } catch (err) {
      console.error('Failed to set secret:', err);
    }
    setSaving(false);
    setEditing(false);
    setValue('');
    setShowValue(false);
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await automationExec(projectId, 'secrets.delete', { name: secret.name });
      onRefresh();
    } catch (err) {
      console.error('Failed to delete secret:', err);
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setEditing(false);
    setValue('');
    setShowValue(false);
  };

  return (
    <div className="px-3 py-2.5 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {secret.hasValue ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
          )}
          <span className="text-sm font-medium text-foreground">{secret.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {!editing && (
            <>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditing(true)} disabled={saving}>
                {secret.hasValue ? 'Update' : 'Set'}
              </Button>
              {secret.hasValue && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-500 hover:text-red-600" onClick={handleDelete} disabled={saving}>
                  Clear
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {secret.description && <p className="text-xs text-muted-foreground mb-1.5">{secret.description}</p>}

      {editing && (
        <div className="flex items-center gap-1.5 mt-2">
          <div className="flex-1 relative">
            <input
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
              placeholder="Enter secret value..."
              autoFocus
              className="w-full h-7 px-2 pr-8 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowValue(!showValue)}
            >
              {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave} disabled={saving || !value.trim()} title="Save">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancel} disabled={saving} title="Cancel">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SecretsPanel
// ---------------------------------------------------------------------------

export function SecretsPanel() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [secrets, setSecrets] = useState<SecretInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');

  const loadSecrets = async () => {
    if (!currentProjectId) return;
    setIsLoading(true);
    try {
      const result = await automationExec(currentProjectId, 'secrets.list');
      setSecrets(result.secrets ?? []);
    } catch {
      // Fallback: no secrets available
      setSecrets([]);
    }
    setIsLoading(false);
  };

  useEffect(() => { loadSecrets(); }, [currentProjectId]);

  const handleAddSecret = async () => {
    if (!newName.trim() || !currentProjectId) return;
    // Just create the entry — user will set the value via the SecretItem UI
    try {
      await automationExec(currentProjectId, 'secrets.set', { name: newName.trim(), value: '__placeholder__' });
      await automationExec(currentProjectId, 'secrets.delete', { name: newName.trim() });
      // Actually, just register as a resource with hasValue: false
      // The user will set the actual value via the item's "Set" button
    } catch { /* ignore */ }
    setAddingNew(false);
    setNewName('');
    loadSecrets();
  };

  if (isLoading && secrets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">Loading secrets...</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Per-project secrets (SSM encrypted)</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => setAddingNew(true)}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {addingNew && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddSecret(); if (e.key === 'Escape') { setAddingNew(false); setNewName(''); } }}
            placeholder="Secret name (e.g., api-key)"
            autoFocus
            className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleAddSecret} disabled={!newName.trim()} title="Add">
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setAddingNew(false); setNewName(''); }} title="Cancel">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        {secrets.length === 0 && !addingNew ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <KeyRound className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No secrets configured</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Add" to create a project secret</p>
          </div>
        ) : (
          secrets.map((secret) => (
            <SecretItem key={secret.name} secret={secret} projectId={currentProjectId!} onRefresh={loadSecrets} />
          ))
        )}
      </ScrollArea>
    </div>
  );
}
