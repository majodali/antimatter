/**
 * Token management for Cognito authentication.
 *
 * Reads tokens from a JSON file, checks JWT expiry, refreshes via
 * Cognito InitiateAuth API (no AWS SDK), and writes back updated tokens.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { McpServerConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenFile {
  ChallengeParameters?: Record<string, string>;
  AuthenticationResult: {
    AccessToken: string;
    RefreshToken: string;
    IdToken: string;
    ExpiresIn: number;
    TokenType: string;
  };
}

interface AuthConfig {
  region: string;
  userPoolId: string;
  clientId: string;
}

// ---------------------------------------------------------------------------
// Cached state
// ---------------------------------------------------------------------------

let cachedAuthConfig: AuthConfig | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a valid access token, refreshing if needed.
 * Returns the Bearer token string.
 */
export async function getValidAccessToken(config: McpServerConfig): Promise<string> {
  const tokenFilePath = resolve(process.cwd(), config.tokenFilePath);
  const tokens = await readTokens(tokenFilePath);
  const accessToken = tokens.AuthenticationResult.AccessToken;

  if (!isExpiringSoon(accessToken)) {
    return accessToken;
  }

  // Token expiring soon — refresh
  console.error('[auth] Access token expiring soon, refreshing...');
  const authConfig = await getAuthConfig(config.baseUrl);
  const newTokens = await refreshTokens(
    tokens.AuthenticationResult.RefreshToken,
    authConfig.clientId,
    authConfig.region,
  );

  // Merge new tokens into existing file (refresh doesn't return RefreshToken)
  tokens.AuthenticationResult.AccessToken = newTokens.AccessToken;
  tokens.AuthenticationResult.IdToken = newTokens.IdToken;
  tokens.AuthenticationResult.ExpiresIn = newTokens.ExpiresIn;

  await writeTokensAtomic(tokenFilePath, tokens);
  console.error('[auth] Tokens refreshed and saved');

  return newTokens.AccessToken;
}

/**
 * Force a token refresh (e.g., after a 401 response).
 */
export async function forceRefresh(config: McpServerConfig): Promise<string> {
  const tokenFilePath = resolve(process.cwd(), config.tokenFilePath);
  const tokens = await readTokens(tokenFilePath);
  const authConfig = await getAuthConfig(config.baseUrl);

  const newTokens = await refreshTokens(
    tokens.AuthenticationResult.RefreshToken,
    authConfig.clientId,
    authConfig.region,
  );

  tokens.AuthenticationResult.AccessToken = newTokens.AccessToken;
  tokens.AuthenticationResult.IdToken = newTokens.IdToken;
  tokens.AuthenticationResult.ExpiresIn = newTokens.ExpiresIn;

  await writeTokensAtomic(tokenFilePath, tokens);
  console.error('[auth] Tokens force-refreshed and saved');

  return newTokens.AccessToken;
}

// ---------------------------------------------------------------------------
// Token file I/O
// ---------------------------------------------------------------------------

async function readTokens(filePath: string): Promise<TokenFile> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as TokenFile;
}

async function writeTokensAtomic(filePath: string, tokens: TokenFile): Promise<void> {
  const dir = dirname(filePath);
  const tmpPath = resolve(dir, `.tokens-${Date.now()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(tokens, null, 4), 'utf-8');
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// JWT decode (no verification — just reading expiry)
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1]!;
  // Base64url → Base64 → Buffer → JSON
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(base64, 'base64').toString('utf-8');
  return JSON.parse(json);
}

function isExpiringSoon(accessToken: string, marginMs: number = 300_000): boolean {
  try {
    const payload = decodeJwtPayload(accessToken);
    const exp = payload.exp as number;
    if (!exp) return true; // No expiry — treat as expired
    const expiresAt = exp * 1000;
    return Date.now() + marginMs >= expiresAt;
  } catch {
    return true; // Can't decode — treat as expired
  }
}

// ---------------------------------------------------------------------------
// Auth config from server
// ---------------------------------------------------------------------------

async function getAuthConfig(baseUrl: string): Promise<AuthConfig> {
  if (cachedAuthConfig) return cachedAuthConfig;

  const res = await fetch(`${baseUrl}/api/auth/config`);
  if (!res.ok) {
    throw new Error(`Failed to fetch auth config: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as AuthConfig;
  cachedAuthConfig = data;
  console.error(`[auth] Fetched auth config: region=${data.region}, clientId=${data.clientId}`);
  return data;
}

// ---------------------------------------------------------------------------
// Cognito token refresh (raw fetch, no AWS SDK)
// ---------------------------------------------------------------------------

interface RefreshResult {
  AccessToken: string;
  IdToken: string;
  ExpiresIn: number;
  TokenType: string;
}

async function refreshTokens(
  refreshToken: string,
  clientId: string,
  region: string,
): Promise<RefreshResult> {
  const url = `https://cognito-idp.${region}.amazonaws.com/`;

  const body = JSON.stringify({
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: clientId,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { AuthenticationResult: RefreshResult };
  return data.AuthenticationResult;
}
