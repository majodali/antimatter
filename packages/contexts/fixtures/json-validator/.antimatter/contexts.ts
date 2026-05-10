/**
 * Project contexts for the json-validator example.
 *
 * Tree:
 *   json-validator (root)
 *     ├── implement-validator
 *     ├── implement-tests
 *     └── publish
 *
 * Each context declares: objective, inputs (resource refs), outputs,
 * validations, and a single action. The root has no own action other
 * than a plan-shaped one — it's done iff all children are done.
 */
import {
  defineContext,
  ref,
  validation,
  action,
  output,
} from '@antimatter/contexts';

export const root = defineContext({
  id: 'json-validator',
  name: 'json-validator',
  objective: 'Ship a JSON validator npm package that passes its unit tests and is published to the configured registry.',
  action: action.plan({ description: 'Decompose the project into implement / test / publish.' }),
  inputs: {
    spec: ref.resource('spec'),
  },
  outputs: {},
  validations: [],
});

export const implementValidator = defineContext({
  id: 'implement-validator',
  name: 'Implement validator',
  parentId: 'json-validator',
  objective: 'Author the validator code so that it type-checks against the spec.',
  inputs: {
    spec: ref.resource('spec'),
    sources: ref.resource('sources'),
  },
  outputs: {
    validatorBundle: output('file-set', 'Compiled validator bundle'),
  },
  validations: [
    {
      id: 'types-compile',
      validation: validation.ruleOutcome({ ruleId: 'type-check' }),
      resources: ['sources'],
    },
  ],
  action: action.agent({
    description: 'Iterate on the validator until type-check passes.',
    instructions: 'Implement type-safe schema validation. Match the public API documented in spec/.',
  }),
});

export const implementTests = defineContext({
  id: 'implement-tests',
  name: 'Implement tests',
  parentId: 'json-validator',
  objective: 'Author unit tests covering the public API.',
  inputs: {
    spec: ref.resource('spec'),
    tests: ref.resource('tests'),
  },
  outputs: {},
  validations: [
    {
      id: 'tests-pass',
      validation: validation.testSetPass({ testSetId: 'unit-tests' }),
      resources: ['unit-tests'],
    },
  ],
  action: action.agent({
    description: 'Add a unit test per FT-JV-* until the unit-tests set passes.',
  }),
});

export const publish = defineContext({
  id: 'publish',
  name: 'Publish',
  parentId: 'json-validator',
  objective: 'Run the build + publish workflow rules and confirm the bundle is live on the npm mirror.',
  inputs: {
    bundle: ref.contextOutput('implement-validator', 'validatorBundle'),
  },
  outputs: {
    publishedBundle: output('deployed-resource', 'The npm package after publish.'),
  },
  validations: [
    {
      id: 'bundle-published',
      validation: validation.deployedResourcePresent({ resourceId: 'published-bundle' }),
      resources: ['published-bundle'],
    },
  ],
  action: action.invokeRule({ ruleId: 'publish-bundle' }),
});
