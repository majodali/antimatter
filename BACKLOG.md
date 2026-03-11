# Antimatter Backlog

> Single source of truth for planning and current status.
> For architecture details see `docs/architecture.md`. For long-term vision see `docs/project-os.md`.

---

## Status Definitions

**Feature status:** `done` | `in-progress` | `planned`

- **done** — All functional test cases for the feature are `test-passing`.
- **in-progress** — Work underway (design, implementation, or test catchup).
- **planned** — Not started. Summary description only.

**Test case status** (rows nested under parent feature):

- **defined** — Test case described, no test code yet.
- **test-implemented** — Test code written, not yet passing.
- **test-passing** — Test passes.

A feature becomes `done` when ALL its test cases are `test-passing`.

**Test case ID convention:** `FT-{AREA}-{NNN}` (e.g., `FT-EDIT-001`, `FT-BUILD-002`)

---

## Phase: Bootstrap

**Goal:** The IDE can build, test, and deploy itself.
**Exit criterion:** A code change can be made, built, tested, and deployed entirely from within the IDE.

### Editor

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-EDIT-001 | **Monaco Editor** | in-progress | Multi-tab code editor with syntax highlighting, diagnostics overlay, auto-save, unsaved indicators |
| | FT-EDIT-001: Open file in tab | test-passing | Selecting a file in explorer opens it in an editor tab with correct content |
| | FT-EDIT-002: Switch between tabs | test-passing | Clicking a tab switches the active editor to that file |
| | FT-EDIT-003: Close tab | test-passing | Closing a tab removes it; if active, switches to adjacent tab |
| | FT-EDIT-004: Auto-save on edit | test-passing | Editing a file triggers auto-save after 1.5s debounce; file is persisted |
| | FT-EDIT-005: Unsaved indicator | defined | Editing a file shows amber dot on tab until save completes |
| | FT-EDIT-006: Diagnostics overlay | defined | Errors reported by build tools appear as inline markers in the editor |
| | FT-EDIT-007: Manual save (Ctrl+S) | defined | Ctrl+S immediately saves the file without waiting for debounce |

### File Explorer

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-FILE-001 | **File Explorer** | in-progress | Tree view with file/folder CRUD, selection opens in editor |
| | FT-FILE-001: Display file tree | test-passing | File explorer shows project directory structure as expandable tree |
| | FT-FILE-002: Create file | test-passing | Creating a new file via UI adds it to the tree and opens it in editor |
| | FT-FILE-003: Create folder | test-passing | Creating a new folder via UI adds it to the tree |
| | FT-FILE-004: Delete file | test-passing | Deleting a file removes it from tree and closes its editor tab |
| | FT-FILE-005: Rename file | test-passing | Renaming a file updates tree, editor tab title, and persisted path |
| | FT-FILE-006: Move file | test-passing | Moving a file to another folder updates tree and persisted path |
| | FT-FILE-007: Select file opens editor | test-passing | Clicking a file in the tree opens it in a new or existing editor tab |

### Problems Panel

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-PROB-001 | **Problems Panel** | in-progress | Displays build/lint errors grouped by file with navigation to source |
| | FT-PROB-001: Display errors grouped by file | defined | Errors from build tools appear grouped by file path |
| | FT-PROB-002: Navigate to file on click | defined | Clicking an error opens the corresponding file in the editor |
| | FT-PROB-003: Navigate to line on click | defined | Clicking an error scrolls editor to the error's line and column |
| | FT-PROB-004: Error count badge | defined | Panel header shows total error count |
| | FT-PROB-005: Clear errors on successful build | defined | Errors for a tool are cleared when that tool reports zero errors |

