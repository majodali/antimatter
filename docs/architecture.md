# Antimatter — System Architecture

> Current system architecture and implementation details.
> For planning and status see `BACKLOG.md`. For long-term vision see `docs/project-os.md`.

---

## 1. System Overview

Antimatter is a self-hosting online IDE with AI agent integration, deployed on AWS. The system has three main execution contexts:

- **Lambda API** — Stateless Express server handling REST requests (file ops, agent chat, tests, auth). Backed by S3 for file storage.
- **EC2 Workspace Server** — Layered process architecture: a lightweight **Router** (parent) that spawns isolated **Project Workers** (child processes) via `fork()`. Workers own PTY terminal, real-time file sync, workflow engine, and WebSocket connections for a single project.
- **CloudFront SPA** — React frontend served from S3, connecting to both Lambda (REST) and workspace server (WebSocket).

```
                        CloudFront
                            |
                   +--------+--------+
                   |                 |
               S3 Bucket        API Gateway
             (SPA assets)       (REST API)
                                    |
                               Lambda Function
                              (Express proxy)
                                    |
                              S3 Data Bucket
                            (project files)

        EC2 Instance
        +-----------------------------------+
        | Router (parent process)            |
        | - Express on :8080                 |
        | - ALB health, auth, WebSocket      |
        | - Proxies HTTP → child UNIX socket |
        | - Relays WebSocket via IPC         |
        | - Crash recovery (auto-respawn)    |
        +-----------------------------------+
           | fork()            | fork()
           v                   v
        +---------------+   +---------------+
        | Project Worker|   | Project Worker|
        | - antimatter  |   | - other-proj  |
        |   ProjectCtx  |   |   ProjectCtx  |
        |   Workflow    |   |   Workflow    |
        |   S3 Sync     |   |   S3 Sync     |
        |   PTY         |   |   PTY         |
        |   Express on  |   |   Express on  |
        |   UNIX socket |   |   UNIX socket |
        +---------------+   +---------------+
                    |
        Application Load Balancer
         (per-project path rules)
                    |
              CloudFront /ws/*
```

---

## 2. Monorepo Structure

npm workspaces with 12 packages:

| Package | Path | Description |
|---------|------|-------------|
| `@antimatter/service-interface` | `packages/service-interface/` | Canonical type definitions for all platform operations. Commands, queries, events, and protocol types organized by service (Projects, Files, Builds, Tests, Workspaces, DeployedResources, Agents, Auth, ClientAutomation, Observability). Transport-agnostic ServiceClient with routing. |
| `@antimatter/project-model` | `packages/project-model/` | Domain types: Project, Module, SourceFile, BuildRule, TestSuite, DeploymentResult. Immutable interfaces, all other packages reference this. |
| `@antimatter/filesystem` | `packages/filesystem/` | FileSystem interface with MemoryFileSystem, LocalFileSystem, S3FileSystem. Path utilities, content hashing, change tracking. |
| `@antimatter/tool-integration` | `packages/tool-integration/` | ToolRunner interface with SubprocessRunner and MockRunner. Parameter substitution, environment management. |
| `@antimatter/build-system` | `packages/build-system/` | BuildExecutor with wave-based parallel execution, CacheManager, DependencyResolver, diagnostic parsing, glob matching. (Largely superseded by workflow engine for build orchestration.) |
| `@antimatter/agent-framework` | `packages/agent-framework/` | Agent class with Claude and Mock providers, AgentConfigBuilder, multi-agent Orchestrator, tool system, MemoryStore, SSE streaming with abort. |
| `@antimatter/workflow` | `packages/workflow/` | Workflow type definitions: rules, events, state, widget declarations, project errors. |
| `@antimatter/workspace` | `packages/workspace/` | Workspace environment abstraction: LocalWorkspaceEnvironment, S3 sync utilities. |
| `@antimatter/test-harness` | `packages/test-harness/` | Functional test utilities: ActionContext abstraction, FetchActionContext, ServiceActionContext, test fixtures. |
| `@antimatter/mcp-server` | `packages/mcp-server/` | MCP server bridging Claude Code to Antimatter IDE automation API. |
| `@antimatter/ui` | `packages/ui/` | React frontend (Vite + Tailwind + Monaco + xterm.js) and Express backend (Lambda handler + workspace server). |
| `infrastructure` | `infrastructure/` | AWS CDK stacks: AntimatterStack (production), AntimatterEnvStack (per-environment). |

