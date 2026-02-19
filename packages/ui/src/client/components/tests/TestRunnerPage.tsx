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
  const [tests, setTests] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    setTests([{ name: 'Running tests...', status: 'running' }]);

    try {
      const res = await fetch('/api/tests/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBase, frontendBase }),
      });
      const data = await res.json();

      if (!res.ok) {
        setTests([{ name: 'Server error', status: 'fail', detail: data.message || data.error }]);
        setRunning(false);
        return;
      }

      setTests(
        data.results.map((r: any) => ({
          name: r.name,
          status: r.pass ? 'pass' : 'fail',
          durationMs: r.durationMs,
          detail: r.detail,
        })),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTests([{ name: 'Request failed', status: 'fail', detail: message }]);
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
