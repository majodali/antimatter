/**
 * Tests for `traceRegression`. The function is pure — given a model
 * and collaborator stubs it returns a structured explanation.
 *
 * Identifiers used here: FT-REGRESS-001..010.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import {
  KIND,
  assembleProjectModel,
  defineContext,
  defineDeployedResource,
  defineRule,
  defineTest,
  defineTestSet,
  ref,
  validation,
  action,
  output,
  traceRegression,
  type LifecycleStatus,
  type TraceCollaborators,
} from '../index.js';

function fixedStatus(map: Record<string, LifecycleStatus>): TraceCollaborators['getLifecycleStatus'] {
  return (id: string) => map[id];
}

describe('FT-REGRESS-001 — trace returns null for unknown context', () => {
  it('handles missing id gracefully', () => {
    const m = assembleProjectModel({});
    expect(traceRegression(m, 'nope', {})).toBe(null);
  });
});

describe('FT-REGRESS-002 — passing context has no failure rows', () => {
  it('all-green context yields empty failure lists', () => {
    const r = defineRule({ id: 'r', name: 'R', on: 'x', run: 'x' });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [{ id: 'v', validation: validation.ruleOutcome({ ruleId: 'r' }), resources: [] }],
    });
    const m = assembleProjectModel({ contexts: [c], rules: [r] });

    const trace = traceRegression(m, 'c', {
      getRuleStatus: () => 'success',
      getLifecycleStatus: fixedStatus({ c: 'done' }),
    });
    expect(trace).not.toBe(null);
    expect(trace!.validationFailures).toEqual([]);
    expect(trace!.childBlockers).toEqual([]);
    expect(trace!.dependencyCulprits).toEqual([]);
    expect(trace!.hasOwnFailures).toBe(false);
  });
});

describe('FT-REGRESS-003 — failed rule-outcome surfaces the rule id + status', () => {
  it('rule failed → row with kind=rule-outcome', () => {
    const r = defineRule({ id: 'check', name: 'C', on: 'x', run: 'x' });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [{ id: 'types', validation: validation.ruleOutcome({ ruleId: 'check' }), resources: [] }],
    });
    const m = assembleProjectModel({ contexts: [c], rules: [r] });
    const trace = traceRegression(m, 'c', {
      getRuleStatus: () => 'failed',
      getLifecycleStatus: fixedStatus({ c: 'regressed' }),
    });
    expect(trace!.validationFailures.length).toBe(1);
    const row = trace!.validationFailures[0];
    expect(row.kind).toBe('rule-outcome');
    if (row.kind === 'rule-outcome') {
      expect(row.ruleId).toBe('check');
      expect(row.ruleStatus).toBe('failed');
      expect(row.ruleDeclared).toBe(true);
    }
  });
});

describe('FT-REGRESS-004 — unknown rule status surfaces too', () => {
  it('rule-outcome with no recorded result reports unknown', () => {
    const r = defineRule({ id: 'check', name: 'C', on: 'x', run: 'x' });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [{ id: 'types', validation: validation.ruleOutcome({ ruleId: 'check' }), resources: [] }],
    });
    const m = assembleProjectModel({ contexts: [c], rules: [r] });
    const trace = traceRegression(m, 'c', {
      getRuleStatus: () => undefined,
      getLifecycleStatus: fixedStatus({ c: 'pending' }),
    });
    expect(trace!.validationFailures.length).toBe(1);
    const row = trace!.validationFailures[0];
    if (row.kind === 'rule-outcome') {
      expect(row.ruleStatus).toBe('unknown');
    }
  });
});

describe('FT-REGRESS-005 — test-set-pass partitions failing vs unobserved members', () => {
  it('reports failing + unobserved test ids separately', () => {
    const t1 = defineTest({ id: 'FT-X-001' });
    const t2 = defineTest({ id: 'FT-X-002' });
    const t3 = defineTest({ id: 'FT-X-003' });
    const ts = defineTestSet({ id: 'unit', members: ['FT-X-001', 'FT-X-002', 'FT-X-003'] });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [{ id: 'tests', validation: validation.testSetPass({ testSetId: 'unit' }), resources: [] }],
    });
    const m = assembleProjectModel({ contexts: [c], resources: [t1, t2, t3, ts] });
    const trace = traceRegression(m, 'c', {
      getTestPasses: () => [
        { id: 'FT-X-001', pass: true },
        { id: 'FT-X-002', pass: false },
        // FT-X-003 unobserved
      ],
      getLifecycleStatus: fixedStatus({ c: 'in-progress' }),
    });
    expect(trace!.validationFailures.length).toBe(1);
    const row = trace!.validationFailures[0];
    if (row.kind === 'test-set-pass') {
      expect(row.memberCount).toBe(3);
      expect(row.failingMembers).toEqual(['FT-X-002']);
      expect(row.unobservedMembers).toEqual(['FT-X-003']);
    } else {
      throw new Error('expected test-set-pass row');
    }
  });
});

describe('FT-REGRESS-006 — deployed-resource-present false surfaces resourceId', () => {
  it('reports present:false when collaborator says missing', () => {
    const dr = defineDeployedResource({ id: 'pkg', resourceType: 'npm-package', target: '@x/y' });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [{ id: 'live', validation: validation.deployedResourcePresent({ resourceId: 'pkg' }), resources: [] }],
    });
    const m = assembleProjectModel({ contexts: [c], resources: [dr] });
    const trace = traceRegression(m, 'c', {
      hasDeployedResource: () => false,
      getLifecycleStatus: fixedStatus({ c: 'ready' }),
    });
    expect(trace!.validationFailures.length).toBe(1);
    const row = trace!.validationFailures[0];
    if (row.kind === 'deployed-resource-present') {
      expect(row.resourceId).toBe('pkg');
      expect(row.present).toBe(false);
    } else {
      throw new Error('expected deployed-resource-present row');
    }
  });
});

describe('FT-REGRESS-007 — child blockers are reported', () => {
  it('parent shows non-done children as blockers', () => {
    const root = defineContext({
      id: 'root', name: 'Root', objective: 'r',
      action: action.plan({ description: 'p' }),
    });
    const a = defineContext({
      id: 'a', name: 'A', parentId: 'root', objective: 'a',
      action: action.agent({ description: 'a' }),
    });
    const b = defineContext({
      id: 'b', name: 'B', parentId: 'root', objective: 'b',
      action: action.agent({ description: 'b' }),
    });
    const m = assembleProjectModel({ contexts: [root, a, b] });

    const trace = traceRegression(m, 'root', {
      getLifecycleStatus: fixedStatus({ root: 'in-progress', a: 'done', b: 'in-progress' }),
    });
    expect(trace!.childBlockers.map(b => b.contextId)).toEqual(['b']);
  });
});

describe('FT-REGRESS-008 — dependency culprit walks input refs', () => {
  it('dependency-regressed context points at the upstream regressed root', () => {
    const producer = defineContext({
      id: 'producer', name: 'Producer', objective: 'p',
      action: action.agent({ description: 'p' }),
      outputs: { bundle: output('file-set') },
    });
    const consumer = defineContext({
      id: 'consumer', name: 'Consumer', parentId: 'producer', objective: 'c',
      action: action.agent({ description: 'c' }),
      inputs: { src: ref.contextOutput('producer', 'bundle') },
    });
    const m = assembleProjectModel({ contexts: [producer, consumer] });

    const trace = traceRegression(m, 'consumer', {
      getLifecycleStatus: fixedStatus({
        consumer: 'dependency-regressed',
        producer: 'regressed',
      }),
    });
    expect(trace!.dependencyCulprits.length).toBe(1);
    expect(trace!.dependencyCulprits[0].contextId).toBe('producer');
    expect(trace!.dependencyCulprits[0].path).toEqual(['consumer', 'producer']);
  });
});

describe('FT-REGRESS-009 — manual-confirm + code validations surface as informational', () => {
  it('manual-confirm row carries description', () => {
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'sign-off', validation: validation.manualConfirm({ description: 'Signed-off by lead' }), resources: [] },
      ],
    });
    const m = assembleProjectModel({ contexts: [c] });
    const trace = traceRegression(m, 'c', {
      getLifecycleStatus: fixedStatus({ c: 'ready' }),
    });
    expect(trace!.validationFailures.length).toBe(1);
    const row = trace!.validationFailures[0];
    expect(row.kind).toBe('manual-confirm');
    if (row.kind === 'manual-confirm') {
      expect(row.description).toBe('Signed-off by lead');
    }
  });
});

describe('FT-REGRESS-010 — passing rule does not surface', () => {
  it('rule-outcome=success is hidden from the trace', () => {
    const r = defineRule({ id: 'r', name: 'R', on: 'x', run: 'x' });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'good', validation: validation.ruleOutcome({ ruleId: 'r' }), resources: [] },
      ],
    });
    const m = assembleProjectModel({ contexts: [c], rules: [r] });
    const trace = traceRegression(m, 'c', {
      getRuleStatus: () => 'success',
      getLifecycleStatus: fixedStatus({ c: 'done' }),
    });
    expect(trace!.validationFailures).toEqual([]);
    void KIND; // touch to keep import alive
  });
});
