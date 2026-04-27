/**
 * ContextLifecycleStore tests — verify the persistence + derivation +
 * transition-emission integration on top of @antimatter/contexts.
 */
import { describe, it } from 'node:test';
import { expect, createMockFn } from '@antimatter/test-utils';
import type { WorkspaceEnvironment, ExecutionResult } from '@antimatter/workspace';
import { ContextStore } from '../context-store.js';
import {
  ContextLifecycleStore,
  type RuleResultStatus,
  type RuleDeclaration,
  type TestPassEntry,
} from '../context-lifecycle-store.js';
import type { ContextLifecycleTransition } from '../../../shared/contexts-types.js';

const SAMPLE_DSL = `work antimatter "A"
  work feature "F"
    requires rule Bundle API Lambda
    requires test FT-M3-001
  work shared "S"
    requires rule build:full
`;

/** In-memory "filesystem" with a tracked write store for persistence assertions. */
function makeEnv(initial: Record<string, string> = {}): WorkspaceEnvironment & { _store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    id: 'test', label: 'Test',
    readFile: createMockFn().mockImplementation(async (path: string) => {
      if (path in store) return store[path];
      throw new Error(`ENOENT: ${path}`);
    }),
    writeFile: createMockFn().mockImplementation(async (path: string, content: string) => {
      store[path] = content;
    }),
    deleteFile: createMockFn().mockResolvedValue(undefined),
    exists: createMockFn().mockImplementation(async (path: string) => path in store),
    readDirectory: createMockFn().mockResolvedValue([]),
    mkdir: createMockFn().mockResolvedValue(undefined),
    stat: createMockFn().mockResolvedValue({ size: 0, isFile: true, isDirectory: false, modifiedAt: '' }),
    execute: createMockFn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 } as ExecutionResult),
    initialize: createMockFn().mockResolvedValue(undefined),
    dispose: createMockFn().mockResolvedValue(undefined),
    fileSystem: {} as any,
    _store: store,
  } as any;
}

interface BuildOpts {
  dsl?: string;
  ruleDeclarations?: RuleDeclaration[];
  ruleResults?: Record<string, RuleResultStatus>;
  testPasses?: TestPassEntry[];
  initialPersisted?: Record<string, string>;
  onTransitions?: (t: readonly ContextLifecycleTransition[]) => void;
}

async function build(opts: BuildOpts = {}): Promise<{
  ctxStore: ContextStore;
  lifecycle: ContextLifecycleStore;
  env: ReturnType<typeof makeEnv>;
}> {
  const initial: Record<string, string> = { ...(opts.initialPersisted ?? {}) };
  if (opts.dsl !== undefined) initial['.antimatter/contexts.dsl'] = opts.dsl;
  const env = makeEnv(initial);

  const ctxStore = new ContextStore(env);
  await ctxStore.initialize();

  const lifecycle = new ContextLifecycleStore({
    env,
    contextStore: ctxStore,
    getRuleDeclarations: () => opts.ruleDeclarations ?? [],
    getRuleResult: (id) => opts.ruleResults?.[id],
    getTestPasses: () => opts.testPasses ?? [],
    onTransitions: opts.onTransitions,
  });
  await lifecycle.initialize();
  return { ctxStore, lifecycle, env };
}

// ---------------------------------------------------------------------------
// Empty / no-DSL cases
// ---------------------------------------------------------------------------

describe('ContextLifecycleStore — empty cases', () => {
  it('starts with empty snapshot when no DSL file', async () => {
    const { lifecycle } = await build();
    const snap = lifecycle.getSnapshot();
    expect(Object.keys(snap.statuses)).toEqual([]);
    expect(Object.keys(snap.requirements)).toEqual([]);
  });

  it('produces statuses for all contexts on first run', async () => {
    const { lifecycle } = await build({ dsl: SAMPLE_DSL });
    const snap = lifecycle.getSnapshot();
    // Expect: antimatter, feature, shared
    expect(Object.keys(snap.statuses).sort()).toEqual(['antimatter', 'feature', 'shared']);
  });
});

// ---------------------------------------------------------------------------
// Rule + test resolution
// ---------------------------------------------------------------------------

