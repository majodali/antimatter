import { Plus, Trash2, Save } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { useDeployStore } from '@/stores/deployStore';
import { useProjectStore } from '@/stores/projectStore';
import type { DeploymentModule, PackagingStrategy, DeploymentTarget } from '@antimatter/project-model';

export function DeployConfigEditor() {
  const {
    modules,
    packaging,
    targets,
    addModule,
    updateModule,
    removeModule,
    addPackaging,
    updatePackaging,
    removePackaging,
    addTarget,
    updateTarget,
    removeTarget,
    saveConfig,
  } = useDeployStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  const handleSave = () => {
    saveConfig(currentProjectId ?? undefined);
  };

  const handleAddModule = () => {
    const id = `module-${Date.now()}`;
    addModule({
      id,
      name: 'New Module',
      type: 'lambda',
      buildCommand: 'echo build',
    });
  };

  const handleAddPackaging = () => {
    const id = `pkg-${Date.now()}`;
    const moduleIds = Array.from(modules.keys());
    addPackaging({
      id,
      moduleId: moduleIds[0] ?? '',
      type: 'lambda-zip',
      config: { type: 'lambda-zip', bundlePath: '' },
    });
  };

  const handleAddTarget = () => {
    const id = `target-${Date.now()}`;
    const moduleIds = Array.from(modules.keys());
    const pkgIds = Array.from(packaging.keys());
    addTarget({
      id,
      moduleId: moduleIds[0] ?? '',
      packagingId: pkgIds[0] ?? '',
      type: 'lambda-update',
      config: { type: 'lambda-update', functionName: '', region: 'us-west-2' },
    });
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-4">
        {/* Modules Section */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Modules
            </h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddModule}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            {Array.from(modules.values()).map((mod) => (
              <ModuleEditor
                key={mod.id}
                module={mod}
                onChange={(updated) => updateModule(mod.id, updated)}
                onRemove={() => removeModule(mod.id)}
              />
            ))}
            {modules.size === 0 && (
              <p className="text-xs text-muted-foreground">No modules configured</p>
            )}
          </div>
        </section>

        {/* Packaging Section */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Packaging
            </h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddPackaging}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            {Array.from(packaging.values()).map((pkg) => (
              <PackagingEditor
                key={pkg.id}
                pkg={pkg}
                moduleIds={Array.from(modules.keys())}
                onChange={(updated) => updatePackaging(pkg.id, updated)}
                onRemove={() => removePackaging(pkg.id)}
              />
            ))}
            {packaging.size === 0 && (
              <p className="text-xs text-muted-foreground">No packaging configured</p>
            )}
          </div>
        </section>

        {/* Targets Section */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Targets
            </h4>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddTarget}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-2">
            {Array.from(targets.values()).map((tgt) => (
              <TargetEditor
                key={tgt.id}
                target={tgt}
                moduleIds={Array.from(modules.keys())}
                packagingIds={Array.from(packaging.keys())}
                onChange={(updated) => updateTarget(tgt.id, updated)}
                onRemove={() => removeTarget(tgt.id)}
              />
            ))}
            {targets.size === 0 && (
              <p className="text-xs text-muted-foreground">No targets configured</p>
            )}
          </div>
        </section>

        {/* Save button */}
        <Button size="sm" className="w-full" onClick={handleSave}>
          <Save className="h-3.5 w-3.5 mr-2" />
          Save Configuration
        </Button>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Module Editor
// ---------------------------------------------------------------------------

function ModuleEditor({
  module: mod,
  onChange,
  onRemove,
}: {
  module: DeploymentModule;
  onChange: (mod: DeploymentModule) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-border p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-transparent text-xs font-medium border-b border-transparent hover:border-border focus:border-primary focus:outline-none py-0.5"
          value={mod.name}
          onChange={(e) => onChange({ ...mod, name: e.target.value })}
        />
        <select
          className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
          value={mod.type}
          onChange={(e) => onChange({ ...mod, type: e.target.value as any })}
        >
          <option value="frontend">frontend</option>
          <option value="lambda">lambda</option>
          <option value="infrastructure">infrastructure</option>
        </select>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-accent/30 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Build command"
          value={mod.buildCommand}
          onChange={(e) => onChange({ ...mod, buildCommand: e.target.value })}
        />
        <input
          className="w-24 bg-accent/30 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="cwd"
          value={mod.cwd ?? ''}
          onChange={(e) => onChange({ ...mod, cwd: e.target.value || undefined })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packaging Editor
// ---------------------------------------------------------------------------

function PackagingEditor({
  pkg,
  moduleIds,
  onChange,
  onRemove,
}: {
  pkg: PackagingStrategy;
  moduleIds: string[];
  onChange: (pkg: PackagingStrategy) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-border p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
          value={pkg.moduleId}
          onChange={(e) => onChange({ ...pkg, moduleId: e.target.value })}
        >
          {moduleIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <select
          className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
          value={pkg.type}
          onChange={(e) => {
            const type = e.target.value as 'lambda-zip' | 's3-static';
            const config = type === 'lambda-zip'
              ? { type: 'lambda-zip' as const, bundlePath: '' }
              : { type: 's3-static' as const, outputDir: '' };
            onChange({ ...pkg, type, config });
          }}
        >
          <option value="lambda-zip">lambda-zip</option>
          <option value="s3-static">s3-static</option>
        </select>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
      {pkg.config.type === 'lambda-zip' && (
        <input
          className="w-full bg-accent/30 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Bundle path (e.g. dist-lambda/index.js)"
          value={(pkg.config as any).bundlePath}
          onChange={(e) =>
            onChange({ ...pkg, config: { type: 'lambda-zip', bundlePath: e.target.value } })
          }
        />
      )}
      {pkg.config.type === 's3-static' && (
        <input
          className="w-full bg-accent/30 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Output dir (e.g. dist/client)"
          value={(pkg.config as any).outputDir}
          onChange={(e) =>
            onChange({ ...pkg, config: { type: 's3-static', outputDir: e.target.value } })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target Editor
// ---------------------------------------------------------------------------

function TargetEditor({
  target,
  moduleIds,
  packagingIds,
  onChange,
  onRemove,
}: {
  target: DeploymentTarget;
  moduleIds: string[];
  packagingIds: string[];
  onChange: (target: DeploymentTarget) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-border p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          className="w-24 bg-transparent text-xs font-medium border-b border-transparent hover:border-border focus:border-primary focus:outline-none py-0.5"
          value={target.id}
          onChange={(e) => onChange({ ...target, id: e.target.value })}
        />
        <select
          className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
          value={target.type}
          onChange={(e) => {
            const type = e.target.value as 'lambda-update' | 's3-upload';
            const config = type === 'lambda-update'
              ? { type: 'lambda-update' as const, functionName: '', region: 'us-west-2' }
              : { type: 's3-upload' as const, bucket: '', region: 'us-west-2' };
            onChange({ ...target, type, config });
          }}
        >
          <option value="lambda-update">lambda-update</option>
          <option value="s3-upload">s3-upload</option>
        </select>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
      <div className="flex gap-2">
        <select
          className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
          value={target.moduleId}
          onChange={(e) => onChange({ ...target, moduleId: e.target.value })}
        >
          {moduleIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <select
          className="text-xs bg-transparent border border-border rounded px-1 py-0.5"
          value={target.packagingId}
          onChange={(e) => onChange({ ...target, packagingId: e.target.value })}
        >
          {packagingIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>
      {target.config.type === 'lambda-update' && (
        <input
          className="w-full bg-accent/30 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Function name (e.g. ${COMMAND_FUNCTION_NAME})"
          value={(target.config as any).functionName}
          onChange={(e) =>
            onChange({ ...target, config: { ...target.config, functionName: e.target.value } })
          }
        />
      )}
      {target.config.type === 's3-upload' && (
        <div className="space-y-1">
          <input
            className="w-full bg-accent/30 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Bucket (e.g. ${WEBSITE_BUCKET})"
            value={(target.config as any).bucket}
            onChange={(e) =>
              onChange({ ...target, config: { ...target.config, bucket: e.target.value } })
            }
          />
          <input
            className="w-full bg-accent/30 text-xs rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Distribution ID (e.g. ${DISTRIBUTION_ID})"
            value={(target.config as any).distributionId ?? ''}
            onChange={(e) =>
              onChange({ ...target, config: { ...target.config, distributionId: e.target.value || undefined } })
            }
          />
        </div>
      )}
    </div>
  );
}