---

## 3. AWS Infrastructure

Region: `us-west-2`. Single AWS account.

### Production Stack (AntimatterStack)

| Resource | Name/Details |
|----------|-------------|
| **S3 — Frontend** | `antimatter-ide-{account}` — SPA assets, private, OAI access |
| **S3 — Data** | `antimatter-data-{account}` — Project files |
| **CloudFront** | Distribution with ACM cert for `ide.antimatter.solutions`. `/api/*` proxied to API Gateway. SPA routing (404/403 → /index.html). |
| **API Gateway** | REST API proxying all routes to Lambda |
| **Lambda** | Node.js 20.x, 120s timeout, 1024 MB. Runs Express via `@codegenie/serverless-express`. |
| **EventBridge** | `antimatter` event bus for system events |
| **Cognito** | User Pool `antimatter-users`, Hosted UI domain `antimatter-ide`, PKCE auth code flow |
| **VPC** | Public/private subnets for EC2 workspace instances |
| **EC2** | On-demand instances per project, launched via workspace routes |
| **ALB** | Application Load Balancer for workspace WebSocket routing |
| **IAM** | EC2 instance role with AdministratorAccess (to be scoped down) |

### Environment Stack (AntimatterEnvStack)

Each environment (dev/staging/prod/feature) gets its own S3 buckets, CloudFront distribution, API Gateway + Lambda, EC2 launch template, ALB, **Cognito User Pool**, and **EventBridge bus**. Shares VPC from production stack to avoid NAT Gateway duplication.

**Deployment model**: per-env stacks are opt-in via CDK context. `cdk deploy` alone touches only `AntimatterStack`. `cdk deploy AntimatterEnv-test --context envId=test` synthesizes *both* stacks (because the env stack cross-references the prod VPC) but deploys only the named one.

**Env-scoped resource names**: `antimatter-ide-{envId}-{account}`, `antimatter-data-{envId}-{account}`, `antimatter-users-{envId}`, `antimatter-{envId}` (event bus), `antimatter-{envId}-{accountSuffix}` (Cognito domain prefix — must be globally unique). Distribution domains, API Gateway URLs, and ALB DNS names are AWS-generated and output as stack outputs.

**Per-env Cognito**: each env gets its own user pool. Callback URLs are initialized with `http://localhost:5173/` only to avoid a circular dependency against the distribution domain (distribution → BucketDeployment → API Gateway → Lambda → Cognito client → distribution). The stack emits a `CognitoClientUpdateHint` output with the exact `aws cognito-idp update-user-pool-client` command to add the CloudFront domain post-deploy if Hosted UI access is needed. SRP-based auth (the path we use in practice) doesn't consult callback URLs.

### Promotion strategy (evolving)

The current (and only validated) workflow is **deploy-new-stack-then-switch**:

> **Near-term (lowest risk today):** deploy a parallel env stack, sync it to match current production, cutover user DNS (Route 53) to the new stack. Blue-green style. The running IDE is untouched until the DNS flip; rollback is a DNS revert.
>
> **Long-term (lower complexity, faster turnaround, requires more architectural comfort):** partial deployments — update only the components that changed (e.g. Lambda code only, or frontend bundle only). Requires per-component rollback, reliable health gates, and confidence that bundle-level and CDK-level changes can be applied independently. Worth moving toward once the promotion process has been exercised end-to-end a few times.

Both approaches assume the deploy orchestrator runs **outside** the target environment. The running IDE can orchestrate deploys to fresh stacks via `wf.utils.http.post` against the Lambda admin endpoints (`/api/admin/*`, see §11), never by modifying itself.

---

## 4. Workspace Server — Layered Process Architecture

Files:
- `packages/ui/src/server/workspace-server.ts` — **Router** (parent process): Express app, WebSocket handler, HTTP proxy, child lifecycle
- `packages/ui/src/server/project-worker.ts` — **Project Worker** (child process entry point): hosts a single ProjectContext
- `packages/ui/src/server/child-process-manager.ts` — Child lifecycle: spawn, IPC, crash recovery
- `packages/ui/src/server/ipc-types.ts` — Typed IPC message protocol
- `packages/ui/src/server/project-context.ts` — `ProjectContext` class: per-project state (env, PTY, workflow, S3 sync, routes). Runs inside each child process.

