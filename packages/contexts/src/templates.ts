/**
 * Project templates — emit the three canonical `.antimatter/*.ts`
 * files from a small set of named starting points.
 *
 * Each template is a pure function from a `params` record to a
 * `RenderedTemplate` with `files: Record<relPath, contents>`. Callers
 * (the workspace server's automation command) write those files to the
 * project root.
 *
 * Templates are NOT precompiled — the strings here ARE the source the
 * user will see in `.antimatter/{resources,contexts,build}.ts`. We
 * favour readability over conciseness so authors can learn the new
 * model from their first project.
 *
 * Phase 1 ships two templates:
 *
 *   - `empty`         — no files; sets up an empty `.antimatter/`
 *                       directory so the loader can find it but the
 *                       model is empty. Manual authoring takes over.
 *   - `json-validator` — replicates the worked-example fixture:
 *                        a small npm-package context with sources,
 *                        tests, build/test/publish rules, and three
 *                        sub-contexts (implement-validator,
 *                        implement-tests, publish).
 *
 * Future templates (web-app, lambda-service, …) plug in by adding a
 * new entry to `TEMPLATE_REGISTRY`.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TemplateParam {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly default?: string;
}

export interface TemplateMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Author-visible tags / categories — used by future template gallery UI. */
  readonly tags?: readonly string[];
  /** Parameters the user fills in before applying the template. */
  readonly params?: readonly TemplateParam[];
}

export interface RenderedTemplate {
  /**
   * Files to write, keyed by relative path (forward-slash). Existing
   * files at these paths MUST NOT be overwritten — the caller checks
   * existence and surfaces a "would-overwrite" error per file.
   */
  readonly files: Readonly<Record<string, string>>;
  /** Human-readable summary of what was generated, for confirmation UIs. */
  readonly summary: string;
}

export type TemplateRender = (params: Record<string, string>) => RenderedTemplate;

