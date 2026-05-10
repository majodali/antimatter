/**
 * Tests for graph query helpers in `queries.ts`.
 *
 * Identifiers used here: FT-FOUND-040..050.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import {
  assembleProjectModel,
  defineContext,
  defineFileSet,
  defineRule,
  defineTest,
  defineTestSet,
  ref,
  action,
  output,
  rootContext,
  childrenOf,
  parentOf,
  ancestorsOf,
  descendantsOf,
  resolveResourceRef,
  resourcesOfKind,
  testSetsForTest,
  implicitDependencies,
  implicitDependents,
  rulesReading,
  rulesWriting,
} from '../index.js';

function buildSampleModel() {
  const root = defineContext({
    id: 'root', name: 'Root', objective: 'x',
    action: action.plan({ description: 'a' }),
  });
  const a = defineContext({
    id: 'a', name: 'A', parentId: 'root', objective: 'x',
    action: action.agent({ description: 'a' }),
    outputs: { bundle: output('file-set') },
  });
  const b = defineContext({
    id: 'b', name: 'B', parentId: 'root', objective: 'x',
    action: action.agent({ description: 'a' }),
    inputs: { dep: ref.contextOutput('a', 'bundle') },
  });
  const aa = defineContext({
    id: 'aa', name: 'AA', parentId: 'a', objective: 'x',
    action: action.agent({ description: 'a' }),
  });
  const fs = defineFileSet({ id: 'src', include: ['*.ts'] });
  const t1 = defineTest({ id: 'FT-X-001' });
  const t2 = defineTest({ id: 'FT-X-002' });
  const ts1 = defineTestSet({ id: 'set-A', members: ['FT-X-001'] });
  const ts2 = defineTestSet({ id: 'set-B', members: ['FT-X-001', 'FT-X-002'] });
  const r1 = defineRule({
    id: 'reader', name: 'Reader', on: 'x', run: 'x',
    reads: [ref.resource('src')],
  });
  const r2 = defineRule({
    id: 'writer', name: 'Writer', on: 'x', run: 'x',
    writes: [ref.resource('src')],
  });
  return assembleProjectModel({
    contexts: [root, a, b, aa],
    resources: [fs, t1, t2, ts1, ts2],
    rules: [r1, r2],
  });
}

describe('FT-FOUND-040 — rootContext', () => {
  it('returns the single root', () => {
    const m = buildSampleModel();
    expect(rootContext(m)?.id).toBe('root');
  });
  it('returns undefined for an empty model', () => {
    const m = assembleProjectModel({});
    expect(rootContext(m)).toBe(undefined);
  });
});

describe('FT-FOUND-041 — children / parent / ancestors / descendants', () => {
  it('childrenOf returns immediate children', () => {
    const m = buildSampleModel();
    expect(childrenOf(m, 'root').map(c => c.id).sort()).toEqual(['a', 'b']);
    expect(childrenOf(m, 'a').map(c => c.id)).toEqual(['aa']);
    expect(childrenOf(m, 'aa')).toEqual([]);
  });
  it('parentOf returns the parent or undefined', () => {
    const m = buildSampleModel();
    expect(parentOf(m, 'aa')?.id).toBe('a');
    expect(parentOf(m, 'root')).toBe(undefined);
  });
  it('ancestorsOf walks to the root', () => {
    const m = buildSampleModel();
    expect(ancestorsOf(m, 'aa').map(c => c.id)).toEqual(['a', 'root']);
  });
  it('descendantsOf gathers the subtree', () => {
    const m = buildSampleModel();
    expect(descendantsOf(m, 'root').map(c => c.id).sort()).toEqual(['a', 'aa', 'b']);
  });
});

describe('FT-FOUND-042 — resolveResourceRef', () => {
  it('resolves a resource ref to the declaration', () => {
    const m = buildSampleModel();
    const r = resolveResourceRef(m, ref.resource('src'));
    expect(r.kind).toBe('resource');
    if (r.kind === 'resource') expect(r.resource.id).toBe('src');
  });
  it('resolves a context-output ref', () => {
    const m = buildSampleModel();
    const r = resolveResourceRef(m, ref.contextOutput('a', 'bundle'));
    expect(r.kind).toBe('context-output');
  });
  it('reports unresolved ref to missing resource', () => {
    const m = buildSampleModel();
    const r = resolveResourceRef(m, ref.resource('nope'));
    expect(r.kind).toBe('unresolved');
  });
});

describe('FT-FOUND-043 — resourcesOfKind', () => {
  it('filters to the requested short kind name', () => {
    const m = buildSampleModel();
    expect(resourcesOfKind(m, 'file-set').map(r => r.id)).toEqual(['src']);
    expect(resourcesOfKind(m, 'test').map(r => r.id).sort()).toEqual(['FT-X-001', 'FT-X-002']);
    expect(resourcesOfKind(m, 'test-set').map(r => r.id).sort()).toEqual(['set-A', 'set-B']);
  });
});

describe('FT-FOUND-044 — testSetsForTest (many-to-many)', () => {
  it('returns every set containing the test id', () => {
    const m = buildSampleModel();
    expect(testSetsForTest(m, 'FT-X-001').map(t => t.id).sort()).toEqual(['set-A', 'set-B']);
    expect(testSetsForTest(m, 'FT-X-002').map(t => t.id)).toEqual(['set-B']);
    expect(testSetsForTest(m, 'FT-MISSING')).toEqual([]);
  });
});

describe('FT-FOUND-045 — implicit dependencies derive from inputs', () => {
  it('returns the producing context for a context-output input', () => {
    const m = buildSampleModel();
    expect(implicitDependencies(m, 'b').map(c => c.id)).toEqual(['a']);
    expect(implicitDependencies(m, 'a')).toEqual([]);
  });
  it('inverse — implicitDependents reports consumers', () => {
    const m = buildSampleModel();
    expect(implicitDependents(m, 'a').map(c => c.id)).toEqual(['b']);
    expect(implicitDependents(m, 'b')).toEqual([]);
  });
});

describe('FT-FOUND-046 — rulesReading / rulesWriting', () => {
  it('returns rules with matching reads/writes refs', () => {
    const m = buildSampleModel();
    expect(rulesReading(m, 'src').map(r => r.id)).toEqual(['reader']);
    expect(rulesWriting(m, 'src').map(r => r.id)).toEqual(['writer']);
  });
});
