# Project Operating System (working title)

A structured development environment where human intent, system design, behavior specification, implementation, and operational state are first-class, navigable, interlinked concepts — optimized for productive human/agent collaboration.

## Purpose

Software projects fail at the seams: between intent and implementation, between modules, between what was built and what's running, between what the human understands and what the agent produced. This tool closes those gaps by organizing everything around **consistent information bundles** — living, navigable knowledge structures where documentation, models, code, tests, and operational state are linked by intent and dependency.

The human brings intent, domain knowledge, and judgment. The agent brings tireless execution, comprehensive validation, and the ability to maintain consistency across complexity that would overwhelm working memory. The tool makes their collaboration legible, traceable, and productive.

---

## Domain Types

These are the core concepts the system is built around. Each is a first-class, addressable entity with identity, metadata, and relationships to other entities.

### Intent Layer

**Requirement**
A statement of what the system should do or how it should behave, expressed in natural language enriched with linked domain types, examples, and constraints. Requirements are the root of traceability — every other artifact should link back to one or more requirements.

- Has: description, rationale, priority, status
- Links to: Examples, Activities, Domain Types, Work Items
- Invariant: every Requirement has at least one Example before implementation begins

**Example**
A concrete, executable scenario that illustrates and validates a Requirement or Activity. The primary lingua franca between human and agent. Examples are both documentation (readable) and tests (executable).

- Has: description, preconditions, steps/inputs, expected outcomes
- Links to: Requirements, Activities, Components
- Invariant: Examples are always executable against the current system state
- Note: Examples exist at multiple granularity levels — from end-to-end user scenarios down to unit-level component behaviors

**Business Rule**
A named, declarative statement of domain logic defined in literate code — embedded in high-level documents but executable. Rules constrain or determine system behavior.

- Has: name, description, rule definition (literate code), scope
- Links to: Domain Types, Activities, Examples
- Invariant: every Business Rule has at least one Example demonstrating its effect

**Constraint / Invariant**
A condition that must always hold across the system or within a defined scope. Continuously validated by the build and test engine.

- Has: name, description, constraint definition, scope (global / module / component)
- Links to: Domain Types, Components, Activities
- Invariant: violations are surfaced immediately on any change

### Structure Layer

**Project**
The top-level information bundle. Organizes everything else. Provides structured entry points for different audiences: newcomers, feature contributors, work managers, operations staff.

- Has: name, purpose statement, entry points, configuration
- Contains: Modules, Domain Types, Requirements, Models

**Module**
A cohesive unit of functionality with a declared interface contract. Modules are developed and tested in isolation against their contracts, then integrated.

- Has: name, purpose, interface contract (inputs, outputs, behaviors), dependencies
- Links to: Requirements, Components, Activities, Examples
- Invariant: a Module's interface contract is satisfied by its Examples

**Domain Type**
A named type from the problem domain, defined in literate code. Domain types are the shared vocabulary between human and agent, and between documentation and implementation.

- Has: name, description, definition (literate code), validation rules
- Links to: Requirements, Business Rules, Activities, Components
- Note: Domain Types are defined once and referenced everywhere — in requirements, models, code, and examples

**Component**
A runtime unit that implements part of a Module. Components interact via Activities. In the debugging/tracing environment, components are live, inspectable entities — not just source files.

- Has: name, type, state schema, interface, implementation
- Belongs to: Module
- Links to: Activities, Domain Types, Examples

### Behavior Layer

**Activity**
A model of how Components or other actors interact to achieve an outcome. Activities are defined at multiple levels of granularity and are the primary way behavior is specified, understood, and validated.

- Has: name, description, participants, steps, level (system / module / component)
- Links to: Requirements, Examples, Components, Business Rules
- Note: Activities at higher levels decompose into Activities at lower levels. Examples at each level serve as both documentation and tests.

**Model**
A formal representation of some aspect of the system using a specific modeling approach. Models are artifacts of standard model types (data structure, workflow, state machine, UI layout, formal logic, etc.) drawn from a library.

- Has: name, model type (from library), definition (DSL or diagram), description
- Links to: Requirements, Activities, Domain Types, Components
- Note: The model library provides standard types. Agents recommend appropriate models. New model types or extensions are rare and require justification.

