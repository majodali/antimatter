/**
 * Workflow rules for the json-validator example project. Each rule is a
 * verb-shaped, ambient automation that fires on a trigger and reads /
 * writes resources. The new context model wires rule outcomes into
 * context validations via `validation.ruleOutcome({ ruleId })`.
 *
 * The `on` and `run` fields are opaque at the model layer; the workflow
 * runtime interprets them. The `reads` / `writes` arrays are how the
 * context model knows which resources a rule's outcome depends on /
 * produces.
 */
import { defineRule, ref } from '@antimatter/contexts';

export const typeCheckRule = defineRule({
  id: 'type-check',
  name: 'Type-check',
  description: 'Run tsc --build over the sources file-set on change.',
  on: { kind: 'fileChange', path: 'src/**/*.ts' },
  run: { kind: 'shell', command: 'npx tsc --build' },
  reads: [ref.resource('sources')],
});

export const buildRule = defineRule({
  id: 'build',
  name: 'Build',
  description: 'Bundle the validator into dist/ for publishing.',
  on: { kind: 'event', name: 'build' },
  run: { kind: 'shell', command: 'npm run build' },
  reads: [ref.resource('sources')],
  writes: [ref.resource('build-out')],
});

export const runTestsRule = defineRule({
  id: 'run-tests',
  name: 'Run tests',
  description: 'Run the unit test set after build artefacts change.',
  on: { kind: 'fileChange', path: 'dist/**/*' },
  run: { kind: 'shell', command: 'npm test' },
  reads: [ref.resource('build-out'), ref.resource('tests')],
});

export const publishRule = defineRule({
  id: 'publish-bundle',
  name: 'Publish to npm',
  description: 'Publish the bundle to the configured npm registry.',
  on: { kind: 'event', name: 'publish' },
  run: { kind: 'shell', command: 'npm publish --access public' },
  reads: [ref.resource('build-out')],
  writes: [ref.resource('published-bundle')],
  manual: true,
});
