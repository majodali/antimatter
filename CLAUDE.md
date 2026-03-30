# Antimatter — Claude Code Context

## Active TODO (keep in sync with BACKLOG.md Tier 3)

> Update this list when items are completed or reprioritized. See BACKLOG.md for full details.

1. **M2 planning** — define web app project for milestone M2
2. **File search** — Cmd+P file finder
3. **Command palette** — Cmd+Shift+P command palette + keyboard shortcuts
4. **Full-text search** — Cmd+Shift+F across project files
5. **Show/hide dot files** — toggle in file explorer

**Recently completed:** test panel (project tests, S3 persistence, double-click nav), graceful workflow reload, widget/state persistence across recompilation, file annotations REST API, slug-based project IDs, per-project terminal sessions, URL routing fix, wf.utils, chat panel WebSocket migration, git panel UI, file annotations model+UI, compilation errors in Problems, client.state completeness, FT-XTAB-006 fix.

## What This Project Is

Antimatter is a self-hosting online development environment with AI agent integration. The immediate goal is a modular online IDE that can build, test, and deploy itself on AWS. The long-term goal is a **Project Operating System** where documentation, models, code, tests, and operational state are first-class, navigable, interlinked concepts optimized for human/agent collaboration. See `docs/project-os.md` for the full vision.

## Documentation System

| Document | Purpose |
|----------|---------|
| `BACKLOG.md` | **Source of truth** for planning, feature status, and test case tracking |
| `docs/DONE.md` | Completed features archive (features with all tests passing) |
| `docs/architecture.md` | Current system architecture and implementation details |
| `docs/project-os.md` | Long-term vision (reference only) |
| `CLAUDE.md` | This file — Claude Code working context and development process |

## Architecture Overview

For full details see `docs/architecture.md`.

### Execution Contexts

- **Lambda API** — Stateless Express server (REST). S3-backed file storage. Handles agent chat, file ops, tests, auth, git.
- **EC2 Workspace Server** — Stateful per-project server. PTY terminal, S3 sync (30s), workflow engine, WebSocket connections.
- **CloudFront SPA** — React frontend connecting to Lambda (REST) and workspace server (WebSocket).

### Monorepo (npm workspaces)

| Package | Purpose |
|---------|---------|
| `@antimatter/service-interface` | Canonical service types: commands, queries, events, protocol, routing (organized by service) |
| `@antimatter/project-model` | Domain types (Project, Module, SourceFile, BuildRule, etc.) |
| `@antimatter/filesystem` | FileSystem interface: MemoryFileSystem, LocalFileSystem, S3FileSystem |
| `@antimatter/tool-integration` | ToolRunner interface: SubprocessRunner, MockRunner |
| `@antimatter/build-system` | Build orchestration (largely superseded by workflow engine) |
| `@antimatter/agent-framework` | AI agent: Claude/Mock providers, tools, streaming, orchestrator |
| `@antimatter/workflow` | Workflow types: rules, events, state, widgets, errors |
| `@antimatter/workspace` | Workspace environment abstraction, S3 sync |
| `@antimatter/test-harness` | ActionContext abstraction, FetchActionContext, ServiceActionContext |
| `@antimatter/mcp-server` | MCP server bridging Claude Code to Antimatter IDE automation API |
| `@antimatter/ui` | React frontend + Express backend (Lambda + workspace server) |
| `infrastructure` | AWS CDK stacks |

### AWS Resources

Lambda API, EC2+ALB workspace, S3 (frontend + data), CloudFront, Cognito, EventBridge. Region: us-west-2.

**Canonical URL: `https://ide.antimatter.solutions`** — Always use this domain for all API calls, automation commands, test URLs, and browser references. Never use the CloudFront distribution URL directly.

### Key Patterns

- All file operations go through `FileSystem` interface
- All tool execution goes through `ToolRunner` interface
- Workflow definitions in `.antimatter/*.ts`, compiled via esbuild, auto-reload on change
- Widget declarations in workflow rules, rendered in build/deploy panels
- SSE streaming for agent responses and build output
- WebSocket for terminal I/O, application state, and file change notifications

## Current Objective

See `BACKLOG.md` for current in-progress items. The project is in a **test catchup phase** — most features have working code but lack functional test coverage.

## Development Process & Mandates

### 1. Functional Test-Driven Development

Every feature follows this cycle:

1. **Define test cases** in `BACKLOG.md` as `FT-{AREA}-{NNN}` rows under the feature
2. **Write functional tests** using the ActionContext abstraction:
   - **Service context** (`@antimatter/test-harness`) — calls services directly with MemoryFileSystem/MockRunner
   - **API context** (`packages/ui/src/server/tests/`) — calls REST endpoints via FetchActionContext
   - (Future) **UI context** — browser automation driving the same scenarios
