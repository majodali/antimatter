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
| FT-M2-001 | Verify m2-todo-app project exists with correct source files | test-implemented |
| FT-M2-002 | Run unit tests via vitest, verify pass | test-implemented |
| FT-M2-003 | Deploy to S3+CloudFront via workflow rule, verify deployed URL accessible | defined |
| FT-M2-004 | Puppeteer E2E: navigate deployed URL, add a todo, verify it renders | defined |
| FT-M2-005 | Puppeteer E2E: reload page, verify todo persists (localStorage) | defined |
| FT-M2-006 | Preview via IDE-hosted URL (`/workspace/{id}/preview/`), verify renders | test-implemented |
| FT-M2-007 | Introduce a bug, verify E2E fails, fix bug, verify E2E passes | defined |
| FT-M2-008 | Git commit and verify in log | test-implemented |

**Implementation phases:**

| Phase | Work | Dependencies |
|-------|------|--------------|
| 1 | `wf.utils.puppeteerTest(url, script)` — headless browser utility in workflow runtime | Puppeteer already on workspace server |
| 2 | Web preview route — `/workspace/{id}/preview/` serves project directory | Workspace server route |
| 3 | Create m2-todo-app project with source files | Phase 1 for E2E tests |
| 4 | `.antimatter/build.ts` workflow rules for the todo app | Phases 1-3 |
| 5 | FT-M2 functional test cases | Phase 4 |
| 6 | Per-project CDK utility (`wf.utils.cdkDeploy`) | Independent |

### Project Context Model

New declaration model and lifecycle for the project context tree. Replaces the indent-based DSL with `defineX()` constructors in `.antimatter/{resources,contexts,build}.ts`. Three layers — Resources (noun) / Workflow rules (verb) / Project contexts (intent) — assembled into a graph the IDE can reason about. See `docs/contexts.md` for the conceptual model and the canonical journey (cold start → decompose → focused build → react → review).

**Phase 0 — Foundation** *(complete)*: declaration types, `defineX()` constructors, project model assembler with validation, graph queries, lifecycle derivation against the new model, esbuild-based loader for `.antimatter/*.ts`, json-validator fixture as canonical worked example.

| Test ID | Name | Status |
|---------|------|--------|
| FT-FOUND-001 | ref factories build well-formed ResourceRefs | test-passing |
| FT-FOUND-002 | id format guard rejects malformed identifiers | test-passing |
| FT-FOUND-003 | defineFileSet stamps __kind and validates include | test-passing |
| FT-FOUND-004 | defineConfig / defineSecret declarations | test-passing |
| FT-FOUND-005 | defineDeployedResource / defineEnvironment declarations | test-passing |
| FT-FOUND-006 | defineTest / defineTestSet declarations | test-passing |
| FT-FOUND-007 | defineSignal / defineAuthorization declarations | test-passing |
| FT-FOUND-008 | defineRule with reads/writes resource refs | test-passing |
| FT-FOUND-009 | validation factories (ruleOutcome / testSetPass / manualConfirm / etc.) | test-passing |
| FT-FOUND-010 | action factories (agent / code / invokeRule / human / plan) | test-passing |
| FT-FOUND-011 | defineContext rejects malformed actions | test-passing |
| FT-FOUND-012 | defineContext rejects duplicate validation binding ids | test-passing |
| FT-FOUND-013 | defineContext normalises a string objective | test-passing |
| FT-FOUND-014 | output() helper stamps producesKind | test-passing |
| FT-FOUND-020 | classifyDeclarations partitions exports by __kind | test-passing |
| FT-FOUND-021 | assembler builds children/parentOf maps | test-passing |
| FT-FOUND-022 | assembler reports duplicate ids (same family + cross-family) | test-passing |
| FT-FOUND-023 | assembler reports unknown parent | test-passing |
| FT-FOUND-024 | assembler reports multiple-roots / cycles | test-passing |
| FT-FOUND-025 | unresolved resource ref reported | test-passing |
| FT-FOUND-026 | unresolved context-output ref reported | test-passing |
| FT-FOUND-027 | validation binding scope check | test-passing |
| FT-FOUND-028 | kind-specific validation refs (rule / test / deployed-resource) | test-passing |
| FT-FOUND-029 | test-set members must be declared tests | test-passing |
| FT-FOUND-030 | empty input is valid | test-passing |
| FT-FOUND-040 | rootContext query | test-passing |
| FT-FOUND-041 | children / parent / ancestors / descendants | test-passing |
| FT-FOUND-042 | resolveResourceRef handles all three modes | test-passing |
| FT-FOUND-043 | resourcesOfKind filters by short name | test-passing |
| FT-FOUND-044 | testSetsForTest reports many-to-many membership | test-passing |
| FT-FOUND-045 | implicit dependencies derived from context-output inputs | test-passing |
| FT-FOUND-046 | rulesReading / rulesWriting | test-passing |
| FT-FOUND-060 | leaf with no validations is done | test-passing |
| FT-FOUND-061 | single-validation leaf — passing → done, failing → ready | test-passing |
| FT-FOUND-062 | partial passing → in-progress | test-passing |
| FT-FOUND-063 | parent rolls up children | test-passing |
| FT-FOUND-064 | regression: prior=done, validation now failing | test-passing |
| FT-FOUND-065 | recovery: prior=regressed, validation passing again | test-passing |
| FT-FOUND-066 | transitions report only changes | test-passing |
| FT-FOUND-080 | loader builds expected graph for json-validator fixture | test-passing |
| FT-FOUND-081 | rule-outcome validation references a declared rule | test-passing |
| FT-FOUND-082 | context-output ref between contexts resolves | test-passing |
| FT-FOUND-083 | declarations carry the correct __kind discriminator | test-passing |
| FT-FOUND-084 | empty / missing project handled gracefully | test-passing |
| FT-FOUND-085 | compile error in a single file is surfaced and isolated | test-passing |

