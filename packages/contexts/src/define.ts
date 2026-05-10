/**
 * `defineX()` constructors — the surface authors use to declare
 * resources, rules, validations, actions, and contexts in
 * `.antimatter/{resources,contexts,build}.ts`.
 *
 * Each `defineX()` returns a typed declaration record stamped with a
 * stable `__kind` discriminator. The loader walks named exports of the
 * three `.antimatter/*.ts` files and classifies them by `__kind`, so
 * authors can mix any kind of declaration in any file. There is no
 * "what kind of declaration this file holds" registry; the file name
 * is convention only.
 *
 * Three companion factories live alongside:
 *   - `ref` — produces ResourceRefs
 *   - `validation` — produces validation declarations
 *   - `action` — produces action declarations
 *
 * Phase 0 keeps these constructors minimal — they validate the shape
 * is well-formed but don't resolve references or execute anything.
 * Cross-cutting validation (id uniqueness, ref resolution, etc.) is
 * the assembler's job.
 */
import {
  KIND,
  type ContextDeclaration,
  type ContextObjective,
  type FileSetDeclaration,
  type ConfigDeclaration,
  type SecretDeclaration,
  type DeployedResourceDeclaration,
  type EnvironmentDeclaration,
  type TestDeclaration,
  type TestSetDeclaration,
  type SignalDeclaration,
  type AuthorizationDeclaration,
  type RuleDeclaration,
  type ValidationDeclaration,
  type ValidationBinding,
  type ActionDeclaration,
  type Performer,
  type ResourceRef,
  type OutputDeclaration,
  type ResourceKind,
} from './model.js';

// ---------------------------------------------------------------------------
// Resource refs
// ---------------------------------------------------------------------------

/**
 * Build a ResourceRef. Three factories: `ref.resource(id)`,
 * `ref.contextOutput(contextId, outputName)`, `ref.external(uri)`.
 */
export const ref = {
  resource(id: string): ResourceRef {
    if (!id) throw new Error('ref.resource: id is required');
    return { __kind: KIND.ResourceRef, mode: 'resource', id };
  },
  contextOutput(contextId: string, outputName: string): ResourceRef {
    if (!contextId) throw new Error('ref.contextOutput: contextId is required');
    if (!outputName) throw new Error('ref.contextOutput: outputName is required');
    return { __kind: KIND.ResourceRef, mode: 'context-output', contextId, outputName };
  },
  external(uri: string): ResourceRef {
    if (!uri) throw new Error('ref.external: uri is required');
    return { __kind: KIND.ResourceRef, mode: 'external', uri };
  },
} as const;

// ---------------------------------------------------------------------------
// Resource constructors
// ---------------------------------------------------------------------------

export interface DefineFileSetInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
}

export function defineFileSet(input: DefineFileSetInput): FileSetDeclaration {
  requireId('defineFileSet', input.id);
  if (!input.include?.length) {
    throw new Error(`defineFileSet(${input.id}): 'include' must be a non-empty array of glob patterns`);
  }
  return {
    __kind: KIND.FileSet,
    id: input.id,
    name: input.name,
    description: input.description,
    include: input.include,
    exclude: input.exclude,
  };
}

export interface DefineConfigInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly source: { readonly kind: 'file' | 'env' | 'inline'; readonly value: string };
}

export function defineConfig(input: DefineConfigInput): ConfigDeclaration {
  requireId('defineConfig', input.id);
  if (!input.source) throw new Error(`defineConfig(${input.id}): 'source' is required`);
  return {
    __kind: KIND.Config,
    id: input.id,
    name: input.name,
    description: input.description,
    source: input.source,
  };
}

export interface DefineSecretInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly source: { readonly kind: 'env' | 'aws-secrets-manager' | 'file'; readonly key: string };
}

export function defineSecret(input: DefineSecretInput): SecretDeclaration {
  requireId('defineSecret', input.id);
  if (!input.source) throw new Error(`defineSecret(${input.id}): 'source' is required`);
  return {
    __kind: KIND.Secret,
    id: input.id,
    name: input.name,
    description: input.description,
    source: input.source,
  };
}

export interface DefineDeployedResourceInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly resourceType: string;
  readonly target: string;
}

