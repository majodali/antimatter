export type Suite = 'smoke' | 'functional';

export interface TestResult {
  name: string;
  pass: boolean;
  durationMs: number;
  detail: string;
  suite: Suite;
}

export interface TestRunResponse {
  results: TestResult[];
  summary: { total: number; passed: number; failed: number; durationMs: number };
}

export type TestDef = {
  name: string;
  suite: Suite;
  run: (ctx: Record<string, string>) => Promise<{ pass: boolean; detail: string }>;
};
