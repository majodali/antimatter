# V0 Plan: Modular Online IDE with Agent Integration

## What V0 Is

A basic online IDE that can build and deploy its own modules. Agent-integrated. Modular enough that each component can be incrementally replaced with its Project Operating System equivalent.

## Components

### Frontend

**1. Shell**
Application frame, layout management, panel routing. Manages which panels are visible and how they're arranged. This is the skeleton that everything else plugs into.
- Resizable panel layout (sidebar + main + secondary panels)
- Panel registration — components register themselves; the shell doesn't know their internals
- Keyboard shortcut routing
- *Evolves into:* the Project Operating System's top-level navigation frame

**2. File Explorer**
Tree view of the project file system. Standard IDE file browser.
- Directory tree with expand/collapse
- File create, rename, delete, move
- File selection opens in Editor
- Context menus for file operations
- *Evolves into:* Entity Navigator (files become entities, folders become modules/concerns)

**3. Editor**
Code and text editing. The core authoring surface.
- Multi-tab, multi-file editing
- Syntax highlighting (TypeScript, markdown, JSON, YAML at minimum)
- Find/replace
- Unsaved change indicators
- *Evolves into:* Literate Editor (embedded code blocks, entity links, model DSLs)
- *Technology:* CodeMirror 6 — extensible, well-documented, good foundation for later rich editing features (embedded widgets, custom syntax, collaborative editing via OT)

**4. Command Runner**
Execute commands and view output. Not a persistent terminal — each command is a discrete execution.
- Command input with history (up arrow to recall previous commands)
- Structured output display with ANSI color support
- Command queue — run multiple commands, see results in sequence
- Working directory selector (defaults to project root or selected module)
- Preset commands — build, test, deploy shortcuts per module
- *Evolves into:* Build & Validation Bar (structured build results, dependency-aware test execution, continuous validation status)

**5. Agent Chat**
Conversational interface with the coding agent.
- Message thread (human and agent)
- Agent can reference files (displayed as links)
- Agent can propose file edits (displayed as diffs the user can accept/reject)
- Agent can execute commands (with user visibility)
- Markdown rendering in messages
- *Evolves into:* Agent Workspace (session contracts, interaction budgets, multi-agent roles, work item management)

**6. Deployment Panel**
Manage build and deployment of modules.
- List of defined modules with build/deploy status
- Build action — runs module build pipeline, shows output
- Deploy action — deploys to target environment(s)
- Environment status — what's deployed where, health indicators
- *Evolves into:* Deployment & Operations Console (system topology, activity traces, automated deployment)

### Backend

**7. Project File Service**
Server-side file system operations for the project workspace.
- CRUD operations on files and directories
- File watching — notify frontend of external changes (e.g., agent edits)
- File content serving for the editor
- *Evolves into:* Entity & Link Engine (files become structured entities with typed relationships)

**8. Command Execution Service**
Server-side command execution. Each command is a discrete, stateless invocation — no persistent shell.
- Accepts a command string and working directory
- Executes in the project's EFS-mounted file system
- Returns stdout, stderr, and exit code
- Streams output for long-running commands (builds)
- *Evolves into:* Build & Validation Engine backend (structured build pipelines, dependency-aware test execution, example runner)

**9. Agent Service**
Integration layer between the IDE and the coding agent (Claude).
- Manages agent conversation state
- Provides agent with project context (file listing, file contents, relevant files)
- Translates agent actions (edit file, run command) into Project File Service and Command Execution Service calls
- Streams agent responses to frontend
- *Evolves into:* Agent Interface Layer (entity-aware context, session contracts, multi-agent orchestration, continuous context compression)

**10. Deployment Service**
Build and deployment orchestration.
- Module definition — what constitutes a module, how to build it, where to deploy it
- Build execution — run build scripts, capture output, report status
- Deployment execution — push built artifacts to target environments
- Environment registry — known environments and their state
- *Evolves into:* full Deployment & Operations Console backend

---

## Module Structure

V0 is itself a multi-module project. This is important — we want to experience multi-module development early.

