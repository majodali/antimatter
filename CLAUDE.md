# Antimatter — Project Context for Claude Code

## What This Project Is

Antimatter is a self-hosting online development environment. The immediate goal (V0) is a modular online IDE with agent integration that can build and deploy its own modules on AWS serverless infrastructure. The long-term goal is a **Project Operating System** — a structured environment where documentation, models, code, tests, and operational state are first-class, navigable, interlinked concepts optimized for human/agent collaboration.

Full vision: `docs/project-os.md`
V0 plan: `docs/v0-plan.md`

## Architecture

### Monorepo Structure (npm workspaces)

Eight packages with clear boundaries:

- **`@antimatter/project-model`** — Domain types (Project, Module, SourceFile, BuildRule, TestSuite, etc.). Foundation — all other packages reference this. Immutable interfaces, strong typing.
- **`@antimatter/filesystem`** — File system abstraction. Implementations: `MemoryFileSystem`, `LocalFileSystem`, `S3FileSystem`. Includes path utilities, content hashing, change tracking, workspace snapshots.
- **`@antimatter/tool-integration`** — External tool execution. `SubprocessRunner` for real commands, `MockRunner` for tests. Parameter substitution, environment management.
- **`@antimatter/build-system`** — Build orchestration. `BuildExecutor` with wave-based parallel execution, `CacheManager` with dependency-aware invalidation, `DependencyResolver`, diagnostic parsing, glob matching.
- **`@antimatter/agent-framework`** — AI agent integration. `Agent` with Claude API and Mock providers, `AgentConfigBuilder`, multi-agent `Orchestrator` (implementer/reviewer/tester roles), tool system (file ops, build, test, lint, custom tools), `MemoryStore` for persistent memory, streaming with abort.
- **`@antimatter/ui`** — Frontend (React + TypeScript + Tailwind + Monaco) and backend (Express + Lambda). The UI has: resizable panel shell, file explorer, tabbed editor with diagnostics, chat panel with SSE streaming, build panel with config editor, terminal output panel, project picker. The backend has: routes for files, build, agent, projects, tests; `WorkspaceService` orchestrating all packages; Lambda handler via `@codegenie/serverless-express`.

### AWS Deployment (CDK)

Infrastructure is in `infrastructure/` (CDK TypeScript):
- **S3 + CloudFront** — Frontend SPA hosting
- **API Gateway REST → Lambda** — All backend routes (Express proxy)
- **S3 data bucket** — Project file storage (via `S3FileSystem`)
- **Region:** us-west-2, single account for dev/test/prod

### Key Patterns

- All file operations go through the `FileSystem` interface — never raw `fs` calls
- All tool execution goes through the `ToolRunner` interface — never raw `child_process`
- Agent tools are defined as `AgentTool` objects and registered with the agent at construction
- Build config is stored as `.antimatter/build.json` within each project
- SSE streaming is used for both agent responses and build output (works within API Gateway REST constraints)
- Project-scoped routes create per-request `WorkspaceService` instances backed by `S3FileSystem`

## Current Objective: EFS Migration (Step 1 of 6)

We are implementing the **WorkspaceEnvironment abstraction** — unifying file access and command execution into a single interface, then migrating to EFS for Lambda-based command execution.

Full plan: `docs/efs-migration.md`

### Why

The current architecture stores files on S3, which works for read/write/browse but not for command execution. Build tools (npm, tsc, vitest) need a POSIX file system. `SubprocessRunner` works locally but cannot work on Lambda against `S3FileSystem`. EFS provides the POSIX file system that commands need.

### The WorkspaceEnvironment Interface

Replaces the current pattern of separate `FileSystem` + `ToolRunner` with a single abstraction:

```typescript
interface WorkspaceEnvironment {
  readonly id: string;
  readonly label: string;

  // File operations (same as current FileSystem interface)
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDirectory(path: string): Promise<FileEntry[]>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<FileStat>;

  // Command execution (coupled with files — commands run against these files)
  execute(options: ExecuteOptions): Promise<ExecutionResult>;

  // Lifecycle
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}
```

Implementations:
- `LocalWorkspaceEnvironment` — wraps `LocalFileSystem` + `SubprocessRunner` (for local dev)
- `EfsWorkspaceEnvironment` — runs on Lambda with EFS mount (for cloud command execution)
- `S3WorkspaceEnvironment` — wraps `S3FileSystem`, no command execution (for file browsing)

### Step 1: What To Do Now

This step is a **pure refactor** — no new infrastructure, no EFS, no CDK changes. All existing tests must keep passing.

1. Define the `WorkspaceEnvironment` interface (in `@antimatter/filesystem` or a new `@antimatter/workspace` package — decide based on what feels cleaner)
2. Define `ExecuteOptions` and `ExecutionResult` types
3. Implement `LocalWorkspaceEnvironment` wrapping existing `LocalFileSystem` + `SubprocessRunner`
4. Implement `S3WorkspaceEnvironment` wrapping existing `S3FileSystem` (with `execute()` throwing "not supported" or using /tmp for simple commands)
5. Refactor `WorkspaceService` to accept a `WorkspaceEnvironment` instead of separate `FileSystem` + `ToolRunner`
6. Update Lambda handler and local server to create the appropriate `WorkspaceEnvironment`
7. Verify all existing tests pass, all existing functionality works

### Subsequent Steps (don't do these yet)

- Step 2: Add VPC + EFS to CDK stack, add Command Lambda
- Step 3: Implement `EfsWorkspaceEnvironment` with S3 ↔ EFS sync
- Step 4: Wire build execution to Command Lambda
- Step 5: Deployment model (module/packaging/deployment separation) and Deployment Panel
- Step 6: Self-hosting verification

## Development & Testing Process

