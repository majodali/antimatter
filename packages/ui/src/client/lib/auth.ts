/**
 * Authentication module — configures AWS Amplify with Cognito
 * and provides token access for API calls.
 */

import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signOut, getCurrentUser, signInWithRedirect } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

let configured = false;
let authConfig: {
  userPoolId: string;
  clientId: string;
  region: string;
  domain: string;
  redirectUri: string;
} | null = null;

/**
 * Initialize Amplify with Cognito config fetched from the API.
 * Safe to call multiple times — only configures once.
 */
export async function initAuth(): Promise<void> {
  if (configured) return;

  // Fetch Cognito configuration from the public API endpoint
  const res = await fetch('/api/auth/config');
  if (!res.ok) {
    throw new Error(`Failed to fetch auth config: ${res.statusText}`);
  }
  authConfig = await res.json();

  if (!authConfig?.userPoolId || !authConfig?.clientId) {
    console.warn('[auth] Cognito not configured — skipping auth initialization');
    return;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: authConfig.userPoolId,
        userPoolClientId: authConfig.clientId,
        loginWith: {
          oauth: {
            domain: authConfig.domain,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [authConfig.redirectUri],
            redirectSignOut: [authConfig.redirectUri],
            responseType: 'code',
          },
        },
      },
    },
  });

  configured = true;
}

/**
 * Get the current access token, or null if not authenticated.
 * Amplify automatically refreshes expired access tokens using the refresh token.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export { signOut, getCurrentUser, signInWithRedirect, Hub };
