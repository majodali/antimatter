# Antimatter Backlog

> Single source of truth for planning and current status.
> For architecture details see `docs/architecture.md`. For long-term vision see `docs/project-os.md`.

---

## Status Definitions

**Feature status:** `done` | `in-progress` | `planned`

- **done** — All functional test cases for the feature are `test-passing`.
- **in-progress** — Work underway (design, implementation, or test catchup).
- **planned** — Not started. Summary description only.

**Test case status:** `defined` | `test-implemented` | `test-passing`

**Test case ID convention:** `FT-{AREA}-{NNN}` (e.g., `FT-EDIT-001`, `FT-BUILD-002`)

---

## Tier 1: Roadmap

Big-ticket items that span multiple services or introduce new capabilities.

| # | Item | Status | Description |
|---|------|--------|-------------|
| M1 | **Toy project edit/build/test/deploy** | **done** | Create, edit, build, test, and deploy json-validator entirely from within the IDE. 5/5 functional tests passing (FT-M1-001 through FT-M1-005). |
| M2 | **Build & deploy a web app** | planned | Create, build, test, and deploy a web SPA from within the IDE. Validates web-specific workflow: build → deploy to S3+CloudFront → preview → Puppeteer E2E verification against live URL. |
| M3 | **Self-host Antimatter** | planned | Perform code changes, builds, tests, and deployments on Antimatter itself entirely from within the IDE. |
| M4 | **Claude Code remote driving** | in-progress | Claude Code (local CLI) drives the IDE remotely via the Automation API — editing, building, testing, deploying. MCP server + project template validated. Auto-generated MCP tools from service-interface registry pending. |
| M5 | **Native AI agent** | planned | Built-in AI agent replaces Claude Code, using the same Automation API and service interface. |
| R1 | **Functional demos** | planned | Extend UI/DOM functional test infrastructure to support scripted demos. Animated walkthroughs of IDE features for onboarding, documentation, and showcase. Reuses BrowserActionContext, adds pacing/narration/highlighting. |
| R2 | **WebSocket protocol migration** | planned | Move from ad-hoc WebSocket messages to typed ServerFrame format from `@antimatter/service-interface`. Enables EventTransport for all services. |
| R3 | **Project-OS foundation** | planned | Entity model, literate editor, example workshop — see `docs/project-os.md`. |
| R4 | **Multi-user collaboration** | planned | Real-time editing via OTs/CRDTs, shared state. |

### M1 Validation: json-validator Test Project

A zero-dependency TypeScript JSON schema validator library demonstrating M1 capabilities:

| Test ID | Name | Status |
|---------|------|--------|
| FT-M1-001 | Create json-validator project with files and verify build pipeline | test-passing |
| FT-M1-002 | Introduce type error, verify in Problems panel, fix, verify clear | test-passing |
| FT-M1-003 | Add failing test, verify failure, fix test, verify pass | test-passing |
| FT-M1-004 | Publish to S3, create consumer project, verify import works | test-passing |
| FT-M1-005 | Git commit all M1 changes and verify in log | test-passing |

### M2 Validation: Web App Build & Deploy

A simple SPA (HTML/CSS/JS, no framework) demonstrating the full web development workflow. The project uses workflow rules for build, test, deploy, and E2E verification. No Vite/webpack — the IDE's workflow engine handles everything.

**New IDE capabilities required for M2:**

1. **Puppeteer E2E utility (`wf.utils.puppeteerTest`)** — Run headless browser assertions against any URL from a workflow rule. Returns pass/fail + screenshot on failure. Uses Puppeteer on the workspace server (already available for headless functional tests).

2. **Web app preview hosting** — Serve project files under `ide.antimatter.solutions/workspace/{projectId}/preview/` so the IDE can open and control the app via `window.open()` (same-origin). The workspace server already serves static routes; this adds a `/preview/` mount pointing at a configurable directory (e.g., `dist/` or `src/`).

3. **Per-project CDK stack provisioning** — `wf.utils.cdkDeploy(stackDir)` utility for deploying project-specific infrastructure. Wraps `npx cdk deploy` with environment setup. Initially simple (S3+CloudFront for static sites), extensible to API Gateway, Lambda, etc.

4. **WebSocket bridge for remote app control** (future) — Inject a small script into deployed apps that connects back to the workspace server for remote control commands. Enables Puppeteer-like automation against production deployments at arbitrary domains. Not required for M2 (Puppeteer against URL is sufficient).

**Test project: `m2-todo-app`**

