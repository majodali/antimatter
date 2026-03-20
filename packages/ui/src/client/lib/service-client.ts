/**
 * ServiceClient singleton for the browser.
 *
 * Provides a typed, transport-agnostic interface for calling all service
 * operations. The RestTransport handles auth injection and workspace-aware
 * URL routing automatically.
 *
 * Usage:
 * ```ts
 * import { client } from '@/lib/service-client';
 *
 * const tree = await client.query({ type: 'files.tree', projectId: pid });
 * await client.command({ type: 'files.write', projectId: pid, path: '/a.ts', content: '...' });
 * ```
 *
 * The singleton is also available as `window.__serviceClient` for console debugging.
 */

import { ServiceClient } from '@antimatter/service-interface';
import { RestTransport } from './rest-transport.js';

// Create the singleton transport and client
const restTransport = new RestTransport();

/**
 * Global ServiceClient instance.
 *
 * Uses RestTransport for both platform and workspace operations.
 * Workspace routing is handled inside RestTransport (checks activeWorkspaceProjectIds).
 * When we add WebSocket-based operations, the workspace transport
 * will be swapped to a WebSocketTransport.
 */
export const client = new ServiceClient(
  {
    platform: restTransport,
    workspace: restTransport,
    // No browser transport yet — editor automation commands TBD
  },
  '', // Default projectId — callers pass it per-operation
);

// Re-export workspace routing functions for use by workspace-connection.ts
export {
  setActiveWorkspace,
  clearActiveWorkspace,
  getActiveWorkspace,
  hasActiveWorkspace,
} from './rest-transport.js';

// Expose on window for console debugging
if (typeof window !== 'undefined') {
  (window as any).__serviceClient = client;
}