**Model Type (Library)**
A reusable modeling approach with an associated DSL or diagram notation. Maintained as a shared library across projects.

- Has: name, description, DSL definition, diagram notation, tooling support
- Examples: Entity-Relationship, State Machine, Workflow/Process, UI Layout, Decision Table, Constraint Network, Data Flow, Sequence/Interaction

### Work Layer

**Work Item**
A unit of work to be performed by a human, agent, or both. Work items are linked to Requirements and scoped by session contracts.

- Has: description, type (feature / fix / refactor / investigation), status, assignee (human / agent), priority
- Links to: Requirements, Examples, Session Contracts

**Session Contract**
An agreement between human and agent before a block of work begins. Defines scope, assumptions, touched modules, stable interfaces, and interaction budget.

- Has: scope description, target Requirements/Work Items, modules affected, assumptions, interaction budget, checkpoint criteria
- Links to: Work Items, Modules, Requirements
- Note: The agent proposes, the human approves/amends. Provides a clear runway for uninterrupted agent work.

### Observation Layer

**Activity Trace**
A recorded execution of an Activity — the primary debugging artifact. Captures component interactions, rule firings, constraint evaluations, state transitions, and asynchronous events. Traces are navigable at different levels of granularity, matching the Activity hierarchy.

- Has: timestamp, activity reference, participants, events (ordered), outcome, duration
- Links to: Activities, Components, Business Rules, Constraints
- Note: Specific in-progress state can be extracted from a trace to replicate in a debug environment

**Environment**
A running instance of one or more Modules — test or production. The system knows about infrastructure topology and can spin up, deploy to, and observe environments.

- Has: name, type (development / test / staging / production), topology, deployed modules (with versions), status
- Links to: Modules, Activity Traces

---

## High-Level Components

These are the major subsystems of the tool itself.

### 1. Project Navigator
The entry point to the information bundle. Provides structured, top-down navigation organized by purpose — not by file system. Different views for different audiences (newcomer orientation, feature planning, work management, operations). Contextual filtering by task, module, or concern.

### 2. Literate Editor
Editing environment for information bundle content — documents with embedded/linked diagrams, literate code, domain type definitions, business rules, examples. Not a traditional code editor: content is rich, multi-modal, and semantically linked. Supports the standard model library DSLs and diagram notations.

### 3. Activity Designer
Visual and textual environment for defining Activities at multiple granularity levels. Shows participants, interactions, decision points, asynchronous flows. Directly linked to Examples that illustrate each activity. Decomposition from high-level system activities down to component-level interactions.

### 4. Example Workshop
Where humans and agents collaborate on specification-by-example. Create, organize, run, and review examples. Examples are grouped by Requirement and Activity. Running examples produces immediate feedback. Failed examples surface linked context: which Requirements, Activities, Rules, and Components are involved.

### 5. Agent Workspace
The collaboration surface for human/agent interaction. Supports session contracts, work item management, and high-value interaction patterns (agent-initiated questions, clarification requests, open question identification). Shows agent progress against contracts. Configurable autonomy levels per scope.

### 6. Build & Validation Engine
Continuous, automatic build and test on every change. Runs examples at all levels, validates constraints and invariants, checks interface contracts between modules. Surfaces results as progress/confidence indicators, not just pass/fail logs. Feeds into activity traces for failed runs.

### 7. Trace Explorer
The debugging environment — reimagined. Navigate activity traces rather than stepping through code. Inspect component interactions, rule firings, constraint evaluations, state at any point. Filter by participant, time range, or concern. Extract state snapshots for replication. Supports asynchronous and concurrent traces.

### 8. Deployment & Operations Console
Manages environments (test, staging, production). Deploys modules, monitors running systems, links operational observations back to Activity Traces and Components. The agent can spin up test environments, run integration tests, and report on operational status.

### 9. Link & Dependency Engine
The connective tissue. Maintains fine-grained links between all entity types. Powers contextual navigation (sidebar, context menus, hypertext links). Supports filtering and querying across the dependency graph. Detects orphaned artifacts (requirements without examples, components without tests).

---

## Core Activities — Candidates for Specification by Example