export function defineDeployedResource(input: DefineDeployedResourceInput): DeployedResourceDeclaration {
  requireId('defineDeployedResource', input.id);
  if (!input.resourceType) throw new Error(`defineDeployedResource(${input.id}): 'resourceType' is required`);
  if (!input.target) throw new Error(`defineDeployedResource(${input.id}): 'target' is required`);
  return {
    __kind: KIND.DeployedResource,
    id: input.id,
    name: input.name,
    description: input.description,
    resourceType: input.resourceType,
    target: input.target,
  };
}

export interface DefineEnvironmentInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly provider: string;
  readonly config?: Record<string, string>;
}

export function defineEnvironment(input: DefineEnvironmentInput): EnvironmentDeclaration {
  requireId('defineEnvironment', input.id);
  if (!input.provider) throw new Error(`defineEnvironment(${input.id}): 'provider' is required`);
  return {
    __kind: KIND.Environment,
    id: input.id,
    name: input.name,
    description: input.description,
    provider: input.provider,
    config: input.config,
  };
}

export interface DefineTestInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly testType?: 'unit' | 'functional' | 'smoke' | 'integration';
  readonly source?: ResourceRef;
}

export function defineTest(input: DefineTestInput): TestDeclaration {
  requireId('defineTest', input.id);
  if (input.source !== undefined) requireResourceRef('defineTest.source', input.source);
  return {
    __kind: KIND.Test,
    id: input.id,
    name: input.name,
    description: input.description,
    testType: input.testType,
    source: input.source,
  };
}

export interface DefineTestSetInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly members: readonly string[];
}

export function defineTestSet(input: DefineTestSetInput): TestSetDeclaration {
  requireId('defineTestSet', input.id);
  if (!Array.isArray(input.members)) {
    throw new Error(`defineTestSet(${input.id}): 'members' must be an array of test ids`);
  }
  return {
    __kind: KIND.TestSet,
    id: input.id,
    name: input.name,
    description: input.description,
    members: input.members,
  };
}

export interface DefineSignalInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly source: string;
}

export function defineSignal(input: DefineSignalInput): SignalDeclaration {
  requireId('defineSignal', input.id);
  if (!input.source) throw new Error(`defineSignal(${input.id}): 'source' is required`);
  return {
    __kind: KIND.Signal,
    id: input.id,
    name: input.name,
    description: input.description,
    source: input.source,
  };
}

export interface DefineAuthorizationInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly grant: string;
}

export function defineAuthorization(input: DefineAuthorizationInput): AuthorizationDeclaration {
  requireId('defineAuthorization', input.id);
  if (!input.grant) throw new Error(`defineAuthorization(${input.id}): 'grant' is required`);
  return {
    __kind: KIND.Authorization,
    id: input.id,
    name: input.name,
    description: input.description,
    grant: input.grant,
  };
}

// ---------------------------------------------------------------------------
// Workflow rule
// ---------------------------------------------------------------------------

export interface DefineRuleInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly on: unknown;
  readonly run: unknown;
  readonly reads?: readonly ResourceRef[];
  readonly writes?: readonly ResourceRef[];
  readonly manual?: boolean;
}

export function defineRule(input: DefineRuleInput): RuleDeclaration {
  requireId('defineRule', input.id);
  if (!input.name) throw new Error(`defineRule(${input.id}): 'name' is required`);
  if (input.on === undefined) throw new Error(`defineRule(${input.id}): 'on' is required`);
  if (input.run === undefined) throw new Error(`defineRule(${input.id}): 'run' is required`);
  for (const r of input.reads ?? []) requireResourceRef(`defineRule(${input.id}).reads`, r);
  for (const r of input.writes ?? []) requireResourceRef(`defineRule(${input.id}).writes`, r);
  return {
    __kind: KIND.Rule,
    id: input.id,
    name: input.name,
    description: input.description,
    on: input.on,
    run: input.run,
    reads: input.reads,
    writes: input.writes,
    manual: input.manual,
  };
}

// ---------------------------------------------------------------------------
// Validation factories
// ---------------------------------------------------------------------------

const DEFAULT_PERFORMER: Performer = { kind: 'code' };

/**
 * Built-in validation factories. Each returns a `ValidationDeclaration`
 * which the author then binds inside a context via the
 * `defineContext({ validations: [{ id, validation: <here>, resources: [...] }] })`
 * shape.
 */
