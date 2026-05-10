/**
 * Tests for source emitters. Each emitter's output should:
 *   - Be syntactically valid TS
 *   - Round-trip through esbuild + the loader and produce the
 *     declaration the input described
 *
 * Identifiers used here: FT-DECOMP-001..014.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve as pathResolve } from 'node:path';
import {
  appendDeclaration,
  emitContext,
  emitFileSet,
  emitRule,
  emitTest,
  emitTestSet,
  emitDeployedResource,
  emitEnvironment,
  loadProjectModel,
} from '../index.js';

// Helper — write `files` into a fresh temp project and load the model.
async function loadInTmp(files: Record<string, string>) {
  const tmp = await mkdtemp(pathResolve(tmpdir(), 'antimatter-emit-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = pathResolve(tmp, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents, 'utf-8');
  }
  const out = await loadProjectModel({ projectRoot: tmp });
  await rm(tmp, { recursive: true, force: true });
  return out;
}

describe('FT-DECOMP-001 — emitFileSet produces a declaration that loads', () => {
  it('round-trips a basic file-set', async () => {
    const decl = emitFileSet({
      id: 'src',
      name: 'TS sources',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    });
    const file = appendDeclaration('', decl);
    const out = await loadInTmp({ '.antimatter/resources.ts': file });
    expect(out.loadErrors).toEqual([]);
    expect(out.model.errors).toEqual([]);
    const r = out.model.resources.get('src');
    expect(r?.__kind).toBe('antimatter:resource:file-set');
    if (r?.__kind === 'antimatter:resource:file-set') {
      expect(r.include).toEqual(['src/**/*.ts']);
      expect(r.exclude).toEqual(['src/**/*.spec.ts']);
    }
  });
});

describe('FT-DECOMP-002 — emitTest / emitTestSet round-trip', () => {
  it('builds a test and a test-set referencing it', async () => {
    const t = emitTest({ id: 'FT-X-001', name: 'A test', testType: 'unit' });
    const ts = emitTestSet({ id: 'set-A', members: ['FT-X-001'] });
    const file = appendDeclaration(appendDeclaration('', t), ts);
    const out = await loadInTmp({ '.antimatter/resources.ts': file });
    expect(out.model.errors).toEqual([]);
    expect(out.model.resources.get('FT-X-001')?.__kind).toBe('antimatter:resource:test');
    expect(out.model.resources.get('set-A')?.__kind).toBe('antimatter:resource:test-set');
  });
});

describe('FT-DECOMP-003 — emitDeployedResource / emitEnvironment round-trip', () => {
  it('produces valid declarations', async () => {
    const dr = emitDeployedResource({ id: 'pkg', resourceType: 'npm-package', target: '@x/y' });
    const env = emitEnvironment({ id: 'aws-prod', provider: 'aws', config: { region: 'us-west-2' } });
    const file = appendDeclaration(appendDeclaration('', dr), env);
    const out = await loadInTmp({ '.antimatter/resources.ts': file });
    expect(out.model.errors).toEqual([]);
    expect(out.model.resources.get('pkg')?.__kind).toBe('antimatter:resource:deployed-resource');
    expect(out.model.resources.get('aws-prod')?.__kind).toBe('antimatter:resource:environment');
  });
});

describe('FT-DECOMP-004 — emitRule with reads/writes', () => {
  it('round-trips a rule with resource refs', async () => {
    const fs = emitFileSet({ id: 'src', include: ['*.ts'] });
    const out2 = emitFileSet({ id: 'out', include: ['dist/**/*'] });
    const r = emitRule({
      id: 'build',
      name: 'Build',
      on: { kind: 'event', name: 'build' },
      run: { kind: 'shell', command: 'npm run build' },
      reads: [{ mode: 'resource', id: 'src' }],
      writes: [{ mode: 'resource', id: 'out' }],
    });

    const resourcesFile = appendDeclaration(appendDeclaration('', fs), out2);
    const buildFile = appendDeclaration('', r);

    const result = await loadInTmp({
      '.antimatter/resources.ts': resourcesFile,
      '.antimatter/build.ts': buildFile,
    });
    expect(result.model.errors).toEqual([]);
    const rule = result.model.rules.get('build');
    expect(rule?.reads?.length).toBe(1);
    expect(rule?.writes?.length).toBe(1);
  });
});

describe('FT-DECOMP-005 — emitContext basic shape', () => {
  it('round-trips a leaf context with one validation', async () => {
    const fs = emitFileSet({ id: 'src', include: ['*.ts'] });
    const c = emitContext({
      id: 'leaf',
      name: 'Leaf',
      objective: 'Get done.',
      action: { kind: 'agent', description: 'do the thing' },
      inputs: { sources: { mode: 'resource', id: 'src' } },
      validations: [
        {
          id: 'v1',
          validation: { kind: 'manual-confirm', description: 'check it' },
          resources: ['sources'],
        },
      ],
    });
    const result = await loadInTmp({
      '.antimatter/resources.ts': appendDeclaration('', fs),
      '.antimatter/contexts.ts': appendDeclaration('', c),
    });
    expect(result.model.errors).toEqual([]);
    const leaf = result.model.contexts.get('leaf');
    expect(leaf?.objective.statement).toBe('Get done.');
    expect(leaf?.validations.length).toBe(1);
    expect(Object.keys(leaf?.inputs ?? {})).toEqual(['sources']);
  });
});

