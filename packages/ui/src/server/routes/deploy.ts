import { Router } from 'express';
import type { S3Client } from '@aws-sdk/client-s3';
import type { WorkspaceService } from '../services/workspace-service.js';
import {
  DeploymentExecutor,
} from '../services/deployment-executor.js';
import type {
  DeployLambdaClient,
  DeployCloudfrontClient,
} from '../services/deployment-executor.js';
import type { DeploymentResult } from '@antimatter/project-model';

export interface DeployRouterOptions {
  /** S3 data bucket where project files live. */
  readonly bucket: string;
  /** S3 prefix for project files (e.g. "projects/{id}/files/"). */
  readonly prefix: string;
  /** Lambda client for Lambda function updates (optional — only on deployed Lambda). */
  readonly lambdaClient?: DeployLambdaClient;
  /** CloudFront client for cache invalidation (optional). */
  readonly cloudfrontClient?: DeployCloudfrontClient;
}

export function createDeployRouter(
  workspace: WorkspaceService,
  s3Client: S3Client | undefined,
  options?: DeployRouterOptions,
): Router {
  const router = Router();

  // In-memory results (same pattern as build results in WorkspaceService)
  let deployResults: DeploymentResult[] = [];

  // Load deployment config
  router.get('/config', async (_req, res) => {
    try {
      const config = await workspace.loadDeployConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load deployment config',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Save deployment config
  router.put('/config', async (req, res) => {
    try {
      const { modules, packaging, targets } = req.body;
      if (!modules || !packaging || !targets) {
        return res.status(400).json({
          error: 'modules, packaging, and targets are required',
        });
      }
      await workspace.saveDeployConfig({ modules, packaging, targets });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to save deployment config',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Execute deployment (supports SSE streaming)
  router.post('/execute', async (req, res) => {
    try {
      const { targetIds, dryRun } = req.body as {
        targetIds?: string[];
        dryRun?: boolean;
      };

      // Load the deployment config
      const config = await workspace.loadDeployConfig();
      if (config.targets.length === 0) {
        return res.status(400).json({
          error: 'No deployment targets configured. Add targets via the deploy config editor.',
        });
      }

      if (!s3Client || !options) {
        return res.status(400).json({
          error: 'Deployment is not available in this environment (no S3 client configured)',
        });
      }

      // Get the workspace environment for command execution
      if (!workspace.env) {
        return res.status(400).json({
          error: 'No workspace environment available for command execution',
        });
      }

      // Check if client wants SSE streaming
      const wantsSSE = req.headers.accept === 'text/event-stream';

      const executor = new DeploymentExecutor({
        env: workspace.env,
        s3Client,
        projectsBucket: options.bucket,
        projectPrefix: options.prefix,
        lambdaClient: options.lambdaClient,
        cloudfrontClient: options.cloudfrontClient,
        onProgress: wantsSSE
          ? (event) => {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          : undefined,
      });

      if (wantsSSE) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        try {
          const results = await executor.deployAll(config, targetIds, dryRun);
          deployResults = results;
          res.write(`data: ${JSON.stringify({ type: 'deploy-complete', results })}\n\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({ type: 'deploy-error', error: error instanceof Error ? error.message : String(error) })}\n\n`);
        }
        res.end();
      } else {
        const results = await executor.deployAll(config, targetIds, dryRun);
        deployResults = results;
        res.json({ results });
      }
    } catch (error) {
      res.status(500).json({
        error: 'Failed to execute deployment',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get deployment results
  router.get('/results', (_req, res) => {
    res.json({ results: deployResults });
  });

  // Clear deployment results
  router.delete('/results', (_req, res) => {
    deployResults = [];
    res.json({ success: true });
  });

  return router;
}