### Workflow Engine

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-WKFL-001 | **Workflow Engine** | in-progress | Rule-based automation with events, state persistence, widget declarations, esbuild compilation |
| | FT-WKFL-001: Load automation files | defined | .antimatter/*.ts files are compiled and loaded on workspace start |
| | FT-WKFL-002: File change detection | defined | Saving a file triggers workflow rules with matching file patterns |
| | FT-WKFL-003: Manual rule execution | defined | Running a rule via API executes its action and returns result |
| | FT-WKFL-004: State persistence | defined | Workflow state survives workspace server restart |
| | FT-WKFL-005: Error reporting | defined | Workflow rule errors appear in the Problems panel |
| | FT-WKFL-006: Auto-reload on change | defined | Editing a .antimatter/*.ts file triggers recompilation and reload |
| | FT-WKFL-007: Widget declarations | defined | Rules can declare UI widgets that appear in build/deploy panels |

### Build Panel

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-BUILD-001 | **Build Panel** | in-progress | Displays workflow rules with status, manual execution, widget rendering |
| | FT-BUILD-001: Display rule list | defined | Build panel shows all workflow rules with current status |
| | FT-BUILD-002: Run rule manually | defined | Clicking a rule's run button executes it and updates status |
| | FT-BUILD-003: Show rule result | defined | After execution, rule shows success/failure with duration |
| | FT-BUILD-004: Render widgets | defined | Widget declarations from build.ts render as buttons/status in panel |
| | FT-BUILD-005: Widget button triggers event | defined | Clicking a widget button fires the declared event and executes handler |
| | FT-BUILD-006: Streaming build output | defined | Build output streams to UI in real-time during execution |

### Widget System

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-WIDG-001 | **Widget Declaration System** | in-progress | Button, toggle, and status widgets rendered in build/deploy panels |
| | FT-WIDG-001: Button widget renders | defined | A declared button widget appears with correct label and icon |
| | FT-WIDG-002: Button click fires event | defined | Clicking a button widget fires its declared event |
| | FT-WIDG-003: Status widget displays value | defined | A declared status widget shows its current value and color |
| | FT-WIDG-004: Toggle widget renders | defined | A declared toggle widget appears and toggles on click |
| | FT-WIDG-005: Dynamic widget state | defined | Widget enabled/visible/value updates via workflowState._ui |

### Terminal

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-TERM-001 | **Terminal** | in-progress | xterm.js terminal with PTY backend, WebSocket, resize handling |
| | FT-TERM-001: Terminal connects on load | defined | Terminal establishes WebSocket connection and shows shell prompt |
| | FT-TERM-002: Execute command | defined | Typing a command and pressing Enter executes it and shows output |
| | FT-TERM-003: Resize handling | defined | Resizing the terminal panel adjusts the PTY dimensions |
| | FT-TERM-004: Reconnect on disconnect | defined | After WebSocket disconnect, terminal reconnects and replays buffer |
| | FT-TERM-005: Input buffering during reconnect | defined | Input typed during disconnect is sent after reconnection |

### AI Chat

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-CHAT-001 | **AI Chat** | in-progress | Chat panel with SSE streaming, tool calls, abort, conversation persistence |
| | FT-CHAT-001: Send message and receive response | defined | Sending a message returns a streamed assistant response |
| | FT-CHAT-002: Streaming display | defined | Assistant tokens appear incrementally as they arrive |
| | FT-CHAT-003: Tool call display | defined | Tool calls and results are shown inline in the conversation |
| | FT-CHAT-004: Abort response | defined | Clicking abort stops the current response mid-stream |
| | FT-CHAT-005: Conversation persistence | defined | Chat history survives page reload (save/load via API) |
| | FT-CHAT-006: Clear conversation | defined | Clear button resets the conversation history |

### Git Integration

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-GIT-001 | **Git Integration** | in-progress | Status, stage, commit, push, pull with UI panel |
| | FT-GIT-001: Show status | defined | Git panel shows staged, unstaged, and untracked files |
| | FT-GIT-002: Stage file | defined | Clicking stage on a file moves it to the staged section |
| | FT-GIT-003: Unstage file | defined | Clicking unstage on a staged file moves it back |
| | FT-GIT-004: Commit | defined | Entering a message and committing creates a git commit |
| | FT-GIT-005: Push | defined | Push sends commits to the remote repository |
| | FT-GIT-006: Pull | defined | Pull fetches and merges remote changes |
| | FT-GIT-007: Stage all | defined | Stage all button stages all unstaged and untracked files |

### Deploy Panel

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-DEPLOY-001 | **Deploy Panel** | in-progress | Deployment UI with workflow state display, widget rendering, deployment execution |
| | FT-DEPLOY-001: Display deploy widgets | defined | Deploy panel renders widget declarations from deploy.ts |
| | FT-DEPLOY-002: Build all action | defined | Build All button triggers full build pipeline |
| | FT-DEPLOY-003: Deploy action | defined | Deploy button triggers CDK deployment from IDE |
| | FT-DEPLOY-004: Deployment status display | defined | Panel shows current deployment state and last deploy time |
| | FT-DEPLOY-005: Streaming deploy output | defined | Deployment output streams to UI in real-time |

### Authentication

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-AUTH-001 | **Authentication** | in-progress | Cognito OAuth with auto token refresh |
| | FT-AUTH-001: Login redirects to Cognito | defined | Unauthenticated users are redirected to Cognito hosted UI |
| | FT-AUTH-002: Token auto-refresh | defined | Access token is automatically refreshed before expiry |
| | FT-AUTH-003: Auth gate blocks unauthenticated | defined | Protected routes return 401 without valid token |

### Secrets Management

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-SECRET-001 | **Secrets Management** | in-progress | SSM SecureString backend with management UI |
| | FT-SECRET-001: List secrets | defined | Secrets panel shows known secrets with set/unset status |
| | FT-SECRET-002: Set secret | defined | Setting a secret stores it in SSM and updates UI |
| | FT-SECRET-003: Clear secret | defined | Clearing a secret removes it from SSM |

### Infrastructure

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-INFRA-001 | **CDK Infrastructure** | in-progress | Lambda API, EC2/ALB workspace, S3, CloudFront, Cognito |
| | FT-INFRA-001: Lambda API health | defined | Health endpoint returns 200 with version info |
| | FT-INFRA-002: S3 file operations | defined | Files can be created, read, listed, and deleted via API |
| | FT-INFRA-003: CloudFront serves frontend | defined | CloudFront URL serves the SPA index.html |
| | FT-INFRA-004: Workspace server connects | defined | WebSocket connection to workspace server establishes successfully |

### Workspace Server

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-WKSP-001 | **Workspace Server** | in-progress | EC2 instance with S3 sync, PTY, WebSocket, workflow integration, git auto-init. Currently fragile — needs auto-recovery and idle detection fixes. |
| | FT-WKSP-001: Server starts and syncs | defined | Workspace server starts, syncs files from S3, initializes git |
| | FT-WKSP-002: WebSocket connection | defined | Client establishes WebSocket connection to workspace server |
| | FT-WKSP-003: S3 periodic sync | defined | File changes sync to S3 on 30s interval |
| | FT-WKSP-004: Workflow engine loads | defined | Workflow engine loads .antimatter/*.ts files on startup |
| | FT-WKSP-005: Idle detection respects running commands | defined | Long-running commands prevent workspace auto-stop |
| | FT-WKSP-006: S3/refresh race condition | defined | Workspace restart re-downloads stale files from S3 before local deletions (e.g. git clean) can sync. Fix: run syncToS3 before downloading on restart, or accept local filesystem as authoritative after git operations |

### S3 Project Storage

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-S3-001 | **S3 Project Storage** | in-progress | Project files stored in S3 with periodic sync to workspace. Timing and conflict resolution incomplete. |
| | FT-S3-001: Create project | defined | Creating a project initializes an S3 prefix |
| | FT-S3-002: File round-trip | defined | Write file via API → read back returns same content |
| | FT-S3-003: Sync to workspace | defined | Files written via Lambda API appear on workspace filesystem |

### Logging

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-LOG-001 | **Central Logging** | in-progress | EventLogger with S3 persistence exists. 138+ raw console.log calls remain. No IDE log viewer. |
| | FT-LOG-001: Structured event logging | defined | Backend components log via Logger utility, not raw console.* |
| | FT-LOG-002: S3 log persistence | defined | Logs are persisted to S3 in JSONL format |
| | FT-LOG-003: In-memory log buffer | defined | Workspace server buffers recent logs for quick retrieval |

### Test Infrastructure

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-TEST-001 | **Smoke Test Suite** | in-progress | 17 Lambda-based smoke tests covering health, files, projects, commands, frontend |
| | FT-TEST-001: All smoke tests pass | defined | POST /api/tests/run?suite=smoke returns all passing |
| F-TEST-002 | **Functional Test Framework** | in-progress | ActionContext abstraction with FetchActionContext and ServiceActionContext. Only 2 placeholder tests. |
| | FT-TEST-002: Functional tests run from CLI | defined | npm test executes functional tests via ServiceActionContext |
| | FT-TEST-003: Functional tests run from Lambda | defined | POST /api/tests/run?suite=functional executes via FetchActionContext |

### Build Scripts

| ID | Feature / Test Case | Status | Description |
|----|---------------------|--------|-------------|
| F-BSCR-001 | **Build Script Declarations** | in-progress | build.ts and deploy.ts workflow files with widget declarations |
| | FT-BSCR-001: Build.ts loads widgets | defined | Build panel shows type-check button and status widgets from build.ts |
| | FT-BSCR-002: Deploy.ts loads widgets | defined | Deploy panel shows build/deploy buttons and status widgets from deploy.ts |

---

## Phase: Migrate to Online

**Goal:** All development happens in the online IDE.
**Exit criterion:** Desktop Claude Code is no longer needed — code editing, AI agent interaction, build/test/deploy, and troubleshooting all happen online.

| ID | Feature | Status | Description |
|----|---------|--------|-------------|
| F-AUTO-001 | **UI Automation Layer** | planned | Browser automation for all testable user actions. Supports functional tests, reduces Claude-in-Chrome dependency, serves as agent tools. |
| F-AGENT-001 | **Agent Tool Integration** | planned | Agent can drive IDE actions (file ops, builds, deployments) via UI automation layer |
| F-AGENT-002 | **Agent Context Awareness** | planned | Agent sees project structure, workflow state, errors, and active file context |
| F-APPLY-001 | **Code Block Apply** | planned | Render code blocks in chat with "Apply" button that patches the corresponding file |
| F-CTX-001 | **File/Selection Context** | planned | Attach current file or editor selection as context when sending a chat message |
| F-LOGUI-001 | **IDE Log Viewer** | planned | Panel to view structured logs from EventLogger (filtered, searchable) |
| F-KBD-001 | **Keyboard Shortcuts & Command Palette** | planned | Cmd+P file switcher, Cmd+Shift+P command palette, customizable shortcuts |
| F-SEARCH-001 | **Full-Text File Search** | planned | Search across all project files with results panel (Cmd+Shift+F) |
| F-TRUN-001 | **In-IDE Test Runner** | planned | Run and view test results in a dedicated panel without using terminal |
| F-PULL-001 | **Git Pull API Endpoint** | planned | Lambda endpoint to trigger git pull, streamlining self-hosting update cycle |
| F-DIFF-001 | **Git Diff Viewer** | planned | Side-by-side or inline diff view for uncommitted changes. See also F-DIFFMERGE-001 and F-GITADV-001 for full diff/merge. |

---

## Phase: Project-OS Development

**Goal:** Build the Project Operating System vision.
**Features pulled from `docs/project-os.md` as needed.**

| ID | Feature | Status | Description |
|----|---------|--------|-------------|
| F-EDADV-001 | **Editor In-Browser Type Checking** | planned | Investigate solutions for type checking and linting within Monaco independent of save (current diagnostics rely on workspace-server compile step with multi-second delay) |
| F-EDADV-002 | **Editor Context Menu** | planned | Fix non-functional context menu items in Monaco editor |
| F-EDADV-003 | **Editor Tab Overflow** | planned | Replace horizontal scrollbar on tab panel with left/right navigation buttons when too many tabs are open |
| F-FILEADV-001 | **File Explorer Indicators** | planned | Show error-in-file and source-changed indicators on file tree nodes |
| F-FILEADV-002 | **File Explorer Multi-Select** | planned | Multi-select for bulk delete, drag-and-drop reordering/moving, cut/copy/paste operations |
| F-DIFFMERGE-001 | **File Diff/Merge** | planned | File explorer and source control panels support file diff/merge in panel or open content diff/merge view |
| F-WKFLADV-001 | **Workflow Type Checking** | planned | .antimatter/*.ts files are only transpiled via esbuild, not type-checked. Add type checking for workflow definition files. |
| F-WKFLADV-002 | **Workflow Terminal Execution** | planned | wf.exec() should run commands in the terminal (visible output) rather than a hidden subprocess. Configurable to use primary or secondary terminal. |
| F-TERMADV-001 | **Multiple Terminal Sessions** | planned | Support multiple terminal tabs — opened manually or automatically for build/deploy output |
| F-GITADV-001 | **Git Diff/Merge UI** | planned | Manual diff/merge interface for conflict resolution when merges aren't automatic |
| F-GITADV-002 | **Git History/Version View** | planned | Browse commit history with diff view per commit |
| F-GITADV-003 | **Git Branch & Tag Management** | planned | Create, switch, delete, and merge branches; create and manage tags |
| F-DEPLOYADV-001 | **Deploy Panel Per-Environment Actions** | planned | Remove hardcoded "Build all" and "Deploy" buttons. Projects define actions per environment or as specific widgets. Deployment status is per environment. |
| F-DEPLOYADV-002 | **Deploy Output Streaming to Terminal** | planned | Deploy output should stream to a terminal session rather than a custom panel |
| F-S3ADV-001 | **S3 Fallback for Inactive Workspace** | planned | UI actions should fall back to S3-only operation when workspace server is inactive — file operations, current workflow state, logging, etc. |
| F-ENTITY-001 | **Structured Entity Database** | planned | Requirements, Examples, Domain Types, Components, Modules as first-class entities with typed links |
| F-NAV-001 | **Project Navigator** | planned | Browse project as an information bundle — navigate by entity type, follow links, search |
| F-LITED-001 | **Literate Editor** | planned | CodeMirror 6 editor with embedded code blocks, entity links, model DSLs |
| F-EXAMPLE-001 | **Example Workshop** | planned | Specification by example — define, execute, and track examples linked to requirements |
| F-CONTRACT-001 | **Session Contracts** | planned | Agent proposes scope/assumptions/affected modules; human approves before work begins |
| F-ACTIVITY-001 | **Activity Designer** | planned | Visual design of activities and workflows |
| F-TRACE-001 | **Trace Explorer** | planned | Structured debugging and execution trace visualization |
| F-MULTI-001 | **Multi-Agent Orchestration** | planned | Specialized agents (implementer, reviewer, tester) with supervisor coordination |
| F-COMPRESS-001 | **Continuous Context Compression** | planned | Automatic context summarization to maintain agent effectiveness over long sessions |
| F-COLLAB-001 | **Real-Time Collaboration** | planned | Multiple users editing simultaneously via OTs/CRDTs |
| F-MODEL-001 | **Model Library & DSLs** | planned | Reusable model types with custom DSL support |
| F-IMPORT-001 | **Incombobulation** | planned | Import existing codebases into the entity model |