A minimal todo app with:
- `src/index.html` — main page with todo list UI
- `src/app.js` — vanilla JS: add/remove/toggle todos, localStorage persistence
- `src/style.css` — basic styling
- `src/__tests__/app.test.js` — unit tests (vitest, jsdom)
- `infrastructure/` — CDK stack for S3+CloudFront deployment
- `.antimatter/build.ts` — workflow rules: install, build, test, deploy, E2E verify

| Test ID | Name | Status |
|---------|------|--------|
| FT-M2-001 | Create m2-todo-app project with source files and workflow rules | defined |
| FT-M2-002 | Run unit tests via test panel (vitest), verify pass | defined |
| FT-M2-003 | Deploy to S3+CloudFront via workflow rule, verify deployed URL accessible | defined |
| FT-M2-004 | Puppeteer E2E: navigate deployed URL, add a todo, verify it renders | defined |
| FT-M2-005 | Puppeteer E2E: reload page, verify todo persists (localStorage) | defined |
| FT-M2-006 | Preview via IDE-hosted URL (`/workspace/{id}/preview/`), verify renders | defined |
| FT-M2-007 | Introduce a bug, verify E2E fails, fix bug, verify E2E passes | defined |
| FT-M2-008 | Git commit and push all M2 changes | defined |

**Implementation phases:**

| Phase | Work | Dependencies |
|-------|------|--------------|
| 1 | `wf.utils.puppeteerTest(url, script)` — headless browser utility in workflow runtime | Puppeteer already on workspace server |
| 2 | Web preview route — `/workspace/{id}/preview/` serves project directory | Workspace server route |
| 3 | Create m2-todo-app project with source files | Phase 1 for E2E tests |
| 4 | `.antimatter/build.ts` workflow rules for the todo app | Phases 1-3 |
| 5 | FT-M2 functional test cases | Phase 4 |
| 6 | Per-project CDK utility (`wf.utils.cdkDeploy`) | Independent |

---

## Tier 2: By Service

### Files Service

**Current state:** ServiceClient-wired (files.read, files.write, files.tree, files.exists, files.delete, files.mkdir, files.move, files.copy). REST mutations emit `onFileChange` events to workflow engine. Move/copy operations support batch entries. File annotations model defined in service-interface (files.annotate, files.clearAnnotations, files.annotations). ErrorStore on server persists errors to `.antimatter-cache/errors.json`. Problems panel shows errors grouped by file with click-to-navigate. Editor decorations (squiggles, markers, hover messages) from errorStore. File explorer tree nodes show error count badges.

| ID | Test Case | Status |
|----|-----------|--------|
| FT-FILE-001 | Display file tree with nested structure | test-passing |
| FT-FILE-002 | Create file via UI | test-passing |
| FT-FILE-003 | Create folder with nested file | test-passing |
| FT-FILE-004 | Delete file via UI | test-passing |
| FT-FILE-005 | Rename file via UI | test-passing |
| FT-FILE-006 | Move file via UI | test-passing |
| FT-FILE-007 | Select file opens editor | test-passing |
| FT-FILE-010 | Delete file via API | test-passing |
| FT-FILE-011 | Move file via API | test-passing |
| FT-FILE-012 | Copy file via API | test-passing |

**Remaining work:**
- File annotations REST endpoints (expose files.annotate/clearAnnotations/annotations via API for external tools)
- Lambda dual-write (forward mutations to workspace when running)
- Multi-select for bulk operations
- File search (find files by name/path, Cmd+P integration)

**Usability:**
- File explorer error indicators on tree nodes
- Tab overflow: replace scrollbar with left/right navigation buttons
- Show/hide dot files in explorer (toggle for .gitignore, .antimatter, etc.)

### Projects Service

**Current state:** ServiceClient-wired (projects.list, projects.create, projects.delete, projects.import). Git operations wired (projects.status, projects.stage, projects.unstage, projects.commit, projects.push, projects.pull, projects.log, projects.remote, projects.setRemote). `gitInit` still uses apiFetch. Slug-based project IDs (derived from name, collision-safe). URL `?project=` param syncs on project switch. Per-tab project locking with heartbeat.

| ID | Test Case | Status |
|----|-----------|--------|
| FT-PROJ-001 | List projects returns array with current project | test-passing |
| FT-PROJ-002 | Create project, verify exists, delete, verify removed | test-passing |
| FT-PROJ-003 | Start workspace and verify RUNNING status | test-passing |
| FT-PROJ-004 | Git status returns valid VCS state | test-passing |
| FT-PROJ-005 | Git stage, commit, verify in log | test-passing |

**Remaining work:**
- Git panel: visual diff viewer
- Git branch management
- Git history/version viewer
- Custom project ID on create (allow user to override the auto-generated slug)

### Workspaces Service

