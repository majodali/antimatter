/**
 * Contexts REST routes — read-only surface over the parsed
 * `.antimatter/contexts.dsl` model owned by ContextStore.
 *
 * The store auto-reloads when the DSL file changes, so callers always
 * see fresh data. Live update is also broadcast over WebSocket via
 * `application-state` patches; this REST endpoint is for fetch-on-load
 * and external tools (Automation API).
 */
import { Router } from 'express';
import type { ContextStore } from '../services/context-store.js';
import {
  enrichContextSnapshot,
  type ContextLifecycleSnapshot,
} from '../../shared/contexts-types.js';

/**
 * REST surface over the parsed contexts model.
 *
 * When `getLifecycle` is provided, responses are enriched with the
 * runtime lifecycle data (per-context status + live requirement
 * pass/fail + catalog-resolution validation errors). External callers
 * (Automation API, MCP) get the same merged view the IDE renders.
 */
export function createContextsRouter(
  contextStore: ContextStore,
  getLifecycle?: () => ContextLifecycleSnapshot | null,
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(enrichContextSnapshot(contextStore.getSnapshot(), getLifecycle?.()));
  });

  router.post('/reload', async (_req, res) => {
    try {
      const snap = await contextStore.reload();
      res.json(enrichContextSnapshot(snap, getLifecycle?.()));
    } catch (err) {
      res.status(500).json({
        error: 'Failed to reload contexts',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
