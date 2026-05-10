/**
 * Project Context Model — the data shapes a project authors via the
 * `defineX()` constructors in `define.ts` and consumes via the
 * loader/queries.
 *
 * See docs/contexts.md for the conceptual model. This file is the
 * authoritative source for the type names; runtime evaluation,
 * persistence, and lifecycle live elsewhere.
 *
 * Three layers, each with their own declaration kinds:
 *
 *   1. Resources (noun)         — file-set, config, secret,
 *                                 deployed-resource, environment, test,
 *                                 test-set, signal, authorization
 *   2. Workflow rules (verb)    — ambient, fire on triggers, declare
 *                                 reads/writes against resources
 *   3. Project contexts (intent) — outcome-shaped, exactly one Action,
 *                                 zero or more Validations
 *
 * Three intersection seams: a Validation may consult a rule outcome; an
 * Action may invoke a rule; rule outputs become resources. None of the
 * three layers nests inside another.
 *
 * Every declaration record carries a stable `__kind` discriminator so
 * the loader can classify exports without any naming convention. Keep
 * those literals in sync with `KIND.*` exported below.
 */

// ---------------------------------------------------------------------------
// Discriminator constants
// ---------------------------------------------------------------------------

export const KIND = {
  Context:           'antimatter:context',
  FileSet:           'antimatter:resource:file-set',
  Config:            'antimatter:resource:config',
  Secret:            'antimatter:resource:secret',
  DeployedResource:  'antimatter:resource:deployed-resource',
  Environment:       'antimatter:resource:environment',
  Test:              'antimatter:resource:test',
  TestSet:           'antimatter:resource:test-set',
  Signal:            'antimatter:resource:signal',
  Authorization:     'antimatter:resource:authorization',
  Rule:              'antimatter:rule',
  Validation:        'antimatter:validation',
  Action:            'antimatter:action',
  ResourceRef:       'antimatter:resource-ref',
} as const;

export type DeclarationKind =
  typeof KIND[keyof typeof KIND];

/** All resource `__kind` discriminators (the literal stamped onto declarations). */
export const RESOURCE_DISCRIMINATORS = [
  KIND.FileSet,
  KIND.Config,
  KIND.Secret,
  KIND.DeployedResource,
  KIND.Environment,
  KIND.Test,
  KIND.TestSet,
  KIND.Signal,
  KIND.Authorization,
] as const;

export type ResourceDiscriminator = typeof RESOURCE_DISCRIMINATORS[number];

/**
 * Short, user-facing names for resource kinds. These are what authors
 * pass to `output(...)`, what the IDE filters by, and what
 * `resourcesOfKind(...)` accepts. The full discriminator stays on
 * declarations as `__kind` and is treated as an internal implementation
 * detail.
 */
export const RESOURCE_KINDS = [
  'file-set',
  'config',
  'secret',
  'deployed-resource',
  'environment',
  'test',
  'test-set',
  'signal',
  'authorization',
] as const;

export type ResourceKind = typeof RESOURCE_KINDS[number];

/** Map short kind name → full `__kind` discriminator. */
export const KIND_OF: Readonly<Record<ResourceKind, ResourceDiscriminator>> = {
  'file-set':          KIND.FileSet,
  'config':            KIND.Config,
  'secret':            KIND.Secret,
  'deployed-resource': KIND.DeployedResource,
  'environment':       KIND.Environment,
  'test':              KIND.Test,
  'test-set':          KIND.TestSet,
  'signal':            KIND.Signal,
  'authorization':     KIND.Authorization,
};

/** Map full `__kind` discriminator → short kind name. */
export const KIND_NAME: Readonly<Record<ResourceDiscriminator, ResourceKind>> = {
  [KIND.FileSet]:          'file-set',
  [KIND.Config]:            'config',
  [KIND.Secret]:            'secret',
  [KIND.DeployedResource]:  'deployed-resource',
  [KIND.Environment]:       'environment',
  [KIND.Test]:              'test',
  [KIND.TestSet]:           'test-set',
  [KIND.Signal]:            'signal',
  [KIND.Authorization]:     'authorization',
};

