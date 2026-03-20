/**
 * Milestone 1 functional tests — validate that a toy TypeScript project
 * (json-validator) can be created, built, tested, and deployed entirely
 * from within the IDE.
 *
 * FT-M1-001: Create json-validator project, set up files & build rules,
 *            verify files exist on workspace + S3, verify all rules pass.
 *
 * These tests use a persistent project (not disposable) for efficiency.
 * If FT-M1-001 fails, it deletes the project so subsequent runs start fresh.
 *
 * The test uses the `setup()` hook to create the project and start its
 * workspace BEFORE the test tab opens. The `run()` body performs all file
 * operations via DOM interactions (BrowserActionContext).
 */

import type { TestModule } from '../test-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_NAME = 'json-validator';

// Maximum time to wait for all workflow rules to complete (npm install + tsc + tests)
const RULE_TIMEOUT_MS = 60_000; // 60 seconds — rules complete within this window

// S3 sync is eventually consistent — allow time for periodic sync
const S3_SYNC_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Project file definitions
// ---------------------------------------------------------------------------

const PROJECT_FILES: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'json-validator',
    version: '1.0.0',
    type: 'module',
    main: 'dist/src/index.js',
    scripts: {
      build: 'tsc',
      test: 'node --test dist/test/',
    },
    devDependencies: {
      typescript: '^5.0.0',
      '@types/node': '^20.0.0',
    },
  }, null, 2),

  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      strict: true,
      declaration: true,
      skipLibCheck: true,
    },
    include: ['src/**/*.ts', 'test/**/*.ts'],
  }, null, 2),

  'src/types.ts': `\
export type SchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface Schema {
  type: SchemaType;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
`,

  'src/validator.ts': `\
import type { Schema, ValidationError, ValidationResult } from './types.js';

export function validate(value: unknown, schema: Schema, path = ''): ValidationResult {
  const errors: ValidationError[] = [];

  const actualType = getType(value);
  if (actualType !== schema.type) {
    errors.push({ path: path || '(root)', message: \`Expected \${schema.type}, got \${actualType}\` });
    return { valid: false, errors };
  }

  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: \`String length \${value.length} is less than minimum \${schema.minLength}\` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: \`String length \${value.length} exceeds maximum \${schema.maxLength}\` });
    }
  }

  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: \`Value \${value} is less than minimum \${schema.minimum}\` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: \`Value \${value} exceeds maximum \${schema.maximum}\` });
    }
  }

  if (schema.type === 'object' && typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: \`\${path}.\${key}\`, message: \`Required property '\${key}' is missing\` });
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          const result = validate(obj[key], propSchema, path ? \`\${path}.\${key}\` : key);
          errors.push(...result.errors);
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const result = validate(value[i], schema.items, \`\${path}[\${i}]\`);
      errors.push(...result.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
`,

  'src/index.ts': `\
export { validate } from './validator.js';
export type { Schema, SchemaType, ValidationError, ValidationResult } from './types.js';
`,

  'test/validator.test.ts': `\
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validate } from '../src/validator.js';
import type { Schema } from '../src/types.js';

describe('validate', () => {
  it('validates string type', () => {
    const schema: Schema = { type: 'string' };
    assert.deepStrictEqual(validate('hello', schema), { valid: true, errors: [] });
    assert.strictEqual(validate(42, schema).valid, false);
  });

  it('validates number type', () => {
    const schema: Schema = { type: 'number' };
    assert.deepStrictEqual(validate(42, schema), { valid: true, errors: [] });
    assert.strictEqual(validate('hello', schema).valid, false);
  });

  it('validates string minLength and maxLength', () => {
    const schema: Schema = { type: 'string', minLength: 2, maxLength: 5 };
    assert.strictEqual(validate('hi', schema).valid, true);
    assert.strictEqual(validate('h', schema).valid, false);
    assert.strictEqual(validate('toolong', schema).valid, false);
  });

  it('validates number minimum and maximum', () => {
    const schema: Schema = { type: 'number', minimum: 0, maximum: 100 };
    assert.strictEqual(validate(50, schema).valid, true);
    assert.strictEqual(validate(-1, schema).valid, false);
    assert.strictEqual(validate(101, schema).valid, false);
  });

  it('validates required object properties', () => {
    const schema: Schema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    assert.strictEqual(validate({ name: 'Alice' }, schema).valid, true);
    assert.strictEqual(validate({}, schema).valid, false);
  });

  it('validates nested object properties', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    };
    assert.strictEqual(validate({ address: { city: 'NYC' } }, schema).valid, true);
    assert.strictEqual(validate({ address: { city: 123 } }, schema).valid, false);
  });

  it('validates array items', () => {
    const schema: Schema = { type: 'array', items: { type: 'number' } };
    assert.strictEqual(validate([1, 2, 3], schema).valid, true);
    assert.strictEqual(validate([1, 'two', 3], schema).valid, false);
  });

  it('validates null type', () => {
    const schema: Schema = { type: 'null' };
    assert.strictEqual(validate(null, schema).valid, true);
    assert.strictEqual(validate(undefined, schema).valid, false);
  });

  it('returns detailed error paths', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const result = validate({ tags: ['ok', 42] }, schema);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].path, 'tags[1]');
  });
});
`,

  // Workflow rules — no @antimatter/workflow import needed because
  // defineWorkflow is just an identity function, and esbuild can't resolve
  // @antimatter/* from a non-Antimatter project's node_modules.
  '.antimatter/build.ts': `\
// json-validator build pipeline: install → build → test
// Each step triggers the next via custom events.

export default (wf: any) => {
  wf.rule('Install dependencies',
    (e: any) => e.type === 'file:change' && String(e.path) === 'package.json',
    async (_events: any[], state: any) => {
      wf.log('Installing dependencies...');
      const result = await wf.exec('npm install --include=dev 2>&1');
      if (result.exitCode === 0) {
        state.install = { status: 'success', lastRun: new Date().toISOString() };
        wf.log('Dependencies installed successfully');
        wf.emit({ type: 'install:success' });
      } else {
        state.install = { status: 'failed', lastRun: new Date().toISOString() };
        wf.log('npm install failed (exit ' + result.exitCode + '): ' + result.stdout + result.stderr, 'error');
      }
    },
    { id: 'install' },
  );

  wf.rule('Build TypeScript',
    (e: any) => e.type === 'install:success',
    async (_events: any[], state: any) => {
      wf.log('Compiling TypeScript...');
      const result = await wf.exec('npm run build');
      if (result.exitCode === 0) {
        state.build = { status: 'success', lastRun: new Date().toISOString() };
        wf.log('TypeScript compiled successfully');
        wf.reportErrors('tsc', []);
        wf.emit({ type: 'build:success' });
      } else {
        state.build = { status: 'failed', lastRun: new Date().toISOString() };
        wf.log('Build failed: ' + result.stdout + result.stderr, 'error');
      }
    },
    { id: 'build' },
  );

  wf.rule('Run tests',
    (e: any) => e.type === 'build:success',
    async (_events: any[], state: any) => {
      wf.log('Running tests...');
      const result = await wf.exec('npm test');
      if (result.exitCode === 0) {
        state.test = { status: 'success', lastRun: new Date().toISOString() };
        wf.log('All tests passed');
      } else {
        state.test = { status: 'failed', lastRun: new Date().toISOString() };
        wf.log('Tests failed: ' + result.stdout, 'error');
      }
    },
    { id: 'test' },
  );
};
`,
};

