/**
 * Tests for the `defineX()` constructors and the validation/action
 * factories in `define.ts`. Covers:
 *
 *   - Each constructor stamps the right `__kind`
 *   - Required-field guards throw with helpful messages
 *   - id format guard rejects bad ids
 *   - ResourceRef factories build well-formed refs
 *   - Validation/action factories require their kind-specific configs
 *   - defineContext rejects bad action / duplicate validation ids
 *
 * Identifiers used here: FT-FOUND-001..016.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import {
  KIND,
  ref,
  validation,
  action,
  output,
  defineFileSet,
  defineConfig,
  defineSecret,
  defineDeployedResource,
  defineEnvironment,
  defineTest,
  defineTestSet,
  defineSignal,
  defineAuthorization,
  defineRule,
  defineContext,
} from '../index.js';

describe('FT-FOUND-001 — ref factories', () => {
  it('ref.resource builds a resource ref', () => {
    const r = ref.resource('foo');
    expect(r.__kind).toBe(KIND.ResourceRef);
    expect(r.mode).toBe('resource');
    expect((r as { id: string }).id).toBe('foo');
  });
  it('ref.contextOutput builds a context-output ref', () => {
    const r = ref.contextOutput('ctx-1', 'out-1');
    expect(r.mode).toBe('context-output');
    expect((r as { contextId: string }).contextId).toBe('ctx-1');
    expect((r as { outputName: string }).outputName).toBe('out-1');
  });
  it('ref.external builds an external ref', () => {
    const r = ref.external('https://example.com/x');
    expect(r.mode).toBe('external');
    expect((r as { uri: string }).uri).toBe('https://example.com/x');
  });
  it('rejects empty inputs', () => {
    expect(() => ref.resource('')).toThrow();
    expect(() => ref.contextOutput('', 'x')).toThrow();
    expect(() => ref.external('')).toThrow();
  });
});

describe('FT-FOUND-002 — id format guard', () => {
  it('rejects ids that do not match the allowed pattern', () => {
    expect(() => defineFileSet({ id: '', include: ['x'] })).toThrow(/id/i);
    expect(() => defineFileSet({ id: ' bad', include: ['x'] })).toThrow(/id/i);
    expect(() => defineFileSet({ id: 'no spaces', include: ['x'] })).toThrow(/id/i);
  });
  it('accepts kebab-case, snake_case, dotted, alphanumeric ids', () => {
    expect(defineFileSet({ id: 'foo', include: ['*'] }).id).toBe('foo');
    expect(defineFileSet({ id: 'FT-JV-001', include: ['*'] }).id).toBe('FT-JV-001');
    expect(defineFileSet({ id: 'a.b_c-3', include: ['*'] }).id).toBe('a.b_c-3');
  });
});

describe('FT-FOUND-003 — defineFileSet', () => {
  it('produces a FileSetDeclaration with __kind set', () => {
    const r = defineFileSet({ id: 'src', include: ['src/**/*.ts'] });
    expect(r.__kind).toBe(KIND.FileSet);
    expect(r.include).toEqual(['src/**/*.ts']);
  });
  it('rejects empty include array', () => {
    expect(() => defineFileSet({ id: 'x', include: [] })).toThrow(/include/);
  });
});

describe('FT-FOUND-004 — defineConfig / defineSecret', () => {
  it('produces a ConfigDeclaration', () => {
    const c = defineConfig({ id: 'app', source: { kind: 'file', value: 'config.json' } });
    expect(c.__kind).toBe(KIND.Config);
    expect(c.source.kind).toBe('file');
  });
  it('produces a SecretDeclaration', () => {
    const s = defineSecret({ id: 'api-key', source: { kind: 'env', key: 'API_KEY' } });
    expect(s.__kind).toBe(KIND.Secret);
    expect(s.source.key).toBe('API_KEY');
  });
});

describe('FT-FOUND-005 — defineDeployedResource / defineEnvironment', () => {
  it('produces a DeployedResourceDeclaration', () => {
    const d = defineDeployedResource({ id: 'pkg', resourceType: 'npm-package', target: '@x/y' });
    expect(d.__kind).toBe(KIND.DeployedResource);
    expect(d.resourceType).toBe('npm-package');
  });
  it('produces an EnvironmentDeclaration', () => {
    const e = defineEnvironment({ id: 'aws-prod', provider: 'aws' });
    expect(e.__kind).toBe(KIND.Environment);
    expect(e.provider).toBe('aws');
  });
  it('requires resourceType and target', () => {
    expect(() => defineDeployedResource({ id: 'x', resourceType: '', target: 't' })).toThrow();
    expect(() => defineDeployedResource({ id: 'x', resourceType: 't', target: '' })).toThrow();
  });
});

