import { useEffect, useState } from 'react';
import { Check, AlertTriangle, Loader2, Eye, EyeOff, Save, X, KeyRound } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { useSecretsStore } from '@/stores/secretsStore';
import type { SecretStatus } from '@/lib/api';

// ---------------------------------------------------------------------------
// SecretItem
// ---------------------------------------------------------------------------

function SecretItem({ secret }: { secret: SecretStatus }) {
  const { setSecret, deleteSecret } = useSecretsStore();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    await setSecret(secret.name, value.trim());
    setSaving(false);
    setEditing(false);
    setValue('');
    setShowValue(false);
  };

  const handleClear = async () => {
    setSaving(true);
    await deleteSecret(secret.name);
    setSaving(false);
  };

  const handleCancel = () => {
    setEditing(false);
    setValue('');
    setShowValue(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
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
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setEditing(true)}
                disabled={saving}
              >
                {secret.hasValue ? 'Update' : 'Set'}
              </Button>
              {secret.hasValue && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-red-500 hover:text-red-600"
                  onClick={handleClear}
                  disabled={saving}
                >
                  Clear
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-1.5">{secret.description}</p>

      {editing && (
        <div className="flex items-center gap-1.5 mt-2">
          <div className="flex-1 relative">
            <input
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter secret value..."
              autoFocus
              className="w-full h-7 px-2 pr-8 text-xs bg-background border border-border rounded
                         focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowValue(!showValue)}
            >
              {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleSave}
            disabled={saving || !value.trim()}
            title="Save"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCancel}
            disabled={saving}
            title="Cancel"
          >
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
  const { secrets, isLoading, loadSecrets } = useSecretsStore();

  useEffect(() => {
    loadSecrets();
  }, []);

  if (isLoading && secrets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">Loading secrets...</span>
      </div>
    );
  }

  if (secrets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <KeyRound className="h-12 w-12 text-muted-foreground mb-3 opacity-50" />
        <p className="text-sm text-muted-foreground">No secrets configured</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      {secrets.map((secret) => (
        <SecretItem key={secret.name} secret={secret} />
      ))}
    </ScrollArea>
  );
}