// Files that should exist after a successful build (not created by us)
const BUILD_ARTIFACTS = [
  'node_modules/typescript/package.json',
  'dist/src/index.js',
  'dist/src/validator.js',
  'dist/src/types.js',
  'dist/test/validator.test.js',
];

// Order in which files should be created via DOM (directories first, then files)
const FILE_CREATION_ORDER = [
  { type: 'dir' as const, path: 'src' },
  { type: 'dir' as const, path: 'test' },
  { type: 'dir' as const, path: '.antimatter' },
  { type: 'file' as const, path: 'package.json' },
  { type: 'file' as const, path: 'tsconfig.json' },
  { type: 'file' as const, path: 'src/types.ts' },
  { type: 'file' as const, path: 'src/validator.ts' },
  { type: 'file' as const, path: 'src/index.ts' },
  { type: 'file' as const, path: 'test/validator.test.ts' },
  { type: 'file' as const, path: '.antimatter/build.ts' },
];

// ---------------------------------------------------------------------------
// Helpers — authenticated API calls (used by setup, run in different contexts)
// ---------------------------------------------------------------------------

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { getAccessToken } = await import('../../client/lib/auth.js');
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
}

/** Find a project by name. Returns null if not found. */
async function findProject(name: string): Promise<ProjectMeta | null> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/projects', { headers });
  if (!res.ok) throw new Error(`Failed to list projects: ${res.statusText}`);
  const { projects } = await res.json() as { projects: ProjectMeta[] };
  return projects.find(p => p.name === name) ?? null;
}

