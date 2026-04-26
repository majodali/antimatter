# Project Context Model

> Status: design draft (2026-04). The primitives are agreed; the
> mechanism (workflow engine integration, UI surfaces, persistence) is
> not yet implemented. This document is the canonical reference for
> what we're building toward.

## Why this exists

Antimatter today has a flat workflow model: rules and resources are
project-scoped, the project deploys to one environment, and "what's
in progress" is implicit (whatever the user happens to be editing).
This worked at M1–M3 scale. It breaks down quickly past it:

- **Multi-env work** wants resource isolation (a "test" env's
  `api-lambda` is not the prod `api-lambda`) without two parallel rule
  trees.
- **Work breakdown** (features, milestones, deliverables) needs
  structure that the IDE understands — not just folders or git
  branches.
- **"What's next / urgent / shippable"** needs a mechanical
  derivation, not the user's memory.
- **Provenance** from a deployed artifact back to "the work that
  produced it" needs first-class links — for incident triage, change
  attribution, and agent reasoning.

The Project Context Model addresses these by making **contexts** the
primary organizing primitive of the IDE. It is also the integration
seam for the sibling projects (OpenContext, SSM, Tautology, Allegro)
that will eventually replace several existing IDE surfaces.

## Primitives

### Context

A named, hierarchical node. Every context has a parent (except the
root). Two flavors:

- **Work context** — represents a deliverable or bounded unit of
  work. Has a derived lifecycle status. Examples: a feature, a
  milestone, a refactor, an investigation.
- **Runtime context** — represents a place where things run. Owns
  deployed resources and the rules that operate on them. No lifecycle
  status; it just exists. Examples: prod, staging, a feature-preview
  environment.

The two flavors share the same underlying tree. They differ only in
which of the layered pieces below they primarily own and how the IDE
surfaces them.

The **root context** is the project itself. Things defined in the
root are visible to every descendant.

### Rule

A workflow primitive: an event predicate plus an action. Defined in a
context; visible to its descendants (which may opt out — see
*Inheritance*). A rule may declare what kinds of resources it expects
(its `expects` contract); see *Dynamic resource resolution*.

### Requirement

A contract referencing rules, tests, constraints, or examples. A
requirement says: "for the containing work context to be done, these
referenced things must succeed." Requirements are the layer above
rules — they decide what *counts* toward shipping.

A requirement does not itself execute; it observes the state of its
referents. A rule that fails a requirement that names it triggers a
status flip on the containing context.

### Resource

A first-class operational entity managed by the IDE: a deployed
Lambda, an S3 bucket, an ALB, a Cognito User Pool, etc. Today these
are tracked in the deployed-resource registry; under the context
model they live in the runtime context that owns them.

Resources carry **provenance**:
```
Resource {
  id, type, name, instance, ...,
  producedBy?: { contextId, commit, requirementIds }
}
```

Provenance enables runtime → work navigation: clicking on a deployed
artifact (or an operational anomaly attributed to it) takes you to
the work context that produced this version, and through it to the
specific commit and requirements being delivered.

## Hierarchy and inheritance

A child context inherits its parent's rules, requirements, runtime
context references, and resources. The child can:

- **opt out** of an inherited requirement (just don't reference it)
- **disable** an inherited rule (`wf.disable(ruleId)` — the rule is
  invisible to that subtree)
- **override** a resource of the same logical name (the
  most-specific binding wins)
- **add** any of the above

There is no "project scope" vs "context scope" distinction in the
mechanism. There is only "what does this context contribute" and
"how do contributions compose along the path to root." Anything
historically called "project-wide" simply lives in the root context.

## Dynamic resource resolution

When a rule references a resource by logical name, the resource
resolves from the **executing context** — walking up the tree from
the context the rule is currently running in, returning the closest
match.

This is **dynamic scoping**, not lexical: the rule's resource
references are resolved at call time against the executing context's
visibility, not at definition time against the defining context's.

Concrete example: `runtime:staging` defines a rule "Health-check the
API Lambda" that operates on a logical resource named `api`. A child
runtime context `runtime:staging-eu` inherits the rule but binds its
own `api` resource (an EU-region Lambda). When the rule fires under
`runtime:staging-eu`, it acts on the EU Lambda. Under `runtime:staging`
itself (no override), it acts on staging's `api`.

This is the same mechanism used by React Context, CSS custom
properties, Common Lisp `defvar`, AsyncLocalStorage in Node, and
OpenTelemetry context propagation. Dynamic scoping has a deserved
reputation for being confusing for general-purpose variables in
ordinary code; for **contextual configuration** it is the correct
tool, because the consumer doesn't (and shouldn't) need to know
which provider will be active at call time.

