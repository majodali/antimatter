# Antimatter Codebase Review

## Summary

The project is significantly further along than expected. Six packages are implemented with substantial functionality, and the infrastructure deploys to AWS. Against our V0 plan, roughly 60-70% of the work is done. The main gaps are command execution on Lambda (the EFS question) and the deployment panel.

---

## What Exists

### Packages — All Six Implemented

**`@antimatter/project-model`** ✅ Complete
- Domain types: Project, Module, SourceFile, BuildRule, BuildTarget, BuildResult, TestSuite, TestCase, ToolConfig
- Immutable interfaces, strong typing throughout
- Foundation for everything else

**`@antimatter/filesystem`** ✅ Complete
- MemoryFileSystem, LocalFileSystem, **S3FileSystem**
- Path utilities, content hashing, change tracking, workspace snapshots
- File watching with debouncing
- The S3FileSystem is what makes Lambda-based file storage work today

**`@antimatter/tool-integration`** ✅ Complete
- SubprocessRunner (child_process based)
- MockRunner for testing
- Parameter substitution, environment management
- Standardized tool execution interface

**`@antimatter/build-system`** ✅ Complete
- BuildExecutor with wave-based parallel execution
- CacheManager with dependency-aware invalidation
- DependencyResolver for build ordering
- Diagnostic parser, glob matcher
- Watch mode (client-side polling), incremental builds

**`@antimatter/agent-framework`** ✅ Complete
- Agent with Claude API provider and MockProvider
- AgentConfigBuilder (fluent API)
- Multi-agent Orchestrator (implementer → reviewer → tester handoffs)
- Tools: file read/write, run build/tests/lint, custom tool definitions
- MemoryStore (persistent memory across sessions)
- Streaming support with abort capability

**`@antimatter/ui`** ✅ Substantial
- **Frontend (React + TypeScript + Tailwind):**
  - Shell with resizable panels (react-resizable-panels)
  - Sidebar with icon bar switching between views (files, chat, docs, build, activity)
  - File Explorer with recursive tree, create/delete/rename
  - Editor: Monaco, multi-tab, dirty indicators, auto-save, diagnostics overlay, inline code actions (fix/explain/refactor)
  - Terminal panel (output display)
  - Chat panel with SSE streaming, tool call display
  - Build panel with config editor, execution, watch mode
  - Activity panel / activity log page
  - Project picker (create, import from Git, upload)
  - Zustand stores for state management
  - Dark theme

- **Backend (Express + Lambda):**
  - Routes: filesystem, build, agent, projects, tests
  - WorkspaceService orchestrating all packages
  - Lambda handler via @codegenie/serverless-express
  - Project-scoped routes (per-project S3FileSystem instances)
  - SSE streaming for agent and build output

