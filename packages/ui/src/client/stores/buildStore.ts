import { create } from 'zustand';
import type { BuildResult, BuildRule, Diagnostic } from '@antimatter/project-model';
import { fetchBuildConfig, saveBuildConfig as saveBuildConfigApi } from '@/lib/api';
import { eventLog } from '@/lib/eventLog';

interface BuildState {
  // Build configuration
  rules: Map<string, BuildRule>;

  // Build results
  results: Map<string, BuildResult>;

  // Build output (streaming logs per rule)
  buildOutput: Map<string, string[]>;

  // UI state
  expandedRules: Set<string>;
  configMode: boolean;

  // Actions
  setRules: (rules: BuildRule[]) => void;
  setResult: (result: BuildResult) => void;
  setResults: (results: BuildResult[]) => void;
  clearResults: () => void;
  toggleExpanded: (ruleId: string) => void;
  appendOutput: (ruleId: string, line: string) => void;
  clearOutput: () => void;
  setConfigMode: (mode: boolean) => void;

  // Config management
  loadConfig: (projectId?: string) => Promise<void>;
  saveConfig: (projectId?: string) => Promise<void>;
  addRule: (rule: BuildRule) => void;
  removeRule: (ruleId: string) => void;
  updateRule: (ruleId: string, rule: BuildRule) => void;

  // Selectors
  getDiagnosticsForFile: (filePath: string) => Diagnostic[];
}

export const useBuildStore = create<BuildState>((set, get) => ({
  rules: new Map(),
  results: new Map(),
  buildOutput: new Map(),
  expandedRules: new Set(),
  configMode: false,

  setRules: (rules) =>
    set({
      rules: new Map(rules.map((r) => [r.id, r])),
    }),

  setResult: (result) =>
    set((state) => ({
      results: new Map(state.results).set(result.ruleId, result),
    })),

  setResults: (results) =>
    set({
      results: new Map(results.map((r) => [r.ruleId, r])),
    }),

  clearResults: () =>
    set({
      results: new Map(),
      buildOutput: new Map(),
      expandedRules: new Set(),
    }),

  toggleExpanded: (ruleId) =>
    set((state) => {
      const expanded = new Set(state.expandedRules);
      if (expanded.has(ruleId)) {
        expanded.delete(ruleId);
      } else {
        expanded.add(ruleId);
      }
      return { expandedRules: expanded };
    }),

  appendOutput: (ruleId, line) =>
    set((state) => {
      const output = new Map(state.buildOutput);
      const existing = output.get(ruleId) || [];
      output.set(ruleId, [...existing, line]);
      return { buildOutput: output };
    }),

  clearOutput: () => set({ buildOutput: new Map() }),

  setConfigMode: (mode) => set({ configMode: mode }),

  loadConfig: async (projectId?: string) => {
    try {
      const config = await fetchBuildConfig(projectId);
      set({
        rules: new Map(config.rules.map((r) => [r.id, r])),
      });
    } catch (err) {
      eventLog.error('build', 'Failed to load build config', String(err));
    }
  },

  saveConfig: async (projectId?: string) => {
    const state = get();
    try {
      await saveBuildConfigApi(
        {
          rules: Array.from(state.rules.values()),
        },
        projectId,
      );
    } catch (err) {
      eventLog.error('build', 'Failed to save build config', String(err));
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
    set((state) => {
      const rules = new Map(state.rules);
      if (rule.id !== ruleId) {
        rules.delete(ruleId);
      }
      rules.set(rule.id, rule);
      return { rules };
    }),

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
