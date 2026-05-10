/**
 * Client-side wrappers for the project-context-model automation
 * commands. Thin REST calls that mirror the server handler shapes;
 * keeps `ContextsPanel` clean of boilerplate and gives the rest of the
 * client a typed API for the new model.
 */

// ---------------------------------------------------------------------------
// Wire types — mirror the server snapshot
// ---------------------------------------------------------------------------

export type LifecycleStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'done'
  | 'regressed'
  | 'dependency-regressed';

export interface SerializedValidation {
  readonly id: string;
  readonly kind: string;
  readonly description: string;
  readonly status: 'passing' | 'failing' | 'unknown';
  readonly resources: readonly string[];
}

export interface SerializedContext {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly objectiveStatement: string;
  readonly objectiveNotes?: string;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly validations: readonly SerializedValidation[];
  readonly actionKind: string;
  readonly actionDescription: string;
  readonly lifecycleStatus: LifecycleStatus;
  /** ISO timestamp of the most recent lifecycle transition for this context. */
  readonly lastTransitionAt?: string;
}

export interface SerializedResource {
  readonly id: string;
  readonly kind: string;
  readonly discriminator: string;
  readonly name?: string;
  readonly description?: string;
}

export interface SerializedRule {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly readsCount: number;
  readonly writesCount: number;
  readonly manual: boolean;
}

export interface ContextModelLoadError {
  readonly file: string;
  readonly stage: string;
  readonly message: string;
}

export interface ContextModelAssemblyError {
  readonly code: string;
  readonly message: string;
  readonly subject?: string;
  readonly target?: string;
}

export type LifecycleCounts = Readonly<Record<LifecycleStatus, number>>;

export interface SerializedTransition {
  readonly contextId: string;
  readonly contextName: string;
  readonly from: LifecycleStatus | null;
  readonly to: LifecycleStatus;
  readonly at: string;
}

export interface ContextModelSnapshot {
  readonly present: boolean;
  readonly loadedFiles: readonly string[];
  readonly loadErrors: readonly ContextModelLoadError[];
  readonly modelErrors: readonly ContextModelAssemblyError[];
  readonly counts: {
    readonly contexts: number;
    readonly resources: number;
    readonly rules: number;
    readonly byStatus: LifecycleCounts;
  };
  readonly contexts: readonly SerializedContext[];
  readonly resources: readonly SerializedResource[];
  readonly rules: readonly SerializedRule[];
  /** Most-recent-first; capped server-side at ~50. */
  readonly recentTransitions: readonly SerializedTransition[];
  readonly loadedAt: string;
}

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
  readonly tags?: readonly string[];
  readonly params?: readonly TemplateParam[];
}

export interface ApplyTemplateResult {
  readonly templateId: string;
  readonly writtenPaths: readonly string[];
  readonly summary: string;
  readonly snapshot: ContextModelSnapshot | null;
}

// ---------------------------------------------------------------------------
// Emit input types — mirror the @antimatter/contexts emit.ts shapes so the
// IDE forms can be typed without reaching across package boundaries.
// ---------------------------------------------------------------------------

export type EmitResourceRefInput =
  | { mode: 'resource'; id: string }
  | { mode: 'context-output'; contextId: string; outputName: string }
  | { mode: 'external'; uri: string };

export type EmitValidationInput =
  | { kind: 'rule-outcome'; ruleId: string; description?: string }
  | { kind: 'test-pass'; testId: string; description?: string }
  | { kind: 'test-set-pass'; testSetId: string; description?: string }
  | { kind: 'deployed-resource-present'; resourceId: string; description?: string }
  | { kind: 'deployed-resource-healthy'; resourceId: string; description?: string }
  | { kind: 'manual-confirm'; description: string }
  | { kind: 'code'; description: string; fn: string; module?: string };

export type EmitActionInput =
  | { kind: 'agent'; description: string; instructions?: string; agentId?: string }
  | { kind: 'code'; description: string; fn: string; module?: string }
  | { kind: 'invoke-rule'; ruleId: string; description?: string }
  | { kind: 'human'; description: string; instructions?: string; role?: string }
  | { kind: 'plan'; description: string };

export interface EmitContextInput {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  objective: string;
  objectiveNotes?: string;
  inputs?: Record<string, EmitResourceRefInput>;
  outputs?: Record<string, { producesKind: string; description?: string }>;
  validations?: Array<{
    id: string;
    validation: EmitValidationInput;
    resources: string[];
  }>;
  action: EmitActionInput;
  guidance?: string;
}

export interface EmitFileSetInput {
  id: string;
  name?: string;
  description?: string;
  include: string[];
  exclude?: string[];
}

export interface EmitTestInput {
  id: string;
  name?: string;
  description?: string;
  testType?: 'unit' | 'functional' | 'smoke' | 'integration';
}

export interface EmitTestSetInput {
  id: string;
  name?: string;
  description?: string;
  members: string[];
}

export interface EmitDeployedResourceInput {
  id: string;
  name?: string;
  description?: string;
  resourceType: string;
  target: string;
}