// ---------------------------------------------------------------------------
// Performers — who does the work
// ---------------------------------------------------------------------------

/**
 * The party responsible for executing an Action or evaluating a
 * Validation. Four kinds; concrete implementations attach to the
 * Action / Validation via a separate runtime registry (Phase 3+).
 */
export type Performer =
  | { readonly kind: 'human';   readonly role?: string }
  | { readonly kind: 'agent';   readonly agentId?: string; readonly role?: string }
  | { readonly kind: 'code';    readonly module?: string;  readonly fn?: string }
  | { readonly kind: 'service'; readonly service: string };

// ---------------------------------------------------------------------------
// Resource references
// ---------------------------------------------------------------------------

/**
 * A pointer to a resource. Three kinds:
 *   - 'resource'        — by id of a declared resource
 *   - 'context-output'  — the named output of another context (resolved
 *                         after the producing context's action runs)
 *   - 'external'        — a literal URI / opaque external reference
 *
 * Every ResourceRef carries `__kind: 'antimatter:resource-ref'` so the
 * loader can distinguish refs from declarations during export walking.
 */
export type ResourceRef =
  | { readonly __kind: typeof KIND.ResourceRef; readonly mode: 'resource';       readonly id: string }
  | { readonly __kind: typeof KIND.ResourceRef; readonly mode: 'context-output'; readonly contextId: string; readonly outputName: string }
  | { readonly __kind: typeof KIND.ResourceRef; readonly mode: 'external';       readonly uri: string };

// ---------------------------------------------------------------------------
// Resource declarations (discriminated union)
// ---------------------------------------------------------------------------

interface ResourceBase {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export interface FileSetDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.FileSet;
  /** Glob patterns relative to project root (e.g. `src/**\/*.ts`). */
  readonly include: readonly string[];
  /** Optional excludes applied after `include`. */
  readonly exclude?: readonly string[];
}

export interface ConfigDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.Config;
  /** File path, env-var name, or other locator the runtime reads. */
  readonly source: { readonly kind: 'file' | 'env' | 'inline'; readonly value: string };
}

export interface SecretDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.Secret;
  /** Where the secret value is fetched from (no values stored in code). */
  readonly source: { readonly kind: 'env' | 'aws-secrets-manager' | 'file'; readonly key: string };
}

export interface DeployedResourceDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.DeployedResource;
  /** What kind of deployed thing this is — `'lambda'`, `'s3-object'`, `'cloudfront'`, `'npm-package'`, etc. */
  readonly resourceType: string;
  /** Identifier in the target system (ARN, URL, package name, …). */
  readonly target: string;
}

export interface EnvironmentDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.Environment;
  /** Environment provider — `'aws'`, `'npm'`, `'github'`, `'local'`, etc. */
  readonly provider: string;
  /** Provider-specific identifying config (account/region, registry URL, …). */
  readonly config?: Record<string, string>;
}

export interface TestDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.Test;
  /** Free-form id (typically `FT-{AREA}-{NNN}`). */
  /** What kind of test — informational, drives runner selection. */
  readonly testType?: 'unit' | 'functional' | 'smoke' | 'integration';
  /** Optional reference to the file-set or single file the test lives in. */
  readonly source?: ResourceRef;
}

export interface TestSetDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.TestSet;
  /** Test ids that belong to this set. Many-to-many: a test may belong to multiple sets. */
  readonly members: readonly string[];
}

export interface SignalDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.Signal;
  /** A named flag/event-stream the project reads. */
  readonly source: string;
}

export interface AuthorizationDeclaration extends ResourceBase {
  readonly __kind: typeof KIND.Authorization;
  /** What the authorization grants (e.g. `'aws:iam-role:foo'`). */
  readonly grant: string;
}

export type ResourceDeclaration =
  | FileSetDeclaration
  | ConfigDeclaration
  | SecretDeclaration
  | DeployedResourceDeclaration
  | EnvironmentDeclaration
  | TestDeclaration
  | TestSetDeclaration
  | SignalDeclaration
  | AuthorizationDeclaration;