```
project-os/
├── packages/
│   ├── shell/              # App frame, layout, panel system
│   ├── file-explorer/      # File tree panel
│   ├── editor/             # Code editor panel (CodeMirror 6)
│   ├── command-runner/     # Command execution panel
│   ├── agent-chat/         # Agent conversation panel
│   ├── deployment-panel/   # Build/deploy UI
│   ├── common-ui/          # Shared UI components, theming
│   │
│   ├── file-service/       # Lambda: file operations on EFS
│   ├── command-service/    # Lambda: command execution on EFS
│   ├── agent-service/      # Lambda: Claude API integration
│   ├── deployment-service/ # Lambda: build and deploy orchestration
│   └── api-gateway/        # API Gateway config (REST + WebSocket)
│
├── infrastructure/
│   ├── cdk/                # AWS CDK infrastructure-as-code
│   │   ├── api.ts          # API Gateway (REST + WebSocket)
│   │   ├── lambdas.ts      # Lambda functions + EFS mount
│   │   ├── storage.ts      # DynamoDB tables, EFS, S3
│   │   ├── cdn.ts          # CloudFront + S3 static hosting
│   │   └── stack.ts        # Top-level stack composition
│   └── environments/
│       ├── dev.ts          # Dev environment config
│       ├── test.ts         # Test environment config
│       └── prod.ts         # Production environment config
│
└── project.json            # Module definitions, dependencies, build config
```

Each package has its own build, its own tests, and a declared interface. The shell discovers and loads frontend packages dynamically. Backend services communicate through defined APIs.

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend framework** | React + TypeScript | Mature component model, rich ecosystem, modular by nature. |
| **Editor** | CodeMirror 6 | Extensible architecture, plugin system supports future literate editing, collaborative editing support built in. |
| **Command output** | xterm.js (output only) | Renders ANSI-colored command output. No interactive terminal needed. |
| **Styling** | Tailwind CSS | Utility-first, consistent, works well with component boundaries. |
| **Build system** | Turborepo or Nx | Monorepo management with per-package builds, caching, dependency-aware task execution. |
| **Backend runtime** | Node.js + TypeScript (Lambda) | Same language as frontend, proven on Lambda, good for streaming via WebSocket API. |
| **API layer** | API Gateway (REST + WebSocket) | REST for CRUD operations. WebSocket for streaming (agent responses, command output, file watching). |
| **Agent integration** | Claude API (direct) | Direct API gives full control over context construction, essential for evolution toward continuous context compression. |
| **Infrastructure-as-code** | AWS CDK (TypeScript) | Same language as application code. Type-safe infrastructure. Easy to version and deploy. |
| **Database** | DynamoDB | Conversation history, module definitions, environment config, deployment state. Serverless-native, scales to zero. Eventually becomes the structured entity store. |
| **Project file storage** | EFS (Elastic File System) | Mounted by Lambdas for file operations and command execution. Provides the POSIX file system that builds and tools expect. |
| **Static hosting** | S3 + CloudFront | Standard SPA hosting. Frontend bundles served from edge. |
| **Compute** | Lambda | All backend services run as Lambda functions. EFS-mounted for file access. Up to 15 min timeout for long builds. |

### AWS Architecture

```
                         CloudFront
                             │
                    ┌────────┴────────┐
                    │                 │
                S3 Bucket        API Gateway
              (static SPA)     (REST + WebSocket)
                                     │
                    ┌────────┬───────┼────────┐
                    │        │       │        │
                 Lambda   Lambda  Lambda   Lambda
                 (file)   (cmd)   (agent)  (deploy)
                    │        │       │        │
                    └────────┴───┬───┴────────┘
                                 │
                          ┌──────┴──────┐
                          │             │
                         EFS        DynamoDB
                    (project files) (app state)
```

**Key architectural notes:**
- All Lambdas mount the same EFS file system, so file changes made by command execution or agent edits are immediately visible to all services.
- WebSocket connections are managed by API Gateway. Lambda functions are invoked per-message for agent streaming and command output.
- Agent service calls Claude API and streams responses back through the WebSocket. Long agent interactions are handled within Lambda's 15-minute timeout.
- Command execution is stateless — each command runs in a fresh process on EFS. Working directory is specified per-command. Environment variables are passed explicitly.
- For builds exceeding Lambda timeout, the deployment service can use Step Functions to orchestrate multi-step build pipelines, or delegate to CodeBuild.