### Resource contracts

To keep dynamic scoping safe, rules declare what kinds of resources
they expect:

```ts
wf.rule('Health-check', {
  expects: { api: { type: 'aws:lambda' } },
  on: 'schedule:health-check',
  fn: (ctx) => wf.utils.aws.lambda.getConfig(ctx.resources.api),
});
```

The validator checks at context-load time that every descendant's
resource bindings satisfy the contracts of every inherited rule. A
mismatch (e.g., a child binds `api` to an `aws:s3-bucket` instead
of `aws:lambda`) is flagged before the rule ever runs — analogous
to a type error.

### Cross-context invocation

A rule defined in one context can be invoked from another by
emitting an event the rule responds to. There is no special syntax:
the existing `wf.emit` model handles this, with the event-routing
engine resolving which rules match according to the active
context's view (inherited + locally added, minus disabled).

This is the mechanism for things like deploy-from-work-context-to-
runtime-context: the work context's build pipeline emits a
"ready-to-deploy" event; the runtime context's deploy rule
responds. Same primitive, different contexts.

## Lifecycle (work contexts only)

Work contexts have a **status** mechanically derived from
requirement satisfaction. Runtime contexts do not have a lifecycle —
they just exist.

| Status | Meaning |
|---|---|
| `pending` | Declared, not yet eligible for work (e.g., prerequisites unmet) |
| `ready` | Prerequisites met; work can begin |
| `in-progress` | Work has started; some requirements not yet satisfied |
| `done` | All requirements pass; has held green for one full clean cycle |
| `regression` | Was `done`, now a requirement is failing. **Urgent.** |
| `dependent-regressed` | Own requirements still pass, but a depended-on context regressed. **Advisory.** |

State transitions are **observed, not requested**. No agent or user
sets a context's status. A context becomes `done` by virtue of its
requirements passing; it becomes `regression` by virtue of a
requirement starting to fail. This is a deliberate guardrail: the
agent cannot "claim" done; the user cannot mark something done by
fiat.

Requirements changing (added, removed, modified) is itself a
high-visibility event — the contract has shifted, and previously-
done contexts may transition.

## Cross-references

Two directions, both first-class:

**Work → Runtime**: a work context explicitly *targets* a runtime
context for its actions. "Deploy this work to staging." Multiple
work contexts can target the same runtime; one work context can
target several runtimes (e.g., feature → preview env, then prod).

**Runtime → Work**: every deployed resource carries provenance
back to the work context, commit, and requirements that produced
it. Operational signals are navigable to source by clicking through.

These cross-references are NOT structural parent/child relationships
— they are typed links in the dependency graph. The structural tree
is the inheritance hierarchy; cross-references are orthogonal.

## Approval gates

A pattern, not a new primitive. To express "build in work, gate at
runtime, deploy at runtime":

1. The work context defines a build rule that produces an artifact
   and emits a `ready-to-deploy` event.
2. The runtime context defines a gate rule responding to
   `ready-to-deploy` that requires (e.g.) human approval.
3. On approval, the runtime context's deploy rule acts on the
   artifact.

The split across contexts is the point: build concerns belong to the
work; gating and execution concerns belong to where the running
happens. Each side opts in to its own piece. A child runtime context
can disable inherited gates if it legitimately needs auto-deploy
(e.g., an ephemeral preview env).

## Perspectives

The IDE has a single user-selected **perspective** that determines
which axis is primary in the layout:

- **Build perspective** — work context is primary. Selecting a work
  context drives focus across all panels: file tree, build panel,
  activity panel show that context's contents/state. The Operations
  panel filters or highlights runtime contexts targeted by the
  selected work.
- **Ops perspective** — runtime context is primary in the
  Operations panel. Selecting a runtime context drives focus in
  the other panels: work contexts active in that runtime are
  filtered/highlighted in the work-context tree, file tree, etc.

The perspective selector lives in the header. Persistent per user.
At most one perspective is active at a time.