**Current state:** ServiceClient-wired (workspaces.start, workspaces.status). EC2 lifecycle management via workspace-ec2-service. Shared mode reuses running instances. S3 sync on startup/shutdown and 30s interval. Per-project PTY isolation (one PtyManager per ProjectContext). Multi-project workspace server (ProjectContext class on shared EC2 instance).

| ID | Test Case | Status |
|----|-----------|--------|
| FT-WS-001 | Files created via UI exist on workspace filesystem | test-implemented (intermittent) |

**Remaining work:**
- Terminal sessions as first-class resources (multiple tabs per project, server-managed lifecycle)
- Workspace auto-stop idle detection (respect running commands)
- S3/workspace sync conflict resolution
- Workspace restart recovery (stale file race condition)

### Builds Service

**Current state:** ServiceClient-wired (builds.results.list, builds.configurations.list, builds.configurations.set, builds.triggers.invoke). Workflow engine handles rule execution with event sourcing (JSONL event log, dedup, replay, compaction). Build/deploy SSE streaming removed — all progress via WebSocket application-state broadcasts. `wf.utils` provides S3 upload/uploadDir, CloudFront invalidation, and file read utilities — workflow rules use server-provided AWS SDK without npm dependencies. `client.state` includes full workflow declarations (rules with metadata, widgets with current values). Compilation errors from `.antimatter/*.ts` surface in Problems panel.

| ID | Test Case | Status |
|----|-----------|--------|
| FT-M1-001 | Workflow rules load and execute (install/build/test) | test-passing |
| FT-M1-002 | Build failure surfaces errors in Problems panel | test-passing |

**Remaining work:**
- Build commands executed in terminal (visible output, not hidden subprocess)
- In-browser type checking (Monaco language services without workspace round-trip)
- Widget and rule ordering: ensure declarations appear in the Build panel in the order they're declared in the source file.

### Tests Service

**Current state:** Project test panel discovers and runs vitest/jest tests via CLI (`tests.discover-project`, `tests.run-project` automation commands). Results parsed from JSON reporter output with file paths, suite names, failure messages/lines. File-backed persistence (`.antimatter-cache/test-results.json`, auto-synced to S3). Double-click navigates to test file or failure line. Cross-tab functional test framework still available via `/tests` URL.

| ID | Test Case | Status |
|----|-----------|--------|
| FT-XTAB-001 | Tab lock acquire and release lifecycle | test-passing |
| FT-XTAB-002 | Lock blocks acquisition by simulated other tab | test-passing |
| FT-XTAB-003 | Stale lock recovery | test-passing |
| FT-XTAB-004 | Project-scoped storage isolation | test-passing |
| FT-XTAB-005 | selectProject acquires lock, clearProject releases | test-passing |
| FT-XTAB-006 | Header dropdown shows lock icon for locked projects | test-passing |

**Remaining work:**
- Test discovery config: `.antimatter/config.json` `"tests"` field for custom runner/patterns (currently auto-detects from package.json)
- Tests with multiple runners show results per runner (columns in test panel)
- Headless test execution (server-side Puppeteer)
- Functional tests as project-registered tests for the Antimatter project (instead of hardcoded imports)

### DeployedResources Service

**Current state:** FT-M1-004 demonstrates package publish to S3 as a deployed resource. Infrastructure environment registry exists (Lambda routes for infra-environments).

**Remaining work:**
- Deployed resource tracking with custom actions
- Deploy panel per-environment actions
- Secrets/env vars integration

### Agents Service

**Current state:** ServiceClient-wired (agents.chats.send, agents.chats.delete). Chat panel uses fire-and-forget REST POST + WebSocket event subscription (agents.chats.message, agents.chats.toolCall, agents.chats.toolResult, agents.chats.done). SSE fully removed. Chat history persistence via apiFetch.

**Remaining work:**
- Tool call display and inline results
- Abort response mid-stream
- File/selection context attachment
- Code block "Apply" button

### Auth Service

**Current state:** Cognito OAuth with auto token refresh. Auth gate blocks unauthenticated access.

**Remaining work:**
- Multi-user support

### ClientAutomation Service

**Current state:** Automation API with browser/headless execution. Server commands (file.read, file.write, git.*, workflow.*). Browser commands (editor.open, tests.run, client.refresh). MCP server bridges Claude Code to automation API.

**Remaining work:**
- Navigation command (navigate to specific URL/view)
- Client registry improvements

### Observability Service

**Current state:** ServiceClient-wired (observability.events.list). EventLogger with S3 persistence (JSONL, daily partitioned). In-memory buffer on workspace server.

**Remaining work:**
- IDE log viewer panel (filtered, searchable)
- Structured logging migration (replace remaining raw console.* calls)

### Editor