These are the key workflows the tool must support, defined as Activities. Each needs concrete Examples to serve as both specification and validation.

### A0: Create a New Project
**Participants:** Human, Agent, Project Navigator, Activity Designer, Model Library
**Summary:** Human describes the system's purpose and scale. Agent helps structure top-down: system boundaries and context first, then actors and high-level activities, then interfaces, modules, components. At each level, appropriate Models are selected from the library. The result is a navigable project skeleton — an information bundle with structure and intent before any implementation.
**Key questions to explore via examples:**
- How does the flow differ for a single-function app vs. a distributed multi-module system?
- How does the agent suggest appropriate models and decomposition strategies based on scale?
- What's the minimum skeleton that's useful — when do you stop structuring and start specifying?
- How does the agent help identify actors and system boundaries from a loose description?
- At what point do Examples enter the process — at the system level, module level, or both?

### A1: Define a New Feature
**Participants:** Human, Agent, Project Navigator, Example Workshop
**Summary:** Human describes intent. Agent helps formalize as Requirements with Domain Types. Together they create Examples that define done. Work Items are created.
**Key questions to explore via examples:**
- What does the interaction look like when the human's intent is ambiguous?
- How does the agent suggest relevant existing Domain Types and Models?
- What's the minimum viable set of Examples before work begins?

### A2: Negotiate a Session Contract
**Participants:** Human, Agent, Agent Workspace
**Summary:** Agent proposes a contract for a Work Item: scope, modules affected, assumptions, interaction budget, checkpoints. Human reviews and amends. Agent begins work on approval.
**Key questions:**
- How does the agent determine what assumptions to surface?
- What happens when the agent discovers mid-work that an assumption was wrong?
- How are checkpoints defined — by time, by milestone, by confidence?

### A3: Agent Implements a Feature
**Participants:** Agent, Build & Validation Engine, Example Workshop
**Summary:** Agent works through a contracted scope: creates/modifies Components, Activities, Business Rules. Continuously validated against Examples and Constraints. Agent identifies open questions and asks high-value questions within interaction budget.
**Key questions:**
- How does the agent decide to ask a question vs. make an assumption?
- What does "progress" look like — is it example pass rate? Module completeness?
- How does the agent handle a cascade of test failures?

### A4: Human Reviews Agent Work
**Participants:** Human, Project Navigator, Link & Dependency Engine
**Summary:** Human reviews changes organized by intent (Requirement/Work Item), not by file. Sees linked Examples (passing/failing), affected Activities, confidence indicators. Can drill from high-level summary to specific component changes.
**Key questions:**
- What's the default view — summary by requirement, or something else?
- How does the human efficiently verify that nothing unexpected changed?
- What does "approve" mean — merge, deploy to test, or something richer?

### A5: Debug a Failing Scenario
**Participants:** Human, Agent, Trace Explorer, Example Workshop
**Summary:** An Example fails. Human or agent opens the Activity Trace. Navigates the interaction at the appropriate level — component interactions, rule firings, state transitions. Extracts state for isolated reproduction. Agent can suggest hypotheses based on trace analysis.
**Key questions:**
- How does the trace handle asynchronous and concurrent interactions?
- What does "extract state for reproduction" look like concretely?
- How does the agent explain declarative execution (rule/constraint evaluation) in human terms?

### A6: Integrate Modules into a System
**Participants:** Human, Agent, Build & Validation Engine, Deployment & Operations Console
**Summary:** Integration is top-down: the system's Activities and interface contracts define how modules compose, and integration tests are derived from system-level Examples. Modules with declared interface contracts are composed according to the system design. Contract mismatches are surfaced with links to both sides. Agent resolves or escalates.
**Key questions:**
- How are interface contracts defined and versioned?
- What does a contract mismatch look like in the UI?
- Can the agent autonomously resolve simple contract mismatches (e.g., added optional field)?
- How does the system-level Activity model guide integration sequencing?

### A7: Deploy and Observe
**Participants:** Human, Agent, Deployment & Operations Console, Trace Explorer
**Summary:** Module or system is deployed to an environment. Operational activity traces are captured. Anomalies are linked back to Components, Activities, and Business Rules. Agent can correlate operational issues with recent changes.
**Key questions:**
- How does the system distinguish expected vs. anomalous behavior in production?
- What's the workflow for "this production trace looks wrong — help me understand it"?
- How does rollback work?

