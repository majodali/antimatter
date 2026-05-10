/**
 * Client-side wrappers for the project-context-model automation
 * commands. Thin REST calls that mirror the server handler shapes;
 * keeps `ContextsPanel` clean of boilerplate and gives the rest of the
 * client a typed API for the new model.
 */

// ---------------------------------------------------------------------------
// Wire types — mirror the server snapshot
// ---------------------------------------------------------------------------

export interface SerializedContext {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly objectiveStatement: string;
  readonly objectiveNotes?: string;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly validationIds: readonly string[];
  readonly actionKind: string;
  readonly actionDescription: string;
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

export interface ContextModelSnapshot {
  readonly present: boolean;
  readonly loadedFiles: readonly string[];
  readonly loadErrors: readonly ContextModelLoadError[];
  readonly modelErrors: readonly ContextModelAssemblyError[];
  readonly counts: {
    readonly contexts: number;
    readonly resources: number;
    readonly rules: number;
  };
  readonly contexts: readonly SerializedContext[];
  readonly resources: readonly SerializedResource[];
  readonly rules: readonly SerializedRule[];
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
