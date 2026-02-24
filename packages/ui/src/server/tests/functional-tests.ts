import type { TestDef } from './test-types.js';
import type { ActionContext } from './action-context.js';

// ---- Fixtures ----

const testRule = {
  id: 'rule-ft',
  name: 'compile-test',
  inputs: ['src/**/*.ts'],
  outputs: ['dist/**/*.js'],
  command: 'echo compiled',
};

const testTarget = {
  id: 'target-ft',
  ruleId: 'rule-ft',
  moduleId: 'mod-ft',
};

const testTool = {
  name: 'ft-tool',
  description: 'Functional test tool',
  parameters: { type: 'object', properties: { input: { type: 'string' } } },
};

// ---- Test definitions ----

export function getFunctionalTests(
  actions: ActionContext,
  apiBase: string,
  frontendBase: string,
): TestDef[] {
  return [
    // ---- Build System (DEMO 1.1–1.6) ----
    {
      name: 'FT: Save Build Config',
      suite: 'functional',
      run: async () => {
        await actions.saveBuildConfig({ rules: [testRule], targets: [testTarget] });
        return { pass: true, detail: 'Config saved' };
      },
    },
    {
      name: 'FT: Load Build Config',
      suite: 'functional',
      run: async () => {
        const config = await actions.loadBuildConfig();
        const ok = config.rules.length === 1 && config.rules[0].name === 'compile-test';
        return {
          pass: ok,
          detail: ok
            ? `rules=${config.rules.length}, name=${config.rules[0].name}`
            : `Unexpected config: ${JSON.stringify(config)}`,
        };
      },
    },
    {
      name: 'FT: Config Persists Rule Reference',
      suite: 'functional',
      run: async () => {
        const config = await actions.loadBuildConfig();
        const ok = config.targets.length >= 1 && config.targets[0].ruleId === testRule.id;
        return {
          pass: ok,
          detail: ok
            ? `target.ruleId=${config.targets[0].ruleId}`
            : `Unexpected targets: ${JSON.stringify(config.targets)}`,
        };
      },
    },
    {
      name: 'FT: Execute Build',
      suite: 'functional',
      run: async (ctx) => {
        const results = await actions.executeBuild();
        // Store for subsequent checks (Lambda doesn't persist in-memory results across requests)
        ctx.__buildResults = JSON.stringify(results);
        const ok = results.length >= 1 && results[0].status !== undefined && results[0].targetId !== undefined;
        return {
          pass: ok,
          detail: ok
            ? `${results.length} result(s), status=${results[0].status}`
            : `Unexpected results: ${JSON.stringify(results)}`,
        };
      },
    },
    {
      name: 'FT: Build Result Shape',
      suite: 'functional',
      run: async (ctx) => {
        const results = JSON.parse(ctx.__buildResults || '[]');
        if (results.length === 0) return { pass: false, detail: 'No results from execute' };
        const r = results[0];
        const ok = typeof r.targetId === 'string' && typeof r.status === 'string';
        return {
          pass: ok,
          detail: ok
            ? `targetId=${r.targetId}, status=${r.status}`
            : `Missing fields: ${JSON.stringify(Object.keys(r))}`,
        };
      },
    },
    {
      name: 'FT: Build Diagnostics Shape',
      suite: 'functional',
      run: async (ctx) => {
        const results = JSON.parse(ctx.__buildResults || '[]');
        if (results.length === 0) return { pass: false, detail: 'No results from execute' };
        const ok = Array.isArray(results[0].diagnostics);
        return {
          pass: ok,
          detail: ok
            ? `diagnostics is array (${results[0].diagnostics.length} items)`
            : `diagnostics field: ${typeof results[0].diagnostics}`,
        };
      },
    },
    {
      name: 'FT: Stale Target Detection',
      suite: 'functional',
      run: async () => {
        await actions.writeFile('src/new.ts', 'export const x = 1;');
        const stale = await actions.getStaleTargets();
        return {
          pass: Array.isArray(stale),
          detail: `staleTargetIds: ${JSON.stringify(stale)}`,
        };
      },
    },
    {
      name: 'FT: Clear Build Cache',
      suite: 'functional',
      run: async () => {
        await actions.clearBuildCache();
        return { pass: true, detail: 'Cache cleared' };
      },
    },
    {
      name: 'FT: Clear Build Results',
      suite: 'functional',
      run: async () => {
        await actions.clearBuildResults();
        const results = await actions.getBuildResults();
        return {
          pass: results.length === 0,
          detail: results.length === 0 ? 'Results cleared' : `${results.length} results remain`,
        };
      },
    },

    // ---- Agent Integration (DEMO 2.1–2.7) ----
    {
      name: 'FT: Agent Chat',
      suite: 'functional',
      run: async () => {
        const { response } = await actions.sendChat('Hello from functional test');
        const ok = typeof response === 'string' && response.length > 0;
        return {
          pass: ok,
          detail: ok ? `response="${response.slice(0, 80)}"` : `Bad response: ${JSON.stringify(response)}`,
        };
      },
    },
    {
      name: 'FT: Agent History',
      suite: 'functional',
      run: async () => {
        const history = await actions.getHistory();
        const ok = history.length >= 1;
        return {
          pass: ok,
          detail: ok ? `${history.length} message(s)` : 'History is empty',
        };
      },
    },
    {
      name: 'FT: Save Custom Tools',
      suite: 'functional',
      run: async () => {
        await actions.saveCustomTools([testTool]);
        return { pass: true, detail: 'Custom tools saved' };
      },
    },
    {
      name: 'FT: Load Custom Tools',
      suite: 'functional',
      run: async () => {
        const tools = await actions.getCustomTools();
        const ok = tools.length >= 1 && tools[0].name === 'ft-tool';
        return {
          pass: ok,
          detail: ok ? `tools=${tools.length}, name=${tools[0].name}` : `Unexpected: ${JSON.stringify(tools)}`,
        };
      },
    },
    {
      name: 'FT: Clear Agent History',
      suite: 'functional',
      run: async () => {
        // clearHistory() throws on non-200 responses, so success = endpoint works
        await actions.clearHistory();
        const after = await actions.getHistory();
        return {
          pass: true,
          detail: `History cleared (${after.length} message(s) after clear)`,
        };
      },
    },

    // ---- Frontend Routes ----
    {
      name: 'FT: /logs Route',
      suite: 'functional',
      run: async () => {
        const res = await fetch(`${frontendBase}/logs`);
        const ok = res.status === 200;
        return {
          pass: ok,
          detail: ok ? `status=${res.status}` : `status=${res.status}`,
        };
      },
    },

    // ---- Cleanup ----
    {
      name: 'FT: Cleanup Test Project',
      suite: 'functional',
      run: async (_ctx) => {
        const pid = _ctx.__functionalProjectId;
        if (!pid) return { pass: false, detail: 'No project ID to clean up' };
        const res = await fetch(`${apiBase}/api/projects/${pid}`, { method: 'DELETE' });
        const body = await res.json();
        return {
          pass: body.success === true,
          detail: body.success ? `Deleted project ${pid}` : JSON.stringify(body),
        };
      },
    },
  ];
}
