/**
 * Tests for the project model assembler. The assembler is pure: given
 * a list of declarations, returns a ProjectModel with errors inlined.
 *
 * Identifiers used here: FT-FOUND-020..035.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import {
  assembleProjectModel,
  classifyDeclarations,
  defineContext,
  defineDeployedResource,
  defineFileSet,
  defineRule,
  defineTest,
  defineTestSet,
  ref,
  validation,
  action,
  output,
} from '../index.js';

describe('FT-FOUND-020 — classifyDeclarations partitions exports by __kind', () => {
  it('routes contexts, resources, and rules into separate buckets', () => {
    const ctx = defineContext({
      id: 'root', name: 'Root', objective: 'x',
      action: action.agent({ description: 'a' }),
    });
    const fs = defineFileSet({ id: 'src', include: ['*'] });
    const rule = defineRule({ id: 'r', name: 'R', on: 'x', run: 'x' });
    const out = classifyDeclarations([ctx, fs, rule, 'not-a-decl', { random: true }]);
    expect(out.contexts?.length).toBe(1);
    expect(out.resources?.length).toBe(1);
    expect(out.rules?.length).toBe(1);
  });
});

describe('FT-FOUND-021 — root and child contexts are indexed', () => {
  it('builds children and parentOf maps', () => {
    const root = defineContext({
      id: 'root', name: 'R', objective: 'x',
      action: action.agent({ description: 'a' }),
    });
    const child = defineContext({
      id: 'child', name: 'C', parentId: 'root', objective: 'x',
      action: action.agent({ description: 'a' }),
    });
    const m = assembleProjectModel({ contexts: [root, child] });
    expect(m.errors).toEqual([]);
    expect(m.children.get('root')).toEqual(['child']);
    expect(m.parentOf.get('child')).toBe('root');
  });
});

describe('FT-FOUND-022 — duplicate ids are reported', () => {
  it('flags two contexts sharing an id', () => {
    const a = defineContext({
      id: 'x', name: 'A', objective: 'x',
      action: action.agent({ description: 'a' }),
    });
    const b = defineContext({
      id: 'x', name: 'B', objective: 'x',
      action: action.agent({ description: 'a' }),
    });
    const m = assembleProjectModel({ contexts: [a, b] });
    expect(m.errors.some(e => e.code === 'duplicate-id')).toBe(true);
  });
  it('flags an id used by both a context and a resource', () => {
    const c = defineContext({
      id: 'shared', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
    });
    const r = defineFileSet({ id: 'shared', include: ['*'] });
    const m = assembleProjectModel({ contexts: [c], resources: [r] });
    expect(m.errors.some(e => e.code === 'duplicate-id')).toBe(true);
  });
});

describe('FT-FOUND-023 — unknown parent reported', () => {
  it('flags parentId pointing to a non-existent context', () => {
    const c = defineContext({
      id: 'c', name: 'C', parentId: 'nope', objective: 'x',
      action: action.agent({ description: 'a' }),
    });
    const m = assembleProjectModel({ contexts: [c] });
    expect(m.errors.some(e => e.code === 'unknown-parent')).toBe(true);
  });
});

describe('FT-FOUND-024 — multiple roots / no root', () => {
  it('flags multiple top-level contexts', () => {
    const a = defineContext({ id: 'a', name: 'A', objective: 'x', action: action.agent({ description: 'a' }) });
    const b = defineContext({ id: 'b', name: 'B', objective: 'x', action: action.agent({ description: 'a' }) });
    const m = assembleProjectModel({ contexts: [a, b] });
    expect(m.errors.some(e => e.code === 'multiple-roots')).toBe(true);
  });
  it('flags zero roots when contexts exist (cycle case)', () => {
    // We can't author a cycle directly via parentId because parents must
    // exist by the time the child is defined; force the case by tagging
    // both contexts with each other's id. Assembler treats the cycle as
    // "no root" because neither is parentless.
    const a = { ...defineContext({ id: 'a', name: 'A', parentId: 'b', objective: 'x', action: action.agent({ description: 'a' }) }) };
    const b = { ...defineContext({ id: 'b', name: 'B', parentId: 'a', objective: 'x', action: action.agent({ description: 'a' }) }) };
    const m = assembleProjectModel({ contexts: [a, b] });
    expect(m.errors.some(e => e.code === 'no-root' || e.code === 'contains-cycle')).toBe(true);
  });
});

describe('FT-FOUND-025 — unresolved resource ref', () => {
  it('flags a resource ref pointing to a missing resource', () => {
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      inputs: { src: ref.resource('does-not-exist') },
    });
    const m = assembleProjectModel({ contexts: [c] });
    expect(m.errors.some(e => e.code === 'unresolved-resource-ref')).toBe(true);
  });
  it('accepts ref to a declared resource', () => {
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      inputs: { src: ref.resource('src') },
    });
    const r = defineFileSet({ id: 'src', include: ['*'] });
    const m = assembleProjectModel({ contexts: [c], resources: [r] });
    expect(m.errors).toEqual([]);
  });
});

describe('FT-FOUND-026 — unresolved context-output ref', () => {
  it('flags ref to a missing context', () => {
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      inputs: { src: ref.contextOutput('nope', 'x') },
    });
    const m = assembleProjectModel({ contexts: [c] });
    expect(m.errors.some(e => e.code === 'unresolved-context-output')).toBe(true);
  });
  it('flags ref to an undeclared output of an existing context', () => {
    const a = defineContext({
      id: 'a', name: 'A', objective: 'x',
      action: action.agent({ description: 'a' }),
      outputs: { real: output('file-set') },
    });
    const b = defineContext({
      id: 'b', name: 'B', parentId: 'a', objective: 'x',
      action: action.agent({ description: 'a' }),
      inputs: { src: ref.contextOutput('a', 'imaginary') },
    });
    const m = assembleProjectModel({ contexts: [a, b] });
    expect(m.errors.some(e => e.code === 'unresolved-context-output' && e.target === 'a.imaginary')).toBe(true);
  });
});

describe('FT-FOUND-027 — validation binding scope', () => {
  it('accepts a binding referencing an input by name', () => {
    const fs = defineFileSet({ id: 'src', include: ['*'] });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      inputs: { src: ref.resource('src') },
      validations: [
        { id: 'v', validation: validation.manualConfirm({ description: 'm' }), resources: ['src'] },
      ],
    });
    const m = assembleProjectModel({ contexts: [c], resources: [fs] });
    expect(m.errors).toEqual([]);
  });
  it('flags a binding referencing an unknown name', () => {
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'v', validation: validation.manualConfirm({ description: 'm' }), resources: ['nope'] },
      ],
    });
    const m = assembleProjectModel({ contexts: [c] });
    expect(m.errors.some(e => e.code === 'validation-resource-not-in-scope')).toBe(true);
  });
});

describe('FT-FOUND-028 — kind-specific reference checks', () => {
  it('flags rule-outcome referencing a missing rule', () => {
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'v', validation: validation.ruleOutcome({ ruleId: 'missing-rule' }), resources: [] },
      ],
    });
    const m = assembleProjectModel({ contexts: [c] });
    expect(m.errors.some(e => e.code === 'unresolved-rule')).toBe(true);
  });
  it('accepts rule-outcome referencing a declared rule', () => {
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'v', validation: validation.ruleOutcome({ ruleId: 'real-rule' }), resources: [] },
      ],
    });
    const r = defineRule({ id: 'real-rule', name: 'R', on: 'x', run: 'x' });
    const m = assembleProjectModel({ contexts: [c], rules: [r] });
    expect(m.errors).toEqual([]);
  });
  it('flags deployed-resource-present referencing the wrong resource type', () => {
    const fs = defineFileSet({ id: 'src', include: ['*'] });
    const c = defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'v', validation: validation.deployedResourcePresent({ resourceId: 'src' }), resources: [] },
      ],
    });
    const m = assembleProjectModel({ contexts: [c], resources: [fs] });
    expect(m.errors.some(e => e.code === 'unresolved-resource-ref' && e.target === 'src')).toBe(true);
  });
});

describe('FT-FOUND-029 — test-set members must be declared tests', () => {
  it('flags an unknown test id', () => {
    const ts = defineTestSet({ id: 'set', members: ['FT-MISSING'] });
    const m = assembleProjectModel({ resources: [ts] });
    expect(m.errors.some(e => e.code === 'unresolved-test-member')).toBe(true);
  });
  it('flags a member that is a non-test resource', () => {
    const t = defineTest({ id: 'FT-X-001' });
    const dr = defineDeployedResource({ id: 'live', resourceType: 'lambda', target: 'arn' });
    const ts = defineTestSet({ id: 'set', members: ['FT-X-001', 'live'] });
    const m = assembleProjectModel({ resources: [t, dr, ts] });
    expect(m.errors.some(e => e.code === 'unresolved-test-member' && e.target === 'live')).toBe(true);
  });
});

describe('FT-FOUND-030 — empty input is valid', () => {
  it('returns an empty model with no errors', () => {
    const m = assembleProjectModel({});
    expect(m.errors).toEqual([]);
    expect(m.contexts.size).toBe(0);
    expect(m.resources.size).toBe(0);
    expect(m.rules.size).toBe(0);
  });
});