export interface EmitEnvironmentInput {
  id: string;
  name?: string;
  description?: string;
  provider: string;
  config?: Record<string, string>;
}

export type EmitResourceInput =
  | { kind: 'file-set';           resource: EmitFileSetInput }
  | { kind: 'test';               resource: EmitTestInput }
  | { kind: 'test-set';           resource: EmitTestSetInput }
  | { kind: 'deployed-resource';  resource: EmitDeployedResourceInput }
  | { kind: 'environment';        resource: EmitEnvironmentInput };

export interface EmitRuleInput {
  id: string;
  name: string;
  description?: string;
  on: unknown;
  run: unknown;
  reads?: EmitResourceRefInput[];
  writes?: EmitResourceRefInput[];
  manual?: boolean;
}

export interface AddDeclarationResult {
  readonly writtenPath: string;
  readonly varName: string;
  readonly snapshot: ContextModelSnapshot | null;
}

// ---------------------------------------------------------------------------
// REST helper
// ---------------------------------------------------------------------------

async function execute<T>(projectId: string, command: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/workspace/${encodeURIComponent(projectId)}/api/automation/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body.data as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchContextModel(projectId: string): Promise<ContextModelSnapshot> {
  return execute<ContextModelSnapshot>(projectId, 'contexts.model.get');
}

export async function reloadContextModel(projectId: string): Promise<ContextModelSnapshot> {
  return execute<ContextModelSnapshot>(projectId, 'contexts.model.reload');
}

export async function listContextTemplates(projectId: string): Promise<TemplateMetadata[]> {
  const out = await execute<{ templates: TemplateMetadata[] }>(projectId, 'contexts.templates.list');
  return out.templates;
}

export async function applyContextTemplate(
  projectId: string,
  templateId: string,
  params?: Record<string, string>,
  options?: { overwrite?: boolean },
): Promise<ApplyTemplateResult> {
  return execute<ApplyTemplateResult>(projectId, 'contexts.templates.apply', {
    templateId,
    params: params ?? {},
    overwrite: options?.overwrite ?? false,
  });
}

export async function addContext(
  projectId: string,
  context: EmitContextInput,
): Promise<AddDeclarationResult> {
  return execute<AddDeclarationResult>(projectId, 'contexts.contexts.add', { context });
}

export async function addResource(
  projectId: string,
  input: EmitResourceInput,
): Promise<AddDeclarationResult> {
  return execute<AddDeclarationResult>(projectId, 'contexts.resources.add', {
    kind: input.kind,
    resource: input.resource,
  });
}

export async function addRule(
  projectId: string,
  rule: EmitRuleInput,
): Promise<AddDeclarationResult> {
  return execute<AddDeclarationResult>(projectId, 'contexts.rules.add', { rule });
}

export interface InvokeActionResult {
  readonly queued: boolean;
  readonly contextId: string;
  readonly kind: string;
  readonly ruleId?: string;
  readonly eventType?: string;
  readonly operationId: string;
}

export async function invokeContextAction(
  projectId: string,
  contextId: string,
): Promise<InvokeActionResult> {
  return execute<InvokeActionResult>(projectId, 'contexts.action.invoke', { contextId });
}

// ---------------------------------------------------------------------------
// Regression trace (Phase 5)
// ---------------------------------------------------------------------------

export type ValidationExplanation =
  | { validationId: string; kind: 'rule-outcome'; ruleId: string; ruleStatus: 'success' | 'failed' | 'unknown'; ruleDeclared: boolean }
  | { validationId: string; kind: 'test-pass'; testId: string; passing: boolean | null }
  | { validationId: string; kind: 'test-set-pass'; testSetId: string; memberCount: number; failingMembers: readonly string[]; unobservedMembers: readonly string[] }
  | { validationId: string; kind: 'deployed-resource-present'; resourceId: string; present: boolean }
  | { validationId: string; kind: 'deployed-resource-healthy'; resourceId: string; healthy: boolean }
  | { validationId: string; kind: 'manual-confirm'; description: string }
  | { validationId: string; kind: 'code'; description: string; fn?: string };

export interface ChildBlocker {
  readonly contextId: string;
  readonly contextName: string;
  readonly status: LifecycleStatus;
}

export interface DependencyCulprit {
  readonly contextId: string;
  readonly contextName: string;
  readonly status: LifecycleStatus;
  readonly path: readonly string[];
}

export interface RegressionTrace {
  readonly contextId: string;
  readonly contextName: string;
  readonly status: LifecycleStatus;
  readonly hasOwnFailures: boolean;
  readonly hasDependencyFailures: boolean;
  readonly validationFailures: readonly ValidationExplanation[];
  readonly childBlockers: readonly ChildBlocker[];
  readonly dependencyCulprits: readonly DependencyCulprit[];
}

export async function traceContextRegression(
  projectId: string,
  contextId: string,
): Promise<RegressionTrace> {
  return execute<RegressionTrace>(projectId, 'contexts.regression.trace', { contextId });
}
