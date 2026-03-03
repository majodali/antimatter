import { useState, useEffect } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { useBuildStore } from '@/stores/buildStore';
import { useProjectStore } from '@/stores/projectStore';
import type { BuildRule } from '@antimatter/project-model';

export function BuildConfigEditor() {
  const { rules, addRule, removeRule, updateRule, saveConfig } =
    useBuildStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig(currentProjectId ?? undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleAddRule = () => {
    const id = `rule-${Date.now()}`;
    addRule({ id, name: '', inputs: [], outputs: [], command: '' });
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-4">
        {/* Rules Section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Build Rules</h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddRule} title="Add rule">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            {Array.from(rules.values()).map((rule) => (
              <RuleEditor
                key={rule.id}
                rule={rule}
                allRules={rules}
                onUpdate={(updated) => updateRule(rule.id, updated)}
                onRemove={() => removeRule(rule.id)}
              />
            ))}
            {rules.size === 0 && (
              <p className="text-xs text-muted-foreground italic">No rules defined. Click + to add one.</p>
            )}
          </div>
        </div>

        {/* Save */}
        <Button className="w-full" size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-3.5 w-3.5 mr-2" />
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </ScrollArea>
  );
}

function RuleEditor({
  rule,
  allRules,
  onUpdate,
  onRemove,
}: {
  rule: BuildRule;
  allRules: Map<string, BuildRule>;
  onUpdate: (r: BuildRule) => void;
  onRemove: () => void;
}) {
  const otherRules = Array.from(allRules.values()).filter((r) => r.id !== rule.id);

  return (
    <div className="border border-border rounded p-2 space-y-1.5 bg-accent/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground">{rule.id}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-1"
        placeholder="Rule name"
        value={rule.name}
        onChange={(e) => onUpdate({ ...rule, name: e.target.value })}
      />
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-1 font-mono"
        placeholder="Command (e.g. npx tsc --noEmit)"
        value={rule.command}
        onChange={(e) => onUpdate({ ...rule, command: e.target.value })}
      />
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-1 font-mono"
        placeholder="Input globs (comma-separated, e.g. src/**/*.ts)"
        value={rule.inputs.join(', ')}
        onChange={(e) =>
          onUpdate({
            ...rule,
            inputs: e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-1 font-mono"
        placeholder="Output globs (comma-separated, e.g. dist/**/*.js)"
        value={rule.outputs.join(', ')}
        onChange={(e) =>
          onUpdate({
            ...rule,
            outputs: e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
      {otherRules.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground">Depends on:</label>
          <div className="flex flex-wrap gap-1 mt-1">
            {otherRules.map((r) => {
              const isSelected = (rule.dependsOn || []).includes(r.id);
              return (
                <button
                  key={r.id}
                  className={`text-xs px-2 py-0.5 rounded border ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                  }`}
                  onClick={() => {
                    const deps = [...(rule.dependsOn || [])];
                    if (isSelected) {
                      onUpdate({ ...rule, dependsOn: deps.filter((d) => d !== r.id) });
                    } else {
                      onUpdate({ ...rule, dependsOn: [...deps, r.id] });
                    }
                  }}
                >
                  {r.name || r.id}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
