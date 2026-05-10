/**
 * Phase 1 cold-start functional tests for the new project context model.
 *
 * Each test creates a disposable project, exercises the relevant
 * automation commands (`contexts.model.get`, `contexts.templates.list`,
 * `contexts.templates.apply`), asserts on the response, then deletes
 * the project. No DOM interaction needed — the tests run via the
 * server-side automation API only.
 *
 * Tests:
 *   FT-COLDSTART-101 — empty project reports `present: false`
 *   FT-COLDSTART-102 — listing templates returns the registered set
 *   FT-COLDSTART-103 — applying json-validator template populates the model
 *   FT-COLDSTART-104 — applying twice without overwrite is rejected; with overwrite succeeds
 */

import type { TestModule } from '../test-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProjectMeta {
  id: string;
  name: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { getAccessToken } = await import('../../client/lib/auth.js');
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function createProject(name: string): Promise<ProjectMeta> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createProject ${name} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ProjectMeta;
}

async function deleteProject(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers,
  });
}

async function startWorkspace(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/start`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error(`startWorkspace failed: ${res.statusText}`);
}

async function waitForRunning(projectId: string, timeoutMs = 120_000): Promise<void> {
  const headers = await getAuthHeaders();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/status`, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'RUNNING') return;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`workspace not RUNNING after ${timeoutMs / 1000}s`);
}

interface AutomationEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function automationExec<T = unknown>(
  projectId: string,
  command: string,
  params: Record<string, unknown> = {},
): Promise<AutomationEnvelope<T>> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ command, params }),
  });
  return (await res.json()) as AutomationEnvelope<T>;
}

/** Create + start a fresh disposable project. Caller is responsible for deletion. */
async function withFreshProject(prefix: string): Promise<ProjectMeta> {
  const name = `__${prefix}_${Date.now()}`;
  const created = await createProject(name);
  await startWorkspace(created.id);
  await waitForRunning(created.id);
  return created;
}

// ---------------------------------------------------------------------------
// FT-COLDSTART-101 — empty project reports present: false
// ---------------------------------------------------------------------------

