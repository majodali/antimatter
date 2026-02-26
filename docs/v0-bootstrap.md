# V0: Minimum Viable Self-Hosting Platform

## The Bootstrap Question

To self-host, the tool must be capable enough that building the rest of the tool *in it* is more productive than building in a conventional IDE with Claude Code. If it's not, we'd rationally abandon it and go back to the IDE — so the bar is real.

What makes our tool more productive than a conventional IDE + Claude Code?

1. **Structured project understanding** — navigating by intent and purpose, not files
2. **Specification by example** — examples define done before work begins
3. **Agent collaboration model** — session contracts, high-value interactions, continuous context
4. **Continuous validation** — build/test on every change with dependency-aware incrementalism
5. **Rich linked documentation** — everything connected, nothing orphaned

For V0, we don't need all of these fully realized. We need enough of each that the combination is already better than the alternative. And critically, we need V0 to be buildable *outside* the tool in a reasonable timeframe.

---

## What V0 Must Do

### 1. Store and navigate a project as an information bundle
**Why:** This is the foundational difference. Without it, we're just another IDE.
**V0 scope:**
- Structured database with the core domain type schema (Requirements, Examples, Domain Types, Components, Modules, Activities, Business Rules, Constraints, Work Items)
- Entity creation, editing, linking
- Basic navigation — browse by entity type, follow links, search
- No model library yet, no DSLs, no diagrams — plain text/markdown definitions with typed links

**Not in V0:** Project Navigator with audience-specific views, Activity Designer, visual models

### 2. Edit literate content
**Why:** Domain types, business rules, and requirements live in literate documents. We need to author them.
**V0 scope:**
- Editor that handles markdown with embedded code blocks (literate style)
- Code blocks are extractable and executable (the runtime knows how to find and run them)
- Syntax highlighting for embedded code
- Hyperlinks between entities rendered inline

**Not in V0:** Full rich editor with embedded diagrams, model DSL editors, collaborative editing, OTs

### 3. Define and run examples
**Why:** Specification by example is the collaboration lingua franca. Without it, agent collaboration falls back to "write code, hope it's right."
**V0 scope:**
- Example entity type with preconditions, steps, expected outcomes
- Examples are executable — the system can run them and report pass/fail
- Examples linked to Requirements and Components
- Results displayed with links to related entities on failure

**Not in V0:** Example Workshop as a dedicated UI, visual example design, coverage analysis

### 4. Agent workspace with session contracts
**Why:** This is what makes agent collaboration structured rather than ad-hoc chat.
**V0 scope:**
- Chat interface with the implementation agent
- Session contract proposal/approval flow — agent proposes scope, assumptions, affected modules; human approves
- Agent can read and write project entities (not just files)
- Agent sees linked context — when working on a Component, it has access to linked Requirements, Examples, Domain Types
- Basic interaction budget — agent knows how many questions it can ask
- Work item tracking — create, assign, update status

**Not in V0:** Multi-agent roles, supervisor agent, continuous context compression (use simpler context management initially), predefined orchestration processes

### 5. Build and validate continuously
**Why:** Immediate feedback on every change is what lets agents work uninterrupted with confidence.
**V0 scope:**
- Dependency tracking between entities (which Examples test which Components, which Components implement which Requirements)
- On any entity change, determine affected Examples and re-run them
- Build/test results displayed with pass/fail status and links to affected entities
- Pipeline halts on error

**Not in V0:** Code coverage-based dependency tracking (use declared links initially), atomic multi-edit submission, full incremental build optimization

### 6. Respond to user changes (A9 — lightweight)
**Why:** We want to use the tool ourselves and have the agent notice what we're doing.
**V0 scope:**
- Agent is notified when the user edits an entity
- Agent can see what changed and which linked entities are affected (via dependency graph)
- Agent can comment/flag impact but doesn't initiate full conversations unless impact is significant
- Threshold: agent engages when a change breaks an Example or affects another Module's interface

**Not in V0:** Tunable attention model, learned user preferences, exploratory vs. deliberate edit detection

---

## What V0 Does NOT Need

These are important but can be built inside V0 once it exists:

- **Project Navigator with audience-specific views** — basic entity browsing is sufficient
- **Activity Designer** — Activities are defined as structured text, not visual diagrams
- **Model Library and DSLs** — models are plain markdown descriptions initially
- **Trace Explorer** — standard test output and logs for now
- **Deployment & Operations Console** — deploy manually, add console later
- **Multi-agent orchestration** — single implementation agent with basic context
- **Continuous context compression** — simpler context window management initially (load relevant entities by link proximity, summarize on overflow)
- **Real-time collaboration / OTs** — single user initially
- **Custom OT type system** — not needed until multi-user
- **Incombobulation (A8)** — V0 is a new project, nothing to import yet (though V0.5 will need a basic version to import V0 into itself)

