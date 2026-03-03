/**
 * Events routes — query centralized system events from S3.
 *
 * Events are written by EventLogger (workspace-server and Lambda) as JSONL
 * files under s3://bucket/events/{projectId}/{date}/. This route provides
 * a query API to retrieve recent events.
 */

import { Router } from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { EventLogger } from '../services/event-logger.js';

/**
 * @param s3Client S3 client for reading event logs
 * @param bucket S3 bucket name
 * @param defaultProjectId Optional default project ID (used on workspace-server
 *   where projectId is known from environment, not from URL params)
 */
export function createEventsRouter(s3Client: S3Client, bucket: string, defaultProjectId?: string): Router {
  const router = Router({ mergeParams: true });

  /**
   * GET / — Load recent system events for a project.
   * Query params:
   *   days — Number of days to look back (default: 1)
   *   limit — Maximum events to return (default: 200)
   */
  router.get('/', async (req, res) => {
    try {
      const projectId = req.params.projectId || defaultProjectId;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }

      const days = parseInt(String(req.query.days) || '1', 10);
      const limit = parseInt(String(req.query.limit) || '200', 10);

      const events = await EventLogger.loadRecentEvents(s3Client, bucket, projectId, {
        days: Math.min(days, 30), // Cap at 30 days
        limit: Math.min(limit, 1000), // Cap at 1000 events
      });

      res.json({ events });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