export interface TemplateDefinition {
  readonly metadata: TemplateMetadata;
  readonly render: TemplateRender;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyParams(
  template: TemplateDefinition,
  params: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of template.metadata.params ?? []) {
    const v = params?.[p.name];
    if (v && v.length > 0) {
      out[p.name] = v;
    } else if (p.default !== undefined) {
      out[p.name] = p.default;
    } else if (p.required) {
      throw new Error(`Template '${template.metadata.id}' requires param '${p.name}'`);
    } else {
      out[p.name] = '';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Empty template
// ---------------------------------------------------------------------------

const EMPTY_TEMPLATE: TemplateDefinition = {
  metadata: {
    id: 'empty',
    name: 'Empty project',
    description: 'Creates a `.antimatter/` directory with no contexts, resources, or rules. Add them manually via the IDE forms or by editing files directly.',
    tags: ['blank'],
  },
  render: () => ({
    files: {
      // A placeholder marker so the directory exists in git. The loader
      // treats missing / empty .ts files as "no declarations" and
      // produces an empty model with no errors.
      '.antimatter/.gitkeep': '',
    },
    summary: 'Created an empty .antimatter/ directory. Add contexts, resources, and rules manually.',
  }),
};

// ---------------------------------------------------------------------------
// json-validator template
// ---------------------------------------------------------------------------

const JSON_VALIDATOR_TEMPLATE: TemplateDefinition = {
  metadata: {
    id: 'json-validator',
    name: 'JSON validator (npm package)',
    description: 'A small npm package that validates JSON against a schema. Mirrors the worked example in docs/contexts.md — three sub-contexts (implement / test / publish), four workflow rules (type-check / build / run-tests / publish-bundle).',
    tags: ['npm', 'library', 'example'],
    params: [
      {
        name: 'packageName',
        label: 'npm package name',
        description: 'The name to publish under. Should be a valid scoped or unscoped npm package id.',
        required: false,
        default: '@antimatter-examples/json-validator',
      },
    ],
  },
  render: (params) => {
    const pkg = params.packageName ?? '@antimatter-examples/json-validator';
    return {
      files: {
        '.antimatter/resources.ts': renderJsonValidatorResources(pkg),
        '.antimatter/build.ts': renderJsonValidatorBuild(),
        '.antimatter/contexts.ts': renderJsonValidatorContexts(),
      },
      summary: `Created json-validator project skeleton (3 .antimatter/*.ts files, package name '${pkg}').`,
    };
  },
};

// File body emitters kept in separate functions for readability.

function renderJsonValidatorResources(pkg: string): string {
  return `/**
 * Resource declarations for the json-validator project.
 *
 * Edit freely. Each defineX() call returns a typed declaration that
 * the IDE picks up automatically — no registration step.
 */
import {
  defineFileSet,
  defineTest,
  defineTestSet,
  defineDeployedResource,
  defineEnvironment,
} from '@antimatter/contexts';

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

// One test per public-API behaviour we want to verify.
export const tValidStringPasses    = defineTest({ id: 'FT-JV-001', name: 'A valid string-typed value passes', testType: 'unit' });
export const tInvalidStringFails   = defineTest({ id: 'FT-JV-002', name: 'An invalid string-typed value fails', testType: 'unit' });
export const tRequiredKeysEnforced = defineTest({ id: 'FT-JV-003', name: 'Required keys are enforced', testType: 'unit' });
export const tNestedObjects        = defineTest({ id: 'FT-JV-004', name: 'Nested objects validate recursively', testType: 'unit' });
export const tCustomMessages       = defineTest({ id: 'FT-JV-005', name: 'Custom error messages surface in failures', testType: 'unit' });

export const unitTests = defineTestSet({
  id: 'unit-tests',
  name: 'json-validator unit tests',
  members: ['FT-JV-001', 'FT-JV-002', 'FT-JV-003', 'FT-JV-004', 'FT-JV-005'],
});

export const publishedBundle = defineDeployedResource({
  id: 'published-bundle',
  name: 'Published npm package',
  resourceType: 'npm-package',
  target: '${pkg}',
});

export const npmRegistry = defineEnvironment({
  id: 'npm-mirror',
  name: 'Public npm registry',
  provider: 'npm',
  config: { registryUrl: 'https://registry.npmjs.org' },
});
`;
}

function renderJsonValidatorBuild(): string {
  return `/**
 * Workflow rules for the json-validator project.
 *
 * Each rule is a verb-shaped, ambient automation that fires on a
 * trigger and reads / writes resources. Contexts wire rule outcomes
 * into validations via validation.ruleOutcome({ ruleId }).
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
`;
}

function renderJsonValidatorContexts(): string {
  return `/**
 * Project contexts for the json-validator project.
 *
 *   json-validator (root)
 *     ├── implement-validator   — agent writes the validator until type-check passes
 *     ├── implement-tests       — agent writes tests until the unit-tests set passes
 *     └── publish               — invokes the publish-bundle workflow rule
 *
 * Edit objectives, validations, and inputs freely. Add or remove
 * sub-contexts to fit your project shape.
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
  inputs: { spec: ref.resource('spec') },
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
  objective: 'Run the publish workflow rule and confirm the bundle is live on the npm mirror.',
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
`;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TEMPLATE_REGISTRY: readonly TemplateDefinition[] = [
  EMPTY_TEMPLATE,
  JSON_VALIDATOR_TEMPLATE,
];

/** Public template metadata, suitable for IDE rendering. */
export function listTemplates(): readonly TemplateMetadata[] {
  return TEMPLATE_REGISTRY.map(t => t.metadata);
}

/** Look up a template by id. */
export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATE_REGISTRY.find(t => t.metadata.id === id);
}

/** Render a template's output. Throws on unknown id or missing required params. */
export function renderTemplate(id: string, params?: Record<string, string>): RenderedTemplate {
  const t = getTemplate(id);
  if (!t) throw new Error(`Unknown template '${id}'`);
  const filled = applyParams(t, params);
  return t.render(filled);
}