**Phase 1 — Cold start** *(test-passing for unit tests, test-implemented for FT-COLDSTART-101..104)*: empty-state UI, template registry, automation commands (`contexts.model.get`, `contexts.templates.list`, `contexts.templates.apply`), basic context tree render, ProjectContextModelStore on the workspace server. Templates: `empty`, `json-validator`.

**Phase 2 — Decompose / manual authoring** *(test-passing for unit tests, test-implemented for FT-DECOMP-101..105)*: file-watcher reload + WebSocket broadcast (live updates as users edit `.antimatter/*.ts`), source emitters that round-trip through esbuild + the loader, automation commands `contexts.contexts.add` / `contexts.resources.add` / `contexts.rules.add`, three Add modals in the IDE (Add context / Add resource / Add rule).

**Phase 3 — Focused build** *(test-implemented for FT-FOCUS-101..104)*: validation evaluator (rule-outcome / test-pass / test-set-pass / deployed-resource-{present,healthy} kinds wired against existing services), enriched snapshot with per-validation status + per-context lifecycle status, re-evaluation triggered by rule + test + deployed-resource changes, `contexts.action.invoke` automation command for invoke-rule actions, context detail dialog with validation status + Start button, clickable tree rows with status icons.

**Phase 4 — Status check / orient** *(test-implemented for FT-STATUS-101..103)*: snapshot now carries `counts.byStatus` (per-lifecycle bucket) and a recent-transitions ring buffer, `context:transitioned` events emitted to the unified activity log on every lifecycle change, color-coded status chips in the panel header, "Needs attention" banner surfacing regressions / failing validations / model errors, "Recent activity" inline list of transitions.

**Phase 5 — Regression triage** *(test-passing for unit tests, test-implemented for FT-REGRESS-101..103)*: pure `traceRegression` function in `@antimatter/contexts` building a structured explanation (failing/unevaluable validations with kind-specific detail, child blockers, dependency culprits via implicit input refs), `contexts.regression.trace` automation command, "Why isn't this done?" section in the context detail dialog, per-context `lastTransitionAt` in the snapshot.

**Phase 6 — Review** *(test-implemented for FT-REVIEW-101..103)*: per-project ring buffer of action invocations on the workspace server (max 50), each entry capturing operationId, action kind, ruleId, eventType, invokedAt, and a per-validation status snapshot at invoke time. `contexts.history.list` automation command returns filtered entries; "Recent invocations" section in the context detail dialog renders them with an inline expandable trace fetched via `activity.operation`. After-vs-before validation deltas surface inline.

