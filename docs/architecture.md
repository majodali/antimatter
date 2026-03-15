# Antimatter — System Architecture

> Current system architecture and implementation details.
> For planning and status see `BACKLOG.md`. For long-term vision see `docs/project-os.md`.

---

## 1. System Overview

Antimatter is a self-hosting online IDE with AI agent integration, deployed on AWS. The system has three main execution contexts:

- **Lambda API** — Stateless Express server handling REST requests (file ops, agent chat, tests, auth). Backed by S3 for file storage.
- **EC2 Workspace Server** — Stateful per-project server providing PTY terminal, real-time file sync, workflow engine, and WebSocket connections.
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

        EC2 Instance (shared or per-project)
        +---------------------------+
        | Workspace Server          |
        | - ProjectContext per proj  |
        |   - PTY Manager           |
        |   - S3 Sync (30s)         |
        |   - Workflow Engine       |
        |   - WebSocket connections |
        |   - Express Router        |
        | - Dynamic project routing |
        | - Idle shutdown (global)  |
        +---------------------------+
                    |
        Application Load Balancer
         (per-project path rules)
                    |
              CloudFront /ws/*
```

---

## 2. Monorepo Structure

npm workspaces with 10 packages:

| Package | Path | Description |
|---------|------|-------------|
| `@antimatter/project-model` | `packages/project-model/` | Domain types: Project, Module, SourceFile, BuildRule, TestSuite, DeploymentResult. Immutable interfaces, all other packages reference this. |
| `@antimatter/filesystem` | `packages/filesystem/` | FileSystem interface with MemoryFileSystem, LocalFileSystem, S3FileSystem. Path utilities, content hashing, change tracking. |
| `@antimatter/tool-integration` | `packages/tool-integration/` | ToolRunner interface with SubprocessRunner and MockRunner. Parameter substitution, environment management. |
| `@antimatter/build-system` | `packages/build-system/` | BuildExecutor with wave-based parallel execution, CacheManager, DependencyResolver, diagnostic parsing, glob matching. (Largely superseded by workflow engine for build orchestration.) |
| `@antimatter/agent-framework` | `packages/agent-framework/` | Agent class with Claude and Mock providers, AgentConfigBuilder, multi-agent Orchestrator, tool system, MemoryStore, SSE streaming with abort. |
| `@antimatter/workflow` | `packages/workflow/` | Workflow type definitions: rules, events, state, widget declarations, project errors. |
| `@antimatter/workspace` | `packages/workspace/` | Workspace environment abstraction: LocalWorkspaceEnvironment, S3 sync utilities. |
| `@antimatter/test-harness` | `packages/test-harness/` | Functional test utilities: ActionContext abstraction, FetchActionContext, ServiceActionContext, test fixtures. |
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

Each environment (dev/staging/prod/feature) gets its own S3 buckets, CloudFront distribution, Lambda function, and EC2+ALB. Shares VPC from production stack.

---

## 4. Workspace Server

Files:
- `packages/ui/src/server/workspace-server.ts` — Main server: Express app, WebSocket handler, project routing, idle shutdown
- `packages/ui/src/server/project-context.ts` — `ProjectContext` class: per-project state (env, PTY, workflow, S3 sync, routes)

The workspace server is an Express + WebSocket server running on EC2. It supports **multiple projects per instance** via lazy-initialized `ProjectContext` objects.

### Multi-Project Architecture

Each project gets its own `ProjectContext` containing:
- `LocalWorkspaceEnvironment` — file system, command execution
- `WorkspaceService` — file APIs, build, agent
- `PtyManager` — pseudo-terminal (bash shell)
- `S3SyncScheduler` — periodic workspace → S3 backup
- `FileChangeNotifier` — filesystem watcher → WebSocket broadcasts
- `WorkflowManager` — event-driven rule engine
- `ErrorStore` — project error storage
- `EventLogger` — structured logging
- Express Router — project-scoped API routes
- WebSocket connections — for broadcast isolation

Project contexts are stored in a `Map<string, ProjectContext>` and lazy-initialized via `getOrCreateContext(projectId)` with promise coalescing (prevents duplicate init for concurrent requests).

**Backward compat**: If `PROJECT_ID` env var is set, that project is auto-initialized on startup.

**Shared mode**: The EC2 service (`workspace-ec2-service.ts`) supports `sharedMode` where multiple projects route to the same EC2 instance via per-project ALB rules.

### Lifecycle

1. **Start**: `POST /api/workspace/start` — Lambda launches EC2 instance (or reuses existing in shared mode), creates ALB routing rules, returns connection info
2. **Init**: EC2 user data script installs Node.js, downloads workspace server from S3, starts via systemd
3. **Request arrives**: Dynamic routing middleware parses project ID from URL, calls `getOrCreateContext(projectId)`
4. **Context init**: S3 sync, git init, PTY start, workflow engine start, file watcher start
5. **Ready**: WebSocket accepts connections, PTY available, API routes active
6. **Idle shutdown**: When ALL projects have zero connections for 10 min, instance self-stops

### URL Routing

The main Express app routes requests to the correct ProjectContext:
- `/workspace/{projectId}/api/*` → project context router (standard path)
- `/{projectId}/api/*` → project context router (ALB health check compat)
- `/api/*` → primary project context (backward compat, when `PROJECT_ID` is set)
- `/health` → global health check (lists active projects)
- `/internal/project-contexts` → list active contexts
- `DELETE /internal/project-context/{projectId}` — tear down a project context

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
- **Browser**: Tests tab in bottom panel (Run All, Run Failed, filter by area/status)
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

# 3. Bundle workspace server
node packages/ui/scripts/build-workspace-server.mjs

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