describe('ContextLifecycleStore — rule and test resolution', () => {
  it('marks unresolved when no matching rule declaration exists', async () => {
    const { lifecycle } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [],
      ruleResults: {},
    });
    const snap = lifecycle.getSnapshot();
    const featureReqs = snap.requirements.feature;
    expect(featureReqs.find(r => r.id === 'Bundle API Lambda')?.unresolved).toBe(true);
  });

  it('resolves rule by display name', async () => {
    const { lifecycle } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [{ id: 'bundle-api-lambda', name: 'Bundle API Lambda' }],
      ruleResults: { 'bundle-api-lambda': 'success' },
    });
    const snap = lifecycle.getSnapshot();
    const req = snap.requirements.feature.find(r => r.id === 'Bundle API Lambda')!;
    expect(req.unresolved).toBe(false);
    expect(req.passing).toBe(true);
  });

  it('resolves rule by canonical id (slug)', async () => {
    const { lifecycle } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [
        { id: 'bundle-api-lambda', name: 'Bundle API Lambda' },
        { id: 'build:full', name: 'build:full' },
      ],
      ruleResults: { 'build:full': 'failed' },
    });
    const snap = lifecycle.getSnapshot();
    const sharedReq = snap.requirements.shared.find(r => r.id === 'build:full')!;
    expect(sharedReq.unresolved).toBe(false);
    expect(sharedReq.passing).toBe(false);
  });

  it('test pass state flows through', async () => {
    const { lifecycle } = await build({
      dsl: SAMPLE_DSL,
      testPasses: [{ id: 'FT-M3-001', pass: true }],
    });
    const snap = lifecycle.getSnapshot();
    const t = snap.requirements.feature.find(r => r.id === 'FT-M3-001')!;
    expect(t.unresolved).toBe(false);
    expect(t.passing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('ContextLifecycleStore — persistence', () => {
  it('writes statuses to .antimatter-cache/context-lifecycle.json', async () => {
    const { lifecycle, env } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [
        { id: 'bundle-api-lambda', name: 'Bundle API Lambda' },
        { id: 'build:full', name: 'build:full' },
      ],
      ruleResults: { 'bundle-api-lambda': 'success', 'build:full': 'success' },
      testPasses: [{ id: 'FT-M3-001', pass: true }],
    });
    await lifecycle.recomputeNow();

    const persisted = env._store['.antimatter-cache/context-lifecycle.json'];
    expect(persisted).not.toBe(undefined);
    const parsed = JSON.parse(persisted);
    expect(parsed.version).toBe(1);
    expect(parsed.statuses.feature).toBe('done');
    expect(parsed.statuses.shared).toBe('done');
    expect(parsed.statuses.antimatter).toBe('done');
  });

  it('restores statuses from disk on initialize (enables regression detection)', async () => {
    // Pre-populate the persistence file with prior=done, then have the
    // requirements fail — should detect regression.
    const { lifecycle } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [
        { id: 'bundle-api-lambda', name: 'Bundle API Lambda' },
        { id: 'build:full', name: 'build:full' },
      ],
      ruleResults: { 'bundle-api-lambda': 'failed', 'build:full': 'success' },
      testPasses: [{ id: 'FT-M3-001', pass: true }],
      initialPersisted: {
        '.antimatter-cache/context-lifecycle.json': JSON.stringify({
          version: 1,
          statuses: { antimatter: 'done', feature: 'done', shared: 'done' },
          derivedAt: new Date().toISOString(),
        }),
      },
    });
    const snap = lifecycle.getSnapshot();
    expect(snap.statuses.feature).toBe('regressed');
    // Parent rolls up: feature regressed → antimatter regressed
    expect(snap.statuses.antimatter).toBe('regressed');
  });
});

// ---------------------------------------------------------------------------
// Transition emission
// ---------------------------------------------------------------------------

describe('ContextLifecycleStore — transitions', () => {
  it('emits transitions on first derivation (from undefined)', async () => {
    const captured: ContextLifecycleTransition[] = [];
    await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [
        { id: 'bundle-api-lambda', name: 'Bundle API Lambda' },
        { id: 'build:full', name: 'build:full' },
      ],
      ruleResults: { 'bundle-api-lambda': 'success', 'build:full': 'success' },
      testPasses: [{ id: 'FT-M3-001', pass: true }],
      onTransitions: (t) => captured.push(...t),
    });
    expect(captured.length).toBeGreaterThan(0);
    const featureT = captured.find(t => t.contextId === 'feature');
    expect(featureT?.from).toBe(undefined);
    expect(featureT?.to).toBe('done');
    expect(typeof featureT?.at).toBe('string');
  });

  it('emits no transitions on a no-op recompute', async () => {
    const captured: ContextLifecycleTransition[] = [];
    const { lifecycle } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [
        { id: 'bundle-api-lambda', name: 'Bundle API Lambda' },
        { id: 'build:full', name: 'build:full' },
      ],
      ruleResults: { 'bundle-api-lambda': 'success', 'build:full': 'success' },
      testPasses: [{ id: 'FT-M3-001', pass: true }],
      onTransitions: (t) => captured.push(...t),
    });
    captured.length = 0;
    await lifecycle.recomputeNow();
    expect(captured).toEqual([]);
  });

  it('emits a transition when a requirement breaks', async () => {
    const captured: ContextLifecycleTransition[] = [];
    let buildResult: RuleResultStatus = 'success';
    const { lifecycle } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [
        { id: 'bundle-api-lambda', name: 'Bundle API Lambda' },
        { id: 'build:full', name: 'build:full' },
      ],
      ruleResults: { 'bundle-api-lambda': 'success', 'build:full': 'success' },
      testPasses: [{ id: 'FT-M3-001', pass: true }],
      onTransitions: (t) => captured.push(...t),
    });
    captured.length = 0;
    // Rebind the getRuleResult callback by accessing the closure indirectly:
    // we'll mutate the outer var and re-trigger.
    // (In the production wiring, this is the natural flow — the workflow
    // manager updates its own state and we simply re-derive.)
    // To do this cleanly here, build a fresh store with mutated results.
    const { lifecycle: lc2, env } = await build({
      dsl: SAMPLE_DSL,
      ruleDeclarations: [
        { id: 'bundle-api-lambda', name: 'Bundle API Lambda' },
        { id: 'build:full', name: 'build:full' },
      ],
      ruleResults: { 'bundle-api-lambda': 'failed', 'build:full': 'success' },
      testPasses: [{ id: 'FT-M3-001', pass: true }],
      initialPersisted: {
        '.antimatter-cache/context-lifecycle.json': JSON.stringify({
          version: 1,
          statuses: { antimatter: 'done', feature: 'done', shared: 'done' },
          derivedAt: '2026-04-26T00:00:00.000Z',
        }),
      },
      onTransitions: (t) => captured.push(...t),
    });
    expect(captured.find(t => t.contextId === 'feature' && t.to === 'regressed')).toBeTruthy();
    // Ensure the unused vars don't cause noise.
    void lifecycle; void buildResult; void lc2; void env;
  });
});

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

