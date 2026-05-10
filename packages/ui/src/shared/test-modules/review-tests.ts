/**
 * Phase 6 review functional tests. Each verifies that the
 * action-invocation history surfaces correctly via the automation API.
 *
 *   FT-REVIEW-101 — invoking publish records an entry visible via history.list
 *   FT-REVIEW-102 — filtering by contextId narrows results
 *   FT-REVIEW-103 — entries carry the validation status snapshot at invoke time
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

interface HistoryEntry {
  entryId: string;
  contextId: string;
  contextName: string;
  actionKind: string;
  ruleId?: string;
  eventType?: string;
  operationId: string;
  invokedAt: string;
  validationStatusBefore: Record<string, string>;
}

// ---------------------------------------------------------------------------
// FT-REVIEW-101 — invoke publish, history.list returns the entry with matching operationId
// ---------------------------------------------------------------------------

const invokeRecordsHistory: TestModule = {
  id: 'FT-REVIEW-101',
  name: 'contexts.action.invoke records an entry visible via contexts.history.list',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('review101');
      projectId = project.id;

      const before = await exec<{ entries: HistoryEntry[] }>(projectId, 'contexts.history.list');
      if (!before.ok || !before.data) return { pass: false, detail: `history.list before failed: ${before.error?.message}` };
      const beforeCount = before.data.entries.length;

      const invoke = await exec<{ operationId: string }>(projectId, 'contexts.action.invoke', { contextId: 'publish' });
      if (!invoke.ok || !invoke.data) return { pass: false, detail: `invoke failed: ${invoke.error?.message}` };
      const opId = invoke.data.operationId;

      const after = await exec<{ entries: HistoryEntry[] }>(projectId, 'contexts.history.list');
      if (!after.ok || !after.data) return { pass: false, detail: `history.list after failed: ${after.error?.message}` };
      if (after.data.entries.length <= beforeCount) {
        return { pass: false, detail: `expected new entry; before=${beforeCount}, after=${after.data.entries.length}` };
      }
      const entry = after.data.entries.find(e => e.operationId === opId);
      if (!entry) {
        return { pass: false, detail: `no entry with operationId=${opId}` };
      }
      if (entry.contextId !== 'publish') return { pass: false, detail: `wrong contextId: ${entry.contextId}` };
      if (entry.actionKind !== 'invoke-rule') return { pass: false, detail: `wrong actionKind: ${entry.actionKind}` };
      if (entry.ruleId !== 'publish-bundle') return { pass: false, detail: `wrong ruleId: ${entry.ruleId}` };
      return { pass: true, detail: `History entry created with operationId=${opId}` };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-REVIEW-102 — filter by contextId returns only matching entries
// ---------------------------------------------------------------------------

const historyFilteredByContext: TestModule = {
  id: 'FT-REVIEW-102',
  name: 'contexts.history.list filters by contextId when provided',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('review102');
      projectId = project.id;

      // Invoke publish twice; that's the only context with an invoke-rule action in the template.
      const a = await exec(projectId, 'contexts.action.invoke', { contextId: 'publish' });
      if (!a.ok) return { pass: false, detail: `first invoke failed: ${a.error?.message}` };
      const b = await exec(projectId, 'contexts.action.invoke', { contextId: 'publish' });
      if (!b.ok) return { pass: false, detail: `second invoke failed: ${b.error?.message}` };

      const filtered = await exec<{ entries: HistoryEntry[] }>(projectId, 'contexts.history.list', { contextId: 'publish' });
      if (!filtered.ok || !filtered.data) return { pass: false, detail: `history.list failed: ${filtered.error?.message}` };
      if (filtered.data.entries.length < 2) {
        return { pass: false, detail: `expected ≥ 2 entries for publish, got ${filtered.data.entries.length}` };
      }
      for (const entry of filtered.data.entries) {
        if (entry.contextId !== 'publish') {
          return { pass: false, detail: `filter leaked: entry has contextId=${entry.contextId}` };
        }
      }

      const otherContextEntries = await exec<{ entries: HistoryEntry[] }>(projectId, 'contexts.history.list', {
        contextId: 'implement-validator',
      });
      if (!otherContextEntries.ok || !otherContextEntries.data) {
        return { pass: false, detail: `history.list failed: ${otherContextEntries.error?.message}` };
      }
      if (otherContextEntries.data.entries.length !== 0) {
        return { pass: false, detail: `expected 0 entries for implement-validator, got ${otherContextEntries.data.entries.length}` };
      }
      return { pass: true, detail: 'History filter respects contextId' };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (projectId) await deleteProject(projectId).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// FT-REVIEW-103 — entries carry validationStatusBefore matching the publish context's bindings
// ---------------------------------------------------------------------------

const historyCarriesValidationSnapshot: TestModule = {
  id: 'FT-REVIEW-103',
  name: 'History entries carry the per-validation status at invoke time',
  area: 'contexts',
  run: async () => {
    let projectId: string | null = null;
    try {
      const project = await withTemplated('review103');
      projectId = project.id;

      const invoke = await exec<{ operationId: string }>(projectId, 'contexts.action.invoke', { contextId: 'publish' });
      if (!invoke.ok || !invoke.data) return { pass: false, detail: `invoke failed: ${invoke.error?.message}` };

      const list = await exec<{ entries: HistoryEntry[] }>(projectId, 'contexts.history.list', { contextId: 'publish' });
      if (!list.ok || !list.data || list.data.entries.length === 0) {
        return { pass: false, detail: `no history entries returned` };
      }
      const entry = list.data.entries[0];
      const before = entry.validationStatusBefore;
      // The publish context has one validation binding `bundle-published`.
      if (!('bundle-published' in before)) {
        return { pass: false, detail: `validationStatusBefore missing 'bundle-published': ${JSON.stringify(before)}` };
      }
      // No deployed-resource registered → status was failing or unknown when invoked.
      if (before['bundle-published'] === 'passing') {
        return { pass: false, detail: `expected bundle-published to not be 'passing' on a fresh project, got ${before['bundle-published']}` };
      }
      return { pass: true, detail: `validationStatusBefore captured: ${JSON.stringify(before)}` };
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

export const reviewTests: readonly TestModule[] = [
  invokeRecordsHistory,
  historyFilteredByContext,
  historyCarriesValidationSnapshot,
];
