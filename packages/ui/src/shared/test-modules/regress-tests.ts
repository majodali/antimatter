/**
 * Phase 5 regression-triage functional tests. Each induces a failure
 * scenario and verifies `contexts.regression.trace` returns the
 * expected explanation.
 *
 *   FT-REGRESS-101 — fresh project: trace for a publish context lists the
 *                    deployed-resource-present validation as failing
 *   FT-REGRESS-102 — registering a resource removes the failure;
 *                    de-registering puts it back
 *   FT-REGRESS-103 — trace for a known-bogus context id returns 404
 *
 * Identifiers in the FT-REGRESS-001..010 range cover the unit tests in
 * trace.spec.ts; the 100-series here is the API surface.
 */

import type { TestModule } from '../test-types.js';

interface ProjectMeta { id: string; name: string; }

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { getAccessToken } = await import('../../client/lib/auth.js');
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function createProject(name: string): Promise<ProjectMeta> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/projects', { method: 'POST', headers, body: JSON.stringify({ name }) });
  if (!res.ok) throw new Error(`createProject failed: ${res.status}`);
  return (await res.json()) as ProjectMeta;
}

async function deleteProject(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', headers });
}

async function startWorkspace(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/start`, { method: 'POST', headers });
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

interface Envelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function exec<T = unknown>(projectId: string, command: string, params: Record<string, unknown> = {}): Promise<Envelope<T>> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
    method: 'POST', headers, body: JSON.stringify({ command, params }),
  });
  return (await res.json()) as Envelope<T>;
}

async function withTemplated(prefix: string): Promise<ProjectMeta> {
  const name = `__${prefix}_${Date.now()}`;
  const project = await createProject(name);
  await startWorkspace(project.id);
  await waitForRunning(project.id);
  const apply = await exec(project.id, 'contexts.templates.apply', { templateId: 'json-validator' });
  if (!apply.ok) throw new Error(`template apply failed: ${apply.error?.message}`);
  return project;
}

interface TraceShape {
  contextId: string;
  status: string;
  hasOwnFailures: boolean;
  validationFailures: Array<{ validationId: string; kind: string }>;
  childBlockers: Array<{ contextId: string; status: string }>;
  dependencyCulprits: Array<{ contextId: string; status: string; path: string[] }>;
}

// ---------------------------------------------------------------------------
// FT-REGRESS-101 — publish context's failing deployed-resource validation surfaces
// ---------------------------------------------------------------------------

const tracePublishMissingDeployed: TestModule = {
  id: 'FT-REGRESS-101',
  name: 'Publish context with no deployed-resource yields a deployed-resource-present failure row',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('regress101');
      projectId = project.id;

      const trace = await exec<TraceShape>(projectId, 'contexts.regression.trace', { contextId: 'publish' });
      if (!trace.ok || !trace.data) return { pass: false, detail: `trace failed: ${trace.error?.message}` };

      const drp = trace.data.validationFailures.find(f => f.kind === 'deployed-resource-present');
      if (!drp) return { pass: false, detail: `no deployed-resource-present row: ${JSON.stringify(trace.data.validationFailures)}` };
      if (drp.validationId !== 'bundle-published') {
        return { pass: false, detail: `expected validationId=bundle-published, got ${drp.validationId}` };
      }
      return { pass: true, detail: `Trace surfaces ${drp.validationId} as failing` };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-REGRESS-102 — registering then deregistering toggles the failure
// ---------------------------------------------------------------------------

const traceTogglesOnRegistration: TestModule = {
  id: 'FT-REGRESS-102',
  name: 'Trace removes the deployed-resource failure after register, returns it after deregister',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('regress102');
      projectId = project.id;

      // Register the deployed-resource — failure should clear.
      const reg = await exec(projectId, 'deployed-resources.register', {
        id: 'published-bundle', name: 'Test bundle', resourceType: 'npm-package',
      });
      if (!reg.ok) return { pass: false, detail: `register failed: ${reg.error?.message}` };
      await new Promise(r => setTimeout(r, 500));

      const after = await exec<TraceShape>(projectId, 'contexts.regression.trace', { contextId: 'publish' });
      if (!after.ok || !after.data) return { pass: false, detail: `after-register trace failed: ${after.error?.message}` };
      if (after.data.validationFailures.some(f => f.kind === 'deployed-resource-present')) {
        return { pass: false, detail: `expected deployed-resource-present to clear after register` };
      }

      // Deregister — failure should return.
      const dereg = await exec(projectId, 'deployed-resources.deregister', { resourceId: 'published-bundle' });
      if (!dereg.ok) return { pass: false, detail: `deregister failed: ${dereg.error?.message}` };
      await new Promise(r => setTimeout(r, 500));

      const back = await exec<TraceShape>(projectId, 'contexts.regression.trace', { contextId: 'publish' });
      if (!back.ok || !back.data) return { pass: false, detail: `after-deregister trace failed: ${back.error?.message}` };
      if (!back.data.validationFailures.some(f => f.kind === 'deployed-resource-present')) {
        return { pass: false, detail: `expected deployed-resource-present to return after deregister` };
      }
      return { pass: true, detail: 'Trace toggles correctly with register/deregister' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-REGRESS-103 — unknown context returns 404
// ---------------------------------------------------------------------------

const traceUnknownContext: TestModule = {
  id: 'FT-REGRESS-103',
  name: 'contexts.regression.trace returns not-found for an unknown context id',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('regress103');
      projectId = project.id;

      const trace = await exec(projectId, 'contexts.regression.trace', { contextId: 'no-such-context' });
      if (trace.ok) return { pass: false, detail: `expected failure for unknown id, got ok` };
      if (trace.error?.code !== 'not-found') {
        return { pass: false, detail: `expected not-found, got ${trace.error?.code}: ${trace.error?.message}` };
      }
      return { pass: true, detail: 'Unknown context id reported as not-found' };
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

export const regressTests: readonly TestModule[] = [
  tracePublishMissingDeployed,
  traceTogglesOnRegistration,
  traceUnknownContext,
];