describe('FT-DECOMP-006 — emitContext with parent + plan action', () => {
  it('round-trips a parent + child', async () => {
    const root = emitContext({ id: 'root', name: 'R', objective: 'all done', action: { kind: 'plan', description: 'plan' } });
    const child = emitContext({
      id: 'child',
      name: 'Child',
      parentId: 'root',
      objective: 'do',
      action: { kind: 'agent', description: 'go' },
    });
    const file = appendDeclaration(appendDeclaration('', root), child);
    const result = await loadInTmp({ '.antimatter/contexts.ts': file });
    expect(result.model.errors).toEqual([]);
    expect(result.model.children.get('root')).toEqual(['child']);
  });
});

describe('FT-DECOMP-007 — appendDeclaration merges existing imports', () => {
  it('merges new import symbols into the existing import line', () => {
    const initial = `import { defineFileSet } from '@antimatter/contexts';\n\nexport const a = defineFileSet({ id: 'a', include: ['*'] });\n`;
    const decl = emitTest({ id: 'FT-X-001', name: 'a test' });
    const next = appendDeclaration(initial, decl);
    // Both helpers in a single import line.
    expect(next).toContain(`import { defineFileSet, defineTest } from '@antimatter/contexts';`);
    expect(next.match(/from '@antimatter\/contexts'/g)?.length).toBe(1);
  });
});

describe('FT-DECOMP-008 — appendDeclaration adds an import to an empty file', () => {
  it('emits a fresh import + snippet', () => {
    const decl = emitFileSet({ id: 'src', include: ['*'] });
    const next = appendDeclaration('', decl);
    expect(next).toContain(`import { defineFileSet } from '@antimatter/contexts';`);
    expect(next).toContain(`export const src = defineFileSet({`);
  });
});

describe('FT-DECOMP-009 — emitter rejects malformed ids', () => {
  it('emitFileSet throws on bad id', () => {
    expect(() => emitFileSet({ id: ' bad', include: ['*'] })).toThrow();
    expect(() => emitFileSet({ id: '', include: ['*'] })).toThrow();
  });
  it('emitContext throws when objective is missing', () => {
    expect(() => emitContext({
      id: 'c', name: 'C', objective: '',
      action: { kind: 'agent', description: 'go' },
    })).toThrow();
  });
});

describe('FT-DECOMP-010 — strings are JSON-escaped (no injection via id/name/description)', () => {
  it('emits properly escaped strings even for hostile content', async () => {
    const decl = emitFileSet({
      id: 'src',
      name: `Tricky "name" with 'quotes' and \\backslash`,
      description: 'Line one\nLine two\nWith ${interpolation}',
      include: ['*.ts'],
    });
    const file = appendDeclaration('', decl);
    const out = await loadInTmp({ '.antimatter/resources.ts': file });
    expect(out.loadErrors).toEqual([]);
    expect(out.model.errors).toEqual([]);
    const r = out.model.resources.get('src');
    expect(r?.name).toBe(`Tricky "name" with 'quotes' and \\backslash`);
    expect(r?.description).toContain('${interpolation}');
  });
});

describe('FT-DECOMP-011 — emitContext with rule-outcome validation references the rule', () => {
  it('produces a model with a wired validation', async () => {
    const r = emitRule({ id: 'check', name: 'Check', on: 'x', run: 'x' });
    const c = emitContext({
      id: 'leaf',
      name: 'Leaf',
      objective: 'pass',
      action: { kind: 'agent', description: 'go' },
      validations: [
        { id: 'v', validation: { kind: 'rule-outcome', ruleId: 'check' }, resources: [] },
      ],
    });
    const result = await loadInTmp({
      '.antimatter/build.ts': appendDeclaration('', r),
      '.antimatter/contexts.ts': appendDeclaration('', c),
    });
    expect(result.model.errors).toEqual([]);
    const leaf = result.model.contexts.get('leaf');
    expect(leaf?.validations[0].validation.kind).toBe('rule-outcome');
  });
});

describe('FT-DECOMP-012 — emitContext with output() and context-output input', () => {
  it('emits importable output() helper and ref.contextOutput correctly', async () => {
    const producer = emitContext({
      id: 'prod',
      name: 'Producer',
      objective: 'make a bundle',
      action: { kind: 'agent', description: 'make' },
      outputs: { bundle: { producesKind: 'file-set', description: 'compiled bundle' } },
    });
    const consumer = emitContext({
      id: 'cons',
      name: 'Consumer',
      parentId: 'prod',
      objective: 'consume',
      action: { kind: 'agent', description: 'consume' },
      inputs: { dep: { mode: 'context-output', contextId: 'prod', outputName: 'bundle' } },
    });
    const file = appendDeclaration(appendDeclaration('', producer), consumer);
    const result = await loadInTmp({ '.antimatter/contexts.ts': file });
    expect(result.model.errors).toEqual([]);
    const cons = result.model.contexts.get('cons');
    expect(cons?.inputs.dep.mode).toBe('context-output');
  });
});