The workspace server uses a **two-layer process architecture** to isolate projects and improve resilience. A lightweight Router handles HTTP/WebSocket and auth, while each project runs in its own forked child process.

### Router (Parent Process)

The Router owns the HTTP server on port 8080. It:
- Serves `/health`, `/status`, `/internal/*` directly
- Runs Cognito auth middleware for `/api/*` routes
- Parses projectId from URL: `/workspace/{projectId}/...`, `/{PROJECT_ID}/...`, or `/api/*` (primary project)
- Spawns a **ChildProcessManager** for each unique projectId (lazy, first-request)
- Proxies HTTP to the child's UNIX socket at `/tmp/am-{projectId}.sock`
- Holds all WebSocket connections, relays messages to/from children via IPC
- Maintains heartbeat to WebSocket clients (needs actual socket objects)
- Auto-respawns children on crash with exponential backoff

The Router is small (~85 MB RSS) and stable — it rarely needs updates.

### Project Worker (Child Process)

Each project runs in a forked Node.js process (`child_process.fork()`). The worker:
- Receives `SerializableConfig` via IPC on startup
- Creates its own AWS SDK clients (S3, SSM, EventBridge) locally
- Instantiates a `ProjectContext` with all project state:
  - `LocalWorkspaceEnvironment` — file system, command execution
  - `WorkspaceService` — file APIs, build, agent
  - `PtySessionPool` — one or more PTY sessions (bash shells)
  - `S3SyncScheduler` — periodic workspace → S3 backup (30s)
  - `FileChangeNotifier` — filesystem watcher → broadcasts via IPC
  - `WorkflowManager` — event-driven rule engine
  - `ErrorStore`, `EventLog`, `DeployedResourceStore`, `FileTestResultsStorage`
  - Express Router — project-scoped API routes
- Listens on a UNIX socket `/tmp/am-{projectId}.sock` for HTTP from the Router
- Sends `ready` IPC message when initialized
- Runs `broadcastFn` through IPC: `ws-send` (single client) or `ws-broadcast` (all clients)

Workers are larger (~250+ MB RSS including esbuild, git). They can crash independently without affecting the Router or other projects.

### IPC Protocol

**Parent → Child:**
- `initialize` — boot config (projectId, bucket names, region, auth info)
- `ws-connect` / `ws-message` / `ws-disconnect` — WebSocket relay by connectionId
- `shutdown` — graceful stop

**Child → Parent:**
- `ready` — initialization complete, UNIX socket listening
- `ws-send` / `ws-broadcast` — route messages to WebSocket client(s)
- `connection-change` — +1/-1 for global tracking
- `error` — non-fatal errors (fatal errors cause process.exit)

HTTP requests never cross the IPC channel — they flow via the UNIX socket for performance.

### Crash Recovery

`ChildProcessManager` detects child exit events:
- Auto-respawn after 2s delay (exponential backoff up to 30s)
- After 5 consecutive crashes within 5 minutes, give up and mark project dead
- On respawn, re-send `ws-connect` for active WebSocket connections (seamless reconnect)
- HTTP requests during respawn return 503 with `retryAfter: 5`

### Lifecycle

1. **Instance start**: EC2 user-data downloads both `workspace-server.js` and `project-worker.js` from S3, starts Router via systemd
2. **Router ready**: Listens on :8080 immediately, `/health` returns 200
3. **First request**: Router parses projectId, calls `getOrCreateChild(projectId)` which:
   - Forks `project-worker.js`
   - Sends `initialize` IPC message
   - Waits for `ready` (worker runs S3 sync, git init, workflow load — 30-60s)
   - Returns after ready or 90s timeout
4. **Subsequent requests**: Proxied to child's UNIX socket (~1ms latency)
5. **WebSocket**: Router handles upgrade, assigns connectionId, relays via IPC
6. **Child crash**: Router respawns worker, re-registers WebSocket connections

### Feature Flag

`CHILD_PROCESS_MODE=0` env var reverts to the legacy monolith (ProjectContext in-process), for safe rollback.

### URL Routing

