/**
 * AuthGate — wraps the entire app and ensures the user is authenticated
 * before rendering children. Redirects to Cognito Hosted UI if not.
 */

import { useEffect, useState } from 'react';
import { initAuth, getCurrentUser, signInWithRedirect, Hub } from '../lib/auth';

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');

  useEffect(() => {
    // Headless test runner injects a Cognito token before navigate; treat
    // the page as already authenticated and skip the Amplify redirect dance.
    const injected = (window as unknown as { __HEADLESS_TOKEN__?: string }).__HEADLESS_TOKEN__;
    if (injected) {
      setState('authenticated');
      return;
    }
    checkAuth();

    // Listen for auth events (e.g., redirect back from Hosted UI)
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn' || payload.event === 'signInWithRedirect') {
        setState('authenticated');
      }
      if (payload.event === 'signedOut') {
        setState('unauthenticated');
      }
    });

    return unsubscribe;
  }, []);

  async function checkAuth() {
    try {
      await initAuth();
      await getCurrentUser();
      setState('authenticated');
    } catch {
      // Not authenticated — redirect to Cognito Hosted UI
      try {
        await signInWithRedirect();
      } catch (err) {
        console.error('[AuthGate] Failed to redirect to login:', err);
        setState('unauthenticated');
      }
    }
  }

  if (state === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (state === 'unauthenticated') {
    // Should be redirecting to Cognito — show nothing
    return null;
  }

  return <>{children}</>;
}