### Infrastructure — CDK Deployed
- S3 + CloudFront for frontend SPA
- API Gateway REST → Lambda (Express proxy)
- S3 data bucket for project file storage
- CloudFront proxies /api/* to API Gateway

---

## Gap Analysis Against V0 Plan

| V0 Component | Status | Notes |
|--------------|--------|-------|
| **Shell** | ✅ Done | Resizable panels, sidebar with icon bar |
| **File Explorer** | ✅ Done | Recursive tree, CRUD operations |
| **Editor** | ✅ Done | Monaco (not CodeMirror — see below) |
| **Command Runner** | ⚠️ Partial | Terminal panel exists for display, but no command execution service on Lambda |
| **Agent Chat** | ✅ Done | SSE streaming, tool calls, multi-agent orchestration |
| **Deployment Panel** | ❌ Missing | CDK deployment is manual |
| **Project File Service** | ✅ Done | S3-based, project-scoped |
| **Command Execution Service** | ❌ Missing | Core gap — see below |
| **Agent Service** | ✅ Done | Full integration with streaming, tools, orchestration |
| **Deployment Service** | ❌ Missing | No deployment automation from within IDE |
| **CDK Infrastructure** | ⚠️ Partial | Frontend + REST API deployed, but no EFS, no WebSocket API, no DynamoDB |

---

## Critical Architecture Discussion: S3 vs. EFS

The current architecture uses **S3 for all project file storage**. This works well for file CRUD operations (read, write, list, delete) but creates a fundamental problem for **command execution**.

**The problem:** Build commands (npm, tsc, vitest, etc.) need a POSIX file system. They read node_modules, write to dist/, create temp files, follow symlinks. The SubprocessRunner uses `child_process.exec`, which expects a local file system. S3FileSystem serves files over HTTP — you can't run `npm install` against it.

**Current state:** The build system's SubprocessRunner works in local development (LocalFileSystem) but cannot work on Lambda with S3FileSystem. The build config UI and execution flow exist, but builds can only run locally.

**Options for V0:**

**Option A: Add EFS** (our V0 plan)
- Mount EFS to Lambdas
- Copy project from S3 → EFS on demand (or store directly on EFS)
- Command Execution Lambda runs commands against EFS
- Pros: Real file system, all tools work, proven pattern
- Cons: EFS cold start latency, cost for provisioned throughput, VPC required

**Option B: Use CodeBuild for command execution**
- Keep S3 for file storage
- Command execution triggers a CodeBuild project that pulls from S3, runs commands, pushes results back
- Pros: No EFS needed, CodeBuild handles heavy compute, no timeout concerns
- Cons: Slower startup (~30s), more complex orchestration, harder to stream output

**Option C: Hybrid — S3 for storage, Lambda + /tmp for light commands, CodeBuild for heavy builds**
- Light operations (lint, typecheck) copy relevant files to Lambda's /tmp (10GB max)
- Heavy operations (full builds, test suites) use CodeBuild
- Pros: Fast for small tasks, robust for big ones
- Cons: Complexity, /tmp size limits, two execution paths

**Recommendation:** Option A (EFS) is most aligned with the V0 plan and gives us a single execution model. The VPC and cold start concerns are manageable, and EFS is the path that scales to the full Project Operating System.

---

## Monaco vs. CodeMirror 6

The V0 plan specified CodeMirror 6 for its extensibility toward future literate editing features. The project uses Monaco.

**Argument for keeping Monaco:**
- Already integrated with tabs, diagnostics overlay, code actions, auto-save
- Rich feature set out of the box (IntelliSense, multi-cursor, minimap)
- Familiar to VS Code users

**Argument for switching to CodeMirror 6:**
- Better extensibility for literate editing (embedded widgets, custom syntax, mixed content)
- Collaborative editing support built into the architecture (OT-ready)
- Lighter weight, more controllable rendering
- Better foundation for the eventual Literate Editor

**Recommendation:** Keep Monaco for V0. Switch to CodeMirror 6 when building the Literate Editor — the editor panel is already a clean component that can be swapped. The modularity is there.

---

## Other Observations

### Strengths
- **Clean package boundaries.** Each package has a well-defined interface. The project-model types are used consistently throughout.
- **Agent framework is sophisticated.** Multi-agent orchestration, streaming, custom tools, persistent memory — this is ahead of what the V0 plan required.
- **S3FileSystem is a smart abstraction.** Having a file system interface that works over S3 means the same code works locally and on Lambda.
- **Build system is production-grade.** Parallel execution, caching, incremental builds, diagnostics — all working.
- **SSE streaming.** Works within API Gateway REST constraints (no WebSocket API needed for current features).
- **Multi-project support.** Project picker, project-scoped routes, per-project S3 prefixes — already handles multiple projects.

### Areas to Address
- **Chat panel is in the sidebar.** For serious agent collaboration, it may need to be a resizable panel in the main area, not hidden in the sidebar. But this is a layout change, not an architecture change.
- **No DynamoDB yet.** Conversation history, deployment state, environment config would benefit from DynamoDB rather than S3 files. But this is additive.
- **No WebSocket API.** SSE works for current streaming needs, but real-time collaboration and file watching will need WebSocket. Additive.
- **Test runner page exists but tests route is minimal.** The test infrastructure is scaffolded but not deeply integrated.
- **No authentication.** Expected for V0 (API key was the plan).

---

## Revised V0 Completion Plan

Given what exists, the path to V0 self-hosting is shorter than the original plan assumed.

### Phase 1: Command Execution (the critical gap)
1. Add EFS to CDK stack, mount to Lambda functions, configure VPC
2. Build Command Execution Service Lambda
3. Update Command Runner panel (currently TerminalPanel) to use the execution service
4. Verify build system works on Lambda + EFS (SubprocessRunner against real file system)

### Phase 2: Deployment from Within
5. Deployment Panel UI — module list, build status, deploy triggers
6. Deployment Service Lambda — triggers CDK deploy or direct Lambda/S3 updates
7. Environment registry (DynamoDB or S3-based config)
8. Wire it up: edit in IDE → build via command execution → deploy via deployment service

### Phase 3: Self-Hosting Verification
9. Import the antimatter project into its own IDE
10. Make a change, build, deploy — all from within
11. Fix whatever breaks

### Estimated additional effort: 2-4 weeks
The project is much closer to self-hosting than the original 5-7 week estimate assumed.
