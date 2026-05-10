/**
 * Tests for the templates registry. The acid test is "does the
 * rendered output of each template assemble into a valid ProjectModel
 * with no errors?" — that's what proves the template strings are
 * authoring-correct.
 *
 * Identifiers used here: FT-COLDSTART-001..006.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve as pathResolve } from 'node:path';
import {
  listTemplates,
  getTemplate,
  renderTemplate,
  loadProjectModel,
} from '../index.js';

describe('FT-COLDSTART-001 — listTemplates returns metadata for each registered template', () => {
  it('includes empty and json-validator', () => {
    const list = listTemplates();
    const ids = list.map(t => t.id);
    expect(ids).toContain('empty');
    expect(ids).toContain('json-validator');
    for (const m of list) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.description).toBe('string');
    }
  });
});

describe('FT-COLDSTART-002 — getTemplate / renderTemplate basics', () => {
  it('getTemplate returns undefined for unknown ids', () => {
    expect(getTemplate('does-not-exist')).toBe(undefined);
  });
  it('renderTemplate throws for unknown ids', () => {
    expect(() => renderTemplate('does-not-exist')).toThrow();
  });
});

describe('FT-COLDSTART-003 — empty template renders an empty .antimatter directory marker', () => {
  it('produces .antimatter/.gitkeep', () => {
    const out = renderTemplate('empty');
    expect(Object.keys(out.files)).toEqual(['.antimatter/.gitkeep']);
  });
});

describe('FT-COLDSTART-004 — json-validator template renders three .antimatter/*.ts files', () => {
  it('produces resources.ts, contexts.ts, build.ts', () => {
    const out = renderTemplate('json-validator');
    const paths = Object.keys(out.files).sort();
    expect(paths).toEqual([
      '.antimatter/build.ts',
      '.antimatter/contexts.ts',
      '.antimatter/resources.ts',
    ]);
    for (const path of paths) {
      expect(out.files[path].length).toBeGreaterThan(50);
      expect(out.files[path]).toContain('@antimatter/contexts');
    }
  });
  it('respects packageName param when provided', () => {
    const out = renderTemplate('json-validator', { packageName: '@user/my-pkg' });
    expect(out.files['.antimatter/resources.ts']).toContain('@user/my-pkg');
  });
});

describe('FT-COLDSTART-005 — rendered json-validator template assembles into a valid model', () => {
  it('produces files that load with no model.errors', async () => {
    const out = renderTemplate('json-validator');
    const tmp = await mkdtemp(pathResolve(tmpdir(), 'antimatter-template-'));
    try {
      for (const [relPath, contents] of Object.entries(out.files)) {
        const full = pathResolve(tmp, relPath);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents, 'utf-8');
      }
      const result = await loadProjectModel({ projectRoot: tmp });
      expect(result.loadErrors).toEqual([]);
      expect(result.model.errors).toEqual([]);

      // Spot-check the assembled graph.
      expect(result.model.contexts.has('json-validator')).toBe(true);
      expect(result.model.contexts.has('implement-validator')).toBe(true);
      expect(result.model.contexts.has('publish')).toBe(true);
      expect(result.model.rules.has('publish-bundle')).toBe(true);
      expect(result.model.resources.has('unit-tests')).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('FT-COLDSTART-006 — empty template produces an empty model with no errors', () => {
  it('loads into a model with zero contexts/resources/rules', async () => {
    const out = renderTemplate('empty');
    const tmp = await mkdtemp(pathResolve(tmpdir(), 'antimatter-template-'));
    try {
      for (const [relPath, contents] of Object.entries(out.files)) {
        const full = pathResolve(tmp, relPath);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents, 'utf-8');
      }
      const result = await loadProjectModel({ projectRoot: tmp });
      expect(result.loadErrors).toEqual([]);
      expect(result.model.errors).toEqual([]);
      expect(result.model.contexts.size).toBe(0);
      expect(result.model.resources.size).toBe(0);
      expect(result.model.rules.size).toBe(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
