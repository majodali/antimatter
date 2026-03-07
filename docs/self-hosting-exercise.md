# Self-Hosting Build+Deploy Exercise — Findings

**Date:** 2026-03-06
**Goal:** Build and deploy a dev instance of the Antimatter IDE from within the IDE itself, noting UI challenges and terminal commands.

## Summary

The IDE can successfully **build** the application (frontend + Lambda + workspace server) from within its own terminal. However, **CDK deployment** is blocked by the `infrastructure/` directory requiring its own `npm install`, which crashes when the workspace auto-stops during the long-running installation of `aws-cdk-lib`.

## Terminal Commands — Full Build+Deploy Sequence

```bash
# 1. Install workspace dependencies (works — ~30s)
pnpm install --frozen-lockfile

# 2. Build frontend (works — ~10s)
cd packages/ui && npx vite build
# NOTE: Do NOT use `npx nx run ui:build` — see Known Issues #1

# 3. Bundle Lambda functions (works — <1s)
node packages/ui/scripts/build-lambda.mjs

# 4. Bundle workspace server (works — ~1.5s)
node packages/ui/scripts/build-workspace-server.mjs

# 5. Install infrastructure dependencies (FAILS — see Known Issues #4)
cd infrastructure && npm install

# 6. CDK deploy (BLOCKED by step 5)
cd infrastructure && AWS_DEFAULT_REGION=us-west-2 npx cdk deploy --require-approval never
```

## What Works

| Step | Command | Duration | Status |
|------|---------|----------|--------|
| Workspace deps | `pnpm install --frozen-lockfile` | ~30s | OK |
| Frontend build | `cd packages/ui && npx vite build` | 10.32s | OK |
| Lambda bundle | `node packages/ui/scripts/build-lambda.mjs` | 15ms | OK |
| Workspace bundle | `node packages/ui/scripts/build-workspace-server.mjs` | 1.46s | OK |
| AWS credentials | `aws sts get-caller-identity` | <1s | OK (EC2 instance profile) |
| CDK CLI | `npx cdk --version` | <1s | OK (v2.1109.0) |

## What Doesn't Work

| Step | Command | Issue |
|------|---------|-------|
| Nx build | `npx nx run ui:build` | Silently runs tsc declarations, not vite build |
| Infrastructure deps | `cd infrastructure && npm install` | Node.js crashes (assertion error) — workspace auto-stops |
| CDK deploy | `npx cdk deploy` | Blocked by missing infrastructure deps |

## Known Issues & UI Gaps

### 1. `npx nx run ui:build` Runs Wrong Build Target (Critical)

The `@nx/js/typescript` plugin in `nx.json` creates a `build` target from `tsconfig.lib.json`, which has `emitDeclarationOnly: true`. This **shadows** the `package.json` `"build": "vite build"` script. Running `npx nx run ui:build` silently completes tsc declaration compilation with no visible output — it does NOT run the vite build.

**Workaround:** Run `cd packages/ui && npx vite build` directly.

**Fix options:**
- Add a `project.json` for the UI package that explicitly defines `build` as vite
- Rename the Nx plugin target to `typecheck` or `declarations`
- Exclude `packages/ui` from the `@nx/js/typescript` plugin scope

### 2. Workspace Auto-Stops During Long-Running Commands (Critical)

The EC2 idle detection mechanism shuts down the workspace instance while commands are still running. This was observed with:
- `npm install` for `aws-cdk-lib` (large package, takes 1-2 minutes)
- CDK synth/deploy (2-5 minutes)

The idle detector likely checks WebSocket activity or PTY output activity. When output is redirected to a file (`> /tmp/log 2>&1`), the workspace appears idle and gets stopped, killing the running process.

**Impact:** Any command taking more than ~60s risks being killed.

**Fix needed:** The idle detector should check if the PTY has running child processes, not just whether there's WebSocket traffic. A simple `pgrep -P $PTY_PID` check would work.

### 3. WebSocket Disconnects During Builds (Improved but not eliminated)

After the keepalive/heartbeat fixes (15s client pings, 20s server heartbeats, 300s ALB timeout, 60s CloudFront readTimeout), the WebSocket is much more stable. However, disconnects still occur during periods of:
- High CPU usage (npm install, CDK synth)
- Long periods with no PTY output

