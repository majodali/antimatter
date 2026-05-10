/**
 * Phase 2 decompose / manual-authoring functional tests.
 *
 * Each test starts from a fresh disposable project, applies the
 * json-validator template, and exercises one of the new
 * "contexts.contexts.add" / "contexts.resources.add" /
 * "contexts.rules.add" automation commands. Verifies the resulting
 * model contains the new declaration and that direct edits are
 * picked up via the file-change broadcast.
 *
 * Tests:
 *   FT-DECOMP-101 — add a context as a child of an existing one
 *   FT-DECOMP-102 — add a resource (file-set) and verify it loads
 *   FT-DECOMP-103 — add a rule with reads/writes and verify the model wires it
 *   FT-DECOMP-104 — add commands surface invalid-params on bad ids
 *   FT-DECOMP-105 — direct edit to .antimatter/contexts.ts triggers a reload
 */

import type { TestModule } from '../test-types.js';

// ---------------------------------------------------------------------------
// Helpers (duplicated from coldstart-tests.ts; could be hoisted later)
// ---------------------------------------------------------------------------

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
  const res = await fetch('/api/projects', {
    method: 'POST', headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createProject ${name} failed: ${res.status} ${await res.text()}`);
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

interface AutomationEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function exec<T = unknown>(projectId: string, command: string, params: Record<string, unknown> = {}): Promise<AutomationEnvelope<T>> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
    method: 'POST', headers,
    body: JSON.stringify({ command, params }),
  });
  return (await res.json()) as AutomationEnvelope<T>;
}

async function withFreshTemplatedProject(prefix: string): Promise<ProjectMeta> {
  const name = `__${prefix}_${Date.now()}`;
  const project = await createProject(name);
  await startWorkspace(project.id);
  await waitForRunning(project.id);
  const apply = await exec(project.id, 'contexts.templates.apply', { templateId: 'json-validator' });
  if (!apply.ok) throw new Error(`template apply failed: ${apply.error?.message}`);
  return project;
}

// ---------------------------------------------------------------------------
// FT-DECOMP-101 — add a context as a child of an existing one
// ---------------------------------------------------------------------------

const addChildContext: TestModule = {
  id: 'FT-DECOMP-101',
  name: 'contexts.contexts.add — append a child context to an existing tree',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshTemplatedProject('decomp101');
      projectId = project.id;

      const add = await exec(projectId, 'contexts.contexts.add', {
        context: {
          id: 'documentation',
          name: 'Documentation',
          parentId: 'json-validator',
          objective: 'Write user-facing docs for the validator API.',
          action: { kind: 'agent', description: 'Draft README and API reference' },
        },
      });
      if (!add.ok) return { pass: false, detail: `add failed: ${add.error?.message}` };

      const get = await exec<{ contexts: { id: string; parentId?: string }[]; modelErrors: unknown[] }>(
        projectId, 'contexts.model.get',
      );
      if (!get.ok || !get.data) return { pass: false, detail: `get failed: ${get.error?.message ?? 'no data'}` };
      if (get.data.modelErrors.length > 0) {
        return { pass: false, detail: `model errors after add: ${JSON.stringify(get.data.modelErrors)}` };
      }
      const newCtx = get.data.contexts.find(c => c.id === 'documentation');
      if (!newCtx) return { pass: false, detail: `'documentation' not in contexts: ${get.data.contexts.map(c => c.id).join(', ')}` };
      if (newCtx.parentId !== 'json-validator') return { pass: false, detail: `parentId wrong: ${newCtx.parentId}` };

      return { pass: true, detail: 'Child context added; tree wires it under json-validator' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-DECOMP-102 — add a resource and verify it loads
// ---------------------------------------------------------------------------

const addFileSetResource: TestModule = {
  id: 'FT-DECOMP-102',
  name: 'contexts.resources.add — append a file-set resource',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshTemplatedProject('decomp102');
      projectId = project.id;

      const add = await exec(projectId, 'contexts.resources.add', {
        kind: 'file-set',
        resource: {
          id: 'docs',
          name: 'Documentation files',
          include: ['docs/**/*.md'],
        },
      });
      if (!add.ok) return { pass: false, detail: `add failed: ${add.error?.message}` };

      const get = await exec<{ resources: { id: string; kind: string }[]; modelErrors: unknown[] }>(
        projectId, 'contexts.model.get',
      );
      if (!get.ok || !get.data) return { pass: false, detail: `get failed: ${get.error?.message ?? 'no data'}` };
      if (get.data.modelErrors.length > 0) return { pass: false, detail: `model errors: ${JSON.stringify(get.data.modelErrors)}` };
      const docs = get.data.resources.find(r => r.id === 'docs');
      if (!docs) return { pass: false, detail: `'docs' not in resources` };
      if (docs.kind !== 'file-set') return { pass: false, detail: `wrong kind: ${docs.kind}` };
      return { pass: true, detail: 'File-set resource added and visible in model' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-DECOMP-103 — add a rule with reads/writes
// ---------------------------------------------------------------------------

const addRuleWithRefs: TestModule = {
  id: 'FT-DECOMP-103',
  name: 'contexts.rules.add — append a rule with reads/writes',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshTemplatedProject('decomp103');
      projectId = project.id;

      const add = await exec(projectId, 'contexts.rules.add', {
        rule: {
          id: 'lint',
          name: 'Lint',
          on: { kind: 'fileChange', path: 'src/**/*.ts' },
          run: { kind: 'shell', command: 'npx eslint src/' },
          reads: [{ mode: 'resource', id: 'sources' }],
        },
      });
      if (!add.ok) return { pass: false, detail: `add failed: ${add.error?.message}` };

      const get = await exec<{ rules: { id: string; readsCount: number }[]; modelErrors: unknown[] }>(
        projectId, 'contexts.model.get',
      );
      if (!get.ok || !get.data) return { pass: false, detail: `get failed: ${get.error?.message ?? 'no data'}` };
      if (get.data.modelErrors.length > 0) return { pass: false, detail: `model errors: ${JSON.stringify(get.data.modelErrors)}` };
      const lint = get.data.rules.find(r => r.id === 'lint');
      if (!lint) return { pass: false, detail: `'lint' rule not present` };
      if (lint.readsCount !== 1) return { pass: false, detail: `expected reads=1, got ${lint.readsCount}` };
      return { pass: true, detail: 'Rule with reads ref added; model has 1 reads slot' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-DECOMP-104 — invalid-params surface for bad input
// ---------------------------------------------------------------------------

const rejectsBadInput: TestModule = {
  id: 'FT-DECOMP-104',
  name: 'contexts.contexts.add — surfaces invalid-params for malformed id',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshTemplatedProject('decomp104');
      projectId = project.id;

      const add = await exec(projectId, 'contexts.contexts.add', {
        context: {
          id: '!!!',
          name: 'Bad',
          parentId: 'json-validator',
          objective: 'oops',
          action: { kind: 'agent', description: 'x' },
        },
      });
      if (add.ok) return { pass: false, detail: 'Expected failure for malformed id, but request succeeded' };
      if (add.error?.code !== 'invalid-params') {
        return { pass: false, detail: `Expected invalid-params, got ${add.error?.code}: ${add.error?.message}` };
      }
      return { pass: true, detail: 'Malformed id rejected with invalid-params' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-DECOMP-105 — direct file edit triggers a reload
// ---------------------------------------------------------------------------

const directEditReloads: TestModule = {
  id: 'FT-DECOMP-105',
  name: 'Direct edit to .antimatter/contexts.ts is picked up by the watcher',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withFreshTemplatedProject('decomp105');
      projectId = project.id;

      // Read the existing contexts.ts.
      const read = await exec<{ content: string }>(projectId, 'file.read', { path: '.antimatter/contexts.ts' });
      if (!read.ok || !read.data) return { pass: false, detail: `file.read failed: ${read.error?.message}` };

      const appended = read.data.content + `\nexport const aside = defineContext({\n  id: 'aside',\n  name: 'Aside',\n  parentId: 'json-validator',\n  objective: 'A direct-edit context.',\n  action: action.agent({ description: 'manual' }),\n});\n`;
      const write = await exec(projectId, 'file.write', { path: '.antimatter/contexts.ts', content: appended });
      if (!write.ok) return { pass: false, detail: `file.write failed: ${write.error?.message}` };

      // Watcher debounce — give it a moment.
      await new Promise(r => setTimeout(r, 1500));

      const get = await exec<{ contexts: { id: string }[]; modelErrors: unknown[] }>(projectId, 'contexts.model.get');
      if (!get.ok || !get.data) return { pass: false, detail: `get failed: ${get.error?.message}` };
      if (get.data.modelErrors.length > 0) return { pass: false, detail: `model errors: ${JSON.stringify(get.data.modelErrors)}` };
      const aside = get.data.contexts.find(c => c.id === 'aside');
      if (!aside) return { pass: false, detail: `'aside' not present after direct edit (got: ${get.data.contexts.map(c => c.id).join(', ')})` };

      return { pass: true, detail: 'Direct edit picked up by watcher; new context loaded' };
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

export const decompTests: readonly TestModule[] = [
  addChildContext,
  addFileSetResource,
  addRuleWithRefs,
  rejectsBadInput,
  directEditReloads,
];
