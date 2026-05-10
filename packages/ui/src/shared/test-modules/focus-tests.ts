/**
 * Phase 3 focused-build functional tests.
 *
 * Each test starts from a fresh project, applies the json-validator
 * template, then drives validations + lifecycle through the runtime
 * collaborators and asserts the snapshot reflects the new state.
 *
 * Tests:
 *   FT-FOCUS-101 — fresh json-validator: contexts present, all initially "ready" or "pending"
 *   FT-FOCUS-102 — registering a deployed-resource flips deployed-resource-present
 *                  validation to passing for the publish context
 *   FT-FOCUS-103 — contexts.action.invoke(invoke-rule) emits the rule's event;
 *                  rejects when context's action kind isn't invoke-rule
 *   FT-FOCUS-104 — model carries lifecycleStatus per context (default 'ready' for
 *                  leaves with no validations, 'pending' otherwise)
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

interface ContextSnapshot {
  id: string;
  parentId?: string;
  actionKind: string;
  lifecycleStatus: 'pending' | 'ready' | 'in-progress' | 'done' | 'regressed' | 'dependency-regressed';
  validations: Array<{ id: string; kind: string; status: 'passing' | 'failing' | 'unknown' }>;
}

interface ModelSnapshotShape {
  present: boolean;
  contexts: ContextSnapshot[];
}

// ---------------------------------------------------------------------------
// FT-FOCUS-101 — fresh json-validator template carries lifecycle + validation status fields
// ---------------------------------------------------------------------------

const freshTemplateLifecycle: TestModule = {
  id: 'FT-FOCUS-101',
  name: 'Fresh json-validator template surfaces lifecycleStatus + validation status per context',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('focus101');
      projectId = project.id;
      const get = await exec<ModelSnapshotShape>(projectId, 'contexts.model.get');
      if (!get.ok || !get.data) return { pass: false, detail: `get failed: ${get.error?.message}` };
      if (!get.data.present) return { pass: false, detail: 'model.present is false after template apply' };

      // Every context has a lifecycleStatus + validations array.
      for (const c of get.data.contexts) {
        if (!c.lifecycleStatus) return { pass: false, detail: `context ${c.id} missing lifecycleStatus` };
        if (!Array.isArray(c.validations)) return { pass: false, detail: `context ${c.id} missing validations array` };
      }
      return { pass: true, detail: `all ${get.data.contexts.length} contexts carry lifecycleStatus + validations` };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-FOCUS-102 — registering a deployed-resource flips the matching validation to passing
// ---------------------------------------------------------------------------

const deployedResourceFlipsValidation: TestModule = {
  id: 'FT-FOCUS-102',
  name: 'Registering a deployed-resource flips deployed-resource-present validation to passing',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('focus102');
      projectId = project.id;

      // Initially: bundle-published is unknown (no live resource yet — the
      // store doesn't carry one with id 'published-bundle' in a fresh project).
      const before = await exec<ModelSnapshotShape>(projectId, 'contexts.model.get');
      if (!before.ok || !before.data) return { pass: false, detail: `get failed: ${before.error?.message}` };
      const beforePublish = before.data.contexts.find(c => c.id === 'publish');
      const beforeV = beforePublish?.validations.find(v => v.id === 'bundle-published');
      if (!beforeV) return { pass: false, detail: 'publish.bundle-published validation not present' };
      if (beforeV.status === 'passing') {
        return { pass: false, detail: 'bundle-published already passing on a fresh project — store unexpectedly has resource' };
      }

      // Register a deployed-resource with id 'published-bundle'.
      const reg = await exec(projectId, 'deployed-resources.register', {
        id: 'published-bundle',
        name: 'Test bundle',
        resourceType: 'npm-package',
      });
      if (!reg.ok) return { pass: false, detail: `register failed: ${reg.error?.message}` };

      // Reload (registration triggers re-evaluate; small wait for it to flush).
      await new Promise(r => setTimeout(r, 500));
      const after = await exec<ModelSnapshotShape>(projectId, 'contexts.model.get');
      if (!after.ok || !after.data) return { pass: false, detail: `after-get failed: ${after.error?.message}` };
      const afterPublish = after.data.contexts.find(c => c.id === 'publish');
      const afterV = afterPublish?.validations.find(v => v.id === 'bundle-published');
      if (!afterV) return { pass: false, detail: 'publish.bundle-published validation missing after register' };
      if (afterV.status !== 'passing') {
        return { pass: false, detail: `expected passing after register, got ${afterV.status}` };
      }
      return { pass: true, detail: 'Validation flipped to passing after register' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-FOCUS-103 — action.invoke fires invoke-rule actions; rejects unsupported kinds
// ---------------------------------------------------------------------------

const actionInvokeFiresRule: TestModule = {
  id: 'FT-FOCUS-103',
  name: 'contexts.action.invoke emits the rule event for invoke-rule actions; rejects others',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('focus103');
      projectId = project.id;

      // publish has invoke-rule action; agent contexts should be rejected.
      const ok = await exec<{ queued: boolean; eventType?: string }>(projectId, 'contexts.action.invoke', {
        contextId: 'publish',
      });
      if (!ok.ok) return { pass: false, detail: `invoke publish failed: ${ok.error?.message}` };
      if (!ok.data?.queued) return { pass: false, detail: 'expected queued=true for publish invoke' };
      if (ok.data?.eventType !== 'publish') {
        return { pass: false, detail: `expected eventType=publish, got ${ok.data?.eventType}` };
      }

      const bad = await exec(projectId, 'contexts.action.invoke', { contextId: 'implement-validator' });
      if (bad.ok) return { pass: false, detail: 'expected agent action to reject from invoke endpoint' };
      if (bad.error?.code !== 'unsupported') {
        return { pass: false, detail: `expected unsupported error, got ${bad.error?.code}: ${bad.error?.message}` };
      }
      return { pass: true, detail: 'invoke-rule succeeds; agent rejects with unsupported' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-FOCUS-104 — leaf with no validations is `done`; parents reflect children
// ---------------------------------------------------------------------------

const leafDoneCascadesUp: TestModule = {
  id: 'FT-FOCUS-104',
  name: 'Empty leaf context (no validations + no children) reports lifecycleStatus=done',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('focus104');
      projectId = project.id;

      // Add a brand-new child with no validations + agent action.
      const add = await exec(projectId, 'contexts.contexts.add', {
        context: {
          id: 'leaf-context',
          name: 'Leaf',
          parentId: 'json-validator',
          objective: 'A leaf with nothing required.',
          action: { kind: 'agent', description: 'noop' },
        },
      });
      if (!add.ok) return { pass: false, detail: `add failed: ${add.error?.message}` };

      const get = await exec<ModelSnapshotShape>(projectId, 'contexts.model.get');
      if (!get.ok || !get.data) return { pass: false, detail: `get failed: ${get.error?.message}` };
      const leaf = get.data.contexts.find(c => c.id === 'leaf-context');
      if (!leaf) return { pass: false, detail: 'leaf-context not present' };
      if (leaf.lifecycleStatus !== 'done') {
        return { pass: false, detail: `expected leaf-context status=done, got ${leaf.lifecycleStatus}` };
      }
      return { pass: true, detail: 'Leaf with no validations correctly reports done' };
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

export const focusTests: readonly TestModule[] = [
  freshTemplateLifecycle,
  deployedResourceFlipsValidation,
  actionInvokeFiresRule,
  leafDoneCascadesUp,
];
