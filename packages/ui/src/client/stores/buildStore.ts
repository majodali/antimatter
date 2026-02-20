import { create } from 'zustand';
import type { BuildResult, BuildTarget, BuildRule, Diagnostic } from '@antimatter/project-model';
import { fetchBuildConfig, saveBuildConfig as saveBuildConfigApi } from '@/lib/api';

interface BuildState {
  // Build configuration
  targets: Map<string, BuildTarget>;
  rules: Map<string, BuildRule>;

  // Build results
  results: Map<string, BuildResult>;

  // Build output (streaming logs per target)
  buildOutput: Map<string, string[]>;

  // Watch mode
  watchMode: boolean;

  // UI state
  expandedTargets: Set<string>;
  configMode: boolean;

  // Actions
  setTargets: (targets: BuildTarget[]) => void;
  setRules: (rules: BuildRule[]) => void;
  setResult: (result: BuildResult) => void;
  setResults: (results: BuildResult[]) => void;
  clearResults: () => void;
  toggleExpanded: (targetId: string) => void;
  appendOutput: (targetId: string, line: string) => void;
  clearOutput: () => void;
  toggleWatchMode: () => void;
  setConfigMode: (mode: boolean) => void;

  // Config management
  loadConfig: (projectId?: string) => Promise<void>;
  saveConfig: (projectId?: string) => Promise<void>;
  addRule: (rule: BuildRule) => void;
  removeRule: (ruleId: string) => void;
  updateRule: (ruleId: string, rule: BuildRule) => void;
  addTarget: (target: BuildTarget) => void;
  removeTarget: (targetId: string) => void;
  updateTarget: (targetId: string, target: BuildTarget) => void;

  // Selectors
  getDiagnosticsForFile: (filePath: string) => Diagnostic[];
}

export const useBuildStore = create<BuildState>((set, get) => ({
  targets: new Map(),
  rules: new Map(),
  results: new Map(),
  buildOutput: new Map(),
  watchMode: false,
  expandedTargets: new Set(),
  configMode: false,

  setTargets: (targets) =>
    set({
      targets: new Map(targets.map((t) => [t.id, t])),
    }),

  setRules: (rules) =>
    set({
      rules: new Map(rules.map((r) => [r.id, r])),
    }),

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
      buildOutput: new Map(),
      expandedTargets: new Set(),
    }),

  toggleExpanded: (targetId) =>
    set((state) => {
      const expanded = new Set(state.expandedTargets);
      if (expanded.has(targetId)) {
        expanded.delete(targetId);
      } else {
        expanded.add(targetId);
      }
      return { expandedTargets: expanded };
    }),

  appendOutput: (targetId, line) =>
    set((state) => {
      const output = new Map(state.buildOutput);
      const existing = output.get(targetId) || [];
      output.set(targetId, [...existing, line]);
      return { buildOutput: output };
    }),

  clearOutput: () => set({ buildOutput: new Map() }),

  toggleWatchMode: () => set((state) => ({ watchMode: !state.watchMode })),

  setConfigMode: (mode) => set({ configMode: mode }),

  loadConfig: async (projectId?: string) => {
    try {
      const config = await fetchBuildConfig(projectId);
      set({
        rules: new Map(config.rules.map((r) => [r.id, r])),
        targets: new Map(config.targets.map((t) => [t.id, t])),
      });
    } catch (err) {
      console.error('Failed to load build config:', err);
    }
  },

  saveConfig: async (projectId?: string) => {
    const state = get();
    try {
      await saveBuildConfigApi(
        {
          rules: Array.from(state.rules.values()),
          targets: Array.from(state.targets.values()),
        },
        projectId,
      );
    } catch (err) {
      console.error('Failed to save build config:', err);
    }
  },

  addRule: (rule) =>
    set((state) => ({
      rules: new Map(state.rules).set(rule.id, rule),
    })),

  removeRule: (ruleId) =>
    set((state) => {
      const rules = new Map(state.rules);
      rules.delete(ruleId);
      return { rules };
    }),

  updateRule: (ruleId, rule) =>
    set((state) => ({
      rules: new Map(state.rules).set(ruleId, rule),
    })),

  addTarget: (target) =>
    set((state) => ({
      targets: new Map(state.targets).set(target.id, target),
    })),

  removeTarget: (targetId) =>
    set((state) => {
      const targets = new Map(state.targets);
      targets.delete(targetId);
      return { targets };
    }),

  updateTarget: (targetId, target) =>
    set((state) => ({
      targets: new Map(state.targets).set(targetId, target),
    })),

  getDiagnosticsForFile: (filePath: string) => {
    const state = get();
    const diagnostics: Diagnostic[] = [];
    for (const result of state.results.values()) {
      for (const diag of result.diagnostics) {
        if (diag.file === filePath || diag.file.endsWith(filePath) || filePath.endsWith(diag.file)) {
          diagnostics.push(diag);
        }
      }
    }
    return diagnostics;
  },
}));