### A8: Incombobulate an Existing Codebase
**Participants:** Human, Agent, Project Navigator, Link & Dependency Engine
**Summary:** An existing codebase is analyzed and imported into the information bundle structure. Agent identifies implicit domain types, component boundaries, activities, and business rules. Human validates and corrects the agent's interpretation. The result is a structured project that can be navigated and evolved using the full toolset.
**Key questions:**
- What's the analysis strategy — static analysis, test execution, both?
- How does the agent surface its confidence level in inferred structure?
- What's the minimum viable import — can you incombobulate incrementally (one module at a time)?
- How does the agent handle codebases with poor separation of concerns?

### A9: Agent Responds to a User Change
**Participants:** Human, Agent, Link & Dependency Engine, Build & Validation Engine
**Summary:** The human directly edits any artifact in the project bundle — code, documentation, examples, domain types, business rules, models. The change attracts agent attention. The agent analyzes the change, its intention (inferred from context and the dependency graph), and its effects across the project. The agent initiates a high-value conversation: discusses what it thinks the human intended, identifies downstream impacts, surfaces broken invariants or failing examples, and proposes follow-up work items if needed. The human remains empowered — the agent supports and advises rather than gatekeeping.
**Key questions:**
- How does the agent infer intent from a raw edit? Does it use the dependency graph, recent conversation, active work items?
- What's the threshold for agent engagement — every keystroke, every save, every committed change?
- How does this interact with the build engine — does the agent wait for build results before engaging, or respond immediately with structural analysis?
- How does the agent distinguish between exploratory edits (the human is trying something) and deliberate changes (the human knows what they want)?
- What if the human disagrees with the agent's assessment of downstream impact?

---

## Design Decisions

### Identity and Storage
A structured database tracks fine-grained entities and their links natively. This is essential for the rich querying, contextual navigation, and dependency tracking that the information bundle requires. A canonical Git import/export provides an exchange mechanism for duplicating projects outside the toolset, but Git is not the primary storage model.

**CQRS architecture:**
- **Write model:** Captures edits, collaboration events, and OT operations.
- **Read models (document-based):** Optimized for distinct access patterns:
  - *Project content:* Optimized for reading the entire project at once into memory.
  - *Agent context, memory, and policy content:* Optimized for selective loading and querying.
- **Vector indexing:** All document read models are vector-indexed so agent content can be loaded and queried selectively by relevance.
- **Dedicated in-memory storage:** While agents are active, their working data lives in dedicated in-memory stores for maximum responsiveness. This includes the current project graph, active context, and working state.

Database technology selection requires review against concrete use cases and activity definitions.

### Multi-User Collaboration
Real-time collaboration is the target — multiple humans and agents coworking on the same artifact in the same branch. This is genuine collaboration, not just data syncing.

The collaboration model includes: cooperative editing on shared backend data/branch, chat between collaborators, presence and focus indicators when users are working on the same or related artifacts (with alerts for related artifact proximity), and OT-based conflict resolution as a fallback when there are conflicts or network latency.

OTs function more like client commands — they get persisted immediately if there is no conflict. A custom OT type system will be built once data types and relationships are finalized, handling semantic operations on structured entities (e.g., "add field to domain type") rather than just text-level transformations. If users want to work in isolation, they explicitly choose to branch; the challenge then becomes merge strategy. The system favors cooperative work as the default and branching as a deliberate choice.

### Model Library
The model library will be developed as a separate project (a modeling framework) and integrated into the platform. Expected standard model types include: UI, data structure/querying, process/workflow, logic and constraint programming, system design and architecture, plus models for some or most of our own domain types. The initial version of the tool may launch with minimal or no model library — the framework can be bootstrapped later and hosted within the tool itself as early as possible.

The platform should ultimately be fully self-hosted and use modeling wherever appropriate — which may be everywhere.

### Agent Protocol
Agent context integrates deeply with the project information model, a persistent memory layer, and a library of standard processes and policies. Three knowledge sources — project, memory, and library — are vector-indexed and continuously integrated into the agent's current context.

