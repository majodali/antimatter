/**
 * Tests for `deriveProjectLifecycle` (the new ProjectModel-based
 * lifecycle derivation in `derive.ts`). The state machine itself is
 * the same as the legacy `lifecycle.ts`, so these tests focus on the
 * input adaptation (validationPasses, container rollup) and a few
 * spot-checks of the regression / recovery paths.
 *
 * Identifiers used here: FT-FOUND-060..072.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import {
  assembleProjectModel,
  defineContext,
  defineRule,
  validation as v,
  action,
  deriveProjectLifecycle,
  validationKey,
  type LifecycleStatus,
} from '../index.js';

function modelWithLeaf(passes: Record<string, boolean>) {
  const r = defineRule({ id: 'r', name: 'R', on: 'x', run: 'x' });
  const c = defineContext({
    id: 'leaf', name: 'L', objective: 'x',
    action: action.agent({ description: 'a' }),
    validations: [
      { id: 'v', validation: v.ruleOutcome({ ruleId: 'r' }), resources: [] },
    ],
  });
  const m = assembleProjectModel({ contexts: [c], rules: [r] });
  return { m, passes: new Map(Object.entries(passes).map(([k, val]) => [validationKey('leaf', k), val])) };
}

describe('FT-FOUND-060 — leaf with no validations is done', () => {
  it('returns done for a context with zero validations and no children', () => {
    const c = defineContext({ id: 'l', name: 'L', objective: 'x', action: action.agent({ description: 'a' }) });
    const m = assembleProjectModel({ contexts: [c] });
    const out = deriveProjectLifecycle({ model: m, validationPasses: new Map(), priorStatuses: new Map() });
    expect(out.statuses.get('l')).toBe('done');
  });
});

describe('FT-FOUND-061 — single-validation leaf', () => {
  it('passes → done', () => {
    const { m, passes } = modelWithLeaf({ v: true });
    const out = deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: new Map() });
    expect(out.statuses.get('leaf')).toBe('done');
  });
  it('not passing → ready', () => {
    const { m, passes } = modelWithLeaf({ v: false });
    const out = deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: new Map() });
    expect(out.statuses.get('leaf')).toBe('ready');
  });
});

describe('FT-FOUND-062 — partial passing → in-progress', () => {
  it('two validations, one passing', () => {
    const r1 = defineRule({ id: 'a', name: 'A', on: 'x', run: 'x' });
    const r2 = defineRule({ id: 'b', name: 'B', on: 'x', run: 'x' });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'v1', validation: v.ruleOutcome({ ruleId: 'a' }), resources: [] },
        { id: 'v2', validation: v.ruleOutcome({ ruleId: 'b' }), resources: [] },
      ],
    });
    const m = assembleProjectModel({ contexts: [c], rules: [r1, r2] });
    const passes = new Map([[validationKey('c', 'v1'), true], [validationKey('c', 'v2'), false]]);
    const out = deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: new Map() });
    expect(out.statuses.get('c')).toBe('in-progress');
  });
});

describe('FT-FOUND-063 — parent rolls up children', () => {
  function tree(allChildrenDone: boolean) {
    const r = defineRule({ id: 'r', name: 'R', on: 'x', run: 'x' });
    const root = defineContext({ id: 'root', name: 'R', objective: 'x', action: action.plan({ description: 'p' }) });
    const a = defineContext({
      id: 'a', name: 'A', parentId: 'root', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [{ id: 'v', validation: v.ruleOutcome({ ruleId: 'r' }), resources: [] }],
    });
    const b = defineContext({
      id: 'b', name: 'B', parentId: 'root', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [{ id: 'v', validation: v.ruleOutcome({ ruleId: 'r' }), resources: [] }],
    });
    const m = assembleProjectModel({ contexts: [root, a, b], rules: [r] });
    const passes = new Map<string, boolean>();
    passes.set(validationKey('a', 'v'), true);
    passes.set(validationKey('b', 'v'), allChildrenDone);
    return deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: new Map() });
  }
  it('all children done → root done', () => {
    expect(tree(true).statuses.get('root')).toBe('done');
  });
  it('one child not done → root in-progress', () => {
    expect(tree(false).statuses.get('root')).toBe('in-progress');
  });
});

describe('FT-FOUND-064 — regression: prior=done, validation now failing', () => {
  it('flips done → regressed', () => {
    const { m, passes } = modelWithLeaf({ v: false });
    const prior = new Map<string, LifecycleStatus>([['leaf', 'done']]);
    const out = deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: prior });
    expect(out.statuses.get('leaf')).toBe('regressed');
  });
});

describe('FT-FOUND-065 — recovery: prior=regressed, validation passing again', () => {
  it('flips regressed → done', () => {
    const { m, passes } = modelWithLeaf({ v: true });
    const prior = new Map<string, LifecycleStatus>([['leaf', 'regressed']]);
    const out = deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: prior });
    expect(out.statuses.get('leaf')).toBe('done');
  });
});

describe('FT-FOUND-066 — transitions report only changes', () => {
  it('emits only contexts whose status changed', () => {
    const { m, passes } = modelWithLeaf({ v: true });
    const prior = new Map<string, LifecycleStatus>([['leaf', 'done']]);
    const out = deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: prior });
    expect(out.transitions).toEqual([]);
  });
  it('emits a transition when status changed', () => {
    const { m, passes } = modelWithLeaf({ v: true });
    const prior = new Map<string, LifecycleStatus>([['leaf', 'in-progress']]);
    const out = deriveProjectLifecycle({ model: m, validationPasses: passes, priorStatuses: prior });
    expect(out.transitions.length).toBe(1);
    expect(out.transitions[0]).toMatchObject({ contextId: 'leaf', from: 'in-progress', to: 'done' });
  });
});
