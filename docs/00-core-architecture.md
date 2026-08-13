# Core Architecture

This document defines the target architecture, core concepts, normalized model, and intended system design.
It describes what the system is and how it is structured.

For implementation guardrails and mandatory engineering rules such as solver-related testing obligations, dependency license checks, and status-update expectations, read:

- `docs/09-technical-and-architecture-constraints.md`

## Vision

Build a lightweight web application that lets users define assignment and grouping problems with simple constraints, run a solver, and explore valid solutions through generic and domain-specific graphical interfaces.

## Product goals

- Keep infrastructure minimal.
- Avoid a database in the MVP.
- Favor pure JavaScript, HTML, and CSS.
- Support both generic and specialized UIs on top of one normalized model.
- Allow hard constraints and, when solver capabilities permit, soft preferences.
- Keep the solver layer replaceable so the project can start simple and evolve later.

## MVP goals

- Generic constraint page.
- Wedding table planning page.
- School class creation page.
- Shared normalized domain model.
- Validation before solver execution.
- Solver execution with a pluggable adapter.
- Solution display for one or more valid solutions.
- JSON import/export.
- Local draft persistence in browser storage.
- Capability-aware UI behavior that enables or disables advanced features based on the active solver.

## Non-goals for MVP

- User accounts.
- Multi-user collaboration.
- Mandatory backend services.
- Persistent cloud storage.
- Large-scale enterprise optimization.
- Full natural-language modeling of constraints.
- Advanced explanation of unsatisfiable problems beyond simple diagnostics.

## Architecture principles

- Frontend-first and static-host friendly.
- No mandatory database.
- One normalized domain model for all pages.
- Domain-specific pages are thin layers over the same core engine.
- Solver integration must be abstracted behind a stable interface.
- Validation and normalization happen before solver execution.
- The model must remain generic and avoid domain-specific entity names such as person, guest, or student in core logic.
- Positional and adjacency logic must be modeled generically through positions and topology relations.

## Recommended technical stack

- HTML, CSS, JavaScript.
- Vite for local development and static build output.
- Browser localStorage for draft persistence.
- JSON import/export for explicit save and restore.
- Static hosting target such as GitHub Pages, Netlify, or Cloudflare Pages.
- Initial solver adapter can be browser-based if feasible.
- Future optional backend solver adapter can be added without changing the UI contract.

## High-level architecture

The application is organized into six main layers.

### 1. UI layer

Responsible for pages, forms, buttons, and display logic.

Examples:

- generic constraint page
- wedding planning page
- school class creation page
- shared editors for items, groups, containers, positions, and relations
- solution browser and score display

### 2. Domain model layer

Defines the normalized concepts used by every feature.

Core concepts:

- items
- groups
- containers
- positions
- containment relations
- topology relations
- hard constraints
- soft preferences
- solver options
- solutions

### 3. Validation layer

Checks that the user input is structurally valid before solving.

Examples:

- duplicate identifiers
- invalid references
- impossible capacities
- cycles or invalid containment shapes if disallowed
- contradictory hard constraints detected early when feasible
- adjacency constraints used without positions

### 4. Normalization layer

Transforms UI-specific input into a solver-ready normalized model.

Examples:

- wedding-specific labels mapped to generic entities
- school-specific labels mapped to generic entities
- group-level constraints expanded to member-level effects when needed
- direct container capacities transformed into positions when required by a positional solver mode
- must-together connected components precomputed for validation and solving

### 5. Solver adapter layer

A stable interface used by the application regardless of the underlying solver.

Possible implementations:

- browser-native JavaScript solver
- WebAssembly solver
- remote API solver

### 6. Persistence and interchange layer

Handles local save/load and portable project files.

Examples:

- localStorage drafts
- import JSON
- export JSON
- optional future shareable URL encoding for small models

## Normalized problem model

Every page must produce the same generic internal representation.

### Project metadata

The normalized project should also include shared metadata used by UI, persistence, and restart flows.

Recommended fields:

- `projectId`
- `title`
- `description?`
- `viewHint?` such as `generic`, `wedding`, or `school`
- `createdAt?`
- `updatedAt?`
- `modelVersion`

`viewHint` is a UI and persistence convenience only. It must not affect the core semantics of the problem model.

### Core node kinds

- `Item`: an assignable entity.
- `Group`: a logical grouping entity used for containment and relation propagation.
- `Container`: a destination that can receive assignments directly or indirectly through positions.
- `Position`: a specific assignable slot inside a container.

### Structural relations

- `contains(Group, Item)` or equivalent membership relation.
- `contains(Container, Position)` for position-aware problems.

### Generic normalized assignment-oriented constraint families

The normalized model may include additive generic constraint families to support domains that compile into assignment facts without introducing domain-specific vocabulary.

Recommended families:

- `assignmentExclusions[]`
  - item-specific forbidden co-assignment between two destinations
- `assignmentCountUpperBounds[]`
  - item-specific maximum count over a generic destination scope
- `fixedAssignments[]`
  - item must be assigned to a specific destination
- `forbiddenAssignments[]`
  - item must not be assigned to a specific destination
- `softAssignmentScores[]`
  - score or penalty applied to assigning an item to a destination
- `softItemCountTargets[]`
  - soft target count for one item over a generic destination scope

These families extend the normalized model without changing the public solver API shape.

### Assignment modes

The system supports two generic assignment modes.

#### Container mode

- each item is assigned directly to a container
- used when only same-container or different-container semantics are needed
- suitable for class assignment, simple grouping, and many generic cases

#### Position mode

- each item is assigned to a position
- each position belongs to a container
- used when adjacency or topology-dependent constraints are needed
- suitable for table seating and other spatial assignment problems

If positions exist for a problem, solving should happen at position level and container membership should be derived from the assigned position.

## Constraint model

The core must distinguish hard constraints from soft preferences.

In addition to relation-style constraints such as same-container and adjacency, the normalized model may include generic assignment-oriented constraint families that remain domain-agnostic.

### Hard constraints

Hard constraints must always be satisfied.

Examples:

- must share container
- must not share container
- must be adjacent
- must not be adjacent
- fixed capacity limits
- fixed assignment restrictions
- assignment exclusions for a specific item across specific destinations
- assignment-count upper bounds for a specific item across a generic scope of destinations
- fixed assignments
- forbidden assignments

If hard constraints cannot all be satisfied, the problem has no valid solution.

### Soft preferences

Soft preferences should be satisfied when possible, but may be violated to obtain valid solutions.

Examples:

- prefer share container
- prefer separate containers
- prefer adjacent
- prefer non-adjacent
- assignment score adjustments for a specific item-destination pair
- assignment-count targets for a specific item across a generic scope of destinations

Soft preferences are only active when the selected solver supports optimization or weighted scoring.

## Containment and propagation

Containment expresses membership in a group. It does not itself assign an item to a container or position.

Example:

- Robert contained in family FAURE

means:

- Robert is a member of group FAURE

### Propagation rule

Group-level constraints may be expanded to member-level constraints.

Default architecture rule:

- group-level relations should be expanded during normalization unless a solver adapter explicitly supports an equivalent native representation
- native solver support is an optimization detail, not a semantic change

Example:

- group FAURE must be separated from group DUPONT

means:

- every member of FAURE must be separated from every member of DUPONT

The same propagation logic can apply to soft preferences and adjacency constraints when semantically valid.

## Topology and adjacency

To support generic notions such as next to, the model must not use domain-specific concepts such as guest or seat-neighbor at dinner.

Instead, the model uses:

- positions
- containment of positions inside containers
- topology relations between positions

### Minimum topology relation

- `adjacent(PositionA, PositionB)`

Then a generic adjacency constraint means:

- two items must be assigned to positions related by `adjacent`

This supports wedding tables, desks, offices, and other layouts without changing the core domain vocabulary.

## Solver abstraction

The application must call the solver through a stable adapter interface.

Suggested interface:

- `getCapabilities()`
- `validateModel(model, options)`
- `solve(model, options)`
- `explainUnsat(model, options)` optional

### Capability reporting

The solver adapter should declare supported features such as:

- hard constraints
- soft preferences
- weighted preferences
- enumeration of all solutions
- optimization mode
- timeout support
- unsat explanation support
- adjacency and positional solving
- per-item assignment upper bounds
- scoped assignment upper bounds
- fixed and forbidden assignments

### Adapter result contract

A solve operation should return:

- status: solved, unsat, timeout, error, partial
- one or more solutions
- score or penalty summary if optimization is used
- runtime metadata
- truncation metadata when result count is limited
- interruption metadata when execution stops early
- warnings about ignored unsupported features

The result contract should distinguish at least:

- `truncatedByLimit`: solving stopped because a configured solution cap was reached
- `interrupted`: solving stopped before full completion
- `timeoutReached`: interruption was caused by timeout

These flags must not be confused with pre-solve validation failures, which should block solving before any solver result is produced.

## Validation and preprocessing

Before solving, the system should perform validation and useful preprocessing.

### Validation examples

- missing node identifiers
- duplicate names or ids
- relation references to unknown nodes
- container with invalid capacity
- position without parent container
- adjacency relation to unknown position
- adjacency constraints used in container mode without a transformation strategy
- group membership referring to non-group nodes

### Preprocessing examples

