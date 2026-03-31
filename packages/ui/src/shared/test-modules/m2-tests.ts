/**
 * Milestone 2 functional tests — validate that a web app (m2-todo-app)
 * can be tested, deployed, previewed, and E2E-verified from within the IDE.
 *
 * Unlike M1 tests (which create files via DOM), M2 tests operate on the
 * pre-existing m2-todo-app project created in M2 Phase 3. They use the
 * automation API (server commands) for most operations.
 *
 * Tests are sequential — later tests depend on earlier ones passing.
 */

import type { TestModule } from '../test-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_NAME = 'm2-todo-app';

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Shared helpers (reusable across test modules)
// ---------------------------------------------------------------------------

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { getAccessToken } = await import('../../client/lib/auth.js');
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function findProject(name: string): Promise<ProjectMeta | null> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/projects', { headers });
  if (!res.ok) throw new Error(`Failed to list projects: ${res.statusText}`);
  const { projects } = await res.json() as { projects: ProjectMeta[] };
  return projects.find(p => p.name === name) ?? null;
}

async function startProjectWorkspace(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/start`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error(`Failed to start workspace: ${res.statusText}`);
}

async function waitForWorkspaceRunning(projectId: string, timeoutMs = 120_000): Promise<void> {
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
  throw new Error(`Workspace not RUNNING after ${timeoutMs / 1000}s`);
}

async function automationExec(projectId: string, command: string, params: Record<string, unknown> = {}): Promise<any> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ command, params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Automation ${command} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function getWorkflowState(projectId: string): Promise<any> {
  return automationExec(projectId, 'workflow.state');
}

async function emitWorkflowEvent(projectId: string, event: Record<string, unknown>): Promise<any> {
  return automationExec(projectId, 'workflow.emit', { event });
}

// ---------------------------------------------------------------------------
// FT-M2-001: Verify m2-todo-app project exists with correct files
// ---------------------------------------------------------------------------

const verifyProject: TestModule = {
  id: 'FT-M2-001',
  name: 'Verify m2-todo-app project exists with correct source files',
  area: 'm1', // reuse m1 area for milestone tests

  setup: async () => {
    console.log('[FT-M2-001:setup] Finding m2-todo-app project...');
    const project = await findProject(PROJECT_NAME);
    if (!project) throw new Error('m2-todo-app project not found — run M2 Phase 3 first');

    console.log(`[FT-M2-001:setup] Starting workspace for ${project.id}...`);
    await startProjectWorkspace(project.id);
    await waitForWorkspaceRunning(project.id);
    console.log('[FT-M2-001:setup] Workspace RUNNING');

    return { projectId: project.id };
  },

  run: async (_ctx) => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    if (!projectId) return { pass: false, detail: 'No project ID in URL' };

    try {
      // Verify key files exist
      const requiredFiles = [
        'src/index.html',
        'src/app.js',
        'src/style.css',
        'src/__tests__/app.test.js',
        'package.json',
        '.antimatter/build.ts',
        'infrastructure/lib/todo-app-stack.ts',
      ];

      const missing: string[] = [];
      for (const file of requiredFiles) {
        const result = await automationExec(projectId, 'file.read', { path: file });
        if (!result.content && !result.data) {
          missing.push(file);
        }
      }

      if (missing.length > 0) {
        return { pass: false, detail: `Missing files: ${missing.join(', ')}` };
      }

      // Verify workflow rules loaded
      const state = await getWorkflowState(projectId);
      if (!state.fileDeclarations || !state.fileDeclarations['.antimatter/build.ts']) {
        return { pass: false, detail: 'Workflow rules not loaded from .antimatter/build.ts' };
      }

      return { pass: true, detail: `All ${requiredFiles.length} files present, workflow rules loaded` };
    } catch (err: any) {
      return { pass: false, detail: `Error: ${err.message}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-M2-002: Run unit tests via test panel (vitest)
// ---------------------------------------------------------------------------

const runUnitTests: TestModule = {
  id: 'FT-M2-002',
  name: 'Run unit tests via vitest, verify pass',
  area: 'm1',

  setup: async () => {
    const project = await findProject(PROJECT_NAME);
    if (!project) throw new Error('m2-todo-app not found');
    return { projectId: project.id };
  },

  run: async (_ctx) => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    if (!projectId) return { pass: false, detail: 'No project ID in URL' };

    try {
      // First ensure npm install has been done
      console.log('[FT-M2-002] Running npm install...');
      const installResult = await automationExec(projectId, 'workflow.emit', {
        event: { type: '__internal:exec', command: 'npm install 2>&1', timeout: 60000 },
      });

      // Discover tests
      console.log('[FT-M2-002] Discovering tests...');
      const discovery = await automationExec(projectId, 'tests.discover-project');
      if (discovery.runner !== 'vitest') {
        return { pass: false, detail: `Expected vitest runner, got: ${discovery.runner}` };
      }

      // Run tests
      console.log('[FT-M2-002] Running vitest...');
      const result = await automationExec(projectId, 'tests.run-project');
      console.log(`[FT-M2-002] Result: ${result.passed}/${result.total} passed`);

      if (result.failed > 0) {
        const failures = (result.results || [])
          .filter((r: any) => r.status === 'fail')
          .map((r: any) => `${r.name}: ${r.failureMessage}`)
          .join('\n');
        return { pass: false, detail: `${result.failed} test(s) failed:\n${failures}` };
      }

      return {
        pass: true,
        detail: `${result.passed}/${result.total} tests passed (${result.durationMs}ms)`,
      };
    } catch (err: any) {
      return { pass: false, detail: `Error: ${err.message}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-M2-006: Preview via IDE-hosted URL
// ---------------------------------------------------------------------------

const verifyPreview: TestModule = {
  id: 'FT-M2-006',
  name: 'Preview via IDE-hosted URL, verify renders',
  area: 'm1',

  setup: async () => {
    const project = await findProject(PROJECT_NAME);
    if (!project) throw new Error('m2-todo-app not found');
    return { projectId: project.id };
  },

  run: async (_ctx) => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    if (!projectId) return { pass: false, detail: 'No project ID in URL' };

    try {
      // Fetch the preview URL
      const previewUrl = `/workspace/${encodeURIComponent(projectId)}/preview/`;
      const headers = await getAuthHeaders();
      const res = await fetch(previewUrl, { headers });

      if (!res.ok) {
        return { pass: false, detail: `Preview returned ${res.status}: ${res.statusText}` };
      }

      const html = await res.text();
      if (!html.includes('<h1>Todo App</h1>')) {
        return { pass: false, detail: 'Preview HTML missing <h1>Todo App</h1>' };
      }
      if (!html.includes('todo-input')) {
        return { pass: false, detail: 'Preview HTML missing todo-input element' };
      }

      return { pass: true, detail: 'Preview serves correct HTML with todo app structure' };
    } catch (err: any) {
      return { pass: false, detail: `Error: ${err.message}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-M2-008: Git commit all M2 changes
// ---------------------------------------------------------------------------

const gitCommit: TestModule = {
  id: 'FT-M2-008',
  name: 'Git commit and verify in log',
  area: 'm1',

  setup: async () => {
    const project = await findProject(PROJECT_NAME);
    if (!project) throw new Error('m2-todo-app not found');
    return { projectId: project.id };
  },

  run: async (_ctx) => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    if (!projectId) return { pass: false, detail: 'No project ID in URL' };

    try {
      // Initialize git if needed
      await automationExec(projectId, 'git.status').catch(async () => {
        // Not initialized — init + configure
        const headers = await getAuthHeaders();
        await fetch(`/workspace/${encodeURIComponent(projectId)}/api/git/init`, {
          method: 'POST',
          headers,
        });
      });

      // Stage all files
      const status = await automationExec(projectId, 'git.status');
      const allFiles = [
        ...status.staged.map((f: any) => f.path),
        ...status.unstaged.map((f: any) => f.path),
        ...status.untracked,
      ];
      if (allFiles.length > 0) {
        await automationExec(projectId, 'git.stage', { files: allFiles });
      }

      // Commit
      await automationExec(projectId, 'git.commit', {
        message: 'M2: Initial todo app with build pipeline, tests, and infrastructure',
      });

      // Verify in log
      const log = await automationExec(projectId, 'git.log', { limit: 1 });
      const latest = log.entries?.[0];
      if (!latest || !latest.message.includes('M2')) {
        return { pass: false, detail: `Latest commit not found or wrong message: ${JSON.stringify(latest)}` };
      }

      return { pass: true, detail: `Committed: ${latest.hash?.slice(0, 7)} "${latest.message}"` };
    } catch (err: any) {
      return { pass: false, detail: `Error: ${err.message}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const m2Tests: readonly TestModule[] = [
  verifyProject,    // FT-M2-001
  runUnitTests,     // FT-M2-002
  verifyPreview,    // FT-M2-006
  gitCommit,        // FT-M2-008
];

// Note: FT-M2-003 through FT-M2-005 and FT-M2-007 require infrastructure
// deployment (CDK + S3 + CloudFront) which takes several minutes and has
// cost implications. They are defined in BACKLOG.md but implemented as
// manual workflow rule tests rather than automated functional tests.
// The E2E verification is exercised via the workflow rules in build.ts.
