/**
 * Automation REST route.
 *
 * POST /execute — validates the request body, routes to server-side or
 *   browser-side execution, and returns a structured AutomationResponse.
 * GET  /commands — returns the full command catalog for discovery.
 *
 * Follows the same factory pattern as createFileRouter, createGitRouter, etc.
 */

import { Router } from 'express';
import {
  COMMAND_CATALOG,
  COMMAND_TIMEOUTS,
  DEFAULT_COMMAND_TIMEOUT,
  isServerCommand,
  generateRequestId,
} from '../../shared/automation-types.js';
import type {
  AutomationRequest,
  AutomationResponse,
  AutomationErrorCode,
} from '../../shared/automation-types.js';
import { AutomationCommandError } from '../automation/server-commands.js';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface AutomationRouterDependencies {
  /** Execute a server-side command (file, git, build, workflow, meta). */
  executeServerCommand: (command: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Relay a browser-side command via WebSocket and await the response. */
  relayBrowserCommand: (
    requestId: string,
    command: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  /**
   * Execute headless browser tests on the server (optional — not all contexts support it).
   * `authToken` is the inbound caller's Bearer token, forwarded so the
   * headless runner can authenticate its disposable-project API calls
   * and the browser page it drives.
   */
  executeHeadlessTests?: (params: Record<string, unknown>, authToken: string | undefined) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Error code → HTTP status mapping
// ---------------------------------------------------------------------------

function httpStatusForCode(code: AutomationErrorCode): number {
  switch (code) {
    case 'invalid-params': return 400;
    case 'not-found': return 400; // Not 404 — CloudFront intercepts 404 and serves SPA
    case 'no-browser': return 503;
    case 'timeout': return 504;
    case 'unsupported': return 501;
    case 'execution-error':
    default: return 500;
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createAutomationRouter(deps: AutomationRouterDependencies): Router {
  const router = Router();

  // GET /commands — command catalog for discovery
  router.get('/commands', (_req, res) => {
    res.json({ commands: COMMAND_CATALOG });
  });

  // POST /execute — execute an automation command
  router.post('/execute', async (req, res) => {
    const startTime = Date.now();
    const body = req.body as AutomationRequest | undefined;

    // Validate request body
    if (!body || !body.command) {
      const resp: AutomationResponse = {
        ok: false,
        requestId: body?.requestId ?? generateRequestId(),
        command: body?.command ?? '',
        error: { code: 'invalid-params', message: 'Request body must include "command"' },
        durationMs: Date.now() - startTime,
      };
      return res.status(400).json(resp);
    }

    const requestId = body.requestId ?? generateRequestId();
    const command = body.command;
    const params = body.params ?? {};

    // Check if command exists in catalog
    const catalogEntry = COMMAND_CATALOG.find((c) => c.command === command);
    if (!catalogEntry) {
      const resp: AutomationResponse = {
        ok: false,
        requestId,
        command,
        error: { code: 'not-found', message: `Unknown command: ${command}` },
        durationMs: Date.now() - startTime,
      };
      // Use 400 (not 404) — CloudFront intercepts 404 and serves SPA fallback
      return res.status(400).json(resp);
    }

    try {
      let data: unknown;

      // Special case: tests.run with fixture routing
      if (command === 'tests.run' && (params as any).fixture === 'headless') {
        if (!deps.executeHeadlessTests) {
          const resp: AutomationResponse = {
            ok: false,
            requestId,
            command,
            error: { code: 'unsupported', message: 'Headless test runner not available in this context' },
            durationMs: Date.now() - startTime,
          };
          return res.status(501).json(resp);
        }
        const authHeader = req.headers.authorization;
        const inboundToken = authHeader?.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length)
          : undefined;
        data = await deps.executeHeadlessTests(params, inboundToken);
      } else if (isServerCommand(command)) {
        // Execute directly on the server
        data = await deps.executeServerCommand(command, params);
      } else {
        // Relay to browser via WebSocket
        data = await deps.relayBrowserCommand(requestId, command, params);
      }

      const resp: AutomationResponse = {
        ok: true,
        requestId,
        command,
        data,
        durationMs: Date.now() - startTime,
      };
      res.json(resp);
    } catch (err) {
      const code: AutomationErrorCode =
        err instanceof AutomationCommandError
          ? err.code
          : (err as any)?.code ?? 'execution-error';
      const message = err instanceof Error ? err.message : String(err);

      const resp: AutomationResponse = {
        ok: false,
        requestId,
        command,
        error: { code, message },
        durationMs: Date.now() - startTime,
      };
      res.status(httpStatusForCode(code)).json(resp);
    }
  });

  return router;
}
