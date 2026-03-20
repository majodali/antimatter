/**
 * Functional tests for Projects and Workspaces services.
 *
 * These tests verify that project CRUD and workspace lifecycle operations
 * work correctly through the ServiceClient-wired api.ts functions.
 *
 * FT-PROJ-001: List projects
 * FT-PROJ-002: Create and delete a project
 * FT-PROJ-003: Start workspace and check status
 */

import type { TestModule } from '../test-types.js';

// ---------------------------------------------------------------------------
// Helpers — authenticated API calls via ServiceClient-wired api.ts
// ---------------------------------------------------------------------------

async function getApi() {
  return import('../../client/lib/api.js');
}

// ---------------------------------------------------------------------------
// FT-PROJ-001: List projects
// ---------------------------------------------------------------------------

const listProjects: TestModule = {
  id: 'FT-PROJ-001',
  name: 'List projects returns array with current project',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const { useProjectStore } = await import('../../client/stores/projectStore.js');
    const currentProjectId = useProjectStore.getState().currentProjectId;

    if (!currentProjectId) {
      return { pass: false, detail: 'No current project selected in store' };
    }

    try {
      const projects = await api.fetchProjects();

      if (!Array.isArray(projects)) {
        return { pass: false, detail: `fetchProjects returned ${typeof projects}, expected array` };
      }

      if (projects.length === 0) {
        return { pass: false, detail: 'fetchProjects returned empty array — expected at least the current project' };
      }

      const current = projects.find(p => p.id === currentProjectId);
      if (!current) {
        return {
          pass: false,
          detail: `Current project ${currentProjectId} not found in projects list (${projects.length} projects returned)`,
        };
      }

      // Verify shape
      if (!current.name || !current.createdAt) {
        return {
          pass: false,
          detail: `Project missing required fields: name=${current.name}, createdAt=${current.createdAt}`,
        };
      }

      return {
        pass: true,
        detail: `Listed ${projects.length} project(s), current project '${current.name}' found`,
      };
    } catch (err) {
      return { pass: false, detail: `fetchProjects threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-PROJ-002: Create and delete a project
// ---------------------------------------------------------------------------

const createDeleteProject: TestModule = {
  id: 'FT-PROJ-002',
  name: 'Create project, verify it exists, then delete it',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const testName = `__test_proj_${Date.now()}`;
    let createdId: string | null = null;

    try {
      // Create
      const created = await api.createProject(testName);
      createdId = created.id;

      if (!created.id || !created.name) {
        return { pass: false, detail: `createProject returned incomplete data: ${JSON.stringify(created)}` };
      }

      if (created.name !== testName) {
        return { pass: false, detail: `Expected name '${testName}', got '${created.name}'` };
      }

      console.log(`[FT-PROJ-002] Created project: ${created.id} (${created.name})`);

      // Verify it appears in list
      const projects = await api.fetchProjects();
      const found = projects.find(p => p.id === created.id);
      if (!found) {
        return { pass: false, detail: `Created project ${created.id} not found in projects list` };
      }

      // Delete
      await api.deleteProject(created.id);
      createdId = null; // Cleared so cleanup doesn't double-delete
      console.log(`[FT-PROJ-002] Deleted project: ${created.id}`);

      // Verify it's gone
      const afterDelete = await api.fetchProjects();
      const stillExists = afterDelete.find(p => p.id === created.id);
      if (stillExists) {
        return { pass: false, detail: `Project ${created.id} still exists after deleteProject` };
      }

      return {
        pass: true,
        detail: `Created '${testName}' (${created.id}), verified in list, deleted, verified removed`,
      };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      // Cleanup on failure
      if (createdId) {
        try {
          const api2 = await getApi();
          await api2.deleteProject(createdId);
          console.log(`[FT-PROJ-002] Cleanup: deleted ${createdId}`);
        } catch {
          console.warn(`[FT-PROJ-002] Cleanup failed for ${createdId}`);
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// FT-PROJ-003: Start workspace and check status
// ---------------------------------------------------------------------------

const workspaceStartStatus: TestModule = {
  id: 'FT-PROJ-003',
  name: 'Start workspace and verify RUNNING status',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const testName = `__test_ws_${Date.now()}`;
    let createdId: string | null = null;

    try {
      // Create a disposable project
      const created = await api.createProject(testName);
      createdId = created.id;
      console.log(`[FT-PROJ-003] Created project: ${created.id}`);

      // Start workspace (shared mode reuses existing EC2)
      const startResult = await api.startWorkspace(created.id);
      console.log(`[FT-PROJ-003] startWorkspace returned status: ${startResult.status}`);

      if (!startResult.status) {
        return { pass: false, detail: `startWorkspace returned no status: ${JSON.stringify(startResult)}` };
      }

      if (startResult.status !== 'RUNNING' && startResult.status !== 'PENDING') {
        return { pass: false, detail: `Expected RUNNING or PENDING, got ${startResult.status}` };
      }

      // Poll status until RUNNING (max 60s)
      const startTime = Date.now();
      let status = startResult.status;
      while (status !== 'RUNNING' && Date.now() - startTime < 60_000) {
        await new Promise(r => setTimeout(r, 3000));
        const wsStatus = await api.getWorkspaceStatus(created.id);
        status = wsStatus.status;
        console.log(`[FT-PROJ-003] Polling status: ${status} (${Math.round((Date.now() - startTime) / 1000)}s)`);
      }

      if (status !== 'RUNNING') {
        return { pass: false, detail: `Workspace not RUNNING after 60s, status: ${status}` };
      }

      // Verify status query returns correct data
      const finalStatus = await api.getWorkspaceStatus(created.id);
      if (!finalStatus.sessionToken) {
        return { pass: false, detail: 'Workspace RUNNING but no sessionToken in status response' };
      }

      return {
        pass: true,
        detail: `Workspace started and verified RUNNING in ${Math.round((Date.now() - startTime) / 1000)}s, sessionToken present`,
      };
    } catch (err) {
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      // Cleanup: delete the project (workspace context auto-cleans)
      if (createdId) {
        try {
          const api2 = await getApi();
          await api2.deleteProject(createdId);
          console.log(`[FT-PROJ-003] Cleanup: deleted ${createdId}`);
        } catch {
          console.warn(`[FT-PROJ-003] Cleanup failed for ${createdId}`);
        }
      }
    }
  },
};

// ---- Export ----

export const projectsTests: readonly TestModule[] = [
  listProjects,
  createDeleteProject,
  workspaceStartStatus,
];
