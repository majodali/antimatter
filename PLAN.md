# Implementation Plan: Post Self-Hosting Improvements

## Phase 1: Remove nx and pnpm, switch to npm workspaces

Remove nx (build orchestrator) and pnpm (package manager) entirely. Replace with npm workspaces. This is foundational — all subsequent changes build/test with the new tooling.

### 1.1 Update root `package.json`

- Add `"workspaces": ["packages/*", "infrastructure"]`
- Remove devDeps: `nx`, `@nx/js`, `@swc-node/register`, `@swc/core`, `@swc/helpers`, `tslib`
- Add root scripts:
  - `"test": "npm --workspaces run test --if-present"`
  - `"build": "npm --workspaces run build --if-present"`
  - `"lint": "npm --workspaces run lint --if-present"`

### 1.2 Replace `workspace:*` with `*` in all package.json files

npm workspaces auto-link local packages when the name matches. Change all `"@antimatter/project-model": "workspace:*"` to `"@antimatter/project-model": "*"` across all 8 workspace packages.

Files: `packages/{filesystem,tool-integration,build-system,agent-framework,workflow,workspace,test-harness,ui}/package.json`

### 1.3 Delete nx/pnpm config files

- Delete `pnpm-workspace.yaml`
- Delete `nx.json`
- Delete `pnpm-lock.yaml`

### 1.4 Update eslint.config.js

Remove `'**/.nx/**'` from the ignores array.

### 1.5 Update shell scripts — `pnpm` → `npm`

- `scripts/build-lambda.sh` line 7: `pnpm install --frozen-lockfile` → `npm ci`

### 1.6 Update workflow automation — `pnpm`/`nx` → `npm`/`vite`

- `.antimatter/build.ts`:
  - Line 30: `'npx nx run ui:build'` → `'cd packages/ui && npx vite build'`
  - Line 62: `'pnpm install --frozen-lockfile'` → `'npm ci'`
  - Line 73: `'pnpm install failed'` → `'npm ci failed'`
- `.antimatter/deploy.ts`:
  - Line 106: `'npx nx run ui:build'` → `'cd packages/ui && npx vite build'`
  - Line 163: `'pnpm install --frozen-lockfile'` → `'npm ci'`

### 1.7 Update EC2 user-data script

`packages/ui/src/server/services/workspace-ec2-service.ts` line 405:
`npm install -g pnpm nx aws-cdk` → `npm install -g aws-cdk`

### 1.8 Update CLAUDE.md

Replace all nx/pnpm references with npm equivalents:
- `nx run-many --target=test --all` → `npm --workspaces run test --if-present`
- `nx test filesystem` → `npm test -w @antimatter/filesystem`
- `nx run-many --target=build --all` → `npm --workspaces run build --if-present`
- `nx run ui:build` → `npm run build -w @antimatter/ui`
- `pnpm workspaces` → `npm workspaces`
- Remove Nx references from architecture description

### 1.9 Generate package-lock.json

```bash
rm -rf node_modules
npm install
```

### 1.10 Verify

- `npm --workspaces run test --if-present` — all tests pass
- `npm run build -w @antimatter/ui` — vite build works (not tsc declarations!)
- `node packages/ui/scripts/build-lambda.mjs` — Lambda bundles
- esbuild `@antimatter/source` condition still resolves correctly

---

## Phase 2: Pause auto-stop during workflow actions

### Problem

`ConnectionManager` in `workspace-server.ts` starts a 10-minute shutdown timer when the last WebSocket client disconnects. During long-running workflow commands (npm install, CDK deploy), if the WebSocket briefly drops, the idle timer can trigger and kill the instance.

### 2.1 Add hold/release to ConnectionManager

Add `workflowHoldCount` to `ConnectionManager` class in `workspace-server.ts` (line 380):

- `holdShutdown()`: increment hold count, cancel any pending shutdown timer
- `releaseShutdown()`: decrement hold count, start shutdown timer if count=0 AND connections=0
- Modify `remove()`: only start shutdown timer if `!this.isHeld`

### 2.2 Wire workflow execution to hold/release

In `WorkflowManager.createExecutor()` (`workflow-manager.ts` line 465), wrap `this.env.execute()` in try/finally that calls hold/release:

```typescript
private createExecutor(): ... {
  return async (command, options) => {
    this.options.onExecStart?.();
    try {
      // ... existing execute logic ...
    } finally {
      this.options.onExecEnd?.();
    }
  };
}
```

Add `onExecStart` / `onExecEnd` callbacks to `WorkflowManagerOptions` interface.

In `workspace-server.ts`, pass the callbacks when constructing WorkflowManager:
```typescript
onExecStart: () => connectionManager.holdShutdown(),
onExecEnd: () => connectionManager.releaseShutdown(),
```

### 2.3 Safety net

Add a max hold duration (30 minutes) to prevent leaked holds from keeping instances alive forever.

---

## Phase 3: Silent WebSocket reconnects (<5s)

### Problem

Every brief WebSocket reconnect shows a spinner overlay blocking the terminal. Most reconnects complete in 1-3 seconds and shouldn't be visible to the user.

### 3.1 Add `reconnecting` state to terminalStore

Add new connection state `'reconnecting'` to `ConnectionState` type. This is distinct from `'connecting'` (initial connection).

### 3.2 Implement 5-second grace period

