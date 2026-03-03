import type { TestDef } from './test-types.js';

/**
 * Smoke tests for the Lambda bootloader.
 *
 * After the EC2 workspace migration, Lambda only serves:
 *   - Health check, config
 *   - Project CRUD (S3 metadata)
 *   - Project-scoped file operations (S3 fallback for browsing without a workspace)
 *   - Workspace EC2 lifecycle (start/stop/status)
 *   - Command Lambda (EFS-based exec — still useful for quick ops)
 *   - Test runner
 *   - Frontend SPA
 *
 * Build, agent, deploy, and environment routes now live on the EC2 workspace server.
 */
export function getSmokeTests(apiBase: string, frontendBase: string): TestDef[] {
  return [
    // ---- Lambda core ----
    {
      name: 'Health Check',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/health`);
        const body = await res.json();
        if (res.status === 200 && body.status === 'ok')
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Config Endpoint',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/config`);
        const body = await res.json();
        if (res.status === 200 && 'wsBaseUrl' in body)
          return { pass: true, detail: `wsBaseUrl=${body.wsBaseUrl ? 'set' : 'null'}` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    // ---- Project CRUD ----
    {
      name: 'Create Project',
      suite: 'smoke',
      run: async (ctx) => {
        const res = await fetch(`${apiBase}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '_smoke_test_project' }),
        });
        const body = await res.json();
        if (res.status === 200 && body.id && body.name === '_smoke_test_project') {
          ctx.projectId = body.id;
          return { pass: true, detail: `id=${body.id}` };
        }
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'List Projects',
      suite: 'smoke',
      run: async (ctx) => {
        const res = await fetch(`${apiBase}/api/projects`);
        const body = await res.json();
        const found = Array.isArray(body.projects) && body.projects.some((p: any) => p.id === ctx.projectId);
        if (res.status === 200 && found)
          return { pass: true, detail: `${body.projects.length} projects, test project found` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    // ---- Project-scoped file operations (S3 fallback) ----
    {
      name: 'Project Write File',
      suite: 'smoke',
      run: async (ctx) => {
        const pid = ctx.projectId;
        if (!pid) return { pass: false, detail: 'No project ID from Create Project test' };
        const res = await fetch(`${apiBase}/api/projects/${pid}/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'hello.txt', content: 'world' }),
        });
        const body = await res.json();
        if (res.status === 200 && body.success === true)
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Project Read File',
      suite: 'smoke',
      run: async (ctx) => {
        const pid = ctx.projectId;
        if (!pid) return { pass: false, detail: 'No project ID' };
        const res = await fetch(`${apiBase}/api/projects/${pid}/files/read?path=hello.txt`);
        const body = await res.json();
        if (res.status === 200 && body.content === 'world')
          return { pass: true, detail: `content="${body.content}"` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Project File Tree',
      suite: 'smoke',
      run: async (ctx) => {
        const pid = ctx.projectId;
        if (!pid) return { pass: false, detail: 'No project ID' };
        const res = await fetch(`${apiBase}/api/projects/${pid}/files/tree`);
        const body = await res.json();
        const hasFile = Array.isArray(body.tree) && body.tree.some((n: any) => n.name === 'hello.txt');
        if (res.status === 200 && hasFile)
          return { pass: true, detail: `${body.tree.length} nodes, hello.txt found` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Delete Project',
      suite: 'smoke',
      run: async (ctx) => {
        const pid = ctx.projectId;
        if (!pid) return { pass: false, detail: 'No project ID' };
        const res = await fetch(`${apiBase}/api/projects/${pid}`, {
          method: 'DELETE',
        });
        const body = await res.json();
        if (res.status === 200 && body.success === true)
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    // ---- Command Lambda (EFS-based execution) ----
    {
      name: 'Command Health',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/commands/health`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const body = await res.json();
        if (res.status === 200 && body.status === 'ok' && body.efs?.mounted === true)
          return { pass: true, detail: `EFS mounted=${body.efs.mounted}, writable=${body.efs.writable}, node=${body.node?.version}` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Command Exec',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/commands/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'node', args: ['--version'] }),
        });
        const body = await res.json();
        if (res.status === 200 && body.exitCode === 0 && body.stdout?.startsWith('v'))
          return { pass: true, detail: `node ${body.stdout.trim()}, ${body.durationMs}ms` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Command EFS Write/Read',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/commands/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'sh',
            args: ['-c', 'echo "hello-efs" > _smoke_test.txt && cat _smoke_test.txt && rm _smoke_test.txt'],
          }),
        });
        const body = await res.json();
        if (res.status === 200 && body.exitCode === 0 && body.stdout?.trim() === 'hello-efs')
          return { pass: true, detail: 'EFS read/write verified' };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Command Project Sync + Exec',
      suite: 'smoke',
      run: async (ctx) => {
        const createRes = await fetch(`${apiBase}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `_sync_test_${Date.now()}` }),
        });
        const { id: projectId } = await createRes.json();
        ctx.syncProjectId = projectId;

        await fetch(`${apiBase}/api/projects/${projectId}/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'hello.txt', content: 'sync-test-value' }),
        });

        const execRes = await fetch(`${apiBase}/api/commands/projects/${projectId}/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'cat', args: ['hello.txt'] }),
        });
        const body = await execRes.json();

        if (execRes.status === 200 && body.exitCode === 0 && body.stdout?.trim() === 'sync-test-value')
          return { pass: true, detail: `S3→EFS sync + exec verified, projectId=${projectId}` };
        return { pass: false, detail: `${execRes.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Command Project Sync Back',
      suite: 'smoke',
      run: async (ctx) => {
        const projectId = ctx.syncProjectId;
        if (!projectId) return { pass: false, detail: 'No project from previous test' };

        const execRes = await fetch(`${apiBase}/api/commands/projects/${projectId}/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'echo created-on-efs > efs-file.txt',
            syncAfter: true,
          }),
        });
        const execBody = await execRes.json();
        if (execRes.status !== 200 || execBody.exitCode !== 0)
          return { pass: false, detail: `exec failed: ${JSON.stringify(execBody)}` };

        const readRes = await fetch(`${apiBase}/api/projects/${projectId}/files/read?path=efs-file.txt`);
        const readBody = await readRes.json();

        await fetch(`${apiBase}/api/projects/${projectId}`, { method: 'DELETE' });

        if (readRes.status === 200 && readBody.content?.trim() === 'created-on-efs')
          return { pass: true, detail: 'EFS→S3 sync-back verified' };
        return { pass: false, detail: `read-back: ${readRes.status}: ${JSON.stringify(readBody)}` };
      },
    },
    // ---- Workspace EC2 lifecycle ----
    {
      name: 'Workspace Status (no instance)',
      suite: 'smoke',
      run: async (ctx) => {
        // Create a throwaway project to check workspace status
        const createRes = await fetch(`${apiBase}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `_ws_test_${Date.now()}` }),
        });
        const { id: projectId } = await createRes.json();
        ctx.wsProjectId = projectId;

        const res = await fetch(`${apiBase}/api/projects/${projectId}/workspace/status`);
        const body = await res.json();

        // Clean up
        await fetch(`${apiBase}/api/projects/${projectId}`, { method: 'DELETE' });

        // Should return 200 with null or a status object
        if (res.status === 200)
          return { pass: true, detail: `status=${body.status ?? 'none'}` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    // ---- Frontend tests ----
    {
      name: 'Frontend HTML',
      suite: 'smoke',
      run: async (ctx) => {
        const res = await fetch(frontendBase);
        const text = await res.text();
        ctx.html = text;
        if (res.status === 200 && text.includes('Antimatter IDE'))
          return { pass: true, detail: `${text.length} bytes, title found` };
        return { pass: false, detail: `${res.status}: title not found (${text.length} bytes)` };
      },
    },
    {
      name: 'Frontend Assets',
      suite: 'smoke',
      run: async (ctx) => {
        const html = ctx.html;
        if (!html) return { pass: false, detail: 'No HTML from previous test' };
        const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
        if (!match) return { pass: false, detail: 'No asset reference found in HTML' };
        const assetUrl = `${frontendBase}${match[1]}`;
        const res = await fetch(assetUrl);
        const text = await res.text();
        if (res.status === 200 && text.length > 0)
          return { pass: true, detail: `${match[1]} — ${text.length} bytes` };
        return { pass: false, detail: `${res.status}: ${assetUrl} (${text.length} bytes)` };
      },
    },
  ];
}
