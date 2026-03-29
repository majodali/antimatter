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
| M2 | **Build & deploy a web app** | planned | Create, build, test, and deploy a real web application (SPA or API server) from within the IDE. Validates the full development workflow for a realistic project beyond a library. |
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

---

## Tier 2: By Service

### Files Service

**Current state:** ServiceClient-wired (files.read, files.write, files.tree, files.exists, files.delete, files.mkdir, files.move, files.copy). REST mutations emit `onFileChange` events to workflow engine. Move/copy operations support batch entries.

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
- File annotations (unified model for errors, warnings, bookmarks, actions)
- Lambda dual-write (forward mutations to workspace when running)
- File explorer indicators (error/changed markers on tree nodes)
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
- Git panel UI (stage/unstage/commit/push/pull with visual diff)
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
- Build panel: display rule list with status, manual execution, widget rendering
- Widget system: button/toggle/status widgets from workflow declarations
- Build commands executed in terminal (visible output, not hidden subprocess)
- Review build and deploy panel layout
- In-browser type checking (Monaco language services without workspace round-trip)
- Rule failure semantics: rules that set failure state (e.g. `status: 'failed'`) should show red indicator, even if the rule itself didn't throw. Currently green = "rule executed without exception" which is misleading when the rule reports a failure.
- Widget value persistence: `_ui` state (widget values) should be persisted across sessions. Currently "Dependencies: idle" means the value is null because `_ui` wasn't rehydrated from persisted state. Blank is better than "idle" for null values.
- Graceful reload on automation file edit: don't remove old rules until the updated `.antimatter/*.ts` compiles and runs successfully. Deactivate or red-check rules from files that failed to compile. Currently editing build.ts causes all rules to disappear during compilation.
- Widget and rule ordering: ensure declarations appear in the Build panel in the order they're declared in the source file.

### Tests Service

**Current state:** Cross-tab test framework with BroadcastChannel orchestrator/executor. Per-test timeout (180s). RunId filtering prevents stale tab interference. Incremental log streaming (test-log messages, liveLogs in store). Monaco model readiness checks for DOM interactions.

| ID | Test Case | Status |
|----|-----------|--------|
| FT-XTAB-001 | Tab lock acquire and release lifecycle | test-passing |
| FT-XTAB-002 | Lock blocks acquisition by simulated other tab | test-passing |
| FT-XTAB-003 | Stale lock recovery | test-passing |
| FT-XTAB-004 | Project-scoped storage isolation | test-passing |
| FT-XTAB-005 | selectProject acquires lock, clearProject releases | test-passing |
| FT-XTAB-006 | Header dropdown shows lock icon for locked projects | test-implemented (missing data-testid) |

**Remaining work:**
- Display all project tests in test panel (not just functional tests)
- Test results persisted in backend (workspace + S3), dynamically updated
- Tests with multiple runners show results per runner (columns in test panel)
- Double-click on test result navigates to the test case source
- In-IDE test runner panel (run and view results without terminal)
- Test definitions as project-registered resources
- Headless test execution (server-side Puppeteer)

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

| Priority | Item | Service | Description |
|----------|------|---------|-------------|
| 1 | **File annotations** | Files | Unified annotation model — errors, warnings, bookmarks. Source-agnostic (tsc, eslint, custom). Powers Problems panel, editor decorations, file explorer indicators. |
| 2 | **Build/Deploy panel review** | Builds | Review layout. Rule failure = red indicator. Widget value persistence. Graceful reload (don't wipe rules on compilation failure). |
| 3 | **Test panel improvements** | Tests | Display all project tests. Persist results to backend (workspace + S3). Multiple runner columns. Double-click navigates to test source. |
| 4 | **M2 planning** | All | Define the web app project for M2 (SPA with API backend?). Identify what additional IDE capabilities are needed. |
| 5 | **Git panel UI** | Projects | Visual stage/unstage, commit message entry, push/pull buttons. |
| 6 | **UI polish: prevent text selection** | Editor | Double-click on interactive UI elements should not highlight text. Apply `user-select: none` to panels, buttons, labels, tree items. |
| 7 | **File search** | Files | Find files by name/path. Integrates with command palette (Cmd+P). |
| 8 | **Show/hide dot files** | Files | Toggle visibility of dot files (.gitignore, .antimatter, etc.) in file explorer. |
| 9 | **Command palette** | ClientAutomation | Cmd+P file switcher, Cmd+Shift+P command palette. Keyboard shortcuts framework. |
| 10 | **Full-text search** | Files | Search across project files with results panel (Cmd+Shift+F). |
| 11 | **Functional demos** | Tests | Demo scripting infrastructure. Pacing, narration overlay, step highlighting. Builds on BrowserActionContext. |
| 12 | **FT-XTAB-006 fix** | Tests | Add `data-testid="project-lock-icon"` to Header lock indicators. |
| 13 | **FT-WS-001 fix** | Workspace | Fix test isolation — file tree empties after earlier DOM tests. |

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
