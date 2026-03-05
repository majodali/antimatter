/**
 * Workspace Container Functional Tests
 *
 * Exercises the full Fargate workspace container lifecycle:
 *   start → poll until RUNNING → health check → exec → idempotent start → stop → cleanup
 *
 * These tests require ~90s for container startup, which exceeds API Gateway's
 * 29s timeout. Run via `suite=workspace` with direct Lambda invocation (120s timeout)
 * or accept a timeout on the /tests page for just the polling step.
 */

import type { TestDef } from './test-types.js';
import { getWorkflowTests } from './workflow-tests.js';

// Helper: pause for a given duration
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getWorkspaceTests(apiBase: string): TestDef[] {
  // ALB DNS for direct container HTTP tests (set by CDK as Lambda env var)
  const albDns = process.env.WORKSPACE_ALB_DNS;

  return [
    // ---- 1. Create project + start workspace ----
    {
      name: 'WS: Start Workspace',
      suite: 'workspace',
      run: async (ctx) => {
        // Create a dedicated test project
        const createRes = await fetch(`${apiBase}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '_workspace_test_project' }),
        });
        const createBody = await createRes.json();
        if (!createRes.ok || !createBody.id) {
          return { pass: false, detail: `Failed to create project: ${JSON.stringify(createBody)}` };
        }
        ctx.__wsProjectId = createBody.id;

        // Start workspace container
        const res = await fetch(`${apiBase}/api/projects/${ctx.__wsProjectId}/workspace/start`, {
          method: 'POST',
        });
        if (!res.ok) {
          const err = await res.text();
          return { pass: false, detail: `Start failed (${res.status}): ${err}` };
        }

        const info = await res.json();
        ctx.__wsTaskArn = info.taskArn || '';
        ctx.__wsSessionToken = info.sessionToken || '';

        const ok =
          typeof info.projectId === 'string' &&
          typeof info.taskArn === 'string' &&
          typeof info.sessionToken === 'string' &&
          typeof info.port === 'number';

        return {
          pass: ok,
          detail: ok
            ? `taskArn=...${info.taskArn?.slice(-12)}, status=${info.status}, port=${info.port}`
            : `Unexpected shape: ${JSON.stringify(info)}`,
        };
      },
    },

    // ---- 2. Poll until RUNNING ----
    {
      name: 'WS: Poll Until Running',
      suite: 'workspace',
      run: async (ctx) => {
        const projectId = ctx.__wsProjectId;
        if (!projectId) return { pass: false, detail: 'No project ID from start test' };

        const maxWaitMs = 90_000;
        const pollIntervalMs = 5_000;
        const start = Date.now();
        let lastStatus = '';

        while (Date.now() - start < maxWaitMs) {
          const res = await fetch(`${apiBase}/api/projects/${projectId}/workspace/status`);
          if (!res.ok) {
            return { pass: false, detail: `Status check failed: ${res.status}` };
          }

          const info = await res.json();
          lastStatus = info.status;

          if (info.status === 'RUNNING') {
            ctx.__wsPrivateIp = info.privateIp || '';
            return {
              pass: true,
              detail: `RUNNING after ${Math.round((Date.now() - start) / 1000)}s, ip=${info.privateIp}`,
            };
          }

          if (info.status === 'STOPPED') {
            return { pass: false, detail: 'Task stopped unexpectedly' };
          }

          await sleep(pollIntervalMs);
        }

        return { pass: false, detail: `Timed out after ${maxWaitMs / 1000}s, lastStatus=${lastStatus}` };
      },
    },

    // ---- 3. Container health check via ALB (path-based routing) ----
    // Uses /{projectId}/health path — ALB routes to the correct container's
    // target group. Container strips the prefix. Validates both routing and response.
    {
      name: 'WS: Container Health Check',
      suite: 'workspace',
      run: async (ctx) => {
        const projectId = ctx.__wsProjectId;
        if (!projectId) return { pass: false, detail: 'No project ID' };
        if (!albDns) return { pass: true, detail: 'SKIPPED — WORKSPACE_ALB_DNS not set' };

        // Wait for ALB health check to pass on new target group (~20s)
        await sleep(15_000);

        try {
          const res = await fetch(`http://${albDns}/${projectId}/health`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            return { pass: false, detail: `Health check returned ${res.status}` };
          }

          const body = await res.json();
          const ok = body.status === 'healthy' && body.projectId === projectId;
          return {
            pass: ok,
            detail: ok
              ? `healthy, projectId=${body.projectId}, uptime=${Math.round(body.uptime)}s`
              : `Unexpected: ${JSON.stringify(body)}`,
          };
        } catch (err) {
          return { pass: false, detail: `Health check failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ---- 4. Container exec via ALB (path-based routing) ----
    {
      name: 'WS: Container Exec',
      suite: 'workspace',
      run: async (ctx) => {
        const projectId = ctx.__wsProjectId;
        if (!projectId) return { pass: false, detail: 'No project ID' };
        if (!albDns) return { pass: true, detail: 'SKIPPED — WORKSPACE_ALB_DNS not set' };

        try {
          const res = await fetch(`http://${albDns}/${projectId}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: 'echo hello-workspace-test',
              syncBefore: false,
              syncAfter: false,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) {
            const err = await res.text();
            return { pass: false, detail: `Exec returned ${res.status}: ${err}` };
          }

          const body = await res.json();
          const ok = body.exitCode === 0 && body.stdout?.trim() === 'hello-workspace-test';
          return {
            pass: ok,
            detail: ok
              ? `exitCode=${body.exitCode}, stdout="${body.stdout?.trim()}", ${body.durationMs}ms`
              : `exitCode=${body.exitCode}, stdout="${body.stdout}", stderr="${body.stderr}"`,
          };
        } catch (err) {
          return { pass: false, detail: `Exec failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    },

    // ---- Workflow tests (run while workspace is up) ----
    ...(albDns ? getWorkflowTests(albDns) : []),

    // ---- 5. Start again returns existing (idempotent) ----
    {
      name: 'WS: Start Returns Existing',
      suite: 'workspace',
      run: async (ctx) => {
        const projectId = ctx.__wsProjectId;
        if (!projectId) return { pass: false, detail: 'No project ID' };

        const res = await fetch(`${apiBase}/api/projects/${projectId}/workspace/start`, {
          method: 'POST',
        });
        if (!res.ok) {
          return { pass: false, detail: `Start failed: ${res.status}` };
        }

        const info = await res.json();
        const ok =
          info.taskArn === ctx.__wsTaskArn &&
          (info.status === 'RUNNING' || info.status === 'PROVISIONING' || info.status === 'PENDING');
        return {
          pass: ok,
          detail: ok
            ? `Same taskArn confirmed, status=${info.status}`
            : `taskArn mismatch: expected=...${ctx.__wsTaskArn?.slice(-12)}, got=...${info.taskArn?.slice(-12)}, status=${info.status}`,
        };
      },
    },

    // ---- 6. Status shows running ----
    {
      name: 'WS: Status Shows Running',
      suite: 'workspace',
      run: async (ctx) => {
        const projectId = ctx.__wsProjectId;
        if (!projectId) return { pass: false, detail: 'No project ID' };

        const res = await fetch(`${apiBase}/api/projects/${projectId}/workspace/status`);
        if (!res.ok) {
          return { pass: false, detail: `Status failed: ${res.status}` };
        }

        const info = await res.json();
        const ok =
          info.status === 'RUNNING' &&
          typeof info.privateIp === 'string' &&
          info.privateIp.length > 0;
        return {
          pass: ok,
          detail: ok
            ? `status=RUNNING, ip=${info.privateIp}, port=${info.port}`
            : `status=${info.status}, ip=${info.privateIp}`,
        };
      },
    },

    // ---- 7. Stop workspace ----
    {
      name: 'WS: Stop Workspace',
      suite: 'workspace',
      run: async (ctx) => {
        const projectId = ctx.__wsProjectId;
        if (!projectId) return { pass: false, detail: 'No project ID' };

        const res = await fetch(`${apiBase}/api/projects/${projectId}/workspace/stop`, {
          method: 'POST',
        });
        if (!res.ok) {
          const err = await res.text();
          return { pass: false, detail: `Stop failed (${res.status}): ${err}` };
        }

        const body = await res.json();
        if (!body.success) {
          return { pass: false, detail: `Stop returned: ${JSON.stringify(body)}` };
        }

        // Brief wait then check status is transitioning
        await sleep(3_000);
        const statusRes = await fetch(`${apiBase}/api/projects/${projectId}/workspace/status`);
        const statusInfo = await statusRes.json();

        // Task may be in various shutdown states — all are acceptable after stop
        return {
          pass: true,
          detail: `Stop succeeded, post-stop status=${statusInfo.status}`,
        };
      },
    },

    // ---- 8. Cleanup test project ----
    {
      name: 'WS: Cleanup Test Project',
      suite: 'workspace',
      run: async (ctx) => {
        const projectId = ctx.__wsProjectId;
        if (!projectId) return { pass: false, detail: 'No project ID to clean up' };

        const res = await fetch(`${apiBase}/api/projects/${projectId}`, {
          method: 'DELETE',
        });
        const body = await res.json();
        return {
          pass: body.success === true,
          detail: body.success ? `Deleted project ${projectId}` : JSON.stringify(body),
        };
      },
    },
  ];
}
