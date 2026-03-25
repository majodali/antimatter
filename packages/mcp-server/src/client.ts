/**
 * HTTP client for the Antimatter Automation API.
 *
 * Wraps the REST endpoint with authentication, retry on 401, and
 * structured error handling.
 */

import type { McpServerConfig } from './config.js';
import { getValidAccessToken, forceRefresh } from './auth.js';

// ---------------------------------------------------------------------------
// Types (mirrored from automation-types.ts — no import to stay standalone)
// ---------------------------------------------------------------------------

export interface AutomationResponse {
  readonly ok: boolean;
  readonly requestId: string;
  readonly command: string;
  readonly data?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AutomationClient {
  constructor(private readonly config: McpServerConfig) {}

  /**
   * Execute an automation command.
   * Handles authentication and retries on 401.
   */
  async execute(
    command: string,
    params?: Record<string, unknown>,
    projectId?: string,
  ): Promise<AutomationResponse> {
    const pid = projectId ?? this.config.projectId;
    if (!pid) {
      return {
        ok: false,
        requestId: '',
        command,
        error: {
          code: 'invalid-params',
          message: 'No project ID configured. Set ANTIMATTER_PROJECT_ID or pass projectId.',
        },
        durationMs: 0,
      };
    }

    // First attempt
    const result = await this.doRequest(command, params ?? {}, pid);

    // If unauthorized, refresh and retry once
    if (result.httpStatus === 401) {
      console.error(`[client] Got 401 for ${command}, refreshing token and retrying...`);
      await forceRefresh(this.config);
      const retry = await this.doRequest(command, params ?? {}, pid);
      return retry.response;
    }

    return result.response;
  }

  private async doRequest(
    command: string,
    params: Record<string, unknown>,
    projectId: string,
  ): Promise<{ httpStatus: number; response: AutomationResponse }> {
    const url = `${this.config.baseUrl}/workspace/${projectId}/api/automation/execute`;
    const token = await getValidAccessToken(this.config);

    const body = JSON.stringify({ command, params });
    const timeoutMs = getCommandTimeout(command);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Check if response is JSON
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        return {
          httpStatus: res.status,
          response: {
            ok: false,
            requestId: '',
            command,
            error: {
              code: 'execution-error',
              message: `Non-JSON response (${res.status}): ${text.slice(0, 200)}`,
            },
            durationMs: 0,
          },
        };
      }

      const data = await res.json() as AutomationResponse;
      return { httpStatus: res.status, response: data };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes('abort');
      return {
        httpStatus: 0,
        response: {
          ok: false,
          requestId: '',
          command,
          error: {
            code: isTimeout ? 'timeout' : 'execution-error',
            message: isTimeout
              ? `Request timed out after ${timeoutMs}ms`
              : `Request failed: ${message}`,
          },
          durationMs: 0,
        },
      };
    }
  }

  /**
   * Call a Lambda REST API endpoint directly (not the workspace automation API).
   * Used for project management, workspace lifecycle, etc.
   */
  async callLambdaApi(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; data: unknown }> {
    const url = `${this.config.baseUrl}${path}`;
    const token = await getValidAccessToken(this.config);

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return { status: res.status, data };
  }
}

// ---------------------------------------------------------------------------
// Timeouts (mirrored from automation-types.ts)
// ---------------------------------------------------------------------------

const COMMAND_TIMEOUTS: Record<string, number> = {
  'tests.run': 300_000,
  'build.run': 120_000,
  'git.push': 60_000,
  'git.pull': 60_000,
};

const DEFAULT_TIMEOUT = 30_000;

function getCommandTimeout(command: string): number {
  return COMMAND_TIMEOUTS[command] ?? DEFAULT_TIMEOUT;
}