- `/workspace/{projectId}/api/*` → proxy to child worker (standard path)
- `/{projectId}/api/*` → proxy to child worker (ALB health check compat)
- `/api/*` → primary project child (backward compat, when `PROJECT_ID` is set)
- `/health` → Router health (lists spawned children)
- `/status` → Router status (mode, projects, total connections)
- `/internal/project-contexts` → list active children
- `DELETE /internal/project-context/{projectId}` — tear down a child process

### S3 Sync

- **Direction**: Bidirectional — workspace ↔ S3
- **Interval**: Every 30 seconds (per project)
- **Mechanism**: Compares file hashes, syncs changed files
- **File change detection**: Uses chokidar watcher, batches changes, broadcasts via WebSocket

### PTY Manager

- One PTY per project (bash shell)
- Terminal replay buffer (configurable size) for reconnection
- Input/output over WebSocket
- Resize support

### WebSocket Protocol

**Client → Server messages:**

| Type | Payload | Purpose |
|------|---------|---------|
| `input` | `{ data: string }` | Terminal keyboard input |
| `resize` | `{ cols, rows }` | Terminal resize |
| `ping` | — | Keep-alive |
| `workflow-emit` | `{ event: { type, ...props } }` | Emit workflow event |
| `workflow-hold` | — | Prevent auto-shutdown |
| `workflow-release` | — | Allow auto-shutdown |
| `workflow-reload` | — | Reload workflow definitions |

**Server → Client messages:**

| Type | Payload | Purpose |
|------|---------|---------|
| `replay` | `{ data: string }` | Terminal history on connect |
| `output` | `{ data: string }` | Terminal output |
| `application-state` | `{ full, state }` | Unified app state snapshot or patch |
| `file-changes` | `{ changes: [{type, path}] }` | Batched file change notifications |
| `heartbeat` | — | Keep-alive (every 20s) |
| `pong` | — | Response to ping |
| `status` | `{ state: 'ready' }` | Server readiness |

### Self-Update

`POST /api/refresh` — Downloads latest workspace server bundle from S3, restarts via systemd.

---

## 5. Workflow Engine

File: `packages/ui/src/server/services/workflow-manager.ts`

The workflow engine provides rule-based automation for build, deploy, and other tasks.

### Architecture

1. **Definition files**: `.antimatter/*.ts` (e.g., `build.ts`, `deploy.ts`)
2. **Compilation**: esbuild bundles TypeScript to JavaScript on load
3. **Auto-reload**: File watcher triggers recompilation on changes (500ms debounce)
4. **State persistence**: Workflow state saved to `.antimatter/workflow-state.json`

### Rule Structure

Rules declare:
- **Trigger**: File patterns, events, or manual
- **Action**: Async function receiving workflow context (`wf`)
- **Dependencies**: Other rules that must complete first

### Workflow Context (`wf`)

Available to rule actions:
- `wf.exec(command)` — Execute shell command
- `wf.reportErrors(toolId, errors)` — Report errors to ErrorStore
- `wf.getState() / setState()` — Read/write persistent state
- `wf.emit(event)` — Emit events to trigger other rules

### Widget Declarations

Rules can declare UI widgets via the workflow definition:
- **Button**: Clickable, fires event on click
- **Toggle**: On/off state, fires event with boolean value
- **Status**: Read-only display with value and color

Widget state is managed via `workflowState._ui[widgetId]` for dynamic updates (enabled, visible, label, value).

### Error Reporting

- `wf.reportErrors(toolId, errors)` → `ErrorStore.setErrors(toolId, errors)`
- ErrorStore persists to `.antimatter-cache/errors.json`
- Changes broadcast to all WebSocket clients via `application-state` messages
- Problems panel subscribes and displays errors grouped by file

---

## 6. Frontend Architecture

### Technology

- **React 18** with TypeScript
- **Vite** for development and production builds
- **Tailwind CSS** for styling
- **Zustand** for state management (14 stores)
- **Monaco Editor** for code editing
- **xterm.js** for terminal emulation
- **Radix UI** for accessible components

### Layout

Resizable panel shell with:
- **Header**: Project selector, navigation, settings
- **Sidebar**: File explorer, git panel
- **Main area**: Editor tabs (Monaco)
- **Bottom panels**: Terminal, build, deploy, problems, activity, chat (tabbed)

### Stores