**Continuous context compression architecture:**
1. Context and new inputs are broken into semantic chunks.
2. All chunks — current context, new inputs, and chunks from history, memory, and library — are scored for relevance.
3. A low-cost, high-speed agent reassembles scored chunks into a new context optimized for the target agent's current task.
4. All dropped chunks are retained in context history — no information is truly lost.
5. Historical chunks are reintroduced when they become more relevant to a future task.
6. Scheduled offline processing cleans up and consolidates history and memory content.

**Chunk scoring features:**
- Dependency graph distance from current work
- Semantic match to most recent input (user input, planned task, event, etc.)
- Recency
- Frequency of access
- Explicit priority

Tuning the scoring model requires experimentation and evaluation in the live system. A set of test cases will be maintained and run regularly, with an agent scoring the results to measure quality.

Relevance scoring uses dependency graph proximity to current work combined with semantic matching, not just one signal alone.

**Validation approach:** Continuous experimentation. The context compression capability, agent role definitions, and model selection will be continuously improved based on production results and targeted test runs. Experimentation runs to a budget — improvements are prioritized by impact and cost.

**Agent role orchestration:**
Agents are organized into interacting roles providing different perspectives, quality control, and task-specialized models. A supervisor agent coordinates roles, resolves conflicts between them, and escalates to the human when necessary. Some tasks have predefined orchestration processes that define how roles interact for that workflow. Candidate roles include: planning agent (contract negotiation, work decomposition), implementation agent (code and model creation), review agent (evaluation against examples and invariants), and domain agent (model consistency and domain type governance).

### Migration Path (Incombobulation)
A first-class analysis/import process that converts existing codebases into information bundle structure. See Activity A8.

### Incremental Builds
Comprehensive dependency linking and tracking — based on code coverage/code traces, not just declarations — indicates precisely what needs to be rebuilt and which tests need to be rerun. Build/test pipelines halt on error. End-to-end functional tests run only when a module change is complete with all unit tests passing, since all functional tests are represented at the unit level. Agents can submit multiple edits atomically to avoid cascading intermediate failures.

### Serialization and Export
The canonical export format is human-readable files in a folder structure. Links are represented either as hyperlinks within documents (where not too busy) or in accompanying metadata files. The format is human-readable but not necessarily human-editable — the authoritative source is always the structured database. The system can also export as a wiki or static website for read-only browsing of the project bundle.

### Agent Attention Model
Agent attention thresholds are a UX question — different users will have different preferences for how proactively the agent engages. The system needs a tunable model that can adapt per-user, learning from interaction patterns. This is a design and experimentation problem, not an architecture decision to lock in early.

### Self-Hosting
The goal is to finish building this project within the tool itself. Self-hosting timeline needs to be worked out, but the aspiration is to reach a viable self-hosting point as early as possible, then use the platform's own capabilities (including modeling) for all further development.

---

## Open Design Questions

1. **Database technology selection.** Requires review against concrete use cases and activity definitions. Document store with graph capabilities (e.g., SurrealDB, ArangoDB) vs. pure document store with separate graph index? How does the CQRS write model integrate with OTs?
2. **Context scoring model tuning.** What does the initial test case suite look like? How do we measure "better context" objectively — task completion rate, agent question frequency, example pass rate?
3. **Predefined orchestration processes.** Which activities (A0–A9) need predefined multi-agent orchestration vs. ad-hoc supervisor coordination? What's the process definition format?
4. **Agent attention UX.** What are the tunable dimensions — frequency, scope of impact threshold, verbosity? How does the system learn user preferences — explicit settings, implicit feedback, or both?
5. **Self-hosting bootstrap.** What's the minimum viable platform that can host its own development? What are the bootstrap dependencies? What's the sequence — build the editor first, then the navigator, then the agent workspace?
6. **Merge strategy for branches.** When users branch for independent work, how are structured information bundles merged? Semantic merge (understanding domain type changes) vs. OT replay?

---

*This document is the seed of its own information bundle. As we develop Examples for the core Activities, they will become living specifications that drive the tool's own implementation.*