export const validation = {
  /** A validation that passes iff the named workflow rule's last run succeeded. */
  ruleOutcome(args: { ruleId: string; description?: string; performer?: Performer }): ValidationDeclaration {
    if (!args.ruleId) throw new Error('validation.ruleOutcome: ruleId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? `Rule "${args.ruleId}" last run succeeded`,
      performer: args.performer ?? DEFAULT_PERFORMER,
      kind: 'rule-outcome',
      config: { ruleId: args.ruleId },
    };
  },
  /** A validation that passes iff a specific test passed. */
  testPass(args: { testId: string; description?: string; performer?: Performer }): ValidationDeclaration {
    if (!args.testId) throw new Error('validation.testPass: testId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? `Test "${args.testId}" passes`,
      performer: args.performer ?? DEFAULT_PERFORMER,
      kind: 'test-pass',
      config: { testId: args.testId },
    };
  },
  /** A validation that passes iff every test in the named set passed. */
  testSetPass(args: { testSetId: string; description?: string; performer?: Performer }): ValidationDeclaration {
    if (!args.testSetId) throw new Error('validation.testSetPass: testSetId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? `All tests in set "${args.testSetId}" pass`,
      performer: args.performer ?? DEFAULT_PERFORMER,
      kind: 'test-set-pass',
      config: { testSetId: args.testSetId },
    };
  },
  /** A validation that passes iff the named deployed resource is reachable. */
  deployedResourcePresent(args: { resourceId: string; description?: string; performer?: Performer }): ValidationDeclaration {
    if (!args.resourceId) throw new Error('validation.deployedResourcePresent: resourceId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? `Deployed resource "${args.resourceId}" is present`,
      performer: args.performer ?? { kind: 'service', service: 'deployed-resources' },
      kind: 'deployed-resource-present',
      config: { resourceId: args.resourceId },
    };
  },
  /** A validation that passes iff the deployed resource health probe succeeds. */
  deployedResourceHealthy(args: { resourceId: string; description?: string; performer?: Performer }): ValidationDeclaration {
    if (!args.resourceId) throw new Error('validation.deployedResourceHealthy: resourceId is required');
    return {
      __kind: KIND.Validation,
      description: args.description ?? `Deployed resource "${args.resourceId}" is healthy`,
      performer: args.performer ?? { kind: 'service', service: 'deployed-resources' },
      kind: 'deployed-resource-healthy',
      config: { resourceId: args.resourceId },
    };
  },
  /** A validation that requires explicit human confirmation. */
  manualConfirm(args: { description: string; performer?: Performer }): ValidationDeclaration {
    if (!args.description) throw new Error('validation.manualConfirm: description is required');
    return {
      __kind: KIND.Validation,
      description: args.description,
      performer: args.performer ?? { kind: 'human' },
      kind: 'manual-confirm',
    };
  },
  /** A validation backed by an arbitrary code function (resolved at runtime). */
  code(args: { description: string; module?: string; fn: string; performer?: Performer }): ValidationDeclaration {
    if (!args.description) throw new Error('validation.code: description is required');
    if (!args.fn) throw new Error('validation.code: fn is required');
    return {
      __kind: KIND.Validation,
      description: args.description,
      performer: args.performer ?? { kind: 'code', module: args.module, fn: args.fn },
      kind: 'code',
      config: { module: args.module, fn: args.fn },
    };
  },
} as const;

// ---------------------------------------------------------------------------
// Action factories
// ---------------------------------------------------------------------------