| Store | Key State |
|-------|-----------|
| `projectStore` | Current project, project list |
| `fileStore` | File tree, selected file |
| `editorStore` | Open tabs, active tab, dirty state, auto-save |
| `chatStore` | Messages, streaming state, abort controller |
| `buildStore` | Build results, rule configs |
| `deployStore` | Deploy results, targets, environments |
| `gitStore` | Staged/unstaged/untracked files, branch |
| `terminalStore` | Terminal state, input history |
| `applicationStore` | Unified server state (workflow, errors, widgets) |
| `secretsStore` | Secret names and set/unset status |
| `uiStore` | Panel visibility, layout preferences |
| `toastStore` | Notification queue |
| `activityStore` | Activity log |
| `infraEnvironmentStore` | Infrastructure environment state |

### WebSocket Integration

Frontend maintains WebSocket connection to workspace server for:
- Terminal I/O
- Application state updates (workflow state, errors, widget state)
- File change notifications
- Keep-alive heartbeat

---

## 7. API Routes

### Lambda Routes (via API Gateway)

All routes are project-scoped: `/api/{route}` with project context from headers or query params.

| Route Prefix | File | Key Endpoints |
|-------------|------|---------------|
| `/api/projects` | `routes/projects.ts` | CRUD, git import |
| `/api/files` | `routes/filesystem.ts` | tree, read, write, mkdir, delete, exists |
| `/api/build` | `routes/build.ts` | execute (SSE), results, config, cache |
| `/api/agent` | `routes/agent.ts` | chat (SSE), history, tools, persistence |
| `/api/deploy` | `routes/deploy.ts` | execute (SSE), config, results |
| `/api/git` | `routes/git.ts` | status, stage, unstage, commit, push, pull, remotes, log |
| `/api/workflow` | `routes/workflow.ts` | state, declarations, run-rule, errors, emit, reload |
| `/api/environments` | `routes/environments.ts` | pipeline config, env CRUD, build, gate, promote |
| `/api/infra-environments` | `routes/infra-environments.ts` | list, register, terminate |
| `/api/secrets` | `routes/secrets.ts` | list, set, delete (SSM SecureString) |
| `/api/events` | `routes/events.ts` | recent system events |
| `/api/workspace` | `routes/workspace.ts` | start, status, stop EC2 instance |
| `/api/tests` | `routes/tests.ts` | run smoke/functional/workspace tests |
| `/api/test-results` | `routes/test-results.ts` | store/retrieve functional test run results |
| `/api/activity` | `routes/activity.ts` | load/save activity log |

### Workspace Server Routes

Same Express routers as Lambda, plus:
- `GET /health` — ALB health check
- `GET /status` — Server uptime, connections, diagnostic counters
- `POST /api/refresh` — Self-update from S3
- `GET /api/automation/commands` — Command catalog discovery (23 commands)
- `POST /api/automation/execute` — Execute automation commands (server-side or browser relay)
- WebSocket at `/terminal/{projectId}` — PTY + workflow messaging + automation relay

### IDE Automation API

Structured REST endpoint for external agents (e.g., Claude Code) to invoke IDE operations and get JSON results back. Replaces fragile browser automation (screenshots + clicking) with reliable programmatic access.

**Architecture:**
```
External Agent (curl/fetch)
    │
    ▼
POST /workspace/{pid}/api/automation/execute
    { command: "tests.run", params: { area: "cross-tab" } }
    │
    ├── Server commands → execute directly via WorkspaceService/git/workflow
    │
    └── Browser commands → WebSocket relay to connected browser tab
                                 │ Zustand stores / DOM / test runner
                                 ▼
                           automation-response via WebSocket → REST response
```

**Command catalog** (23 commands in 6 groups):

| Group | Commands | Execution |
|-------|----------|-----------|
| `file.*` | read, write, delete, mkdir, tree | Server |
| `git.*` | status, stage, unstage, commit, push, pull | Server |
| `build.*` | run | Server |
| `workflow.*` | state, errors, emit | Server |
| `editor.*` | open, active, tabs, close | Browser (WebSocket relay) |
| `tests.*` | run, list, results | Browser (WebSocket relay) |

**Key files:**
- `src/shared/automation-types.ts` — Command catalog, types, request/response interfaces
- `src/server/automation/server-commands.ts` — Server-side command executor
- `src/server/routes/automation.ts` — REST route factory (POST /execute, GET /commands)
- `src/client/lib/automation-handler.ts` — Browser-side handler receiving via WebSocket

