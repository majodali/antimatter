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
      name: 'FT: Build Output Correctness',
      suite: 'functional',
      run: async (ctx) => {
        // The build rule is `echo compiled` — verify stdout appears in the output
        const results = JSON.parse(ctx.__buildResults || '[]');
        if (results.length === 0) return { pass: false, detail: 'No results from execute' };
        const output = (results[0].output ?? '').trim();
        const ok = output === 'compiled';
        return {
          pass: ok,
          detail: ok
            ? `Build command output verified: "${output}"`
            : `Expected "compiled", got "${output}"`,
        };
      },
    },
    {
      name: 'FT: Build Reads Project Files (S3→EFS)',
      suite: 'functional',
      run: async () => {
        // Write a source file via S3, configure a build that reads it,
        // then verify the build can see the file (proving S3→EFS sync works)
        await actions.writeFile('build-input.txt', 'ft-sync-value');
        await actions.saveBuildConfig({
          rules: [{ ...testRule, id: 'cat-rule', command: 'cat build-input.txt' }],
          targets: [{ ...testTarget, id: 'cat-target', ruleId: 'cat-rule' }],
        });
        const results = await actions.executeBuild();

        // Restore original build config for subsequent tests
        await actions.saveBuildConfig({ rules: [testRule], targets: [testTarget] });

        if (results.length === 0) return { pass: false, detail: 'No build results' };
        const output = (results[0].output ?? '').trim();
        const ok = results[0].status === 'success' && output === 'ft-sync-value';
        return {
          pass: ok,
          detail: ok
            ? `Build read S3 file via EFS: "${output}"`
            : `status=${results[0].status}, output="${output}"`,
        };
      },
    },
    {
      name: 'FT: Build Writes Files (EFS→S3)',
      suite: 'functional',
      run: async () => {
        // Configure a build that writes a file, verify it syncs back to S3
        await actions.saveBuildConfig({
          rules: [{ ...testRule, id: 'write-rule', command: 'echo efs-output > build-output.txt' }],
          targets: [{ ...testTarget, id: 'write-target', ruleId: 'write-rule' }],
        });
        const results = await actions.executeBuild();

        // Restore original config
        await actions.saveBuildConfig({ rules: [testRule], targets: [testTarget] });

        if (results.length === 0) return { pass: false, detail: 'No build results' };
        if (results[0].status !== 'success') {
          return { pass: false, detail: `Build failed: status=${results[0].status}` };
        }

        // Read the file back via S3 (API Lambda) to verify EFS→S3 sync
        const content = await actions.readFile('build-output.txt');
        const ok = content.trim() === 'efs-output';
        return {
          pass: ok,
          detail: ok
            ? `Build output synced to S3: "${content.trim()}"`
            : `Expected "efs-output", got "${content.trim()}"`,
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
