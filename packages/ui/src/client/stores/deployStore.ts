import { create } from 'zustand';
import type {
  DeploymentModule,
  PackagingStrategy,
  DeploymentTarget,
  DeploymentResult,
} from '@antimatter/project-model';
import { fetchDeployConfig, saveDeployConfig as saveDeployConfigApi } from '@/lib/api';
import { eventLog } from '@/lib/eventLog';

interface DeployState {
  // Configuration
  modules: Map<string, DeploymentModule>;
  packaging: Map<string, PackagingStrategy>;
  targets: Map<string, DeploymentTarget>;

  // Results
  results: Map<string, DeploymentResult>;

  // Streaming output per target
  deployOutput: Map<string, string[]>;

  // UI state
  configMode: boolean;
  isDeploying: boolean;

  // Actions
  setModules: (modules: DeploymentModule[]) => void;
  setPackaging: (packaging: PackagingStrategy[]) => void;
  setTargets: (targets: DeploymentTarget[]) => void;
  setResult: (result: DeploymentResult) => void;
  setResults: (results: DeploymentResult[]) => void;
  clearResults: () => void;
  setConfigMode: (mode: boolean) => void;
  setDeploying: (deploying: boolean) => void;
  appendOutput: (targetId: string, line: string) => void;
  clearOutput: () => void;

  // Config management
  loadConfig: (projectId?: string) => Promise<void>;
  saveConfig: (projectId?: string) => Promise<void>;
  addModule: (module: DeploymentModule) => void;
  updateModule: (id: string, module: DeploymentModule) => void;
  removeModule: (id: string) => void;
  addPackaging: (pkg: PackagingStrategy) => void;
  updatePackaging: (id: string, pkg: PackagingStrategy) => void;
  removePackaging: (id: string) => void;
  addTarget: (target: DeploymentTarget) => void;
  updateTarget: (id: string, target: DeploymentTarget) => void;
  removeTarget: (id: string) => void;
}

export const useDeployStore = create<DeployState>((set, get) => ({
  modules: new Map(),
  packaging: new Map(),
  targets: new Map(),
  results: new Map(),
  deployOutput: new Map(),
  configMode: false,
  isDeploying: false,

  setModules: (modules) =>
    set({ modules: new Map(modules.map((m) => [m.id, m])) }),

  setPackaging: (packaging) =>
    set({ packaging: new Map(packaging.map((p) => [p.id, p])) }),

  setTargets: (targets) =>
    set({ targets: new Map(targets.map((t) => [t.id, t])) }),

  setResult: (result) =>
    set((state) => ({
      results: new Map(state.results).set(result.targetId, result),
    })),

  setResults: (results) =>
    set({
      results: new Map(results.map((r) => [r.targetId, r])),
    }),

  clearResults: () =>
    set({
      results: new Map(),
      deployOutput: new Map(),
    }),

  setConfigMode: (mode) => set({ configMode: mode }),

  setDeploying: (deploying) => set({ isDeploying: deploying }),

  appendOutput: (targetId, line) =>
    set((state) => {
      const output = new Map(state.deployOutput);
      const existing = output.get(targetId) || [];
      output.set(targetId, [...existing, line]);
      return { deployOutput: output };
    }),

  clearOutput: () => set({ deployOutput: new Map() }),

  loadConfig: async (projectId?: string) => {
    try {
      const config = await fetchDeployConfig(projectId);
      set({
        modules: new Map((config.modules ?? []).map((m: DeploymentModule) => [m.id, m])),
        packaging: new Map((config.packaging ?? []).map((p: PackagingStrategy) => [p.id, p])),
        targets: new Map((config.targets ?? []).map((t: DeploymentTarget) => [t.id, t])),
      });
    } catch (err) {
      eventLog.error('deploy', 'Failed to load deploy config', String(err), { toast: true });
    }
  },

  saveConfig: async (projectId?: string) => {
    const state = get();
    try {
      await saveDeployConfigApi(
        {
          modules: Array.from(state.modules.values()),
          packaging: Array.from(state.packaging.values()),
          targets: Array.from(state.targets.values()),
        },
        projectId,
      );
      eventLog.toast.success('Deploy configuration saved');
    } catch (err) {
      eventLog.error('deploy', 'Failed to save deploy config', String(err), { toast: true });
    }
  },

  addModule: (module) =>
    set((state) => ({
      modules: new Map(state.modules).set(module.id, module),
    })),

  updateModule: (id, module) =>
    set((state) => {
      const modules = new Map(state.modules);
      if (module.id !== id) modules.delete(id);
      modules.set(module.id, module);
      return { modules };
    }),

  removeModule: (id) =>
    set((state) => {
      const modules = new Map(state.modules);
      modules.delete(id);
      return { modules };
    }),

  addPackaging: (pkg) =>
    set((state) => ({
      packaging: new Map(state.packaging).set(pkg.id, pkg),
    })),

  updatePackaging: (id, pkg) =>
    set((state) => {
      const packaging = new Map(state.packaging);
      if (pkg.id !== id) packaging.delete(id);
      packaging.set(pkg.id, pkg);
      return { packaging };
    }),

  removePackaging: (id) =>
    set((state) => {
      const packaging = new Map(state.packaging);
      packaging.delete(id);
      return { packaging };
    }),

  addTarget: (target) =>
    set((state) => ({
      targets: new Map(state.targets).set(target.id, target),
    })),

  updateTarget: (id, target) =>
    set((state) => {
      const targets = new Map(state.targets);
      if (target.id !== id) targets.delete(id);
      targets.set(target.id, target);
      return { targets };
    }),

  removeTarget: (id) =>
    set((state) => {
      const targets = new Map(state.targets);
      targets.delete(id);
      return { targets };
    }),
}));