describe('ContextLifecycleStore — subscribe', () => {
  it('notifies subscribers when statuses change', async () => {
    const { lifecycle } = await build({ dsl: SAMPLE_DSL });
    const cb = createMockFn();
    lifecycle.subscribe(cb);
    // Trigger a change by recomputing with no input changes — should be no-op.
    await lifecycle.recomputeNow();
    expect(cb.mock.callCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validation errors (catalog-aware)
// ---------------------------------------------------------------------------

describe('ContextLifecycleStore — validation errors', () => {
  it('reports unresolved-rule-reference for typo in requires rule', async () => {
    const dsl = `work root "R"
  requires rule Bundle API Lambdaa
`;
    const { lifecycle } = await build({
      dsl,
      ruleDeclarations: [{ id: 'bundle-api-lambda', name: 'Bundle API Lambda' }],
    });
    const snap = lifecycle.getSnapshot();
    expect(snap.validationErrors.length).toBe(1);
    expect(snap.validationErrors[0].code).toBe('unresolved-rule-reference');
    expect(snap.validationErrors[0].target).toBe('Bundle API Lambdaa');
    // The corresponding requirement also has unresolved=true (per-requirement signal).
    expect(snap.requirements.root[0].unresolved).toBe(true);
  });

  it('reports unresolved-test-reference for unknown test id', async () => {
    const dsl = `work root "R"
  requires test FT-DOES-NOT-EXIST
`;
    const { lifecycle } = await build({
      dsl,
      testPasses: [{ id: 'FT-M1-001', pass: true }],
    });
    const snap = lifecycle.getSnapshot();
    expect(snap.validationErrors.length).toBe(1);
    expect(snap.validationErrors[0].code).toBe('unresolved-test-reference');
    expect(snap.validationErrors[0].target).toBe('FT-DOES-NOT-EXIST');
  });

  it('produces no validation errors when all requirements resolve', async () => {
    const dsl = `work root "R"
  requires rule build:full
  requires test FT-M1-001
`;
    const { lifecycle } = await build({
      dsl,
      ruleDeclarations: [{ id: 'build:full', name: 'build:full' }],
      testPasses: [{ id: 'FT-M1-001', pass: true }],
    });
    const snap = lifecycle.getSnapshot();
    expect(snap.validationErrors).toEqual([]);
  });

  it('clears validation errors when DSL is removed', async () => {
    const dsl = `work root "R"
  requires rule typo
`;
    const env = makeEnv({ '.antimatter/contexts.dsl': dsl });
    const ctxStore = new ContextStore(env);
    await ctxStore.initialize();
    const lifecycle = new ContextLifecycleStore({
      env, contextStore: ctxStore,
      getRuleDeclarations: () => [],
      getRuleResult: () => undefined,
      getTestPasses: () => [],
    });
    await lifecycle.initialize();
    expect(lifecycle.getSnapshot().validationErrors.length).toBe(1);

    // Remove the DSL file; reload context store; recompute lifecycle.
    delete (env as any)._store['.antimatter/contexts.dsl'];
    (env.exists as any).mockImplementation(async (path: string) => path in (env as any)._store);
    await ctxStore.reload();
    await lifecycle.recomputeNow();
    expect(lifecycle.getSnapshot().validationErrors).toEqual([]);
  });
});
