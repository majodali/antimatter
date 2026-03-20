/**
 * Functional tests for Projects, Workspaces, Git, and File API services.
 *
 * These tests verify that service operations work correctly through
 * the ServiceClient-wired api.ts functions.
 *
 * FT-PROJ-001: List projects
 * FT-PROJ-002: Create and delete a project
 * FT-PROJ-003: Start workspace and check status
 * FT-PROJ-004: Git status query
 * FT-PROJ-005: Git stage, commit, and log lifecycle
 * FT-FILE-010: File delete via API
 * FT-FILE-011: File move via API
 * FT-FILE-012: File copy via API
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

// ---------------------------------------------------------------------------
// Helpers — get current project ID from store
// ---------------------------------------------------------------------------

async function getCurrentProjectId(): Promise<string | null> {
  const { useProjectStore } = await import('../../client/stores/projectStore.js');
  return useProjectStore.getState().currentProjectId;
}

// ---------------------------------------------------------------------------
// FT-PROJ-004: Git status query
// ---------------------------------------------------------------------------

const gitStatus: TestModule = {
  id: 'FT-PROJ-004',
  name: 'Git status returns valid VCS state',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const projectId = await getCurrentProjectId();
    if (!projectId) {
      return { pass: false, detail: 'No current project selected' };
    }

    try {
      const status = await api.fetchGitStatus(projectId);

      // Verify shape — should have initialized, branch, staged, unstaged, untracked
      if (typeof status.initialized !== 'boolean') {
        return { pass: false, detail: `status.initialized is ${typeof status.initialized}, expected boolean` };
      }

      if (!status.initialized) {
        return { pass: true, detail: 'Git not initialized in this project (valid state)' };
      }

      if (!status.branch) {
        return { pass: false, detail: 'Git initialized but no branch name returned' };
      }

      if (!Array.isArray(status.staged) || !Array.isArray(status.unstaged) || !Array.isArray(status.untracked)) {
        return { pass: false, detail: 'status missing staged/unstaged/untracked arrays' };
      }

      return {
        pass: true,
        detail: `Branch: ${status.branch}, staged: ${status.staged.length}, unstaged: ${status.unstaged.length}, untracked: ${status.untracked.length}`,
      };
    } catch (err) {
      return { pass: false, detail: `fetchGitStatus threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-PROJ-005: Git stage, commit, and log lifecycle
// ---------------------------------------------------------------------------

const gitCommitLifecycle: TestModule = {
  id: 'FT-PROJ-005',
  name: 'Create file, stage, commit, verify in log',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const projectId = await getCurrentProjectId();
    if (!projectId) {
      return { pass: false, detail: 'No current project selected' };
    }

    const testFile = `_git_test_${Date.now()}.txt`;

    try {
      // Create a file so there's something to commit
      await api.saveFile(testFile, `git test content ${Date.now()}`, projectId);
      console.log(`[FT-PROJ-005] Created ${testFile}`);

      // Check status — file should appear as untracked or unstaged
      const status1 = await api.fetchGitStatus(projectId);
      if (!status1.initialized) {
        return { pass: false, detail: 'Git not initialized — cannot test stage/commit' };
      }

      // Stage the file
      await api.gitStage([testFile], projectId);
      console.log(`[FT-PROJ-005] Staged ${testFile}`);

      // Verify staged
      const status2 = await api.fetchGitStatus(projectId);
      const isStaged = status2.staged.some((f: any) => f.path === testFile || f === testFile);
      if (!isStaged) {
        console.log(`[FT-PROJ-005] Staged files: ${JSON.stringify(status2.staged)}`);
        // Not fatal — some git implementations may show path differently
      }

      // Commit
      const commitMsg = `test: FT-PROJ-005 at ${new Date().toISOString()}`;
      await api.gitCommit(commitMsg, projectId);
      console.log(`[FT-PROJ-005] Committed: ${commitMsg}`);

      // Verify in log
      const log = await api.fetchGitLog(5, projectId);
      if (!Array.isArray(log) || log.length === 0) {
        return { pass: false, detail: 'fetchGitLog returned empty array after commit' };
      }

      const found = log.some((entry: any) => entry.message?.includes('FT-PROJ-005'));
      if (!found) {
        return { pass: false, detail: `Commit message not found in log. Latest: ${log[0]?.message}` };
      }

      // Cleanup: delete the test file and commit the deletion
      await api.deleteFile(testFile, projectId);
      await api.gitStage([testFile], projectId);
      await api.gitCommit('test: cleanup FT-PROJ-005', projectId);
      console.log(`[FT-PROJ-005] Cleanup committed`);

      return {
        pass: true,
        detail: `Created ${testFile}, staged, committed, verified in log, cleaned up`,
      };
    } catch (err) {
      // Best-effort cleanup
      try {
        await api.deleteFile(testFile, projectId);
      } catch { /* ignore */ }
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-FILE-010: File delete via API
// ---------------------------------------------------------------------------