| Test ID | Name | Status |
|---------|------|--------|
| FT-COLDSTART-001 | listTemplates returns metadata for each registered template | test-passing |
| FT-COLDSTART-002 | getTemplate / renderTemplate basics | test-passing |
| FT-COLDSTART-003 | empty template renders an empty .antimatter directory marker | test-passing |
| FT-COLDSTART-004 | json-validator template renders three .antimatter/*.ts files | test-passing |
| FT-COLDSTART-005 | rendered json-validator template assembles into a valid model | test-passing |
| FT-COLDSTART-006 | empty template produces an empty model with no errors | test-passing |
| FT-COLDSTART-101 | Empty project — contexts.model.get reports present: false | test-implemented |
| FT-COLDSTART-102 | contexts.templates.list returns registered templates | test-implemented |
| FT-COLDSTART-103 | Apply json-validator template — model populated with expected nodes | test-implemented |
| FT-COLDSTART-104 | contexts.templates.apply refuses to overwrite, succeeds with overwrite flag | test-implemented |
| FT-DECOMP-001 | emitFileSet round-trips through loader | test-passing |
| FT-DECOMP-002 | emitTest / emitTestSet round-trip | test-passing |
| FT-DECOMP-003 | emitDeployedResource / emitEnvironment round-trip | test-passing |
| FT-DECOMP-004 | emitRule with reads/writes round-trips | test-passing |
| FT-DECOMP-005 | emitContext basic shape round-trips | test-passing |
| FT-DECOMP-006 | emitContext with parent + plan action round-trips | test-passing |
| FT-DECOMP-007 | appendDeclaration merges existing imports | test-passing |
| FT-DECOMP-008 | appendDeclaration adds an import to an empty file | test-passing |
| FT-DECOMP-009 | emitter rejects malformed ids | test-passing |
| FT-DECOMP-010 | strings JSON-escaped (no template-literal injection) | test-passing |
| FT-DECOMP-011 | emitContext with rule-outcome validation references the rule | test-passing |
| FT-DECOMP-012 | emitContext with output() and context-output input | test-passing |
| FT-DECOMP-101 | contexts.contexts.add — append a child context | test-implemented |
| FT-DECOMP-102 | contexts.resources.add — append a file-set resource | test-implemented |
| FT-DECOMP-103 | contexts.rules.add — append a rule with reads/writes | test-implemented |
| FT-DECOMP-104 | contexts.contexts.add surfaces invalid-params for malformed id | test-implemented |
| FT-DECOMP-105 | Direct edit to .antimatter/contexts.ts is picked up by the watcher | test-implemented |
| FT-FOCUS-101 | Fresh json-validator template surfaces lifecycleStatus + validation status per context | test-implemented |
| FT-FOCUS-102 | Registering a deployed-resource flips the matching validation to passing | test-implemented |
| FT-FOCUS-103 | contexts.action.invoke emits the rule event for invoke-rule; rejects others as unsupported | test-implemented |
| FT-FOCUS-104 | Empty leaf context (no validations + no children) reports lifecycleStatus=done | test-implemented |
| FT-STATUS-101 | counts.byStatus sums to counts.contexts | test-implemented |
| FT-STATUS-102 | Registering a deployed-resource captures a recent transition | test-implemented |
| FT-STATUS-103 | context:transitioned events show up in activity.list | test-implemented |
| FT-REGRESS-001 | trace returns null for unknown context | test-passing |
| FT-REGRESS-002 | passing context yields empty failure lists | test-passing |
| FT-REGRESS-003 | failed rule-outcome surfaces ruleId + status | test-passing |
| FT-REGRESS-004 | unknown rule status surfaces too | test-passing |
| FT-REGRESS-005 | test-set-pass partitions failing vs unobserved members | test-passing |
| FT-REGRESS-006 | deployed-resource-present surfaces resourceId on failure | test-passing |
| FT-REGRESS-007 | child blockers reported on parent's trace | test-passing |
| FT-REGRESS-008 | dependency culprit walks input refs | test-passing |
| FT-REGRESS-009 | manual-confirm + code validations surface as informational | test-passing |
| FT-REGRESS-010 | passing rule does not surface | test-passing |
| FT-REGRESS-101 | Publish context with no deployed-resource yields a failure row | test-implemented |
| FT-REGRESS-102 | Trace toggles correctly with register / deregister | test-implemented |
| FT-REGRESS-103 | contexts.regression.trace returns not-found for unknown id | test-implemented |
| FT-REVIEW-101 | contexts.action.invoke records an entry visible via contexts.history.list | test-implemented |
| FT-REVIEW-102 | contexts.history.list filters by contextId | test-implemented |
| FT-REVIEW-103 | history entries carry per-validation status at invoke time | test-implemented |

**Deferred capabilities** *(post-Phase-6)*: fingerprint-based freshness (file-set hashing, stale-input detection); focus pill in header (Build/Ops scope drives chat + filtering); manual-confirm + code validation execution (Phase 3 leaves these `unknown`); agent-driven action kinds (`action.agent` / `action.code` / `action.human` reject from `contexts.action.invoke` for now); operate-perspective deep dive (Flow E from the design walkthrough).

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
- Project templates — scaffold new projects from templates (React SPA, Express API, static site, etc.)
- `.antimatter/config.json` — first-class project configuration file (test runner, preview directory, deploy targets, etc.). Preview directory currently auto-detects dist/ > src/ > root; config should allow explicit override (e.g., `"preview": "public/"`).

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
- General file sync utility (`wf.utils.syncFiles`) — URI-based source/dest (file://, s3://), timestamp/hash-based incremental sync, include/exclude globs. Replaces ad-hoc s3UploadDir with a composable primitive. Reuses SyncManifest pattern from workspace package.

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
- Secrets/env vars redesign:
  - **Secrets**: per-project scoped in AWS SSM (`/antimatter/projects/{id}/secrets/{name}`). Currently global (`/antimatter/secrets/{name}`) with hardcoded `KNOWN_SECRETS` list. Projects should define their own secrets. For AWS-deployed resources (Lambda, EC2), pass the SSM parameter name/ARN — the resource reads the secret directly.
  - **Env vars**: persisted with project (`.antimatter/env.json` or similar). Configurable per-var whether to commit to git or gitignore. Plain text values for non-sensitive config.
  - Both are named values referenced by workflow rules. No rigid environment model — projects define environments through workflow rules and map secrets/env vars as needed.
  - Existing SecretsPanel UI works but needs project-scoping and dynamic secret list.
- Deploy URL display ✅ (implemented via deployed resources)
- Deployed resource tracking with custom actions ✅ (implemented)

### Agents Service

**Current state:** ServiceClient-wired (agents.chats.send, agents.chats.delete). Chat panel uses fire-and-forget REST POST + WebSocket event subscription (agents.chats.message, agents.chats.toolCall, agents.chats.toolResult, agents.chats.done). SSE fully removed. Chat history persistence via apiFetch.

**Remaining work** (part of M5 Native AI Agent roadmap):
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
- Redesign ActivityPanel — current implementation is not useful. Redesign events model and panel function. Events fetch should work through both REST API and WebSocket.
- Fix `/api/events` 400 error — observability.events.list routes to Lambda which doesn't have the endpoint. Should route through workspace server or support both.
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
- Code formatting (Prettier integration)
- TypeScript language services — project-aware completions, go-to-definition, hover info
- Fix Monaco `inmemory://model/1` console error — timing issue in editor decorations when model hasn't been created yet

**Usability:**
- Problems panel click/double-click navigation to exact position ✅ (implemented)
- Editor error highlighting uses word boundary ✅ (implemented)
- Double-click on UI elements (panels, buttons, labels) should not highlight element text (prevent user-select on interactive elements)

### Terminal

**Current state:** Multiple named terminal sessions per project via PtySessionPool. Tab bar UI for create/switch/close. Session IDs in WebSocket protocol for routing. Dedicated "Build" terminal streams all wf.exec() output in real-time (virtual session, no PTY). Automation commands for remote terminal control (terminal.list, terminal.create, terminal.close, terminal.send). Per-project xterm.js pool with scrollback preservation across session switches.

**Remaining work:**
- Terminal search (find text in scrollback)
- Terminal session naming/renaming

### Layout & General UI

**Remaining work:**
- Persist UI layout — panel sizes, which panels are selected/visible, sidebar state. Survive across page refreshes. Use per-project localStorage or project config.
- Zero console errors — eliminate all noise from console (events 400, Monaco inmemory model, etc.) for clean debugging.
- Double-click text selection prevention on interactive elements (panels, buttons, labels, tree items).

---

## Tier 3: Immediate Backlog

Prioritized items ready for implementation. Pulled from Tier 2, ordered by impact.

| Priority | Item | Service | Status | Description |
|----------|------|---------|--------|-------------|
| 1 | **M2 implementation** | All | not started | Phases 1-6: Puppeteer E2E utility, web preview route, todo app project, workflow rules, FT-M2 test cases, CDK utility. |
| 2 | **Git visual diff** | Projects | not started | Diff viewer in git panel. View staged/unstaged changes before commit. |
| 3 | **Multiple terminal tabs** | Terminal | not started | Multiple terminal sessions within a single project. Tab bar, create/close/switch. |
| 4 | **Secrets/env vars management** | DeployedResources | not started | UI for project secrets (API keys, credentials). Stored encrypted, injected into workflow rules and terminal env. |
| 5 | **Deploy URL display** | DeployedResources | not started | Show clickable link to live site in deploy panel after deployment. |
| 6 | **Command palette + search** | Files/ClientAutomation | not started | Shared overlay + keyboard shortcuts. Cmd+P file search, Cmd+Shift+P commands, Cmd+Shift+F full-text search. |
| 7 | **Show/hide dot files** | Files | not started | Toggle visibility of dot files (.gitignore, .antimatter, etc.) in file explorer. |
| 8 | **`.antimatter/config.json`** | Projects | not started | First-class project configuration file: test runner, preview directory, deploy targets, etc. |
| 9 | **Project templates** | Projects | not started | Scaffold new projects from templates (React SPA, Express API, static site). |
| 10 | **UI polish: prevent text selection** | Editor | partial | Apply `select-none` systematically to interactive elements. |
| 11 | **Functional demos** | Tests | not started | Demo scripting infrastructure. Pacing, narration overlay, step highlighting. |
| 12 | **FT-WS-001 fix** | Workspace | partial | Fix test isolation — file tree empties after earlier DOM tests. |

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
