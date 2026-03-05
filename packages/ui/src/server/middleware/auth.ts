/**
 * JWT authentication middleware for Cognito tokens.
 *
 * Validates the Bearer token from the Authorization header against
 * the Cognito User Pool's JWKS (JSON Web Key Set). The JWKS is
 * cached by jwks-rsa for performance.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export interface AuthConfig {
  readonly userPoolId: string;
  readonly region: string;
  readonly clientId: string;
}

/**
 * Create Express middleware that validates Cognito JWTs.
 *
 * Returns 401 for missing or invalid tokens.
 * Skips validation for OPTIONS preflight requests.
 */
export function createAuthMiddleware(config: AuthConfig): RequestHandler {
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  const client = jwksClient({
    jwksUri: `${issuer}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 600_000, // 10 minutes
    rateLimit: true,
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for CORS preflight
    if (req.method === 'OPTIONS') {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // Strip "Bearer "

    try {
      // Decode header to get the key ID (kid)
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token format' });
      }

      // Fetch the signing key from JWKS
      const signingKey = await client.getSigningKey(decoded.header.kid);
      const publicKey = signingKey.getPublicKey();

      // Verify signature, issuer, and expiration
      // Note: Cognito access tokens use 'client_id' claim, not 'aud' for audience
      const verified = jwt.verify(token, publicKey, {
        issuer,
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;

      // Verify the token is for our client
      // Access tokens use 'client_id', ID tokens use 'aud'
      const tokenClientId = verified.client_id ?? verified.aud;
      if (tokenClientId !== config.clientId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Token not issued for this client' });
      }

      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token verification failed';
      return res.status(401).json({ error: 'Unauthorized', message });
    }
  };
}