**WebSocket relay with correlation IDs:** Server creates a Promise per browser command keyed by `requestId`. Browser executes against Zustand stores and responds with matching `requestId`. Default timeout 30s (tests.run: 5min).

**Authentication:** Same Cognito auth middleware as all `/api/*` routes.

---

## 8. Test Infrastructure

### Test Levels

| Level | Location | Runs On | Purpose |
|-------|----------|---------|---------|
| Unit tests | `packages/*/src/__tests__/*.spec.ts` | Local (Vitest) | Component-level behavior |
| Smoke tests | `packages/ui/src/server/tests/smoke-tests.ts` | Lambda | 17 tests: health, files, projects, commands, frontend |
| Functional tests | `packages/ui/src/shared/test-modules/*.ts` | Vitest + Browser | Feature behavior via ActionContext abstraction |
| Workspace tests | `packages/ui/src/server/tests/workspace-tests.ts` | Lambda (EC2) | Workspace-dependent tests (excluded from default suite) |

### Functional Test Framework

Tests are framework-agnostic `TestModule` objects in `packages/ui/src/shared/test-modules/`. Each test is an async function that takes an `ActionContext` and returns `{ pass, detail }`.

**Test modules** (organized by area):
- `file-explorer-tests.ts` — FT-FILE-001 through FT-FILE-007
- `editor-tests.ts` — FT-EDIT-001 through FT-EDIT-004
- `cross-tab-tests.ts` — Cross-tab communication tests
- `workspace-tests.ts` — FT-WS-001 (workspace file sync verification)
- `index.ts` — barrel export of all test modules

**Key types** (`packages/ui/src/shared/test-types.ts`):
- `TestModule` — id, name, area, run function
- `StoredTestResult` — result with timing, fixture, runId
- `TestRunSummary` — aggregated run results

### ActionContext Abstraction

Expanded interface: `packages/ui/src/shared/action-context.ts`
Base interface: `packages/ui/src/server/tests/action-context.ts`

Three implementations:
- **FetchActionContext** — HTTP calls to deployed API (Lambda/deployed tests)
- **ServiceActionContext** — Direct service method calls (Vitest/local, uses MemoryFileSystem)
- **BrowserActionContext** — Zustand store actions + API calls (in-browser, with configurable delay)

All three implement the same interface: file, build, deploy, environment, agent, editor, git, and workflow operations.

### Test Execution

- **CLI**: `npm test` (Vitest discovers functional tests via `functional.spec.ts`)
- **Lambda**: `POST /api/tests/run?suite=smoke|functional|workspace|all`
- **Browser**: Tests tab in bottom panel (Run All, Run Failed, Run Single, filter by area/status)
- **Automation API**: `tests.run` command via REST → browser relay
- **Console**: `window.__runTests()` runs all functional tests via BrowserActionContext

### Test Results API

- `POST/GET/DELETE /api/test-results` — store and retrieve test run summaries
- `testResultStore.ts` — Zustand store for results, filters, running state
- `TestResultsPanel.tsx` — bottom panel tab grouped by area with pass/fail, duration, expandable detail

---

## 9. Logging & Observability

### EventLogger

File: `packages/ui/src/server/services/event-logger.ts`

- Structured event logging to S3 (JSONL format, daily partitioned)
- EventBridge signaling for cross-service events
- In-memory buffer before flush

### ErrorStore

File: `packages/ui/src/server/services/error-store.ts`

- Stores build/lint/workflow errors keyed by `toolId`
- Persists to `.antimatter-cache/errors.json`
- Broadcasts changes to WebSocket clients
- Frontend Problems panel subscribes for display

### Known Gaps

- 138+ raw `console.log` calls remain — should be migrated to structured Logger
- No in-memory log buffer on workspace server for quick retrieval
- No IDE log viewer panel

---

## 10. Self-Hosting Deployment Process

Current bootstrap process (to be replaced by 100% online deployment):