3. **Implement** with unit tests in the relevant packages
4. **Deploy and verify** — smoke tests must pass, functional tests for touched features must pass

All test code includes `// FT-AREA-NNN` identifier comments linking to the backlog.

### 2. Test Case ID Convention

`FT-{AREA}-{NNN}` — e.g., `FT-EDIT-001`, `FT-BUILD-002`, `FT-DEPLOY-003`

Test case statuses in BACKLOG.md:
- `defined` — described, no test code yet
- `test-implemented` — test code written, not yet passing
- `test-passing` — test passes

A feature is `done` when ALL its test cases are `test-passing`.

### 3. Functional Test Execution

- **CLI**: `npm test` (Vitest, runs unit + service-level tests)
- **Lambda**: `POST /api/tests/run?suite=smoke|functional|workspace|all`
- **Browser**: `/tests` dashboard
- Tests SHOULD accept modular fixtures (service API + browser UI automation)

### 4. UI Automation & the Automation API

All testable user actions should have UI automation support:
- Supports functional tests without manual browser interaction
- Serves as agent tools for the AI to drive IDE actions

**Always use the Automation API instead of Claude-in-Chrome for browser interaction.** The Automation API is the primary interface for driving the IDE programmatically. This helps mature the API and avoids fragile browser automation.

**Automation API endpoint:**
```
POST /workspace/{projectId}/api/automation/execute
Content-Type: application/json
Authorization: Bearer {cognito_token}

{ "command": "tests.run", "params": { ... } }
```

**Key commands:**
| Command | Execution | Description |
|---------|-----------|-------------|
| `tests.run` | browser/headless | Run functional tests (`fixture: 'browser'` or `'headless'`) |
| `tests.list` | browser | List available test modules |
| `tests.results` | browser | Get latest test results |
| `file.read`, `file.write`, `file.tree` | server | File operations |
| `git.status`, `git.commit`, `git.push` | server | Git operations |
| `editor.open`, `editor.active`, `editor.tabs` | browser | Editor control |
| `commands.list` | server | Discover all available commands |

**Command discovery:** `GET /workspace/{projectId}/api/automation/commands`

Browser commands require an active WebSocket connection (IDE tab open). Server commands work via REST alone. `tests.run` with `fixture: 'headless'` uses server-side Puppeteer and does not require a browser.

### 5. Central Structured Logging

- All backend components use Logger utility, not raw `console.*`
- Lifecycle events, errors, user-triggered actions are logged with structured data
- Logs persisted to S3 (JSONL, daily partitioned)
- Recent logs buffered in memory on workspace server for quick retrieval

### 6. Architecture Doc Maintenance

Changes affecting system architecture include `docs/architecture.md` updates in the same commit.

### 7. Deployment Verification

- Smoke tests must pass after every deployment
- Functional tests must pass for features touched by the deployment

### 8. Self-Hosting Deployment (Bootstrap)

Current process (see `docs/architecture.md` §10 for full commands):

1. Build frontend + Lambda + workspace server
2. CDK deploy
3. Commit and push to GitHub
4. From IDE terminal: `git pull origin main`
5. Workflow engine auto-reloads on file changes

## Build & Test Commands

```bash
# Run all unit tests
npm test

# Test specific package
npm test -w @antimatter/filesystem
npm test -w @antimatter/build-system
npm test -w @antimatter/agent-framework

# Build all packages
npm run build

# Build frontend (Vite)
cd packages/ui && npx vite build

# Bundle Lambda
node packages/ui/scripts/build-lambda.mjs

# Bundle workspace server
node packages/ui/scripts/build-workspace-server.mjs

# Deploy to AWS
cd infrastructure && MSYS_NO_PATHCONV=1 npx cdk deploy --require-approval never

# Run deployed tests
# Browser: https://ide.antimatter.solutions/tests
# API: POST https://ide.antimatter.solutions/api/tests/run?suite=all
```

## Conventions

- **TypeScript 5.9+**, ES modules (`"type": "module"`)
- **Immutable domain types** — all interfaces use `readonly` properties
- **Interface-first** — define interfaces, then implementations. Depend on abstractions.
- **Vitest** for testing — tests in `__tests__/` directories or colocated `*.spec.ts`
- **npm workspaces** for package management
- **Zustand** for frontend state management (14 stores)
- **Express** for backend (Lambda via serverless-express, workspace server direct)
- **Tailwind CSS** for styling
- **Monaco Editor** for code editing
- **xterm.js** for terminal emulation