describe('FT-FOUND-006 — defineTest / defineTestSet', () => {
  it('produces a TestDeclaration', () => {
    const t = defineTest({ id: 'FT-X-001', name: 'A test', testType: 'unit' });
    expect(t.__kind).toBe(KIND.Test);
    expect(t.testType).toBe('unit');
  });
  it('produces a TestSetDeclaration with members', () => {
    const ts = defineTestSet({ id: 'set', members: ['FT-X-001', 'FT-X-002'] });
    expect(ts.__kind).toBe(KIND.TestSet);
    expect(ts.members).toEqual(['FT-X-001', 'FT-X-002']);
  });
});

describe('FT-FOUND-007 — defineSignal / defineAuthorization', () => {
  it('produces a SignalDeclaration', () => {
    const s = defineSignal({ id: 'release', source: 'manual' });
    expect(s.__kind).toBe(KIND.Signal);
  });
  it('produces an AuthorizationDeclaration', () => {
    const a = defineAuthorization({ id: 'deploy', grant: 'aws:iam-role:deployer' });
    expect(a.__kind).toBe(KIND.Authorization);
  });
});

describe('FT-FOUND-008 — defineRule', () => {
  it('builds a rule with reads/writes refs', () => {
    const r = defineRule({
      id: 'build',
      name: 'Build',
      on: { kind: 'event', name: 'build' },
      run: { kind: 'shell', command: 'npm run build' },
      reads: [ref.resource('src')],
      writes: [ref.resource('out')],
    });
    expect(r.__kind).toBe(KIND.Rule);
    expect(r.reads?.length).toBe(1);
    expect(r.writes?.length).toBe(1);
  });
  it('rejects non-ref entries in reads/writes', () => {
    expect(() => defineRule({
      id: 'r', name: 'R', on: 'x', run: 'x',
      reads: [{ id: 'src' } as never],
    })).toThrow(/ResourceRef/);
  });
});

describe('FT-FOUND-009 — validation factories', () => {
  it('ruleOutcome stamps the kind', () => {
    const v = validation.ruleOutcome({ ruleId: 'build' });
    expect(v.__kind).toBe(KIND.Validation);
    expect(v.kind).toBe('rule-outcome');
    expect((v.config as { ruleId: string }).ruleId).toBe('build');
  });
  it('testSetPass requires testSetId', () => {
    expect(() => validation.testSetPass({ testSetId: '' })).toThrow();
  });
  it('manualConfirm requires description', () => {
    expect(() => validation.manualConfirm({ description: '' })).toThrow();
  });
});

describe('FT-FOUND-010 — action factories', () => {
  it('agent stamps performer kind=agent', () => {
    const a = action.agent({ description: 'go' });
    expect(a.__kind).toBe(KIND.Action);
    expect(a.kind).toBe('agent');
    expect((a.performer as { kind: string }).kind).toBe('agent');
  });
  it('code requires fn', () => {
    expect(() => action.code({ description: 'x', fn: '' })).toThrow();
  });
  it('invokeRule requires ruleId', () => {
    expect(() => action.invokeRule({ ruleId: '' })).toThrow();
  });
});

describe('FT-FOUND-011 — defineContext requires a well-formed action', () => {
  it('rejects a missing action', () => {
    expect(() => defineContext({ id: 'c', name: 'C', objective: 'x' } as never)).toThrow(/action/);
  });
  it('rejects an action that was not built via the action factory', () => {
    expect(() => defineContext({
      id: 'c', name: 'C', objective: 'x',
      action: { kind: 'agent', description: 'x' } as never,
    })).toThrow(/action/);
  });
});

describe('FT-FOUND-012 — defineContext rejects duplicate validation binding ids', () => {
  it('throws on duplicate binding id', () => {
    expect(() => defineContext({
      id: 'c',
      name: 'C',
      objective: 'x',
      action: action.agent({ description: 'a' }),
      validations: [
        { id: 'v1', validation: validation.manualConfirm({ description: 'a' }), resources: [] },
        { id: 'v1', validation: validation.manualConfirm({ description: 'b' }), resources: [] },
      ],
    })).toThrow(/duplicate/i);
  });
});

describe('FT-FOUND-013 — defineContext accepts a string objective and normalises it', () => {
  it('coerces string → { statement }', () => {
    const c = defineContext({
      id: 'c', name: 'C',
      objective: 'be done',
      action: action.agent({ description: 'a' }),
    });
    expect(c.objective.statement).toBe('be done');
  });
});

describe('FT-FOUND-014 — output helper stamps producesKind', () => {
  it('returns a typed OutputDeclaration', () => {
    const o = output('file-set', 'Compiled bundle');
    expect(o.producesKind).toBe('file-set');
    expect(o.description).toBe('Compiled bundle');
  });
});
