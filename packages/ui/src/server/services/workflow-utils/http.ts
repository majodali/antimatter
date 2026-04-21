/**
 * wf.utils.http — traced HTTP client for workflow rules.
 *
 * Wraps fetch with automatic activity tracing. Each call emits
 * workflow:util:start / workflow:util:end events so requests show up in
 * the Activity Panel timeline.
 *
 * Operation ID propagation: if the current rule has an operationId, it's
 * automatically sent as an `X-Operation-Id` header so the receiving
 * service can continue the trace.
 */

import type { ActivityLog } from '../activity-log.js';
import { Kinds } from '../../../shared/activity-types.js';

export interface HttpUtilsContext {
  readonly projectId: string;
  readonly activityLog?: ActivityLog;
  readonly getTraceContext: () => {
    invocationId: string | null;
    ruleId: string | null;
    operationId: string | null;
    environment: string | null;
  };
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  /** Timeout in ms. Default 30000. */
  timeout?: number;
  environment?: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  json?: unknown;
}

async function doRequest(
  ctx: HttpUtilsContext,
  method: string,
  url: string,
  opts: HttpRequestOptions,
): Promise<HttpResponse> {
  const tctx = ctx.getTraceContext();
  const utilId = `util-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const parent = tctx.ruleId ?? tctx.invocationId ?? undefined;
  const operationId = tctx.operationId ?? undefined;
  const environment = opts.environment ?? tctx.environment ?? undefined;
  const start = Date.now();

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (operationId) headers['X-Operation-Id'] = operationId;
  if (opts.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  ctx.activityLog?.emit({
    source: 'workflow', kind: Kinds.WorkflowUtilStart, level: 'info',
    message: `http.${method.toLowerCase()}(${url})`,
    projectId: ctx.projectId,
    correlationId: utilId,
    parentId: parent,
    operationId,
    environment,
    data: { method, url, hasBody: opts.body !== undefined },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 30_000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined
        ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
        : undefined,
      signal: controller.signal,
    });
    const body = await response.text();
    let json: unknown;
    try { json = JSON.parse(body); } catch { /* not JSON */ }
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });
    const durationMs = Date.now() - start;

    ctx.activityLog?.emit({
      source: 'workflow', kind: Kinds.WorkflowUtilEnd,
      level: response.ok ? 'info' : 'warn',
      message: `http.${method.toLowerCase()}(${url}) → ${response.status} (${durationMs}ms)`,
      projectId: ctx.projectId,
      correlationId: utilId,
      parentId: parent,
      operationId,
      environment,
      data: { status: response.status, durationMs, ok: response.ok },
    });

    return {
      status: response.status,
      ok: response.ok,
      headers: respHeaders,
      body,
      json,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    ctx.activityLog?.emit({
      source: 'workflow', kind: Kinds.WorkflowUtilEnd, level: 'error',
      message: `http.${method.toLowerCase()}(${url}) FAILED: ${msg}`,
      projectId: ctx.projectId,
      correlationId: utilId,
      parentId: parent,
      operationId,
      environment,
      data: { status: 'error', durationMs, error: msg },
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function createHttpUtils(ctx: HttpUtilsContext) {
  return {
    get: (url: string, opts: HttpRequestOptions = {}) => doRequest(ctx, 'GET', url, opts),
    post: (url: string, body?: unknown, opts: HttpRequestOptions = {}) =>
      doRequest(ctx, 'POST', url, { ...opts, body }),
    put: (url: string, body?: unknown, opts: HttpRequestOptions = {}) =>
      doRequest(ctx, 'PUT', url, { ...opts, body }),
    delete: (url: string, opts: HttpRequestOptions = {}) =>
      doRequest(ctx, 'DELETE', url, opts),
    patch: (url: string, body?: unknown, opts: HttpRequestOptions = {}) =>
      doRequest(ctx, 'PATCH', url, { ...opts, body }),
  };
}