The auto-reconnect mechanism works well — the terminal reconnects and the PTY replay buffer preserves output. But any **input** sent during a disconnect is silently lost.

**Impact:** Commands can be lost if sent during a reconnection window.

**Improvement needed:** Queue terminal input during disconnects and replay on reconnection.

### 4. `infrastructure/` Not in pnpm Workspace (Design Gap)

The `infrastructure/` directory is excluded from `pnpm-workspace.yaml`. It has its own `package.json` and requires a separate `npm install`. This means:

- `pnpm install` at the root doesn't install CDK dependencies
- A separate `cd infrastructure && npm install` is needed
- `aws-cdk-lib` is very large (~300MB of node_modules), making this install slow and prone to workspace auto-stop (see #2)

**Fix options:**
- Add `infrastructure` to `pnpm-workspace.yaml`
- Pre-install infrastructure deps during workspace initialization
- Ship `infrastructure/node_modules` in the S3 snapshot

### 5. Terminal Input via Keyboard Unreliable After Reconnection

After a WebSocket reconnect, typing directly into the terminal doesn't always work. The XTerm.js terminal appears focused but keystrokes don't reach the PTY.

**Workaround:** JavaScript dispatching via the hidden textarea:
```javascript
const ta = document.querySelector('textarea[aria-label="Terminal input"]');
ta.focus();
ta.value = cmd;
ta.dispatchEvent(new InputEvent('input', { data: cmd, inputType: 'insertText', bubbles: true }));
ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
```

### 6. CloudFront Serves Stale Frontend After Deploy

After deploying new frontend assets to S3, CloudFront continues serving the old version until its cache expires. There's no automatic invalidation in the CDK deploy pipeline.

**Workaround:** Hard refresh (Ctrl+Shift+R) or use a different browser/incognito.

**Fix:** Add a CloudFront invalidation to the CDK deployment (or use content-hash URLs, which Vite already does for assets but not for `index.html`).

### 7. No Build/Deploy Progress UI

All build and deploy operations are run via manual terminal commands. There's no:
- Build status panel showing progress
- One-click "Build & Deploy" button
- Progress indicators for long-running operations
- Error summary after failed builds

The workflow engine (Phase 3 of the plan) is designed to address this, but hasn't been fully wired up yet.

### 8. `es2024` tsconfig Target Warning

Both vite build and esbuild show warnings about unrecognized target environment `es2024` in `tsconfig.base.json`. Non-blocking but noisy.

## Build Output Summary

### Frontend (`npx vite build`)
```
vite v5.4.21 building for production...
2166 modules transformed.
dist/client/index.html              0.46 kB  (gzip: 0.38 kB)
dist/client/assets/index-DpXy4tnC.css    30.95 kB  (gzip: 7.25 kB)
dist/client/assets/index-DIT5xeNo.js   753.38 kB  (gzip: 212.85 kB)
Built in 10.32s
```
Warning: Chunk larger than 500 kB — code splitting recommended.

### Lambda Bundle (`build-lambda.mjs`)
```
dist-lambda/index.js + dist-lambda/command.js
Done in 15ms (5 warnings — es2024 target)
```

### Workspace Server Bundle (`build-workspace-server.mjs`)
```
dist-workspace/workspace-server.js  8.7mb
Done in 1457ms (7 warnings — es2024 target)
```

## Conclusions

1. **Self-hosted building works.** The IDE can compile its own frontend, Lambda, and workspace server from within its terminal. This is a significant milestone.

2. **Self-hosted deployment is blocked** by two issues:
   - The `infrastructure/` directory requires its own `npm install` for CDK dependencies
   - The workspace auto-stop kills long-running install processes

3. **Priority fixes for full self-hosting:**
   - Fix workspace idle detection to check for running PTY processes (#2)
   - Add `infrastructure/` to pnpm workspace OR pre-install CDK deps (#4)
   - Fix Nx build target shadowing for the UI package (#1)

4. **Terminal stability is much improved** after the keepalive/heartbeat fixes, but input queuing during disconnects would make it more robust (#3).