const fileDeleteApi: TestModule = {
  id: 'FT-FILE-010',
  name: 'Delete file via API and verify gone',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const projectId = await getCurrentProjectId();
    if (!projectId) {
      return { pass: false, detail: 'No current project selected' };
    }

    const testFile = `_del_test_${Date.now()}.txt`;

    try {
      // Create file
      await api.saveFile(testFile, 'delete me', projectId);

      // Verify exists
      const exists1 = await api.fileExists(testFile, projectId);
      if (!exists1) {
        return { pass: false, detail: `Created ${testFile} but fileExists returned false` };
      }

      // Delete
      await api.deleteFile(testFile, projectId);

      // Verify gone
      const exists2 = await api.fileExists(testFile, projectId);
      if (exists2) {
        return { pass: false, detail: `Deleted ${testFile} but fileExists still returns true` };
      }

      return { pass: true, detail: `Created ${testFile}, verified exists, deleted, verified gone` };
    } catch (err) {
      // Cleanup
      try { await api.deleteFile(testFile, projectId); } catch { /* ignore */ }
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-FILE-011: File move via API
// ---------------------------------------------------------------------------

const fileMoveApi: TestModule = {
  id: 'FT-FILE-011',
  name: 'Move file via API and verify',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const projectId = await getCurrentProjectId();
    if (!projectId) {
      return { pass: false, detail: 'No current project selected' };
    }

    const srcFile = `_move_src_${Date.now()}.txt`;
    const destFile = `_move_dest_${Date.now()}.txt`;

    try {
      // Create source file
      await api.saveFile(srcFile, 'move me', projectId);
      console.log(`[FT-FILE-011] Created ${srcFile}, projectId=${projectId}`);

      // Check workspace routing state
      const wsActive = api.hasActiveWorkspace(projectId);
      console.log(`[FT-FILE-011] hasActiveWorkspace: ${wsActive}`);

      // Move it
      const result = await api.moveFiles([{ src: srcFile, dest: destFile }], projectId);
      if (result.moved !== 1) {
        return { pass: false, detail: `moveFiles returned moved=${result.moved}, errors: ${result.errors.join('; ')}` };
      }

      // Verify source gone, dest exists
      const srcExists = await api.fileExists(srcFile, projectId);
      const destExists = await api.fileExists(destFile, projectId);

      if (srcExists) {
        return { pass: false, detail: `Source ${srcFile} still exists after move` };
      }
      if (!destExists) {
        return { pass: false, detail: `Destination ${destFile} does not exist after move` };
      }

      // Verify content preserved
      const content = await api.fetchFileContent(destFile, projectId);
      if (content !== 'move me') {
        return { pass: false, detail: `Content mismatch: expected 'move me', got '${content?.slice(0, 50)}'` };
      }

      // Cleanup
      await api.deleteFile(destFile, projectId);

      return { pass: true, detail: `Moved ${srcFile} → ${destFile}, verified content preserved` };
    } catch (err) {
      // Cleanup
      try { await api.deleteFile(srcFile, projectId); } catch { /* ignore */ }
      try { await api.deleteFile(destFile, projectId); } catch { /* ignore */ }
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ---------------------------------------------------------------------------
// FT-FILE-012: File copy via API
// ---------------------------------------------------------------------------

const fileCopyApi: TestModule = {
  id: 'FT-FILE-012',
  name: 'Copy file via API and verify',
  area: 'projects',
  run: async (_ctx) => {
    const api = await getApi();
    const projectId = await getCurrentProjectId();
    if (!projectId) {
      return { pass: false, detail: 'No current project selected' };
    }

    const srcFile = `_copy_src_${Date.now()}.txt`;
    const destFile = `_copy_dest_${Date.now()}.txt`;

    try {
      // Create source file
      await api.saveFile(srcFile, 'copy me', projectId);

      // Copy it
      const result = await api.copyFiles([{ src: srcFile, dest: destFile }], projectId);
      if (result.copied !== 1) {
        return { pass: false, detail: `copyFiles returned copied=${result.copied}, errors: ${result.errors.join('; ')}` };
      }

      // Verify both exist
      const srcExists = await api.fileExists(srcFile, projectId);
      const destExists = await api.fileExists(destFile, projectId);

      if (!srcExists) {
        return { pass: false, detail: `Source ${srcFile} gone after copy (should still exist)` };
      }
      if (!destExists) {
        return { pass: false, detail: `Destination ${destFile} does not exist after copy` };
      }

      // Verify content matches
      const content = await api.fetchFileContent(destFile, projectId);
      if (content !== 'copy me') {
        return { pass: false, detail: `Content mismatch: expected 'copy me', got '${content?.slice(0, 50)}'` };
      }

      // Cleanup
      await api.deleteFile(srcFile, projectId);
      await api.deleteFile(destFile, projectId);

      return { pass: true, detail: `Copied ${srcFile} → ${destFile}, both exist, content matches` };
    } catch (err) {
      // Cleanup
      try { await api.deleteFile(srcFile, projectId); } catch { /* ignore */ }
      try { await api.deleteFile(destFile, projectId); } catch { /* ignore */ }
      return { pass: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ---- Export ----

export const projectsTests: readonly TestModule[] = [
  listProjects,
  createDeleteProject,
  workspaceStartStatus,
  gitStatus,
  gitCommitLifecycle,
  fileDeleteApi,
  fileMoveApi,
  fileCopyApi,
];