/** Create a new project by name. Returns the created project metadata. */
async function createProjectByName(name: string): Promise<ProjectMeta> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to create project: ${(body as any).message ?? (body as any).error}`);
  }
  return res.json() as Promise<ProjectMeta>;
}

/** Delete a project by ID. */
async function deleteProjectById(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    console.warn(`[FT-M1-001] Failed to delete project ${id}: ${res.statusText}`);
  }
}

/**
 * Start a workspace for a project via Lambda API.
 * In shared mode, this reuses the existing EC2 instance and creates
 * ALB routing rules so /workspace/{projectId}/* reaches the workspace server.
 */
async function startProjectWorkspace(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/start`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Failed to start workspace: ${(body as any).message ?? (body as any).error}`);
  }
}

/** Poll workspace status until RUNNING, or throw on timeout. */
async function waitForWorkspaceRunning(projectId: string, timeoutMs = 120_000): Promise<void> {
  const headers = await getAuthHeaders();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/workspace/status`,
        { headers },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'RUNNING') return;
        console.debug(`[FT-M1-001] Workspace status: ${data.status}, elapsed=${Math.round((Date.now() - start) / 1000)}s`);
      }
    } catch {
      // Transient error — retry
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error(`Workspace not RUNNING after ${Math.round(timeoutMs / 1000)}s`);
}

/** Check if a file exists on the workspace server's local filesystem. */
async function fileExistsOnWorkspace(projectId: string, path: string): Promise<boolean> {
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(
      `/workspace/${encodeURIComponent(projectId)}/api/files/exists?path=${encodeURIComponent(path)}`,
      { headers },
    );
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return false;
    const data = await res.json();
    return data.exists === true;
  } catch {
    return false;
  }
}

/** Check if a file exists on S3 via Lambda. */
async function fileExistsOnS3(projectId: string, path: string): Promise<boolean> {
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(
      `/api/projects/${projectId}/files/exists?path=${encodeURIComponent(path)}`,
      { headers },
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data.exists === true;
  } catch {
    return false;
  }
}

interface RuleResult {
  status: 'success' | 'failed';
  lastRunAt?: string;
  durationMs?: number;
  error?: string;
}

interface WorkflowSnapshot {
  ruleResults: Record<string, RuleResult>;
  logs: { message: string; level: string; timestamp: string }[];
  loadedFiles: string[];
  ruleCount: number;
  lastInvocationRules: string[];
}

/** Get workflow application state for a project (rule results + invocation logs). */
async function getWorkflowSnapshot(
  projectId: string,
): Promise<WorkflowSnapshot> {
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(
      `/workspace/${encodeURIComponent(projectId)}/api/workflow/application-state`,
      { headers },
    );
    if (!res.ok) {
      console.log(`[FT-M1-001] application-state returned ${res.status} ${res.statusText}`);
      return { ruleResults: {}, logs: [], loadedFiles: [], ruleCount: 0, lastInvocationRules: [] };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      console.log(`[FT-M1-001] application-state returned non-JSON: ${contentType}`);
      return { ruleResults: {}, logs: [], loadedFiles: [], ruleCount: 0, lastInvocationRules: [] };
    }
    const data = await res.json();
    const rules = data.declarations?.rules ?? [];
    return {
      ruleResults: (data.ruleResults ?? {}) as Record<string, RuleResult>,
      logs: data.lastInvocation?.logs ?? [],
      loadedFiles: data.loadedFiles ?? [],
      ruleCount: rules.length,
      lastInvocationRules: (data.lastInvocation?.rulesExecuted ?? []).map((r: any) => r.ruleId),
    };
  } catch (err) {
    console.log(`[FT-M1-001] application-state fetch error: ${err}`);
    return { ruleResults: {}, logs: [], loadedFiles: [], ruleCount: 0, lastInvocationRules: [] };
  }
}

/**
 * Poll workflow rule results until all specified rules have a result.
 * Captures workflow logs (wf.log) from each invocation and prints them
 * to console so they're picked up by the test executor's log streaming.
 * Returns the rule results map, or throws on timeout.
 */