export const action = {
  /** Hand the work to the agent with the given instructions. */
  agent(args: { description: string; instructions?: string; agentId?: string }): ActionDeclaration {
    if (!args.description) throw new Error('action.agent: description is required');
    return {
      __kind: KIND.Action,
      description: args.description,
      performer: { kind: 'agent', agentId: args.agentId },
      kind: 'agent',
      config: { instructions: args.instructions },
    };
  },
  /** Run a registered code function. */
  code(args: { description: string; module?: string; fn: string }): ActionDeclaration {
    if (!args.description) throw new Error('action.code: description is required');
    if (!args.fn) throw new Error('action.code: fn is required');
    return {
      __kind: KIND.Action,
      description: args.description,
      performer: { kind: 'code', module: args.module, fn: args.fn },
      kind: 'code',
      config: { module: args.module, fn: args.fn },
    };
  },
  /** Fire a workflow rule and use its outcome. */
  invokeRule(args: { description?: string; ruleId: string }): ActionDeclaration {
    if (!args.ruleId) throw new Error('action.invokeRule: ruleId is required');
    return {
      __kind: KIND.Action,
      description: args.description ?? `Invoke workflow rule "${args.ruleId}"`,
      performer: { kind: 'service', service: 'workflow' },
      kind: 'invoke-rule',
      config: { ruleId: args.ruleId },
    };
  },
  /** A human will perform this action; IDE just tracks completion via validations. */
  human(args: { description: string; instructions?: string; role?: string }): ActionDeclaration {
    if (!args.description) throw new Error('action.human: description is required');
    return {
      __kind: KIND.Action,
      description: args.description,
      performer: { kind: 'human', role: args.role },
      kind: 'human',
      config: { instructions: args.instructions },
    };
  },
  /**
   * A plan action — when executed, registers sub-contexts. Phase 2+
   * fleshes out the runtime; Phase 0 just declares the kind.
   */
  plan(args: { description: string; performer?: Performer }): ActionDeclaration {
    if (!args.description) throw new Error('action.plan: description is required');
    return {
      __kind: KIND.Action,
      description: args.description,
      performer: args.performer ?? { kind: 'agent' },
      kind: 'plan',
    };
  },
} as const;

// ---------------------------------------------------------------------------
// Output declaration helper
// ---------------------------------------------------------------------------

export function output(producesKind: ResourceKind, description?: string): OutputDeclaration {
  return { producesKind, description };
}

// ---------------------------------------------------------------------------
// Context constructor
// ---------------------------------------------------------------------------

export interface DefineContextInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly objective: ContextObjective | string;
  readonly inputs?: Readonly<Record<string, ResourceRef>>;
  readonly outputs?: Readonly<Record<string, OutputDeclaration>>;
  readonly validations?: readonly ValidationBinding[];
  readonly action: ActionDeclaration;
  readonly guidance?: string;
}

export function defineContext(input: DefineContextInput): ContextDeclaration {
  requireId('defineContext', input.id);
  if (!input.name) throw new Error(`defineContext(${input.id}): 'name' is required`);
  if (!input.objective) throw new Error(`defineContext(${input.id}): 'objective' is required`);
  if (!input.action) throw new Error(`defineContext(${input.id}): 'action' is required`);
  if (input.action.__kind !== KIND.Action) {
    throw new Error(`defineContext(${input.id}): 'action' must be built via action.* factories`);
  }

  const objective: ContextObjective =
    typeof input.objective === 'string' ? { statement: input.objective } : input.objective;

  const inputs = input.inputs ?? {};
  const outputs = input.outputs ?? {};
  const validations = input.validations ?? [];

  for (const [name, r] of Object.entries(inputs)) {
    requireResourceRef(`defineContext(${input.id}).inputs.${name}`, r);
  }
  // Validate validation bindings
  const seenBindings = new Set<string>();
  for (const v of validations) {
    if (!v.id) throw new Error(`defineContext(${input.id}): every validation binding needs an id`);
    if (seenBindings.has(v.id)) {
      throw new Error(`defineContext(${input.id}): duplicate validation binding id '${v.id}'`);
    }
    seenBindings.add(v.id);
    if (v.validation?.__kind !== KIND.Validation) {
      throw new Error(`defineContext(${input.id}): validation '${v.id}' must be built via validation.* factories`);
    }
    if (!Array.isArray(v.resources)) {
      throw new Error(`defineContext(${input.id}): validation '${v.id}' must declare a 'resources' array (may be empty)`);
    }
  }

  return {
    __kind: KIND.Context,
    id: input.id,
    name: input.name,
    description: input.description,
    parentId: input.parentId,
    objective,
    inputs,
    outputs,
    validations,
    action: input.action,
    guidance: input.guidance,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireId(fn: string, id: string | undefined): asserts id is string {
  if (!id || typeof id !== 'string') {
    throw new Error(`${fn}: 'id' is required and must be a non-empty string`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(`${fn}: id '${id}' must match /^[a-z0-9][a-z0-9._-]*$/i`);
  }
}

function requireResourceRef(label: string, r: unknown): asserts r is ResourceRef {
  if (!r || typeof r !== 'object' || (r as { __kind?: unknown }).__kind !== KIND.ResourceRef) {
    throw new Error(`${label}: expected a ResourceRef built with ref.* factories, got ${typeof r}`);
  }
}
