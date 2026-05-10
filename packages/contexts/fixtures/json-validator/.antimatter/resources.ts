/**
 * Resource declarations for the json-validator example project.
 *
 * Worked example used by Phase 0 unit tests and Phase 1+ functional
 * tests. Mirrors the design walkthrough discussion: a small npm
 * package that validates JSON against a schema.
 */
import {
  defineFileSet,
  defineTest,
  defineTestSet,
  defineDeployedResource,
  defineEnvironment,
} from '@antimatter/contexts';

// ---- File-sets ----

export const sources = defineFileSet({
  id: 'sources',
  name: 'TypeScript sources',
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.spec.ts'],
});

export const tests = defineFileSet({
  id: 'tests',
  name: 'Unit test sources',
  include: ['src/**/*.spec.ts'],
});

export const buildOut = defineFileSet({
  id: 'build-out',
  name: 'Compiled output',
  include: ['dist/**/*'],
});

export const spec = defineFileSet({
  id: 'spec',
  name: 'Validator specification',
  include: ['spec/**/*.md'],
});

// ---- Tests ----

export const ftValidStringPasses = defineTest({
  id: 'FT-JV-001',
  name: 'A valid string-typed value passes',
  testType: 'unit',
});
export const ftInvalidStringFails = defineTest({
  id: 'FT-JV-002',
  name: 'An invalid string-typed value fails',
  testType: 'unit',
});
export const ftRequiredKeysEnforced = defineTest({
  id: 'FT-JV-003',
  name: 'Required keys are enforced',
  testType: 'unit',
});
export const ftNestedObjectsValidate = defineTest({
  id: 'FT-JV-004',
  name: 'Nested objects validate recursively',
  testType: 'unit',
});
export const ftCustomMessages = defineTest({
  id: 'FT-JV-005',
  name: 'Custom error messages surface in failures',
  testType: 'unit',
});

// ---- Test sets ----

export const unitTests = defineTestSet({
  id: 'unit-tests',
  name: 'json-validator unit tests',
  members: [
    'FT-JV-001',
    'FT-JV-002',
    'FT-JV-003',
    'FT-JV-004',
    'FT-JV-005',
  ],
});

// ---- Deployed resources & environments ----

export const publishedBundle = defineDeployedResource({
  id: 'published-bundle',
  name: 'Published npm package',
  resourceType: 'npm-package',
  target: '@antimatter-examples/json-validator',
});

export const npmRegistry = defineEnvironment({
  id: 'npm-mirror',
  name: 'Public npm registry',
  provider: 'npm',
  config: { registryUrl: 'https://registry.npmjs.org' },
});
