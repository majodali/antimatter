/**
 * validateRequirements tests — separate validation pass that needs
 * runtime catalogs (workflow rule registry + test id list) to flag
 * `requires rule X` / `requires test X` lines pointing at non-existent
 * artifacts.
 *
 * Catalogs are explicit — the function doesn't reach into any global
 * state. Callers (ContextLifecycleStore in production) build the sets.
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { parseContexts, validateRequirements } from '../index.js';

describe('validateRequirements — empty / no catalogs', () => {
  it('returns no errors when no catalogs are supplied', () => {
    const text = `work root "R"
  requires rule does-not-matter
  requires test FT-WHATEVER
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {});
    expect(errors).toEqual([]);
  });

  it('returns no errors when requirements map is empty', () => {
    const text = `work root "R"\n`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      ruleIds: new Set(['build:full']),
      testIds: new Set(['FT-M1-001']),
    });
    expect(errors).toEqual([]);
  });
});

describe('validateRequirements — rule resolution', () => {
  it('reports unresolved-rule-reference for missing rule', () => {
    const text = `work root "R"
  requires rule typo-rule-name
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      ruleIds: new Set(['Bundle API Lambda', 'bundle-api-lambda']),
    });
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('unresolved-rule-reference');
    expect(errors[0].context).toBe('root');
    expect(errors[0].target).toBe('typo-rule-name');
  });

  it('accepts rule by display name', () => {
    const text = `work root "R"
  requires rule Bundle API Lambda
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      ruleIds: new Set(['Bundle API Lambda', 'bundle-api-lambda']),
    });
    expect(errors).toEqual([]);
  });

  it('accepts rule by canonical id', () => {
    const text = `work root "R"
  requires rule bundle-api-lambda
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      ruleIds: new Set(['Bundle API Lambda', 'bundle-api-lambda']),
    });
    expect(errors).toEqual([]);
  });

  it('reports one error per unresolved rule across multiple contexts', () => {
    const text = `work root "R"
  work feature "F"
    requires rule missing-1
    requires rule Bundle API Lambda
  work other "O"
    requires rule missing-2
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      ruleIds: new Set(['Bundle API Lambda']),
    });
    expect(errors.length).toBe(2);
    expect(errors.map(e => e.target).sort()).toEqual(['missing-1', 'missing-2']);
  });
});

describe('validateRequirements — test resolution', () => {
  it('reports unresolved-test-reference for missing test', () => {
    const text = `work root "R"
  requires test FT-M99-999
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      testIds: new Set(['FT-M1-001', 'FT-M1-002']),
    });
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('unresolved-test-reference');
    expect(errors[0].target).toBe('FT-M99-999');
  });

  it('accepts known test ids', () => {
    const text = `work root "R"
  requires test FT-M1-001
  requires test FT-M1-002
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      testIds: new Set(['FT-M1-001', 'FT-M1-002']),
    });
    expect(errors).toEqual([]);
  });
});

describe('validateRequirements — partial catalog', () => {
  it('only validates the kinds whose catalog is supplied', () => {
    // Only ruleIds passed; tests aren't validated even if id is unknown.
    const text = `work root "R"
  requires rule typo-rule
  requires test FT-NOT-IN-CATALOG
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      ruleIds: new Set([]),
    });
    // One rule error, no test error.
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('unresolved-rule-reference');
  });

  it('validates both kinds when both catalogs supplied', () => {
    const text = `work root "R"
  requires rule typo-rule
  requires test FT-NOT-IN-CATALOG
`;
    const { requirements } = parseContexts(text);
    const errors = validateRequirements(requirements, {
      ruleIds: new Set([]),
      testIds: new Set([]),
    });
    expect(errors.length).toBe(2);
    expect(errors.map(e => e.code).sort()).toEqual([
      'unresolved-rule-reference', 'unresolved-test-reference',
    ]);
  });
});