```bash
# 1. Build frontend
cd packages/ui && npx vite build

# 2. Bundle Lambda
node packages/ui/scripts/build-lambda.mjs

# 3. Bundle workspace server (produces two bundles: router + worker)
node packages/ui/scripts/build-workspace-server.mjs
#   → dist-workspace/workspace-server.js  (Router / parent process)
#   → dist-workspace/project-worker.js    (Project Worker / child process)
#   → dist-workspace/package.json         (runtime deps: esbuild, puppeteer-core)

# 4. Deploy CDK
cd infrastructure && MSYS_NO_PATHCONV=1 npx cdk deploy --require-approval never

# 5. Commit and push
git add -A && git commit -m "..." && git push origin main

# 6. From within the IDE terminal:
git pull origin main

# 7. Workspace server auto-reloads .antimatter/*.ts on file changes
```

**Key notes:**
- Step 4 deploys both Lambda (new code) and frontend (new assets to S3)
- Step 6 updates the workspace server's local files
- Workflow engine auto-detects `.antimatter/*.ts` changes and recompiles
- CloudFront cache may require manual invalidation for index.html

---

## 11. Target Architecture Model

The system is moving toward a decomposition into **Resource Managers** and **Platform Services**, connected through a canonical **Service Interface**.

### Resource Managers

Each resource manager owns the lifecycle and state of a specific resource type:

| Manager | Owns | Current Implementation |
|---------|------|----------------------|
| **Project** | Project lifecycle, metadata, templates | `routes/projects.ts`, `projectStore` |
| **File** | File CRUD, tree, sync (serialized per-project) | `routes/filesystem.ts`, `fileStore`, S3FileSystem |
| **Workflow** | Rule definitions, state, event dispatch, widget declarations | `workflow-manager.ts`, `applicationStore` |
| **Test** | Test runs, results, runner registration | `routes/tests.ts`, `testResultStore`, cross-tab framework |
| **Workspace** | EC2 lifecycle, WebSocket, terminal sessions, S3 sync | `workspace-ec2-service.ts`, `project-context.ts`, `workspace-connection.ts` |
| **Deployed Resources** | Deployment state, environment management | `routes/deploy.ts`, `routes/environments.ts` |
| **Observability** | Logs, metrics, traces, error store | `event-logger.ts`, `error-store.ts` |

### Platform Services

Cross-cutting capabilities that don't own a resource type:

| Service | Responsibility | Current Implementation |
|---------|---------------|----------------------|
| **Auth & User** | Cognito integration, token management | `auth.ts` middleware, `auth.js` client lib |
| **Agent Orchestration** | AI agent providers, tool system, conversation history | `@antimatter/agent-framework`, `routes/agent.ts` |
| **Git Integration** | Status, stage, commit, push, pull, branch | `routes/git.ts`, `gitStore` |
| **Cloud Resource Management** | AWS resource provisioning (CDK, EC2, S3) | `infrastructure/`, `workspace-ec2-service.ts` |
| **Workflow Script Tooling** | esbuild compilation, type checking, auto-reload | `workflow-manager.ts` (bundled with Workflow manager) |

### Service Interface

All resource managers and platform services expose a canonical set of **commands**, **queries**, and **events** defined in a shared TypeScript schema package. Three transport adapters map to the same interface:

| Adapter | Use Case | Current State |
|---------|----------|--------------|
| **REST** | Lambda API, external clients | Express routers per resource |
| **WebSocket** | Real-time updates, terminal I/O, browser commands | Workspace server protocol |
| **Tool-use** | AI agent actions | `@antimatter/agent-framework` tool definitions |

### Deployment Model

**Quasi-monolithic:** Services are bundled into two processes (Lambda + workspace server), calling each other directly via TypeScript interfaces — not external APIs. This avoids distributed system complexity while maintaining clean module boundaries. The service interface schema enables future decomposition if needed.

### Browser Test Framework

The browser functional test framework uses a cross-tab architecture:

```
Orchestrator (original tab)           Executor (test tab)
  │                                      │
  ├── Creates disposable project         │
  ├── Opens test tab ──────────────────► Tab loads with testMode=true
  │                                      │
  │   ◄── BroadcastChannel ──────────── Signals "ready"
  │                                      │
  ├── Sends "run-tests" ──────────────► Runs tests via BrowserActionContext
  │                                      │  (DOM interactions: click, type, etc.)
  │   ◄── "test-result" per test ────── Reports individual results
  │   ◄── "run-complete" ───────────── Reports summary
  │                                      │
  └── Stores results, cleans up          └── Tab stays open or closes
```

Key files: `test-orchestrator.ts`, `test-executor.ts`, `cross-tab-protocol.ts`, `BrowserActionContext`