**Current state:** Monaco editor with multi-tab, auto-save, diagnostics overlay (errors from errorStore), word-boundary highlighting. Problems panel navigates to file:line:column on double-click.

| ID | Test Case | Status |
|----|-----------|--------|
| FT-EDIT-001 | Open file in tab | test-passing |
| FT-EDIT-002 | Switch between tabs | test-passing |
| FT-EDIT-003 | Close tab | test-passing |
| FT-EDIT-004 | Auto-save on edit | test-passing |

**Remaining work:**
- Unsaved indicator (amber dot on tab)
- Manual save (Ctrl+S) — currently dispatched but unreliable
- Editor context menu (fix non-functional items)
- Problems panel error count badge

**Usability:**
- Problems panel click/double-click navigation to exact position ✅ (implemented)
- Editor error highlighting uses word boundary ✅ (implemented)
- Double-click on UI elements (panels, buttons, labels) should not highlight element text (prevent user-select on interactive elements)

### Terminal

**Current state:** xterm.js terminal with PTY backend, WebSocket, basic resize. Per-project terminal sessions with scrollback preservation — each project gets its own xterm.js instance kept in a client-side pool; switching projects detaches/reattaches terminals without losing history. Server-side PTY isolation via ProjectContext.ptyManager with 50KB replay buffer on reconnect.

**Remaining work:**
- Multiple terminal tabs within a single project
- Terminal output visible for workflow commands (wf.exec)

---

## Tier 3: Immediate Backlog

Prioritized items ready for implementation. Pulled from Tier 2, ordered by impact.

| Priority | Item | Service | Status | Description |
|----------|------|---------|--------|-------------|
| 1 | **File annotations REST API** | Files | not started | Expose files.annotate/clearAnnotations/annotations via REST for external tools (linters, CLI). Core model + UI already done. |
| 2 | **Widget value persistence** | Builds | not started | Preserve `_ui` state across workflow recompilation. `fullRefresh()` currently wipes state file. |
| 3 | **Graceful workflow reload** | Builds | partial | Incremental reload handles errors, but `fullRefresh()` is aggressive. Preserve old rules when new compilation fails. |
| 4 | **Test panel: project tests** | Tests | not started | Show current project's tests (vitest/jest), not Antimatter's hardcoded functional tests. Discover from project test framework. |
| 5 | **Test panel: S3 persistence** | Tests | not started | Persist test results to S3 so they survive workspace restart. Backend memory store exists but is ephemeral. |
| 6 | **Test panel: double-click nav** | Tests | not started | Double-click on test result navigates to test source file. |
| 7 | **M2 implementation** | All | not started | Phases 1-6 defined above. Puppeteer utility, preview route, todo app project, FT-M2 test cases, CDK utility. |
| 8 | **Command palette + search** | Files/ClientAutomation | not started | Shared overlay infrastructure + keyboard shortcut system. Cmd+P file search (fuzzy match file paths), Cmd+Shift+P command palette (actions), Cmd+Shift+F full-text search (grep across project files with results panel). |
| 9 | **Show/hide dot files** | Files | not started | Toggle visibility of dot files (.gitignore, .antimatter, etc.) in file explorer. |
| 10 | **UI polish: prevent text selection** | Editor | partial | Apply `select-none` systematically to interactive elements. Only 3/39 components done. |
| 11 | **Functional demos** | Tests | not started | Demo scripting infrastructure. Pacing, narration overlay, step highlighting. Builds on BrowserActionContext. |
| 12 | **FT-WS-001 fix** | Workspace | partial | Fix test isolation — file tree empties after earlier DOM tests. Test intermittently fails. |

---

## Infrastructure Notes

### Service Interface (`@antimatter/service-interface`)

Canonical type definitions for all operations. Typed ServiceClient with TransportAdapter dispatch (REST, WebSocket, tool-use). Operation routing by execution context (platform, workspace, browser).

### Event Sourcing (Workflow Engine)

Persistent JSONL event log (`.antimatter-cache/events.jsonl`). Sequence numbers, 2s dedup window, 50ms batched drain. Checkpoint-based replay on startup/reload. Compaction on shutdown and every 60s. 10MB hard cap with auto-compaction. Audit event filtering.

### Deploy Process

Local script (`scripts/deploy.sh`): Vite build → Lambda bundle → workspace server bundle → CDK deploy → S3 upload → workspace restart via SSM.

### MCP Server (`@antimatter/mcp-server`)

Bridges Claude Code to IDE automation API. Tools: test run/results/list, workspace management, file read/write/tree, git status/stage/commit/push/pull, deployed resources CRUD, build triggers/results, client refresh, execute command. Project template (`templates/claude-code-remote/`) for bootstrapping local projects that drive the IDE remotely.