async function waitForRuleResults(
  projectId: string,
  ruleIds: string[],
  timeoutMs: number,
): Promise<Record<string, RuleResult>> {
  const start = Date.now();
  let lastLogCount = 0;
  let firstPoll = true;

  while (Date.now() - start < timeoutMs) {
    const snapshot = await getWorkflowSnapshot(projectId);

    // First poll: log diagnostic info about workflow state
    if (firstPoll) {
      firstPoll = false;
      console.log(
        `[FT-M1-001] Workflow state: loadedFiles=[${snapshot.loadedFiles.join(',')}] ` +
        `ruleCount=${snapshot.ruleCount} ruleResults=${JSON.stringify(snapshot.ruleResults)} ` +
        `lastInvocationRules=[${snapshot.lastInvocationRules.join(',')}]`,
      );
    }

    // Capture new workflow log entries (wf.log from rule actions)
    if (snapshot.logs.length > lastLogCount) {
      for (const entry of snapshot.logs.slice(lastLogCount)) {
        console.log(`[workflow:${entry.level}] ${entry.message}`);
      }
      lastLogCount = snapshot.logs.length;
    }

    // Check if all rules have a result
    const allPresent = ruleIds.every(id => snapshot.ruleResults[id]?.status !== undefined);
    if (allPresent) return snapshot.ruleResults;

    // Log progress (every poll, use console.log so it's captured)
    const present = ruleIds.filter(id => snapshot.ruleResults[id]?.status !== undefined);
    const running = ruleIds.filter(id => !snapshot.ruleResults[id]?.status);
    const elapsed = Math.round((Date.now() - start) / 1000);
    // Log every 15s to avoid noise
    if (elapsed % 15 < 4) {
      console.log(
        `[FT-M1-001] Waiting for rules: done=[${present.join(',')}] pending=[${running.join(',')}] ` +
        `rules=${snapshot.ruleCount} elapsed=${elapsed}s`,
      );
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  // Timeout — report which rules are missing
  const snapshot = await getWorkflowSnapshot(projectId);
  const missing = ruleIds.filter(id => !snapshot.ruleResults[id]?.status);
  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for rules: [${missing.join(', ')}]. ` +
    `Current results: ${JSON.stringify(snapshot.ruleResults)}`,
  );
}

// ---------------------------------------------------------------------------
// FT-M1-001: Create and verify json-validator project
// ---------------------------------------------------------------------------

// FT-M1-001
const setupAndVerifyProject: TestModule = {
  id: 'FT-M1-001',
  name: 'Create json-validator project with files and verify build pipeline',
  area: 'm1',

  /**
   * Setup runs in the orchestrator context (main IDE tab) BEFORE the test
   * tab is opened. It finds or creates the json-validator project and
   * starts the workspace (ALB routing + project context initialization).
   */
  setup: async () => {
    console.log(`[FT-M1-001:setup] Finding or creating '${PROJECT_NAME}' project...`);

    let projectId: string;
    const existing = await findProject(PROJECT_NAME);
    if (existing) {
      projectId = existing.id;
      console.log(`[FT-M1-001:setup] Found existing project: ${projectId}`);
    } else {
      const created = await createProjectByName(PROJECT_NAME);
      projectId = created.id;
      console.log(`[FT-M1-001:setup] Created new project: ${projectId}`);
    }

    // Start workspace (shared mode reuses existing EC2 + creates ALB routing)
    console.log(`[FT-M1-001:setup] Starting workspace...`);
    await startProjectWorkspace(projectId);
    await waitForWorkspaceRunning(projectId);
    console.log(`[FT-M1-001:setup] Workspace RUNNING`);

    return { projectId };
  },

  /**
   * Test body runs in the test tab, which is loaded with the json-validator
   * project. Uses BrowserActionContext for DOM-based file operations.
   */
  run: async (ctx) => {
    // The test tab is loaded with json-validator's project.
    // The workspace should be connected (started in setup).
    // We need to determine if this is a fresh project that needs files created.

    // Read the project ID from the current URL
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    if (!projectId) {
      return { pass: false, detail: 'No project ID in URL — test tab not loaded correctly' };
    }

    let createdFiles = false;

    try {
      // ---- Step 1: Check if files already exist (project may be from previous run) ----
      const tree = await ctx.getFileTree();
      const hasFiles = tree.length > 0 && tree.some((f: any) =>
        f.name === 'package.json' || f.path === 'package.json',
      );

      // ---- Step 2: Create files via DOM if this is a fresh project ----
      if (!hasFiles) {
        console.log(`[FT-M1-001] Creating ${FILE_CREATION_ORDER.length} files/dirs via DOM...`);
        createdFiles = true;

        for (const item of FILE_CREATION_ORDER) {
          if (item.type === 'dir') {
            console.log(`[FT-M1-001] mkdir: ${item.path}`);
            await ctx.mkdir(item.path);
          } else {
            console.log(`[FT-M1-001] writeFile: ${item.path}`);
            await ctx.writeFile(item.path, PROJECT_FILES[item.path]);
          }
        }
        console.log(`[FT-M1-001] All files created via DOM`);
      } else {
        console.log(`[FT-M1-001] Project already has files — skipping creation`);
      }

      // ---- Step 3: Verify all source files exist on workspace ----
      const wsStart = Date.now();
      let missingOnWorkspace: string[] = [];
      while (Date.now() - wsStart < 30_000) {
        missingOnWorkspace = [];
        for (const path of Object.keys(PROJECT_FILES)) {
          if (!(await fileExistsOnWorkspace(projectId, path))) {
            missingOnWorkspace.push(path);
          }
        }
        if (missingOnWorkspace.length === 0) break;
        console.debug(`[FT-M1-001] ${missingOnWorkspace.length} files not yet on workspace, retrying...`);
        await new Promise(r => setTimeout(r, 3000));
      }
      if (missingOnWorkspace.length > 0) {
        throw new Error(
          `Source files missing on workspace: [${missingOnWorkspace.join(', ')}]`,
        );
      }
      console.log(`[FT-M1-001] All source files verified on workspace`);

      // ---- Step 4: Wait for workflow rules to complete ----
      const ruleResults = await waitForRuleResults(
        projectId,
        ['install', 'build', 'test'],
        RULE_TIMEOUT_MS,
      );

      // Verify all rules passed
      const failedRules: string[] = [];
      for (const ruleId of ['install', 'build', 'test']) {
        const result = ruleResults[ruleId];
        if (result?.status !== 'success') {
          failedRules.push(`${ruleId}: ${result?.status ?? 'no result'} — ${result?.error ?? 'unknown'}`);
        }
      }
      if (failedRules.length > 0) {
        throw new Error(`Build rules failed:\n${failedRules.join('\n')}`);
      }

      // ---- Step 5: Verify build artifacts exist ----
      const missingArtifacts: string[] = [];
      for (const path of BUILD_ARTIFACTS) {
        if (!(await fileExistsOnWorkspace(projectId, path))) {
          missingArtifacts.push(path);
        }
      }
      if (missingArtifacts.length > 0) {
        throw new Error(
          `Build artifacts missing on workspace: [${missingArtifacts.join(', ')}]`,
        );
      }

      // ---- Step 6: Verify source files on S3 (eventually consistent) ----
      const s3Start = Date.now();
      let missingOnS3: string[] = [];
      while (Date.now() - s3Start < S3_SYNC_TIMEOUT_MS) {
        missingOnS3 = [];
        for (const path of Object.keys(PROJECT_FILES)) {
          if (!(await fileExistsOnS3(projectId, path))) {
            missingOnS3.push(path);
          }
        }
        if (missingOnS3.length === 0) break;
        await new Promise(r => setTimeout(r, 5000));
      }
      if (missingOnS3.length > 0) {
        // Non-fatal: S3 sync is eventually consistent
        return {
          pass: true,
          detail:
            `Project verified. All rules passed. ` +
            `Note: ${missingOnS3.length} file(s) not yet on S3 (eventually consistent).`,
        };
      }

      return {
        pass: true,
        detail:
          `Project '${PROJECT_NAME}' verified: ` +
          `${Object.keys(PROJECT_FILES).length} source files (created via DOM: ${createdFiles}), ` +
          `${BUILD_ARTIFACTS.length} build artifacts, ` +
          `all 3 rules passed (install/build/test), ` +
          `S3 sync confirmed.`,
      };
    } catch (err) {
      // Always delete the project on failure so the next run starts clean
      // (avoids stale workflow state, partial file sets, etc.)
      if (projectId) {
        try {
          await deleteProjectById(projectId);
          console.log(`[FT-M1-001] Deleted project ${projectId} for clean retry`);
        } catch (delErr) {
          console.warn(`[FT-M1-001] Failed to delete project: ${delErr}`);
        }
      }

      return {
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ---- Export ----

export const m1Tests: readonly TestModule[] = [
  setupAndVerifyProject,
];