---

## V0 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Web Application                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Entity      │  │   Literate   │  │    Agent      │  │
│  │   Navigator   │  │   Editor     │  │    Chat +     │  │
│  │              │  │              │  │    Contracts   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│  ┌──────┴─────────────────┴───────────────────┴───────┐  │
│  │              Build & Validation Bar                 │  │
│  │         (continuous status, pass/fail, links)       │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
├────────────────────────┼─────────────────────────────────┤
│                   Core Services                          │
│                        │                                 │
│  ┌─────────────────────┴──────────────────────────────┐  │
│  │              Entity & Link Engine                   │  │
│  │   (CRUD, linking, dependency graph, querying)       │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
│  ┌──────────────┐  ┌───┴──────────┐  ┌───────────────┐  │
│  │   Example    │  │  Dependency  │  │    Agent      │  │
│  │   Runner     │  │  Tracker &   │  │    Context    │  │
│  │              │  │  Build Engine│  │    Manager    │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Agent Interface Layer                  │  │
│  │   (entity read/write, context loading,              │  │
│  │    contract management, change notification)        │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
├────────────────────────┼─────────────────────────────────┤
│                   Storage                                │
│                        │                                 │
│  ┌─────────────────────┴──────────────────────────────┐  │
│  │              Structured Database                    │  │
│  │   (entities, links, versions, vector index)         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Technology Decisions Needed for V0

| Decision | Options to Evaluate | Criteria |
|----------|---------------------|----------|
| Database | SurrealDB, ArangoDB, PostgreSQL + pgvector + graph extension | Entity/link model, vector search, bulk load, developer experience |
| Web framework | To be determined | Rich editor support, real-time updates, component model |
| Agent integration | Claude API direct, Claude Code CLI, custom protocol | Entity-aware context, structured read/write, contract flow |
| Example runner | Language-specific test runners, custom harness | Must handle literate code extraction and execution |
| Editor component | Monaco, CodeMirror 6, ProseMirror, custom | Markdown + embedded code + entity links + syntax highlighting |

---

## V0 → V0.5 Transition: Incombobulation of Self

Once V0 is functional, we migrate V0's own codebase into it:
1. Agent analyzes V0's source code and maps it to the domain type schema
2. Human validates: are the inferred Components, Modules, and Dependencies correct?
3. Agent creates Requirements and Examples retroactively for existing functionality
4. Project is now navigable as an information bundle
5. All further development happens inside the tool

This is the first real test of incombobulation (A8) and will expose what's missing.

---

## V0 Build Sequence

A suggested order that maximizes self-hosting readiness at each step:

### Phase 1: Foundation
1. **Database schema + Entity & Link Engine** — the core data model
2. **Basic Entity Navigator** — browse, search, follow links (even if crude)
3. **Basic Editor** — create and edit entities as markdown with code blocks

*At this point: we can manually create an information bundle and navigate it, but there's no agent and no validation.*

### Phase 2: Validation
4. **Example Runner** — extract and execute code from literate examples
5. **Dependency Tracker** — know which Examples test which Components
6. **Build & Validation Bar** — continuous feedback on every save

*At this point: we can define features with examples, write implementations, and get continuous feedback. Already more structured than a regular IDE, but no agent.*

### Phase 3: Agent
7. **Agent Interface Layer** — agent can read/write entities, see dependency graph
8. **Agent Context Manager** — load relevant entities by link proximity for agent context
9. **Agent Chat + Session Contracts** — structured collaboration UI
10. **Change Notification** — agent responds to user edits (A9 lightweight)

*At this point: V0 is complete. We can self-host.*

### Phase 4: Self-Host
11. **Incombobulate V0 into itself** (V0.5)
12. **Begin building V1 features inside the tool**

---

## Estimated Complexity

This is a substantial but bounded V0. The core entities are:
- ~16 domain types with relationships
- ~6 UI surfaces (navigator, editor, chat, contract view, build bar, work items)
- ~5 backend services (entity engine, example runner, dependency tracker, agent interface, context manager)
- 1 database
- 1 agent integration

Rough estimate: a focused team (human + agent) could build V0 in 4-8 weeks depending on technology choices and how much polish is needed before self-hosting is productive. The bar is "more productive than a conventional IDE for building this specific project," not "production-ready for external users."
