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

  // Use the current origin so OAuth works regardless of which CloudFront
  // domain the app is served from (custom domain OR *.cloudfront.net).
  const redirectUri = window.location.origin + '/';

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: authConfig.userPoolId,
        userPoolClientId: authConfig.clientId,
        loginWith: {
          oauth: {
            domain: authConfig.domain,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [redirectUri],
            redirectSignOut: [redirectUri],
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
 *
 * Headless test runner shortcut: when `window.__HEADLESS_TOKEN__` is set
 * (by the server-side Puppeteer runner before navigation), return it
 * directly without consulting Amplify. The token is the inbound caller's
 * own Cognito token forwarded from `tests.run`, so this grants no
 * additional privilege.
 */
export async function getAccessToken(): Promise<string | null> {
  const injected = (typeof window !== 'undefined' ? (window as unknown as { __HEADLESS_TOKEN__?: string }).__HEADLESS_TOKEN__ : undefined);
  if (injected) return injected;
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the user's email from the ID token payload, or null if unavailable.
 * The email scope is requested in initAuth so the claim is present.
 */
export async function getUserEmail(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    const email = session.tokens?.idToken?.payload?.email;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

export { signOut, getCurrentUser, signInWithRedirect, Hub };