### Technology decisions deferred:
- **Structured database** (SurrealDB, ArangoDB, etc.) — not needed until entity model is built; may supplement or replace DynamoDB
- **Vector indexing** — not needed until continuous context compression; could use DynamoDB + OpenSearch Serverless, or an in-Lambda solution
- **OT library** — not needed until real-time collaboration
- **Model/DSL framework** — not needed until model library integration
- **Fargate** — if we later need persistent terminal sessions or long-running build agents

---

## Build Sequence

### Phase 1: Infrastructure + Editable Project (Week 1-2)
**Goal:** Deploy the shell, open files, edit them, save them.

1. AWS CDK stack — API Gateway, Lambda scaffolds, EFS, S3/CloudFront, DynamoDB
2. Shell with resizable panel layout
3. File Explorer connected to Project File Service (Lambda + EFS)
4. Editor (CodeMirror 6) with multi-tab, syntax highlighting
5. Project File Service Lambda (CRUD, file listing)
6. API Gateway REST routes for file operations
7. Deploy frontend to S3/CloudFront

**Milestone:** The IDE is live on AWS. Can open the V0 project and edit files in the browser.

### Phase 2: Executable Project (Week 2-3)
**Goal:** Run commands, see output. Can build and test from within the IDE.

8. Command Runner panel with command input, output display, history
9. Command Execution Service Lambda (EFS-mounted, runs commands, streams output)
10. WebSocket channel for streaming command output
11. Build/test shortcuts per module (defined in project.json)

**Milestone:** Can run builds and tests for V0 modules from within the IDE, deployed on AWS.

### Phase 3: Agent Integrated (Week 3-5)
**Goal:** Agent can understand the project and make changes.

12. Agent Chat panel with message threading and markdown rendering
13. Agent Service Lambda with Claude API integration
14. Agent context construction — file listing, relevant file contents, conversation history (stored in DynamoDB)
15. Agent actions — file edits (displayed as diffs), command execution (visible in Command Runner)
16. Accept/reject flow for agent-proposed changes
17. WebSocket channel for streaming agent responses

**Milestone:** Can have the agent implement features, review its changes, and run tests — all within the IDE on AWS.

### Phase 4: Self-Deploying (Week 5-7)
**Goal:** Build and deploy V0 modules from within V0.

18. Deployment Panel UI — module list, build/deploy status, environment selector
19. Deployment Service Lambda — build execution, CDK deployment triggers
20. Environment registry in DynamoDB — what's deployed where, health status
21. Deploy pipeline: build module → update Lambda/S3 → verify
22. Deploy V0 from within V0

**Milestone:** V0 is self-hosted. Editing code in the IDE, building, and deploying — all from the browser, all on AWS serverless.

---

## Key Interfaces

These are the boundaries between modules. Keeping them clean is what enables incremental replacement.

### Shell ↔ Panels
```typescript
interface PanelRegistration {
  id: string;
  title: string;
  icon: ReactNode;
  component: React.ComponentType<PanelProps>;
  defaultPosition: 'sidebar' | 'main' | 'secondary' | 'bottom';
}

interface PanelProps {
  isActive: boolean;
  onAction: (action: PanelAction) => void; // cross-panel communication
}
```

### Frontend ↔ Backend (API Gateway)
```typescript
// REST endpoints (API Gateway → Lambda)
// GET    /api/files/:path           — read file/directory
// PUT    /api/files/:path           — write file
// DELETE /api/files/:path           — delete file
// POST   /api/files/move            — move/rename
// POST   /api/commands/execute      — run a command, returns execution ID
// GET    /api/modules               — list modules
// POST   /api/modules/:id/build     — trigger build
// POST   /api/modules/:id/deploy    — trigger deploy
// GET    /api/environments          — list environments

// WebSocket channels (API Gateway WebSocket API → Lambda)
type Channel =
  | { type: 'command'; executionId: string }     // command output stream
  | { type: 'agent'; conversationId: string }    // agent message stream
  | { type: 'fileWatch'; path: string }          // file change notifications
  | { type: 'build'; moduleId: string }          // build output stream
```

