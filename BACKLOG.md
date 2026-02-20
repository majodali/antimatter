 # Antimatter Backlog

> Living document — features ordered roughly by priority within each category.
> Status: **Planned** | **In Progress** | **Done**

---

## 1. Build System

The core build executor, caching, and dependency resolver exist. These items take it from "runs a build" to "production-grade build platform."

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 1.1 | **Watch mode** | Done | Re-run affected targets when source files change (client-side polling with stale target detection) |
| 1.2 | **Parallel target execution** | Done | Execute independent targets concurrently (wave-based with configurable maxConcurrency) |
| 1.3 | **Incremental builds** | Done | Skip targets whose inputs haven't changed; dependency-aware cache invalidation |
| 1.4 | **Build configuration UI** | Done | Visual editor for build rules/targets in the IDE sidebar, persisted as `.antimatter/build.json` |
| 1.5 | **Build log streaming** | Done | Stream build progress to terminal panel in real time via SSE over HTTP |
| 1.6 | **Diagnostics overlay** | Done | Show build errors/warnings inline in the Monaco editor with clickable file paths |

---

## 2. Agent Integration

The agent framework supports multi-turn chat with tool use. These items deepen the integration into the IDE workflow.

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 2.1 | **Streaming responses** | Planned | Stream assistant tokens to the chat panel as they arrive instead of waiting for the full response |
| 2.2 | **Inline code actions** | Planned | "Fix this", "Explain", "Refactor" actions in the editor context menu that invoke the agent on a selection |
| 2.3 | **Agent-driven builds** | Planned | Agent can trigger builds, read diagnostics, and iterate on fixes autonomously |
| 2.4 | **Custom tool definitions** | Planned | Let users define project-specific tools (shell commands, API calls) the agent can invoke |
| 2.5 | **Persistent memory** | Planned | Agent retains key context across conversations (project conventions, past decisions) |
| 2.6 | **Multi-agent orchestration** | Planned | Specialized agents (implementer, reviewer, tester) that hand off to each other |
| 2.7 | **Cancel / interrupt** | Planned | Abort a running agent turn mid-stream |

---

## 3. Artifact Repository & Cross-Project Dependencies

No artifact storage exists today. This enables projects to produce versioned outputs that other projects can consume.

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 3.1 | **Artifact publish** | Planned | Build targets can declare outputs; successful builds upload artifacts to S3 with version metadata |
| 3.2 | **Artifact registry API** | Planned | `GET /api/artifacts` — list, query, download published artifacts |
| 3.3 | **Cross-project dependency declarations** | Planned | Project config references artifacts from other projects (name + version range) |
| 3.4 | **Dependency resolution at build time** | Planned | Before building, fetch required artifacts and make them available as inputs |
| 3.5 | **Artifact UI** | Planned | Browse published artifacts per project, view versions, download |
| 3.6 | **Artifact garbage collection** | Planned | Retention policies to prune old artifact versions |

---

## 4. Execution & Deployments

Today deployment is manual CDK. This category covers running code and deploying projects from within the IDE.

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 4.1 | **In-browser code execution** | Planned | Run scripts (JS/TS/Python) in a sandboxed Lambda or container and stream output to terminal |
| 4.2 | **Test runner integration** | Planned | Discover and run project test suites (not smoke tests), show results in a dedicated panel |
| 4.3 | **Preview deployments** | Planned | One-click deploy of a project to a temporary URL for testing/sharing |
| 4.4 | **Deployment configuration** | Planned | Per-project deploy targets (S3 static site, Lambda, container) defined in project config |
| 4.5 | **Deploy history & rollback** | Planned | Track deployments per project, one-click rollback to previous version |
| 4.6 | **Environment management** | Planned | Manage secrets/env vars per project and per deploy environment (dev/staging/prod) |

---

## 5. Chat Interface

The chat panel works for basic conversation. These items make it a first-class IDE feature.

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 5.1 | **Markdown rendering** | Planned | Render assistant messages as rich markdown (code blocks, lists, links) |
| 5.2 | **Code block apply** | Planned | "Apply" button on code blocks that writes the diff into the editor |
| 5.3 | **File context attachment** | Planned | Attach files or selections to a chat message so the agent sees them |
| 5.4 | **Conversation history persistence** | Planned | Save/load past conversations per project |
| 5.5 | **Multi-conversation support** | Planned | Multiple chat threads per project, switchable from sidebar |
| 5.6 | **Tool call visualization** | Planned | Show which tools the agent called and their results in the chat timeline |

---

## 6. Events, Triggers & Automation

No event system exists. This is the foundation for CI/CD-like workflows inside Antimatter.

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 6.1 | **Event bus** | Planned | Internal pub/sub for events: file changed, build completed, test passed/failed, deploy finished |
| 6.2 | **Webhook triggers** | Planned | Inbound webhooks (e.g. GitHub push) that trigger builds or test runs |
| 6.3 | **Automated build on save** | Planned | Configurable trigger: re-build affected targets when files are written |
| 6.4 | **Automated test on build** | Planned | Run project tests after every successful build |
| 6.5 | **Scheduled runs** | Planned | Cron-style triggers for nightly builds, periodic test suites |
| 6.6 | **Notification system** | Planned | Surface event outcomes in the IDE (toast/badge) and optionally via external channels (email, Slack) |
| 6.7 | **Pipeline definitions** | Planned | User-defined multi-step workflows: build → test → deploy, with conditional logic |

---

## 7. Collaboration & Multi-User

Not started. These enable teams to work together in Antimatter.

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 7.1 | **Authentication** | Planned | User accounts with login (OAuth or email/password) |
| 7.2 | **Project sharing & permissions** | Planned | Invite collaborators to projects with role-based access |
| 7.3 | **Real-time collaboration** | Planned | Multiple users editing the same project simultaneously (CRDT or OT) |
| 7.4 | **Activity feed** | Planned | Per-project log of who did what (edits, builds, deploys) |

---

## 8. Developer Experience & Polish

Quality-of-life improvements to the existing IDE.

| # | Feature | Status | Description |
|---|---------|--------|-------------|
| 8.1 | **Keyboard shortcuts** | Planned | Cmd palette, file switcher (Ctrl+P), global search (Ctrl+Shift+F) |
| 8.2 | **File search** | Planned | Full-text search across project files with results panel |
| 8.3 | **Git integration** | Planned | View diffs, stage changes, commit from within the IDE (isomorphic-git already a dependency) |
| 8.4 | **Theme support** | Planned | Light/dark mode toggle, custom editor themes |
| 8.5 | **Multi-file tabs** | Done | Tabbed editor with dirty indicators and auto-save |
| 8.6 | **File/folder creation** | Done | Create files and folders from the explorer context menu |
| 8.7 | **Project import (git + upload)** | Done | Clone repos or upload local directories as projects |
| 8.8 | **Drag-and-drop file upload** | Planned | Drop files/folders onto the explorer to add them to the project |
| 8.9 | **Mobile / responsive layout** | Planned | Usable layout on tablet-sized screens |
