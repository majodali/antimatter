/**
 * ContextStore tests — verify the server-side wrapper around
 * @antimatter/contexts that ProjectContext uses.
 */
import { describe, it } from 'node:test';
import { expect, createMockFn } from '@antimatter/test-utils';
import type { WorkspaceEnvironment, ExecutionResult } from '@antimatter/workspace';
import { ContextStore } from '../context-store.js';

const SAMPLE_DSL = `work antimatter "Antimatter IDE"
  work feature "F"
    targets staging
    depends shared
  work shared "S"
  runtime staging "Staging"
  runtime production
`;

function makeEnv(opts: { exists?: boolean; content?: string; readError?: Error } = {}): WorkspaceEnvironment {
  return {
    id: 'test-env',
    label: 'Test',
    readFile: createMockFn().mockImplementation(async () => {
      if (opts.readError) throw opts.readError;
      return opts.content ?? '';
    }),
    writeFile: createMockFn().mockResolvedValue(undefined),
    deleteFile: createMockFn().mockResolvedValue(undefined),
    exists: createMockFn().mockResolvedValue(opts.exists ?? false),
    readDirectory: createMockFn().mockResolvedValue([]),
    mkdir: createMockFn().mockResolvedValue(undefined),
    stat: createMockFn().mockResolvedValue({ size: 0, isFile: true, isDirectory: false, modifiedAt: '' }),
    execute: createMockFn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 } as ExecutionResult),
    initialize: createMockFn().mockResolvedValue(undefined),
    dispose: createMockFn().mockResolvedValue(undefined),
    fileSystem: {} as any,
  };
}

describe('ContextStore — file-not-present', () => {
  it('starts empty when contexts.dsl is absent', async () => {
    const store = new ContextStore(makeEnv({ exists: false }));
    await store.initialize();
    const snap = store.getSnapshot();
    expect(snap.present).toBe(false);
    expect(snap.nodes).toEqual([]);
    expect(snap.edges).toEqual([]);
    expect(snap.errors).toEqual([]);
  });
});

describe('ContextStore — happy path', () => {
  it('parses a valid contexts.dsl into a clean snapshot', async () => {
    const store = new ContextStore(makeEnv({ exists: true, content: SAMPLE_DSL }));
    await store.initialize();
    const snap = store.getSnapshot();

    expect(snap.present).toBe(true);
    expect(snap.errors).toEqual([]);
    expect(snap.rootName).toBe('antimatter');

    expect(snap.nodes.map(n => n.name).sort()).toEqual([
      'antimatter', 'feature', 'production', 'shared', 'staging',
    ]);

    const feature = snap.nodes.find(n => n.name === 'feature')!;
    expect(feature.kind).toBe('work');
    expect(feature.parent).toBe('antimatter');
    expect(feature.targets).toEqual(['staging']);
    expect(feature.dependsOn).toEqual(['shared']);

    const staging = snap.nodes.find(n => n.name === 'staging')!;
    expect(staging.kind).toBe('runtime');

    // Edges: 4 contains, 1 targets, 1 depends_on
    const containsEdges = snap.edges.filter(e => e.type === 'contains');
    const targetsEdges = snap.edges.filter(e => e.type === 'targets');
    const dependsEdges = snap.edges.filter(e => e.type === 'depends_on');
    expect(containsEdges.length).toBe(4);
    expect(targetsEdges.length).toBe(1);
    expect(dependsEdges.length).toBe(1);
  });
});

describe('ContextStore — validation errors surface', () => {
  it('reports cross-kind violations without throwing', async () => {
    const dsl = `work root "R"
  work feature "F"
    targets shared
  work shared "S"
`;
    const store = new ContextStore(makeEnv({ exists: true, content: dsl }));
    await store.initialize();
    const snap = store.getSnapshot();
    expect(snap.errors.some(e => e.code === 'targets-target-kind')).toBe(true);
    // Snapshot still includes the model — UI can render with the error overlay.
    expect(snap.nodes.length).toBe(3);
  });
});

describe('ContextStore — read failure', () => {
  it('surfaces a read error as a validation error rather than throwing', async () => {
    const store = new ContextStore(makeEnv({
      exists: true,
      readError: new Error('disk fault'),
    }));
    await store.initialize();
    const snap = store.getSnapshot();
    expect(snap.present).toBe(true);
    expect(snap.errors.length).toBe(1);
    expect(snap.errors[0].message).toContain('disk fault');
  });
});

describe('ContextStore — subscribe', () => {
  it('notifies subscribers only when content actually changes', async () => {
    const env = makeEnv({ exists: true, content: SAMPLE_DSL });
    const store = new ContextStore(env);
    await store.initialize();

    const cb = createMockFn();
    const unsubscribe = store.subscribe(cb);

    // Reload with same content — no notification.
    await store.reload();
    expect(cb.mock.callCount()).toBe(0);

    // Mutate underlying content — reload should fire.
    (env.readFile as any).mockImplementation(async () => SAMPLE_DSL + '  runtime extra "Extra"\n');
    await store.reload();
    expect(cb.mock.callCount()).toBe(1);

    // Unsubscribe stops further notifications.
    unsubscribe();
    (env.readFile as any).mockImplementation(async () => SAMPLE_DSL);
    await store.reload();
    expect(cb.mock.callCount()).toBe(1);
  });
});

describe('ContextStore — file-path matcher', () => {
  it('recognizes the canonical contexts file path', () => {
    expect(ContextStore.isContextsFile('.antimatter/contexts.dsl')).toBe(true);
    expect(ContextStore.isContextsFile('/.antimatter/contexts.dsl')).toBe(true);
    expect(ContextStore.isContextsFile('.antimatter/contexts.txt')).toBe(false);
    expect(ContextStore.isContextsFile('src/foo.ts')).toBe(false);
  });
});
