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

export function createContextsRouter(contextStore: ContextStore): Router {
  const router = Router();

  // GET / — current snapshot.
  router.get('/', (_req, res) => {
    res.json(contextStore.getSnapshot());
  });

  // POST /reload — force re-parse from disk (idempotent).
  router.post('/reload', async (_req, res) => {
    try {
      const snap = await contextStore.reload();
      res.json(snap);
    } catch (err) {
      res.status(500).json({
        error: 'Failed to reload contexts',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