// ---------------------------------------------------------------------------
// Validations
// ---------------------------------------------------------------------------

export interface ValidationResult {
  readonly valid: boolean;
  readonly messages?: readonly string[];
  /** Opaque per-validation state the runtime threads back on next call. */
  readonly updatedValidationState?: unknown;
}

/**
 * A pluggable validation. Phase 0 only models the declaration; runtime
 * execution (calling `validate(...)` against resolved resources) lands
 * in Phase 3.
 */
export interface ValidationDeclaration {
  readonly __kind: typeof KIND.Validation;
  readonly description: string;
  readonly performer: Performer;
  /**
   * Validation kind — informs the runtime which built-in evaluator to
   * use. Custom `'code'` validations attach a `validate` function.
   */
  readonly kind:
    | 'rule-outcome'
    | 'test-pass'
    | 'test-set-pass'
    | 'deployed-resource-present'
    | 'deployed-resource-healthy'
    | 'manual-confirm'
    | 'code';
  /** Kind-specific config (rule id, test id, code fn ref, …). */
  readonly config?: Record<string, unknown>;
}

/**
 * A validation as it appears inside a context. The binding adds an
 * id (unique within the context) and the names of the resources the
 * validation evaluates against.
 */
export interface ValidationBinding {
  readonly id: string;
  readonly validation: ValidationDeclaration;
  /**
   * Resource slots within the context's input∪output namespace that
   * this validation reads. Empty array = validation operates on no
   * specific resource (e.g. a manual-confirm).
   */
  readonly resources: readonly string[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * The single action that drives a context toward `done`. Phase 0 models
 * declaration only; execution comes in Phase 3.
 *
 * Action kinds:
 *   - 'agent'           — instruct the agent to make progress
 *   - 'code'            — invoke a registered code function
 *   - 'invoke-rule'     — fire a workflow rule and use its outcome
 *   - 'human'           — IDE stays out of the way; human edits files
 *   - 'plan'            — register sub-contexts (Phase 2+)
 */
export interface ActionDeclaration {
  readonly __kind: typeof KIND.Action;
  readonly description: string;
  readonly performer: Performer | readonly Performer[];
  readonly kind: 'agent' | 'code' | 'invoke-rule' | 'human' | 'plan';
  /** Kind-specific config. */
  readonly config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Context inputs and outputs
// ---------------------------------------------------------------------------

/**
 * Declares one of the named outputs a context produces. The output
 * resolves to a Resource at runtime; the producing Action records the
 * fingerprint into context runtime state.
 */
export interface OutputDeclaration {
  /** What kind of resource this output materialises. */
  readonly producesKind: ResourceKind;
  /** Optional human description. */
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Context declaration
// ---------------------------------------------------------------------------

export interface ContextObjective {
  readonly statement: string;
  readonly notes?: string;
}

export interface ContextDeclaration {
  readonly __kind: typeof KIND.Context;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Containing parent context. Root has no parentId. */
  readonly parentId?: string;
  readonly objective: ContextObjective;
  /** Named input slots — each binds a name to a ResourceRef. */
  readonly inputs: Readonly<Record<string, ResourceRef>>;
  /** Named output slots — declares what this context produces. */
  readonly outputs: Readonly<Record<string, OutputDeclaration>>;
  /** Validations — order is meaningful for UI display only. */
  readonly validations: readonly ValidationBinding[];
  /** The single action that drives this context. */
  readonly action: ActionDeclaration;
  /** Free-form guidance for whoever (or whatever) executes the action. */
  readonly guidance?: string;
}

// ---------------------------------------------------------------------------
// Workflow rule declaration (new — explicit reads/writes)
// ---------------------------------------------------------------------------

/**
 * A workflow rule as authored in `.antimatter/build.ts` (or any
 * `.antimatter/*.ts`) using `defineRule(...)`.
 *
 * Distinct from `RuleDeclaration` in `@antimatter/workflow`: that one
 * is the runtime metadata the workflow manager exposes; this one is the
 * source-level declaration with explicit `reads` and `writes` against
 * resources, which the context model needs in order to wire workflow
 * outcomes into validations.
 *
 * The `on` and `run` fields are kept opaque at the model layer; they're
 * passed through to the workflow runtime which already understands
 * predicates and actions.
 */
export interface RuleDeclaration {
  readonly __kind: typeof KIND.Rule;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Trigger spec — passed through to the workflow runtime. */
  readonly on: unknown;
  /** Action body — opaque function reference; runtime invokes it. */
  readonly run: unknown;
  /** Resources the rule reads (inputs influence rule outcome fingerprint). */
  readonly reads?: readonly ResourceRef[];
  /** Resources the rule writes (outputs become resources downstream of the rule). */
  readonly writes?: readonly ResourceRef[];
  /** Whether the rule fires automatically (false = manual-only). */
  readonly manual?: boolean;
}

// ---------------------------------------------------------------------------
// Project model — the assembled graph
// ---------------------------------------------------------------------------

export type AnyDeclaration =
  | ContextDeclaration
  | ResourceDeclaration
  | RuleDeclaration;

/**
 * The assembled project model. Maps from id → declaration plus a
 * pre-computed parent/child index so callers don't re-traverse the
 * containment tree.
 *
 * Validation errors are produced when assembling; callers should check
 * `errors.length === 0` before treating the model as authoritative.
 */
export interface ProjectModel {
  readonly contexts: ReadonlyMap<string, ContextDeclaration>;
  readonly resources: ReadonlyMap<string, ResourceDeclaration>;
  readonly rules: ReadonlyMap<string, RuleDeclaration>;
  /** Containment: parent id → child ids (root parent is the empty string). */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Reverse index: child id → parent id (absent for the root). */
  readonly parentOf: ReadonlyMap<string, string>;
  /** Validation errors discovered during assembly. */
  readonly errors: readonly ProjectModelError[];
}

export interface ProjectModelError {
  readonly code: ProjectModelErrorCode;
  readonly message: string;
  /** The id of the declaration the error is about, where applicable. */
  readonly subject?: string;
  /** A second id involved (e.g. unresolved target). */
  readonly target?: string;
}

export type ProjectModelErrorCode =
  | 'duplicate-id'
  | 'unknown-parent'
  | 'multiple-roots'
  | 'no-root'
  | 'contains-cycle'
  | 'unresolved-resource-ref'
  | 'unresolved-context-output'
  | 'validation-resource-not-in-scope'
  | 'unresolved-rule'
  | 'unresolved-test-member'
  | 'malformed-declaration';

// ---------------------------------------------------------------------------
// Runtime state (Phase 3+ uses this; Phase 0 just declares the shape)
// ---------------------------------------------------------------------------

/**
 * Per-context runtime state, persisted by the host. Phase 0 doesn't
 * read or write this — it just defines the shape so downstream phases
 * can land without churn.
 */
export interface ContextRuntimeState {
  readonly contextId: string;
  /** Fingerprint per input slot at the time the context was last evaluated. */
  readonly inputFingerprints: Readonly<Record<string, string>>;
  /** Resolved outputs — resource id + fingerprint + producedAt. */
  readonly outputs: Readonly<Record<string, { readonly resourceId: string; readonly fingerprint: string; readonly at: string }>>;
  /** Per-validation result history (only the most recent kept here; historical events go to activity log). */
  readonly validations: Readonly<Record<string, {
    readonly state?: unknown;
    readonly lastResult?: {
      readonly valid: boolean;
      readonly messages?: readonly string[];
      readonly at: string;
      readonly atInputFingerprints: Readonly<Record<string, string>>;
    };
  }>>;
  /** Action runtime state — opaque to the model, owned by the action implementation. */
  readonly action: {
    readonly state?: unknown;
    readonly history: readonly {
      readonly at: string;
      readonly status: 'completed' | 'failed' | 'awaiting';
      readonly note?: string;
    }[];
  };
  /** Last derived lifecycle status (for transition detection). */
  readonly priorStatus?: import('./lifecycle.js').LifecycleStatus;
}