### Test-Driven Development Cycle

Every change follows this cycle:

1. **Define functional test cases** — Document the intended behavior as test cases. Each functional test is defined once in a shared specification, then implemented in two contexts:
   - **Service context** (`@antimatter/test-harness`) — calls `WorkspaceService` methods directly with `MemoryFileSystem`/`MockRunner`. Runs locally, fast, no infrastructure needed.
   - **API context** (`packages/ui/src/server/tests/`) — calls REST endpoints via `FetchActionContext`. Runs against the deployed AWS stack (Lambda + S3).
   - (Future) **UI context** — drives the same scenarios through the browser.

2. **Break down into unit tests** — For each functional test case, identify the packages involved and create/update unit tests in those packages (`packages/*/src/__tests__/*.spec.ts`). Unit tests cover the component-level behavior that the functional test exercises end-to-end.

3. **Develop until unit tests pass locally** — Implement the change across packages. Run unit tests locally with `npm test` (runs across all workspaces) until everything passes.

4. **Deploy and run functional tests** — When all unit tests pass, deploy to AWS and run the full functional test suite against the live environment via the `/tests` page or `POST /api/tests/run`.

### Test Architecture

```
Functional test spec (shared definition)
├── Service-level implementation (test-harness)
│   └── WorkspaceService + MemoryFileSystem + MockRunner
│       Tests real service logic without infrastructure
├── API-level implementation (smoke + functional tests)
│   └── FetchActionContext → REST → Lambda + S3
│       Tests full deployed stack including transport/storage
└── (Future) UI-level implementation
    └── Browser automation driving same scenarios

Unit tests (per package)
├── filesystem/src/__tests__/ — FS operations, paths, hashing, change tracking
├── tool-integration/src/__tests__/ — subprocess, params, environment
├── build-system/src/__tests__/ — executor, cache, deps, diagnostics
├── agent-framework/src/__tests__/ — agent, tools, orchestrator, providers
└── ui/ — (no unit tests yet; backend tested via functional tests)
```

### Why Not localhost?

The local Express server (`index.ts`) and Lambda handler (`lambda.ts`) share the same Express routers and `WorkspaceService`, but differ in the filesystem layer: local uses `LocalFileSystem`, Lambda uses `S3FileSystem`. Running functional tests against localhost would test the same route logic as the service-level tests but miss the S3 behavior. It's not worth maintaining a localhost test path — service-direct for local, HTTP for deployed.

### Shared ActionContext Interface

Both test contexts use the same `ActionContext` interface (`packages/ui/src/server/tests/action-context.ts`):
- **`FetchActionContext`** — implements `ActionContext` over HTTP (for deployed tests)
- **`ServiceActionContext`** (to be built) — implements `ActionContext` by calling `WorkspaceService` directly (for local service-level tests)

This ensures functional test logic is written once and runs in both contexts.

### Test Locations

| What | Where | Runs | Command |
|------|-------|------|---------|
| Unit tests (per package) | `packages/*/src/__tests__/*.spec.ts` | Local (Vitest) | `npm test -w @antimatter/<package>` |
| Service-level functional | `packages/test-harness/src/__tests__/` | Local (Vitest) | `npm test -w @antimatter/test-harness` |
| Smoke tests (deployed) | `packages/ui/src/server/tests/smoke-tests.ts` | AWS (Lambda) | `POST /api/tests/run?suite=smoke` |
| Functional tests (deployed) | `packages/ui/src/server/tests/functional-tests.ts` | AWS (Lambda) | `POST /api/tests/run?suite=functional` |
| Test dashboard (UI) | `/tests` route in frontend | Browser | Navigate to `/tests` |

### Build & Test Commands

```bash
# Run all unit tests locally (the main development loop)
npm test

# Test specific package
npm test -w @antimatter/filesystem
npm test -w @antimatter/build-system
npm test -w @antimatter/agent-framework
npm test -w @antimatter/test-harness

# Build all packages
npm run build

# Build UI (Vite frontend build)
npm run build -w @antimatter/ui

# Lint
npm run lint

# Deploy to AWS
npm run build -w @antimatter/ui && bash scripts/build-lambda.sh && cd infrastructure && MSYS_NO_PATHCONV=1 npx cdk deploy --require-approval never

# Run deployed functional tests
# Via browser: https://d33wyunpiwy2df.cloudfront.net/tests
# Via API: POST https://d33wyunpiwy2df.cloudfront.net/api/tests/run?suite=all
```

## Conventions

- **TypeScript 5.9+**, ES modules (`"type": "module"`)
- **Immutable domain types** — all interfaces use `readonly` properties
- **Interface-first** — define interfaces, then implementations. Depend on abstractions.
- **Test with Vitest** — tests colocated with source (`*.spec.ts`) or in `__tests__/` directories
- **Test-driven** — functional tests define the behavior, unit tests cover the components. Tests are written before implementation.
- **npm workspaces** for package management and task orchestration
- **Zustand** for frontend state management
- **Express** for backend API (runs both locally and on Lambda via serverless-express)

## Design Principles

1. **Modularity above all.** Every component should be replaceable without rewriting its neighbors. This is the foundation for evolving V0 into the Project Operating System.
2. **Interface-driven.** Depend on abstractions. The `FileSystem` → `WorkspaceEnvironment` migration is an example of this done right.
3. **Agent as first-class user.** Agents access the same information and operations as humans. The `WorkspaceService` serves both the UI and the agent.
4. **Self-hosting.** The tool builds and deploys itself. Every architectural decision should move toward this.
5. **Incremental evolution.** V0 components evolve into Project Operating System components. The file explorer becomes the entity navigator. The editor becomes the literate editor. The chat panel becomes the agent workspace. Clean boundaries make this possible.
