import type { TestDef } from './test-types.js';

export function getSmokeTests(apiBase: string, frontendBase: string): TestDef[] {
  return [
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
      name: 'File Tree',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/files/tree`);
        const body = await res.json();
        if (res.status === 200 && Array.isArray(body.tree))
          return { pass: true, detail: `${body.tree.length} nodes` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Write File',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '_test.txt', content: 'hello' }),
        });
        const body = await res.json();
        if (res.status === 200 && body.success === true)
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Read File',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/files/read?path=_test.txt`);
        const body = await res.json();
        if (res.status === 200 && body.content === 'hello')
          return { pass: true, detail: `content="${body.content}"` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'File Exists',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/files/exists?path=_test.txt`);
        const body = await res.json();
        if (res.status === 200 && body.exists === true)
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'List Directory',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/files/list`);
        const body = await res.json();
        const hasTestFile = Array.isArray(body.entries) && body.entries.some((e: any) => (typeof e === 'string' ? e : e.name) === '_test.txt');
        if (res.status === 200 && hasTestFile)
          return { pass: true, detail: `${body.entries.length} entries` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Delete File',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/files/delete?path=_test.txt`, {
          method: 'DELETE',
        });
        const body = await res.json();
        if (res.status === 200 && body.success === true)
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'File Deleted',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/files/exists?path=_test.txt`);
        const body = await res.json();
        if (res.status === 200 && body.exists === false)
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Build Results',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/build/results`);
        const body = await res.json();
        if (res.status === 200 && Array.isArray(body.results))
          return { pass: true, detail: `${body.results.length} results` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Agent Chat',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/agent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'ping' }),
        });
        const body = await res.json();
        if (res.status === 200 && typeof body.response === 'string')
          return { pass: true, detail: `response="${body.response}"` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Agent History',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/agent/history`);
        const body = await res.json();
        if (res.status === 200 && Array.isArray(body.history))
          return { pass: true, detail: `${body.history.length} messages` };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    {
      name: 'Clear History',
      suite: 'smoke',
      run: async () => {
        const res = await fetch(`${apiBase}/api/agent/history`, {
          method: 'DELETE',
        });
        const body = await res.json();
        if (res.status === 200 && body.success === true)
          return { pass: true, detail: JSON.stringify(body) };
        return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
      },
    },
    // ---- Project API tests ----
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
    // ---- Command Lambda tests ----
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
    // ---- Project sync + exec tests ----
    {
      name: 'Command Project Sync + Exec',
      suite: 'smoke',
      run: async (ctx) => {
        // Create a test project and write a file via API Lambda (S3)
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

        // Execute a command via Command Lambda that reads the file (auto-syncs from S3)
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

        // Execute a command that creates a new file on EFS, with syncAfter=true
        const execRes = await fetch(`${apiBase}/api/commands/projects/${projectId}/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // No need for sh -c — LocalWorkspaceEnvironment.execute() wraps in a shell
            command: 'echo created-on-efs > efs-file.txt',
            syncAfter: true,
          }),
        });
        const execBody = await execRes.json();
        if (execRes.status !== 200 || execBody.exitCode !== 0)
          return { pass: false, detail: `exec failed: ${JSON.stringify(execBody)}` };

        // Read the file back via API Lambda (S3) to verify sync-back worked
        const readRes = await fetch(`${apiBase}/api/projects/${projectId}/files/read?path=efs-file.txt`);
        const readBody = await readRes.json();

        // Clean up the test project
        await fetch(`${apiBase}/api/projects/${projectId}`, { method: 'DELETE' });

        if (readRes.status === 200 && readBody.content?.trim() === 'created-on-efs')
          return { pass: true, detail: 'EFS→S3 sync-back verified' };
        return { pass: false, detail: `read-back: ${readRes.status}: ${JSON.stringify(readBody)}` };
      },
    },
    // ---- Build execution via Command Lambda ----
    {
      name: 'Project Build via Command Lambda',
      suite: 'smoke',
      run: async () => {
        // 1. Create a test project
        const createRes = await fetch(`${apiBase}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `_build_test_${Date.now()}` }),
        });
        const { id: projectId } = await createRes.json();

        // 2. Write a source file
        await fetch(`${apiBase}/api/projects/${projectId}/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'src.txt', content: 'build-output-value' }),
        });

        // 3. Write a build config that cats the source file
        const buildConfig = {
          rules: [{
            id: 'cat-rule',
            name: 'Cat Source',
            inputs: ['src.txt'],
            outputs: [],
            command: 'cat src.txt',
            dependsOn: [],
          }],
          targets: [{
            id: 'cat-target',
            ruleId: 'cat-rule',
            moduleId: 'test-mod',
            dependsOn: [],
          }],
        };
        await fetch(`${apiBase}/api/projects/${projectId}/build/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildConfig),
        });

        // 4. Execute the build — this routes through CommandLambdaEnvironment → Command Lambda
        const buildRes = await fetch(`${apiBase}/api/projects/${projectId}/build/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const buildBody = await buildRes.json();

        // 5. Clean up
        await fetch(`${apiBase}/api/projects/${projectId}`, { method: 'DELETE' });

        // 6. Verify build result (BuildResult uses `output` which concatenates stdout+stderr)
        const output = buildBody.results?.[0]?.output?.trim() ?? '';
        if (
          buildRes.status === 200 &&
          buildBody.results?.length >= 1 &&
          buildBody.results[0].status === 'success' &&
          output === 'build-output-value'
        ) {
          return { pass: true, detail: `Build executed via Command Lambda, output="${output}"` };
        }
        return { pass: false, detail: `${buildRes.status}: ${JSON.stringify(buildBody)}` };
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
