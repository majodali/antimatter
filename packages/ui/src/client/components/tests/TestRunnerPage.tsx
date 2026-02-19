import { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';

type TestStatus = 'pending' | 'running' | 'pass' | 'fail';

interface TestResult {
  name: string;
  status: TestStatus;
  durationMs?: number;
  detail?: string;
}

const DEFAULT_API_BASE = 'https://cxpofzihnl.execute-api.us-west-2.amazonaws.com/prod';
const DEFAULT_FRONTEND_BASE = 'https://d33wyunpiwy2df.cloudfront.net';

type TestDef = {
  name: string;
  run: (apiBase: string, frontendBase: string, ctx: Record<string, string>) => Promise<{ pass: boolean; detail: string }>;
};

const testSuite: TestDef[] = [
  {
    name: 'Health Check',
    run: async (api) => {
      const res = await fetch(`${api}/api/health`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && body.status === 'ok')
        return { pass: true, detail: JSON.stringify(body) };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'File Tree',
    run: async (api) => {
      const res = await fetch(`${api}/api/files/tree`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && Array.isArray(body.tree))
        return { pass: true, detail: `${body.tree.length} nodes` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Write File',
    run: async (api) => {
      const res = await fetch(`${api}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '_test.txt', content: 'hello' }),
        mode: 'cors',
      });
      const body = await res.json();
      if (res.status === 200 && body.success === true)
        return { pass: true, detail: JSON.stringify(body) };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Read File',
    run: async (api) => {
      const res = await fetch(`${api}/api/files/read?path=_test.txt`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && body.content === 'hello')
        return { pass: true, detail: `content="${body.content}"` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'File Exists',
    run: async (api) => {
      const res = await fetch(`${api}/api/files/exists?path=_test.txt`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && body.exists === true)
        return { pass: true, detail: JSON.stringify(body) };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'List Directory',
    run: async (api) => {
      const res = await fetch(`${api}/api/files/list`, { mode: 'cors' });
      const body = await res.json();
      const hasTestFile = Array.isArray(body.entries) && body.entries.some((e: any) => (typeof e === 'string' ? e : e.name) === '_test.txt');
      if (res.status === 200 && hasTestFile)
        return { pass: true, detail: `${body.entries.length} entries` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Delete File',
    run: async (api) => {
      const res = await fetch(`${api}/api/files/delete?path=_test.txt`, {
        method: 'DELETE',
        mode: 'cors',
      });
      const body = await res.json();
      if (res.status === 200 && body.success === true)
        return { pass: true, detail: JSON.stringify(body) };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'File Deleted',
    run: async (api) => {
      const res = await fetch(`${api}/api/files/exists?path=_test.txt`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && body.exists === false)
        return { pass: true, detail: JSON.stringify(body) };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Build Results',
    run: async (api) => {
      const res = await fetch(`${api}/api/build/results`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && Array.isArray(body.results))
        return { pass: true, detail: `${body.results.length} results` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Agent Chat',
    run: async (api) => {
      const res = await fetch(`${api}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'ping' }),
        mode: 'cors',
      });
      const body = await res.json();
      if (res.status === 200 && typeof body.response === 'string')
        return { pass: true, detail: `response="${body.response}"` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Agent History',
    run: async (api) => {
      const res = await fetch(`${api}/api/agent/history`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && Array.isArray(body.history))
        return { pass: true, detail: `${body.history.length} messages` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Clear History',
    run: async (api) => {
      const res = await fetch(`${api}/api/agent/history`, {
        method: 'DELETE',
        mode: 'cors',
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
    run: async (api, _frontend, ctx) => {
      const res = await fetch(`${api}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '_smoke_test_project' }),
        mode: 'cors',
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
    run: async (api, _frontend, ctx) => {
      const res = await fetch(`${api}/api/projects`, { mode: 'cors' });
      const body = await res.json();
      const found = Array.isArray(body.projects) && body.projects.some((p: any) => p.id === ctx.projectId);
      if (res.status === 200 && found)
        return { pass: true, detail: `${body.projects.length} projects, test project found` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Project Write File',
    run: async (api, _frontend, ctx) => {
      const pid = ctx.projectId;
      if (!pid) return { pass: false, detail: 'No project ID from Create Project test' };
      const res = await fetch(`${api}/api/projects/${pid}/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'hello.txt', content: 'world' }),
        mode: 'cors',
      });
      const body = await res.json();
      if (res.status === 200 && body.success === true)
        return { pass: true, detail: JSON.stringify(body) };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Project Read File',
    run: async (api, _frontend, ctx) => {
      const pid = ctx.projectId;
      if (!pid) return { pass: false, detail: 'No project ID' };
      const res = await fetch(`${api}/api/projects/${pid}/files/read?path=hello.txt`, { mode: 'cors' });
      const body = await res.json();
      if (res.status === 200 && body.content === 'world')
        return { pass: true, detail: `content="${body.content}"` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Project File Tree',
    run: async (api, _frontend, ctx) => {
      const pid = ctx.projectId;
      if (!pid) return { pass: false, detail: 'No project ID' };
      const res = await fetch(`${api}/api/projects/${pid}/files/tree`, { mode: 'cors' });
      const body = await res.json();
      const hasFile = Array.isArray(body.tree) && body.tree.some((n: any) => n.name === 'hello.txt');
      if (res.status === 200 && hasFile)
        return { pass: true, detail: `${body.tree.length} nodes, hello.txt found` };
      return { pass: false, detail: `${res.status}: ${JSON.stringify(body)}` };
    },
  },
  {
    name: 'Delete Project',
    run: async (api, _frontend, ctx) => {
      const pid = ctx.projectId;
      if (!pid) return { pass: false, detail: 'No project ID' };
      const res = await fetch(`${api}/api/projects/${pid}`, {
        method: 'DELETE',
        mode: 'cors',
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
    run: async (_api, frontend, ctx) => {
      const res = await fetch(frontend, { mode: 'cors' });
      const text = await res.text();
      ctx.html = text;
      if (res.status === 200 && text.includes('Antimatter IDE'))
        return { pass: true, detail: `${text.length} bytes, title found` };
      return { pass: false, detail: `${res.status}: title not found (${text.length} bytes)` };
    },
  },
  {
    name: 'Frontend Assets',
    run: async (_api, frontend, ctx) => {
      const html = ctx.html;
      if (!html) return { pass: false, detail: 'No HTML from previous test' };
      const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
      if (!match) return { pass: false, detail: 'No asset reference found in HTML' };
      const assetUrl = `${frontend}${match[1]}`;
      const res = await fetch(assetUrl, { mode: 'cors' });
      const text = await res.text();
      if (res.status === 200 && text.length > 0)
        return { pass: true, detail: `${match[1]} — ${text.length} bytes` };
      return { pass: false, detail: `${res.status}: ${assetUrl} (${text.length} bytes)` };
    },
  },
];

function statusIcon(status: TestStatus) {
  switch (status) {
    case 'pending': return <span className="text-muted-foreground">&#9679;</span>;
    case 'running': return <span className="text-yellow-500 animate-pulse">&#9654;</span>;
    case 'pass': return <span className="text-green-500">&#10003;</span>;
    case 'fail': return <span className="text-red-500">&#10007;</span>;
  }
}

export function TestRunnerPage() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [frontendBase, setFrontendBase] = useState(DEFAULT_FRONTEND_BASE);
  const [tests, setTests] = useState<TestResult[]>(
    testSuite.map((t) => ({ name: t.name, status: 'pending' as TestStatus }))
  );
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    const fresh: TestResult[] = testSuite.map((t) => ({ name: t.name, status: 'pending' as TestStatus }));
    setTests(fresh);

    const ctx: Record<string, string> = {};
    const api = apiBase.replace(/\/+$/, '');
    const frontend = frontendBase.replace(/\/+$/, '');

    for (let i = 0; i < testSuite.length; i++) {
      setTests((prev) =>
        prev.map((t, idx) => (idx === i ? { ...t, status: 'running' } : t))
      );

      const start = performance.now();
      let result: TestResult;
      try {
        const { pass, detail } = await testSuite[i].run(api, frontend, ctx);
        const durationMs = Math.round(performance.now() - start);
        result = { name: testSuite[i].name, status: pass ? 'pass' : 'fail', durationMs, detail };
      } catch (err: unknown) {
        const durationMs = Math.round(performance.now() - start);
        const message = err instanceof Error ? err.message : String(err);
        result = { name: testSuite[i].name, status: 'fail', durationMs, detail: `Error: ${message}` };
      }

      setTests((prev) =>
        prev.map((t, idx) => (idx === i ? result : t))
      );
    }

    setRunning(false);
  }, [apiBase, frontendBase]);

  const passed = tests.filter((t) => t.status === 'pass').length;
  const failed = tests.filter((t) => t.status === 'fail').length;
  const pending = tests.filter((t) => t.status === 'pending' || t.status === 'running').length;
  const totalMs = tests.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h1 className="text-xl font-semibold">Cloud Test Runner</h1>
        <Button onClick={runAll} disabled={running}>
          {running ? 'Running...' : 'Run All Tests'}
        </Button>
      </div>

      {/* Config inputs */}
      <div className="px-6 py-3 border-b border-border space-y-2">
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground w-28 shrink-0">API Base URL</label>
          <input
            type="text"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            className="flex-1 bg-secondary text-foreground rounded-md px-3 py-1.5 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={running}
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground w-28 shrink-0">Frontend URL</label>
          <input
            type="text"
            value={frontendBase}
            onChange={(e) => setFrontendBase(e.target.value)}
            className="flex-1 bg-secondary text-foreground rounded-md px-3 py-1.5 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={running}
          />
        </div>
      </div>

      {/* Summary bar */}
      <div className="px-6 py-2 border-b border-border flex gap-4 text-sm">
        <span className="text-green-500">{passed} passed</span>
        <span className="text-red-500">{failed} failed</span>
        <span className="text-muted-foreground">{pending} pending</span>
        <span className="text-muted-foreground ml-auto">{totalMs}ms total</span>
      </div>

      {/* Test list */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {tests.map((t, i) => (
            <div key={i} className="px-6 py-3 flex items-start gap-3">
              <span className="mt-0.5 text-lg leading-none w-5 text-center">{statusIcon(t.status)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.durationMs !== undefined && (
                    <span className="text-xs text-muted-foreground">{t.durationMs}ms</span>
                  )}
                </div>
                {t.detail && (
                  <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-all font-mono">
                    {t.detail}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
