/**
 * Phase 4 status-check / orient functional tests.
 *
 * Tests verify the snapshot's enriched status fields:
 *   - counts.byStatus per lifecycle bucket
 *   - recentTransitions ring buffer captures real transitions
 *   - activityLog records context:transitioned events
 *
 * FT-STATUS-101 — counts.byStatus is populated and totals to counts.contexts
 * FT-STATUS-102 — registering a deployed-resource captures a transition
 * FT-STATUS-103 — context:transitioned shows up in activity.list
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

interface ModelSnapshot {
  present: boolean;
  counts: {
    contexts: number;
    byStatus: Record<string, number>;
  };
  recentTransitions: Array<{ contextId: string; from: string | null; to: string; at: string }>;
}

// ---------------------------------------------------------------------------
// FT-STATUS-101 — counts.byStatus totals match counts.contexts
// ---------------------------------------------------------------------------

const byStatusTotalsConsistent: TestModule = {
  id: 'FT-STATUS-101',
  name: 'counts.byStatus sums to counts.contexts (every context bucketed exactly once)',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('status101');
      projectId = project.id;

      const get = await exec<ModelSnapshot>(projectId, 'contexts.model.get');
      if (!get.ok || !get.data) return { pass: false, detail: `get failed: ${get.error?.message}` };

      const total = get.data.counts.contexts;
      const sum = Object.values(get.data.counts.byStatus).reduce((a, b) => a + b, 0);
      if (sum !== total) {
        return { pass: false, detail: `byStatus sum=${sum} ≠ contexts count=${total}: ${JSON.stringify(get.data.counts.byStatus)}` };
      }
      // Sanity: at least one context exists (the json-validator template adds 4).
      if (total === 0) return { pass: false, detail: 'no contexts after template apply' };
      return { pass: true, detail: `byStatus totals to ${total} contexts: ${JSON.stringify(get.data.counts.byStatus)}` };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-STATUS-102 — registering a deployed-resource captures a transition
// ---------------------------------------------------------------------------

const registerCapturesTransition: TestModule = {
  id: 'FT-STATUS-102',
  name: 'Registering a deployed-resource yields a recent transition for the publish context',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('status102');
      projectId = project.id;

      // Snapshot transitions count before.
      const before = await exec<ModelSnapshot>(projectId, 'contexts.model.get');
      if (!before.ok || !before.data) return { pass: false, detail: `before-get failed: ${before.error?.message}` };
      const beforeCount = before.data.recentTransitions.length;

      // Register a deployed-resource matching the validation's resourceId.
      const reg = await exec(projectId, 'deployed-resources.register', {
        id: 'published-bundle',
        name: 'Test bundle',
        resourceType: 'npm-package',
      });
      if (!reg.ok) return { pass: false, detail: `register failed: ${reg.error?.message}` };
      // Re-evaluate is fired fire-and-forget; small wait for it to flush.
      await new Promise(r => setTimeout(r, 500));

      const after = await exec<ModelSnapshot>(projectId, 'contexts.model.get');
      if (!after.ok || !after.data) return { pass: false, detail: `after-get failed: ${after.error?.message}` };
      if (after.data.recentTransitions.length <= beforeCount) {
        return { pass: false, detail: `expected new transitions; before=${beforeCount}, after=${after.data.recentTransitions.length}` };
      }
      // The publish context's lifecycle should have moved (most-recent-first; look in the head).
      const publishMoved = after.data.recentTransitions.find(t => t.contextId === 'publish');
      if (!publishMoved) {
        return { pass: false, detail: `no transition for 'publish' in ${JSON.stringify(after.data.recentTransitions.map(t => t.contextId))}` };
      }
      return { pass: true, detail: `Captured transition for publish: ${publishMoved.from ?? '∅'} → ${publishMoved.to}` };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-STATUS-103 — context:transitioned event reaches activity.list
// ---------------------------------------------------------------------------

const transitionInActivityLog: TestModule = {
  id: 'FT-STATUS-103',
  name: 'context:transitioned events show up in activity.list',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('status103');
      projectId = project.id;

      // Trigger a transition by registering a deployed-resource.
      const reg = await exec(projectId, 'deployed-resources.register', {
        id: 'published-bundle',
        name: 'Test bundle',
        resourceType: 'npm-package',
      });
      if (!reg.ok) return { pass: false, detail: `register failed: ${reg.error?.message}` };
      await new Promise(r => setTimeout(r, 500));

      const events = await exec<{ events: Array<{ kind: string; correlationId?: string; data?: unknown }> }>(
        projectId, 'activity.list', { kind: 'context:transitioned', limit: 50 },
      );
      if (!events.ok || !events.data) return { pass: false, detail: `activity.list failed: ${events.error?.message}` };
      const transitionEvents = events.data.events.filter(e => e.kind === 'context:transitioned');
      if (transitionEvents.length === 0) {
        return { pass: false, detail: 'no context:transitioned events in activity.list' };
      }
      return { pass: true, detail: `Found ${transitionEvents.length} context:transitioned event(s) in activity log` };
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

export const statusTests: readonly TestModule[] = [
  byStatusTotalsConsistent,
  registerCapturesTransition,
  transitionInActivityLog,
];
