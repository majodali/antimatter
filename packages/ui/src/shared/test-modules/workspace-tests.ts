/**
 * Functional tests for workspace file synchronization.
 *
 * These tests verify that files created through the UI are correctly
 * synced to the workspace server's local filesystem, where build tools
 * (tsc, node, npm) actually execute.
 *
 * FT-WS-001: Files created via the UI exist on the workspace filesystem.
 */

import type { TestModule } from '../test-types.js';

/**
 * Directly query the workspace server's /exists endpoint, bypassing
 * the fileBase() routing logic.  This tells us whether the file is on
 * the workspace server's local disk — not just in S3.
 */
async function fileExistsOnWorkspace(
  projectId: string,
  path: string,
): Promise<boolean> {
  const { getAccessToken } = await import('../../client/lib/auth.js');
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `/workspace/${projectId}/api/files/exists?path=${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return false;
    const data = await res.json();
    return data.exists === true;
  } catch {
    return false;
  }
}

/**
 * Poll hasActiveWorkspace(projectId) until it returns true.
 * This is the most reliable check: it verifies that setActiveWorkspace()
 * has been called for this specific project, meaning the WebSocket is open
 * and file operations will route to the workspace server.
 */
async function waitForWorkspaceRouting(
  projectId: string,
  timeoutMs: number,
): Promise<{ connected: boolean; elapsedMs: number }> {
  const { hasActiveWorkspace } = await import('../../client/lib/api.js');
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (hasActiveWorkspace(projectId)) {
      return { connected: true, elapsedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return { connected: false, elapsedMs: Date.now() - start };
}

/**
 * Get the current project ID from the project store.
 */
async function getCurrentProjectId(): Promise<string | null> {
  const { useProjectStore } = await import('../../client/stores/projectStore.js');
  return useProjectStore.getState().currentProjectId;
}

// FT-WS-001
const filesSyncToWorkspace: TestModule = {
  id: 'FT-WS-001',
  name: 'Files created via UI exist on workspace filesystem',
  area: 'workspace',
  run: async (ctx) => {
    const projectId = await getCurrentProjectId();
    if (!projectId) {
      return { pass: false, detail: 'No current project selected' };
    }

    // Wait for workspace routing to be active for THIS project.
    // Normally takes ~12s; allow up to 120s for cold starts.
    const { connected, elapsedMs } = await waitForWorkspaceRouting(projectId, 120_000);
    if (!connected) {
      return {
        pass: false,
        detail: `Workspace routing not active for project ${projectId} after ${Math.round(elapsedMs / 1000)}s. ` +
          'The workspace server may not be running or failed to connect.',
      };
    }

    // Create a uniquely-named file via the standard ActionContext
    // (goes through the UI's file creation flow — DOM interactions in browser context)
    const testFileName = `_ws-sync-test-${Date.now()}.txt`;
    await ctx.writeFile(testFileName, 'workspace sync verification');

    // Verify: file exists on the workspace server's local filesystem
    let existsOnWorkspace = await fileExistsOnWorkspace(projectId, testFileName);

    if (!existsOnWorkspace) {
      // Allow up to 5s for async propagation
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        existsOnWorkspace = await fileExistsOnWorkspace(projectId, testFileName);
        if (existsOnWorkspace) break;
      }
    }

    // Cleanup
    try {
      await ctx.deleteFile(testFileName);
    } catch {
      // Best-effort
    }

    if (!existsOnWorkspace) {
      return {
        pass: false,
        detail: `File '${testFileName}' was created via writeFile but does NOT exist on the workspace server filesystem. ` +
          'The file likely went to S3 via Lambda instead of the workspace server. ' +
          `Workspace routing was confirmed active after ${Math.round(elapsedMs / 1000)}s.`,
      };
    }

    return {
      pass: true,
      detail: `File synced to workspace (routing active after ${Math.round(elapsedMs / 1000)}s)`,
    };
  },
};

// ---- Export ----

export const workspaceTests: readonly TestModule[] = [
  filesSyncToWorkspace,
];
