import { create } from 'zustand';
import type { BuildResult, BuildTarget, BuildRule } from '@antimatter/project-model';

interface BuildState {
  // Build configuration
  targets: Map<string, BuildTarget>;
  rules: Map<string, BuildRule>;

  // Build results
  results: Map<string, BuildResult>;

  // UI state
  expandedTargets: Set<string>;

  // Actions
  setTargets: (targets: BuildTarget[]) => void;
  setRules: (rules: BuildRule[]) => void;
  setResult: (result: BuildResult) => void;
  setResults: (results: BuildResult[]) => void;
  clearResults: () => void;
  toggleExpanded: (targetId: string) => void;
}

export const useBuildStore = create<BuildState>((set) => ({
  targets: new Map(),
  rules: new Map(),
  results: new Map(),
  expandedTargets: new Set(),

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
}));
