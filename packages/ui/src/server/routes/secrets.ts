import { Router } from 'express';
import type { SSMClient } from '@aws-sdk/client-ssm';
import {
  GetParameterCommand,
  PutParameterCommand,
  DeleteParameterCommand,
} from '@aws-sdk/client-ssm';

const SSM_PREFIX = '/antimatter/secrets/';

/** Known secrets with their descriptions. */
const KNOWN_SECRETS = [
  { name: 'anthropic-api-key', description: 'Anthropic API key for AI agent integration' },
  { name: 'github-pat', description: 'GitHub personal access token for git push/pull' },
];

/**
 * Callback invoked when a secret is updated or deleted.
 * Used to clear cached values in the Lambda runtime.
 */
export type OnSecretChanged = (name: string) => void;

export function createSecretsRouter(
  ssmClient: SSMClient,
  onSecretChanged?: OnSecretChanged,
): Router {
  const router = Router();

  // List known secrets with their status (set or not)
  router.get('/', async (_req, res) => {
    try {
      const results = await Promise.all(
        KNOWN_SECRETS.map(async (secret) => {
          try {
            await ssmClient.send(
              new GetParameterCommand({
                Name: `${SSM_PREFIX}${secret.name}`,
                WithDecryption: false, // We only need to check existence
              }),
            );
            return { ...secret, hasValue: true };
          } catch (err: any) {
            if (err.name === 'ParameterNotFound') {
              return { ...secret, hasValue: false };
            }
            // Other errors (permission, throttling) — report as not set
            console.warn(`[secrets] Error checking ${secret.name}:`, err.message);
            return { ...secret, hasValue: false };
          }
        }),
      );

      res.json({ secrets: results });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list secrets',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Set a secret value
  router.put('/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const { value } = req.body as { value?: string };

      // Validate name is in the known list
      if (!KNOWN_SECRETS.some((s) => s.name === name)) {
        return res.status(400).json({ error: `Unknown secret: ${name}` });
      }

      if (!value || typeof value !== 'string' || value.trim().length === 0) {
        return res.status(400).json({ error: 'Secret value is required' });
      }

      await ssmClient.send(
        new PutParameterCommand({
          Name: `${SSM_PREFIX}${name}`,
          Value: value.trim(),
          Type: 'SecureString',
          Overwrite: true,
        }),
      );

      onSecretChanged?.(name);

      res.json({ success: true, name });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to set secret',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Delete a secret
  router.delete('/:name', async (req, res) => {
    try {
      const { name } = req.params;

      if (!KNOWN_SECRETS.some((s) => s.name === name)) {
        return res.status(400).json({ error: `Unknown secret: ${name}` });
      }

      await ssmClient.send(
        new DeleteParameterCommand({
          Name: `${SSM_PREFIX}${name}`,
        }),
      );

      onSecretChanged?.(name);

      res.json({ success: true, name });
    } catch (error: any) {
      if (error.name === 'ParameterNotFound') {
        return res.json({ success: true, name: req.params.name });
      }
      res.status(500).json({
        error: 'Failed to delete secret',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