- derive member-level constraints from group-level relations
- compute connected components of hard must-together relations
- detect impossible must-together component sizes against container capacity
- normalize symmetric relations
- remove duplicate constraints
- build topology graphs for positional solving
- compile domain-specific ordering semantics into generic incompatibility constraints when possible
- derive scoped assignment-count constraints from domain transforms without introducing domain vocabulary into the core model
- build destination scopes used by generic assignment-count bounds or count targets

## Solution model

A solution should be represented in a generic way.

### Required contents

- item assignments
- derived container membership
- derived position assignment when applicable
- score or penalty details when soft preferences are active
- list of violated soft preferences for each solution when available
- metadata such as runtime and solution index

### Display requirements

The UI should support:

- browsing one or many solutions
- grouping assignments by container
- highlighting adjacency-based placements when relevant
- showing optimization score when available
- warning when only the first N solutions are shown

## Persistence strategy

The MVP should avoid a database.

### Local persistence

- auto-save current draft to localStorage
- restore draft on reload when appropriate
- allow explicit clear/reset

### File persistence

- export full project to JSON
- import full project from JSON
- include model version information for forward compatibility

## Performance and safety constraints

Constraint search can grow quickly, especially when enumerating many solutions.

The architecture should support:

- maximum number of returned solutions
- timeout or execution budget
- optional best-solution-first optimization mode
- warning when the problem size is likely to explode
- graceful failure and partial results when supported by the solver

Transforms that expand domain rules into generic incompatibilities or scoped count constraints must be designed carefully because they can increase normalized model size significantly.
+
+## Solver evolution strategy
+
+The solver architecture should evolve by extending the existing solver contract and normalized constraint families rather than by introducing a separate public solver API for each new domain.
+
+Guiding rules:
+
+- preserve the existing public adapter entry points
+- preserve backward compatibility for existing generic, school, and wedding flows
+- keep domain-specific semantics in transform layers whenever possible
+- add new generic constraint families only when a feature cannot be represented cleanly through preprocessing alone
+
+This is especially important for scheduling-oriented domains such as the event staffing planner, where some semantics can be compiled away in transforms while others require richer generic solver support.
+
+### Scheduling-oriented constraints and the generic architecture
+
+For scheduling-style domains built on ordered events and reusable categories:
+
+- event order itself should remain domain-level information
+- transforms may convert ordered-event cooldown rules into generic incompatibility constraints
+- transforms may convert one-assignment-per-event semantics into generic exclusivity constraints
+- the solver may still need generic support for assignment-count upper bounds and soft optimization objectives
+
+This preserves the generic core while allowing the current solver path to grow incrementally.

## Proposed folder structure

```text
/docs
  00-core-architecture.md
  01-feature-generic-constraint-page.md
  02-feature-wedding-table-plan.md
  03-feature-school-class-creation.md
  04-feature-solver-capabilities-and-configuration.md
  05-feature-import-export.md
  06-feature-solution-display-and-scoring.md
  07-feature-domain-model-and-semantics.md

/src
  /ui
  /core
  /solver
  /storage
  /utils
```

## Feature document map

- `00-core-architecture.md`: target architecture, normalized model, and system design.
- `01-feature-generic-constraint-page.md`: generic modeling UI.
- `02-feature-wedding-table-plan.md`: specialized wedding workflow.
- `03-feature-school-class-creation.md`: specialized school workflow.
- `04-feature-solver-capabilities-and-configuration.md`: solver options and capability handling.
- `05-feature-import-export.md`: file and local persistence.
- `06-feature-solution-display-and-scoring.md`: solution browsing and ranking.
- `07-feature-domain-model-and-semantics.md`: formal meaning of model entities and relations.
- `09-technical-and-architecture-constraints.md`: implementation guardrails, mandatory invariants, testing obligations, and dependency/license constraints.

## Evolution strategy

The project should evolve in stages, but the UI and architecture are capability-aware from the start.

### Stage 1

- hard constraints implemented first
- container mode implemented first
- simple solution enumeration
- validation and normalization pipeline in place

### Stage 2

- soft preferences and scoring when supported by the active solver
- positional mode with adjacency when supported by the active solver
- better solution ranking and richer result metadata

### Stage 3

- weighted preferences
- richer topology relations
- optional backend solver integration
- stronger diagnostics and explanations

This means the MVP architecture may expose soft preferences and position mode when the selected solver supports them, while still allowing an incremental implementation plan.

## Acceptance criteria

- A generic internal model exists and is shared by all UI pages.
- The core model uses item, group, container, and optional position concepts rather than domain-specific entity names.
- The architecture supports both container mode and position mode.
- The architecture supports both hard constraints and optional soft preferences.
- Group containment and relation propagation are explicitly defined.
- Adjacency is modeled generically through positions and topology relations.
- The solver is abstracted behind a replaceable adapter interface.
- The MVP does not require a database.
- Persistence is possible through localStorage and JSON import/export.
- The architecture explicitly addresses limits on solution enumeration and solver runtime.