### Agent Service ↔ Claude API
```typescript
interface AgentContext {
  projectStructure: FileTree;
  openFiles: Array<{ path: string; content: string }>;
  relevantFiles: Array<{ path: string; content: string; reason: string }>;
  conversationHistory: Message[];
  moduleDefinitions: ModuleConfig[];
  activeWorkContext?: string; // what the user is currently working on
}

interface AgentAction =
  | { type: 'editFile'; path: string; diff: FileDiff }
  | { type: 'createFile'; path: string; content: string }
  | { type: 'deleteFile'; path: string }
  | { type: 'runCommand'; command: string }
  | { type: 'message'; content: string }
```

---

## What V0 Explicitly Defers

For clarity — these are NOT in V0 but are built using V0:

- Information bundle entity model and navigation
- Literate editing (embedded diagrams, entity links, model DSLs)
- Specification by example (as a structured workflow)
- Session contracts and interaction budgets
- Multi-agent roles and orchestration
- Continuous context compression
- Activity models and Activity Designer
- Trace Explorer and structured debugging
- Real-time collaboration and OTs
- Model library and custom DSLs
- Incombobulation tooling
- Agent attention model (A9)

All of these are V1+ features, built inside V0.

---

## Open Questions for V0

1. **AWS account and region.** Single account or separate accounts for dev/test/prod? Which region? Affects latency and EFS performance.
2. **EFS performance tier.** Standard vs. provisioned throughput? Builds and agent file operations need decent I/O. May need to benchmark.
3. **Lambda concurrency and memory.** What memory/CPU allocation for each service? Command execution and agent services may need higher allocations. Agent service needs enough time for Claude API round-trips.
4. **Long builds.** If builds exceed Lambda's 15-minute timeout — Step Functions to orchestrate, or delegate to CodeBuild? Decision can wait until we hit the problem.
5. **Authentication.** Single user initially, but what's the plan? Cognito when multi-user matters? API key for now?
6. **Agent model.** Claude Opus for all tasks, or Sonnet for lightweight tasks with Opus for complex ones?
7. **Monorepo tooling.** Turborepo vs. Nx vs. simple scripts? Need to evaluate against the CDK + Lambda packaging workflow.
8. **Local development.** How do we develop before V0 is self-hosting? SAM local? LocalStack? Direct deploy to a dev stage?

---

## Backlog

Features planned but not yet scheduled.

### Comprehensive Git Support

Currently: projects can be cloned from a Git URL (`POST /api/projects/import/git`) via `isomorphic-git`, but the `.git` directory is discarded after import so no further Git operations are possible.

**Goal:** Full Git workflow within the IDE — clone, pull, push, branch, commit, diff, merge — so projects stay connected to their upstream repositories.

**Scope:**

1. **Preserve `.git` state** — Keep the `.git` directory in workspace storage (EFS or container) so Git operations work after initial clone. May require storing Git state separately from S3 project files.

2. **Core Git operations**
   - `git pull` / `git fetch` — Update project from upstream
   - `git push` — Push local changes to remote
   - `git commit` — Commit staged changes with message
   - `git branch` / `git checkout` — Branch management
   - `git status` / `git diff` — Show working tree state
   - `git merge` — Merge branches (with conflict UI)
   - `git log` — Commit history viewer

3. **Authentication** — Support GitHub/GitLab authentication (SSH keys or personal access tokens stored securely, e.g. SSM Parameter Store or Secrets Manager). Needed for private repos and push access.

4. **Diff viewer** — Side-by-side or inline diff view in the editor for uncommitted changes and PR reviews.

5. **Branch UI** — Branch selector in the IDE chrome, visual branch/merge history.

6. **GitHub integration** — PR creation, issue linking, webhook-triggered syncs (repo push → project update).

7. **Conflict resolution** — Three-way merge UI when pulls or merges encounter conflicts.

**Implementation considerations:**
- `isomorphic-git` (already a dependency) handles most operations in pure JS but lacks some advanced features (interactive rebase, submodules)
- For full Git support in workspace containers, native `git` is already installed in the container image
- Git state needs to survive container restarts — either persist `.git` on EFS, sync to S3, or treat the container as ephemeral and re-clone on start
- Large repos: shallow clones + sparse checkout may be needed to keep container startup fast
