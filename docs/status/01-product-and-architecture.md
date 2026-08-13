# Product and Architecture Status

## Scope and product idea

The app is a lightweight web application for generic constraint solving with:

- minimal infrastructure
- no database in the MVP
- pure JavaScript/HTML/CSS approach
- a generic core model
- domain-specific pages built on top of that core

Planned pages:

- generic constraint page
- wedding table plan page
- school class creation page

The app lets users define assignment and grouping problems, run a constraint solver, and display one or more valid solutions.

## Core modeling decisions

### Generic core only

Core logic must avoid domain-specific entities such as person, guest, or student.
The generic node types are:

- Item
- Group
- Container
- Position

### Containment semantics

Containment means membership only.
It does not mean assignment.

Example:

- Robert contained in family FAURE

### Group versus Container

These must remain distinct.

- Group = membership and relation propagation
- Container = assignment destination and capacity structure

They must never be merged implicitly.

### Group-level propagation

Example:

- FAURE incompatible with DUPONT

This means every member of FAURE is incompatible with every member of DUPONT.

### Hard constraints versus soft preferences

Hard constraints include:

- must share container
- must not share container
- must be adjacent
- must not be adjacent

Soft preferences include:

- prefer share container
- prefer separate containers
- prefer adjacent
- prefer non-adjacent

Soft preferences are still solver-dependent and are not yet optimized by the first solver.

### Generic adjacency modeling

Adjacency must be modeled generically through:

- Position nodes
- containment of positions inside containers
- adjacency relations between positions

This avoids domain-specific wedding-only logic.

### Assignment modes

Two assignment modes are planned and now supported by the first solver at a basic level:

- Container mode: item assigned directly to container
- Position mode: item assigned to position, and position belongs to container

Position mode is required for adjacency constraints.

## Architecture and module boundaries

For cross-cutting implementation guardrails, testing obligations, and dependency/license rules, also read:

- `docs/09-technical-and-architecture-constraints.md`

High-level `/src` structure:

- `/app`: bootstrap, routing, top-level state
- `/pages`: generic, wedding, school
- `/components`: reusable UI parts
- `/core/model`: normalized generic model only
- `/core/normalize`: preprocessing and solver-ready derivation
- `/core/validate`: validation and capability-aware checks
- `/core/transform`: page/domain mapping logic
- `/solver`: stable solver boundary and adapters
- `/storage`: local drafts, JSON import/export, model versioning
- `/utils`: generic helpers

Important decisions:

- page/domain logic stays out of `/core/model`
- validation and normalization remain separate stages
- solver implementations stay behind `/solver/adapters`
- shared solution rendering should stay reusable across pages

## Solver baseline

The first real solver adapter currently supports:

### Container mode

- capacities
- must-share-container
- must-not-share-container
- multiple solutions up to a configured limit

### Position mode

- one item per position
- must-share-container
- must-not-share-container
- must-be-adjacent
- must-not-be-adjacent

Still not supported by the first solver:

- optimization of soft preferences
- advanced heuristics for large scenarios

## Shared workflow baseline

The main workflow remains:

- validate
- normalize
- solve

This sequence should remain intact.

## Cross-cutting technical constraints reminder

In addition to the product and architecture decisions in this file, future work must also preserve the dedicated technical constraints document, especially for:

- solver-impacting test obligations
- validate -> normalize -> solve separation
- dependency license compatibility with the project MIT license

## Cross-cutting risks

- normalization currently expands some group relations pairwise and may grow large
- contradiction detection is still incomplete for advanced cases
- the current solver is a straightforward backtracking implementation and may need stronger pruning for larger inputs
- soft preferences remain ignored by the first solver