const emptyProjectPresentFalse: TestModule = {
  id: 'FT-COLDSTART-101',
  name: 'Empty project — contexts.model.get reports present: false',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshProject('cs101');
      projectId = project.id;

      const env = await automationExec<{ present: boolean; counts: { contexts: number } }>(
        projectId, 'contexts.model.get',
      );
      if (!env.ok || !env.data) {
        return { pass: false, detail: `contexts.model.get failed: ${env.error?.message ?? 'no data'}` };
      }
      if (env.data.present !== false) {
        return { pass: false, detail: `Expected present=false on fresh project, got ${env.data.present}` };
      }
      if (env.data.counts.contexts !== 0) {
        return { pass: false, detail: `Expected 0 contexts on fresh project, got ${env.data.counts.contexts}` };
      }
      return { pass: true, detail: 'Empty project correctly reports present: false' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-COLDSTART-102 — listing templates returns the registered set
// ---------------------------------------------------------------------------

const listTemplates: TestModule = {
  id: 'FT-COLDSTART-102',
  name: 'contexts.templates.list returns registered templates',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshProject('cs102');
      projectId = project.id;

      const env = await automationExec<{ templates: { id: string; name: string }[] }>(
        projectId, 'contexts.templates.list',
      );
      if (!env.ok || !env.data) {
        return { pass: false, detail: `contexts.templates.list failed: ${env.error?.message ?? 'no data'}` };
      }
      const ids = env.data.templates.map(t => t.id);
      const required = ['empty', 'json-validator'];
      for (const id of required) {
        if (!ids.includes(id)) {
          return { pass: false, detail: `Missing required template '${id}' in list: ${ids.join(', ')}` };
        }
      }
      return { pass: true, detail: `Templates listed: ${ids.join(', ')}` };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-COLDSTART-103 — applying json-validator template populates the model
// ---------------------------------------------------------------------------

const applyJsonValidatorTemplate: TestModule = {
  id: 'FT-COLDSTART-103',
  name: 'Apply json-validator template — model populated with expected nodes',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshProject('cs103');
      projectId = project.id;

      // Apply the template.
      const apply = await automationExec<{ writtenPaths: string[]; snapshot: { present: boolean; counts: { contexts: number } } }>(
        projectId,
        'contexts.templates.apply',
        { templateId: 'json-validator' },
      );
      if (!apply.ok || !apply.data) {
        return { pass: false, detail: `contexts.templates.apply failed: ${apply.error?.message ?? 'no data'}` };
      }
      const expectedPaths = ['.antimatter/resources.ts', '.antimatter/contexts.ts', '.antimatter/build.ts'];
      const missing = expectedPaths.filter(p => !apply.data!.writtenPaths.includes(p));
      if (missing.length > 0) {
        return { pass: false, detail: `Template did not write ${missing.join(', ')}` };
      }

      // Re-fetch the model to confirm it's loaded.
      const get = await automationExec<{
        present: boolean;
        contexts: { id: string }[];
        rules: { id: string }[];
        resources: { id: string }[];
        modelErrors: unknown[];
      }>(projectId, 'contexts.model.get');
      if (!get.ok || !get.data) {
        return { pass: false, detail: `contexts.model.get after apply failed: ${get.error?.message ?? 'no data'}` };
      }
      if (!get.data.present) {
        return { pass: false, detail: 'After applying template, model reports present=false' };
      }
      if (get.data.modelErrors.length > 0) {
        return { pass: false, detail: `Model errors after template apply: ${JSON.stringify(get.data.modelErrors)}` };
      }
      const ctxIds = get.data.contexts.map(c => c.id);
      const required = ['json-validator', 'implement-validator', 'implement-tests', 'publish'];
      for (const id of required) {
        if (!ctxIds.includes(id)) {
          return { pass: false, detail: `Missing context '${id}' after template apply (got: ${ctxIds.join(', ')})` };
        }
      }
      const ruleIds = get.data.rules.map(r => r.id);
      if (!ruleIds.includes('publish-bundle')) {
        return { pass: false, detail: `Missing rule 'publish-bundle' (got: ${ruleIds.join(', ')})` };
      }
      return {
        pass: true,
        detail: `Template applied: ${ctxIds.length} contexts, ${ruleIds.length} rules, ${get.data.resources.length} resources`,
      };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-COLDSTART-104 — re-applying refuses to overwrite, then succeeds with overwrite=true
// ---------------------------------------------------------------------------

const reapplyOverwrite: TestModule = {
  id: 'FT-COLDSTART-104',
  name: 'contexts.templates.apply refuses to overwrite, succeeds with overwrite flag',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshProject('cs104');
      projectId = project.id;

      // First apply — should succeed.
      const first = await automationExec(projectId, 'contexts.templates.apply', { templateId: 'json-validator' });
      if (!first.ok) {
        return { pass: false, detail: `First apply failed: ${first.error?.message}` };
      }

      // Second apply without overwrite — must fail with invalid-params.
      const second = await automationExec(projectId, 'contexts.templates.apply', { templateId: 'json-validator' });
      if (second.ok) {
        return { pass: false, detail: 'Second apply unexpectedly succeeded without overwrite=true' };
      }
      if (second.error?.code !== 'invalid-params') {
        return { pass: false, detail: `Expected invalid-params error, got ${second.error?.code}: ${second.error?.message}` };
      }

      // Third apply with overwrite — should succeed.
      const third = await automationExec(projectId, 'contexts.templates.apply', {
        templateId: 'json-validator',
        overwrite: true,
      });
      if (!third.ok) {
        return { pass: false, detail: `Apply with overwrite=true failed: ${third.error?.message}` };
      }

      return { pass: true, detail: 'Refuses overwrite by default; succeeds with overwrite=true' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const coldstartTests: readonly TestModule[] = [
  emptyProjectPresentFalse,
  listTemplates,
  applyJsonValidatorTemplate,
  reapplyOverwrite,
];
