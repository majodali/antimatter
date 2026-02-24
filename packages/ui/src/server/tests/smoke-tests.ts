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
