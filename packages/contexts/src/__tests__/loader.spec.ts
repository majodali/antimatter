/**
 * Loader tests — exercise `loadProjectModel` against the
 * `fixtures/json-validator/` project, plus a few edge cases.
 *
 * The fixture's `.antimatter/*.ts` files import `@antimatter/contexts`
 * via the workspace symlink so the compiled mjs resolves the host
 * package at dynamic-import time.
 *
 * Identifiers used here: FT-FOUND-080..088.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectModel, KIND } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_VALIDATOR_FIXTURE = pathResolve(HERE, '../../fixtures/json-validator');

describe('FT-FOUND-080 — loads json-validator fixture end-to-end', () => {
  it('reports no load errors and yields the expected graph', async () => {
    const result = await loadProjectModel({ projectRoot: JSON_VALIDATOR_FIXTURE });
    expect(result.loadErrors).toEqual([]);
    expect([...result.loadedFiles].sort()).toEqual(['build.ts', 'contexts.ts', 'resources.ts']);

    const m = result.model;
    expect(m.errors).toEqual([]);

    // Resources
    expect(m.resources.has('sources')).toBe(true);
    expect(m.resources.has('tests')).toBe(true);
    expect(m.resources.has('build-out')).toBe(true);
    expect(m.resources.has('spec')).toBe(true);
    expect(m.resources.has('unit-tests')).toBe(true);
    expect(m.resources.has('FT-JV-001')).toBe(true);
    expect(m.resources.has('FT-JV-005')).toBe(true);
    expect(m.resources.has('published-bundle')).toBe(true);
    expect(m.resources.has('npm-mirror')).toBe(true);

    // Rules
    expect(m.rules.has('type-check')).toBe(true);
    expect(m.rules.has('build')).toBe(true);
    expect(m.rules.has('run-tests')).toBe(true);
    expect(m.rules.has('publish-bundle')).toBe(true);
    expect(m.rules.get('build')?.writes?.[0]).toMatchObject({ mode: 'resource', id: 'build-out' });

    // Contexts
    expect(m.contexts.has('json-validator')).toBe(true);
    expect(m.contexts.has('implement-validator')).toBe(true);
    expect(m.contexts.has('implement-tests')).toBe(true);
    expect(m.contexts.has('publish')).toBe(true);
    expect([...(m.children.get('json-validator') ?? [])].sort()).toEqual(['implement-tests', 'implement-validator', 'publish']);
  });
});

describe('FT-FOUND-081 — type-check rule is wired into implement-validator validation', () => {
  it('rule-outcome validation references a declared rule', async () => {
    const { model } = await loadProjectModel({ projectRoot: JSON_VALIDATOR_FIXTURE });
    const ctx = model.contexts.get('implement-validator')!;
    const binding = ctx.validations.find(v => v.id === 'types-compile');
    expect(binding?.validation.kind).toBe('rule-outcome');
    expect((binding?.validation.config as { ruleId: string }).ruleId).toBe('type-check');
  });
});

describe('FT-FOUND-082 — context-output ref between contexts resolves', () => {
  it('publish.bundle resolves to implement-validator.validatorBundle', async () => {
    const { model } = await loadProjectModel({ projectRoot: JSON_VALIDATOR_FIXTURE });
    expect(model.errors).toEqual([]);
    const publish = model.contexts.get('publish')!;
    const bundle = publish.inputs.bundle;
    expect(bundle.mode).toBe('context-output');
    expect((bundle as { contextId: string }).contextId).toBe('implement-validator');
  });
});

describe('FT-FOUND-083 — declarations carry the correct __kind discriminator', () => {
  it('every resource has a resource discriminator', async () => {
    const { model } = await loadProjectModel({ projectRoot: JSON_VALIDATOR_FIXTURE });
    for (const r of model.resources.values()) {
      expect(r.__kind.startsWith('antimatter:resource:')).toBe(true);
    }
  });
  it('every context carries the context discriminator', async () => {
    const { model } = await loadProjectModel({ projectRoot: JSON_VALIDATOR_FIXTURE });
    for (const c of model.contexts.values()) {
      expect(c.__kind).toBe(KIND.Context);
    }
  });
});

describe('FT-FOUND-084 — empty / missing project handled gracefully', () => {
  it('empty .antimatter directory yields an empty model with no errors', async () => {
    const tmp = await mkdtemp(pathResolve(tmpdir(), 'antimatter-fixture-'));
    try {
      await mkdir(pathResolve(tmp, '.antimatter'), { recursive: true });
      const out = await loadProjectModel({ projectRoot: tmp });
      expect(out.loadErrors).toEqual([]);
      expect(out.loadedFiles).toEqual([]);
      expect(out.model.contexts.size).toBe(0);
      expect(out.model.resources.size).toBe(0);
      expect(out.model.rules.size).toBe(0);
      expect(out.model.errors).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
  it('missing .antimatter directory yields an empty model with no errors', async () => {
    const tmp = await mkdtemp(pathResolve(tmpdir(), 'antimatter-fixture-'));
    try {
      const out = await loadProjectModel({ projectRoot: tmp });
      expect(out.loadErrors).toEqual([]);
      expect(out.loadedFiles).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('FT-FOUND-085 — compile error in a single file is surfaced and isolated', () => {
  it('reports compile error and continues loading other files', async () => {
    const tmp = await mkdtemp(pathResolve(tmpdir(), 'antimatter-fixture-'));
    try {
      const dotDir = pathResolve(tmp, '.antimatter');
      await mkdir(dotDir, { recursive: true });
      // Broken syntax
      await writeFile(pathResolve(dotDir, 'contexts.ts'), 'export const broken = (', 'utf-8');
      // A valid file should still load
      await writeFile(
        pathResolve(dotDir, 'resources.ts'),
        `import { defineFileSet } from '@antimatter/contexts';\nexport const fs = defineFileSet({ id: 'src', include: ['*'] });`,
        'utf-8',
      );
      const out = await loadProjectModel({ projectRoot: tmp });
      expect(out.loadErrors.some(e => e.file === 'contexts.ts' && e.stage === 'compile')).toBe(true);
      expect(out.loadedFiles).toContain('resources.ts');
      expect(out.model.resources.has('src')).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