### Focus mechanism (filter vs highlight)

When a perspective focuses other panels on the current selection,
each panel can either **filter** (hide non-matching items) or
**highlight** (visually emphasize matching items, dim the rest).

Defaults:
- Filter for lists/trees (file tree, rule list, work-context tree)
- Highlight for operational state (Operations panel, Activity ticker)

This is a per-user, per-panel preference (settings surface). The
mechanism is described here for completeness; the per-panel toggle
UI is deferred — defaults are sufficient for now.

## Multiple in-progress contexts: the "coalface" view

A project may have many in-progress work contexts at once. A
breadcrumb showing one active path is insufficient.

The **coalface view** lists all *leaf* in-progress contexts (i.e.,
those with no in-progress children — the contexts you can actually
work on rather than just navigate through). Selecting one sets it
as the focus for the build perspective.

A header pill ("Focus: [context name]") shows the current focus,
with one-click access to the coalface for fast switching.

A personal to-do list (open actions assigned to the current user
across all contexts) is a related but distinct lens, deferred for
now.

## Mapping to existing concepts

Where the context model lands relative to today's IDE:

| Today | Under the context model |
|---|---|
| `.antimatter/*.ts` workflow rules | Rules in the root context |
| Deployed-resource registry | Resources of a runtime context |
| Single deployment env (`production`) | One runtime context (the root's only one, today) |
| Operations panel | Surface for the current runtime context |
| Build panel | Surface for the current work context's rules + requirements |
| Test panel | Surface for the current work context's tests (a kind of requirement input) |
| Project / project-id | The root context |
| `.antimatter/config.json` | Root context's configuration |

Nothing in the existing system is invalidated. Everything maps
cleanly onto "the root context did all of this; descendants will
extend it."

## Mapping to sibling projects

The context model is the integration substrate for the sibling
projects:

- **OpenContext** — its `contextId` is exactly our context. PlanDAGs
  are defined within a context, scoped by its visibility. Plan
  execution operates on the executing context's resources. The
  IncorporationResult feeds into the requirement-satisfaction
  derivation for the context's status.
- **SSM** — its Components, Activities, and Examples will populate
  context contents. A work context's content can be authored in
  SSM. Examples become tests/requirements.
- **Tautology** — its execution traces become the substrate for
  the Activity ticker (today) and the Trace Explorer (future).
  Traces are scoped by context.
- **Allegro** — DSL extensions are authored in a context and
  inherited like any other contribution.

None of these are required for the context model to be useful; the
model is designed to plug in coherently as each matures.

## Open questions

1. **Persistence model.** Where do contexts live? Today rules and
   resources live in code (`.antimatter/*.ts`) and in S3
   (`deployed-resources.json`). Contexts probably want a similar
   split: declarations in code, runtime state (status, last-
   evaluation timestamps) in storage. Schema TBD.

2. **Status derivation cadence.** Are statuses recomputed on every
   rule outcome (potentially noisy) or batched (potentially
   stale)? Probably both: continuous for the active context, lazy
   for inactive ones, with explicit invalidation when requirements
   change.

3. **Cross-context dependency graph.** When work context A depends
   on B, where is the dependency declared? In A? In B? Either
   side?

4. **UI surface for the work-context tree.** Sidebar tab? Header
   breadcrumb? Both? The "smallest faithful UI step" question is
   deferred but will need an answer.

5. **How early to enforce resource contracts.** Validation can
   run at context-load time (best UX) but requires every rule to
   declare `expects` — a migration cost. Soft warnings vs hard
   errors during the transition.

6. **Agent participation in contexts.** When an agent works on a
   context, does it create a sub-context for its session? Per
   OpenContext, plans have their own contextId. The relationship
   between a work context's status and an agent-plan's
   contextId nesting is not fully worked out.

These will be addressed as concrete implementation work
forces them.

## Not yet specified

Things deliberately left out of this draft:

- Concrete data model / storage schema
- IDE component hierarchy / specific React layout
- Permission model / multi-user collaboration semantics
- Migration path from today's flat workflow to the context model
- Rule disable / requirement opt-out syntax (`wf.disable(...)`,
  `wf.requirement.exclude(...)` are placeholders)
- The `expects` contract DSL beyond the example shown

Each of these is a separate design surface to be worked out when
implementation begins.
