/**
 * Auth Service (stub)
 *
 * Platform service for authentication and authorization.
 * Currently backed by AWS Cognito. Full specification TBD.
 */

import type { OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface UserInfo {
  readonly userId: string;
  readonly email: string;
  readonly name?: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface AuthCurrentUserQuery {
  readonly type: 'auth.currentUser';
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type AuthCommand = never;
export type AuthQuery = AuthCurrentUserQuery;
export type AuthEvent = never;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface AuthCommandResponseMap {
  // No commands yet
}

export interface AuthQueryResponseMap {
  'auth.currentUser': UserInfo;
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

export const AUTH_OPERATIONS: Record<string, OperationMeta> = {
  'auth.currentUser': { kind: 'query', context: 'platform', description: 'Get current authenticated user' },
};