In `ws.onclose` handler (terminalStore.ts line 326):
1. On unexpected close, set state to `'reconnecting'` instead of `'connecting'`
2. Start a 5-second grace timer
3. If reconnect succeeds within 5s: clear timer, go to `'connected'`, no UI disruption
4. If 5s elapses while still reconnecting: show the spinner overlay AND log an error (`eventLog.error(...)`) so we can track reconnect frequency and troubleshoot

### 3.3 Buffer input during silent reconnect

Add `inputBuffer: string[]` to store. In `sendInput()`:
- If `connected`: send immediately (existing behavior)
- If `reconnecting`: push to buffer

On successful reconnect in `ws.onopen`: flush buffered input.

Cap buffer at 1000 characters to prevent overflow.

### 3.4 Extract WebSocket-only reconnect function

Create `reconnectToWebSocket(projectId)` that skips the EC2 start/poll sequence and goes straight to WebSocket creation. The instance is already running during a reconnect.

### 3.5 Update TerminalPanel overlay

In `TerminalPanel.tsx` line 301, change overlay condition:
```tsx
{statusMessage && (
  connectionState === 'starting' ||
  connectionState === 'connecting' ||
  (connectionState === 'reconnecting' && showReconnectOverlay)
) && (
```

Update `ConnectionBadge`: show green "Connected" during silent reconnect (no flicker), yellow "Reconnecting..." only after 5s grace period.

Update `isConnectedOrConnecting` to include `'reconnecting'` so buttons/terminal remain usable during brief reconnects.

### 3.6 Remove fallback command input

The fallback command input (line 312) is visually jarring and inconsistent — it shows a raw text input when disconnected, which doesn't match the XTerm-based terminal experience. Remove it entirely. When disconnected, the terminal area shows the XTerm (with replay buffer visible) and the connection overlay when applicable. Users reconnect via the header buttons, not a text input.

---

## Phase 4: CloudFront cache invalidation — Already Implemented

Both `antimatter-stack.ts` and `antimatter-env-stack.ts` already have `distribution` and `distributionPaths: ['/*']` on `BucketDeployment`. CDK handles invalidation automatically.

If stale content persists, it's likely browser disk cache (not CloudFront). Consider adding `Cache-Control: no-cache` to the `BucketDeployment` metadata for `index.html`, or accept that Vite's content-hashed asset filenames already handle this (only `index.html` needs invalidation).

**No code changes needed.**

---

## Phase 5: Build/Deploy UI — Rule States + Resource Management

The user's vision: Build rules shown in the Build panel with running/success/error states. Deploy panel shows persistent resources (environments, releases) with interactions. Terminal shows execution output. Toasts for completions/errors. No new UI chrome — the existing panels evolve.

### 5.1 Build Panel — Rule State Display

This is already partially implemented. The `buildStore` has `setResult()` / `setResults()` for rule states. The `workflow-result` WebSocket message broadcasts rule execution results. Connect these:

- When `workflow-result` arrives on WebSocket, update `buildStore` with rule states
- Build panel renders each rule with: name, status indicator (spinner/checkmark/X), duration
- Add `wf.display()` method for explicitly defining and updating build panel elements (distinct from `wf.log()`, which is for logging only). Rules can call `wf.display({ id, label, status, detail })` to push structured UI state.
- Rules with sub-components (e.g., a bundle rule that handles frontend + lambda) use `wf.display()` to define separate visual elements per component.
- Each rule row has a "Run" button. Clicking it does NOT emit the rule's trigger event (predicates may have complex conditions that can't be satisfied with a synthetic event). Instead, it calls `WorkflowManager.runRule(ruleId)` which directly invokes the rule's action with an empty events array `[]`, bypassing the predicate. Actions that inspect event content should interpret empty events as "reprocess everything". Most actions already ignore events (`_events`) and work correctly with manual runs.

### 5.2 Deploy Panel — Resource/Environment Display

The deploy workflow already declares targets and environments. Extend the Deploy panel to show:

- **Environments**: Listed from `wf.environment()` declarations (name, stack, domain, status)
- **Resources**: Listed from `wf.target()` declarations (name, type, last deployed)
- Each item has declared interactions: "Deploy", "Refresh", "Shut Down"
- Clicking an interaction emits the corresponding workflow event

### 5.3 Toast Notifications

Wire `workflow-result` WebSocket messages to toast notifications:
- On rule completion: green toast with rule name + duration
- On rule failure: red toast with rule name + first error line
- The `toastStore` already exists — use it

### 5.4 Implementation Note

Phase 5 is the largest phase and can be broken into sub-phases:
- 5a: Wire workflow-result → buildStore for rule state display
- 5b: Add Build panel rule list with status indicators and run buttons
- 5c: Wire workflow declarations → deployStore for resource display
- 5d: Add Deploy panel resource list with interaction buttons
- 5e: Toast notifications on workflow completion/failure

---

## Implementation Order

1. **Phase 1** (nx/pnpm removal) — foundational, do first
2. **Phase 2** (auto-stop hold) — small server change, high impact for reliability
3. **Phase 3** (silent reconnects) — client-side UX improvement
4. **Phase 4** — no changes needed
5. **Phase 5** (Build/Deploy UI) — can be done incrementally after 1-3

Phases 1-3 should be done as a single deployment cycle (build, test, deploy, verify in IDE).
