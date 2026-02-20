import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { useBuildStore } from '@/stores/buildStore';
import { useProjectStore } from '@/stores/projectStore';
import type { BuildRule, BuildTarget } from '@antimatter/project-model';

export function BuildConfigEditor() {
  const { rules, targets, addRule, removeRule, updateRule, addTarget, removeTarget, updateTarget, saveConfig } =
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

  const handleAddTarget = () => {
    const id = `target-${Date.now()}`;
    const firstRuleId = Array.from(rules.keys())[0] || '';
    addTarget({ id, ruleId: firstRuleId, moduleId: '' });
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
                onUpdate={(updated) => updateRule(rule.id, updated)}
                onRemove={() => removeRule(rule.id)}
              />
            ))}
            {rules.size === 0 && (
              <p className="text-xs text-muted-foreground italic">No rules defined. Click + to add one.</p>
            )}
          </div>
        </div>

        {/* Targets Section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Build Targets</h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddTarget} title="Add target">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            {Array.from(targets.values()).map((target) => (
              <TargetEditor
                key={target.id}
                target={target}
                rules={rules}
                allTargets={targets}
                onUpdate={(updated) => updateTarget(target.id, updated)}
                onRemove={() => removeTarget(target.id)}
              />
            ))}
            {targets.size === 0 && (
              <p className="text-xs text-muted-foreground italic">No targets defined. Click + to add one.</p>
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
  onUpdate,
  onRemove,
}: {
  rule: BuildRule;
  onUpdate: (r: BuildRule) => void;
  onRemove: () => void;
}) {
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
        placeholder="Command (e.g. tsc)"
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
    </div>
  );
}

function TargetEditor({
  target,
  rules,
  allTargets,
  onUpdate,
  onRemove,
}: {
  target: BuildTarget;
  rules: Map<string, BuildRule>;
  allTargets: Map<string, BuildTarget>;
  onUpdate: (t: BuildTarget) => void;
  onRemove: () => void;
}) {
  const otherTargets = Array.from(allTargets.values()).filter((t) => t.id !== target.id);

  return (
    <div className="border border-border rounded p-2 space-y-1.5 bg-accent/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground">{target.id}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-1"
        placeholder="Target ID"
        value={target.id}
        onChange={(e) => onUpdate({ ...target, id: e.target.value })}
      />
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-1"
        value={target.ruleId}
        onChange={(e) => onUpdate({ ...target, ruleId: e.target.value })}
      >
        <option value="">Select rule...</option>
        {Array.from(rules.values()).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name || r.id}
          </option>
        ))}
      </select>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-1"
        placeholder="Module ID"
        value={target.moduleId}
        onChange={(e) => onUpdate({ ...target, moduleId: e.target.value })}
      />
      {otherTargets.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground">Depends on:</label>
          <div className="flex flex-wrap gap-1 mt-1">
            {otherTargets.map((t) => {
              const isSelected = (target.dependsOn || []).includes(t.id);
              return (
                <button
                  key={t.id}
                  className={`text-xs px-2 py-0.5 rounded border ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                  }`}
                  onClick={() => {
                    const deps = [...(target.dependsOn || [])];
                    if (isSelected) {
                      onUpdate({ ...target, dependsOn: deps.filter((d) => d !== t.id) });
                    } else {
                      onUpdate({ ...target, dependsOn: [...deps, t.id] });
                    }
                  }}
                >
                  {t.id}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
