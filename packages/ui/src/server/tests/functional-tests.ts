import type { TestDef } from './test-types.js';
import type { ActionContext } from './action-context.js';

/**
 * Functional tests for the deployed stack.
 *
 * After the EC2 workspace migration, build/agent/deploy/environment routes
 * live on the EC2 workspace server, not Lambda. These functional tests
 * only cover routes that still exist on Lambda or CloudFront.
 *
 * TODO: Add workspace-scoped functional tests that:
 *   1. Start a workspace EC2 instance via POST /api/projects/:id/workspace/start
 *   2. Wait for RUNNING status
 *   3. Run build/agent/deploy/environment tests against /workspace/:id/api/*
 *   4. Stop the workspace
 */

export function getFunctionalTests(
  _actions: ActionContext,
  apiBase: string,
  frontendBase: string,
): TestDef[] {
  return [
    // ---- Frontend Routes ----
    {
      name: 'FT: /logs Route',
      suite: 'functional',
      run: async () => {
        const res = await fetch(`${frontendBase}/logs`);
        const ok = res.status === 200;
        return {
          pass: ok,
          detail: ok ? `status=${res.status}` : `status=${res.status}`,
        };
      },
    },

    // ---- Cleanup ----
    {
      name: 'FT: Cleanup Test Project',
      suite: 'functional',
      run: async (_ctx) => {
        const pid = _ctx.__functionalProjectId;
        if (!pid) return { pass: true, detail: 'No project ID to clean up (skipped)' };
        const res = await fetch(`${apiBase}/api/projects/${pid}`, { method: 'DELETE' });
        const body = await res.json();
        return {
          pass: body.success === true,
          detail: body.success ? `Deleted project ${pid}` : JSON.stringify(body),
        };
      },
    },
  ];
}
