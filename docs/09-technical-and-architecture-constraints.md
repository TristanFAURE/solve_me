# Technical and Architecture Constraints

This document defines cross-cutting implementation constraints that must be preserved across the project.
It complements `docs/00-core-architecture.md` and the architecture status documents by stating the mandatory engineering rules that apply while implementing and evolving the system.

Use the split as follows:

- `docs/00-core-architecture.md` defines the target architecture, normalized model, concepts, and system design
- this document defines the implementation guardrails that must not be violated while changing that architecture or building on top of it

## Purpose

Use this document as the canonical reference for:

- architectural invariants that must not drift during implementation
- testing obligations for solver-related changes
- dependency and license constraints
- cross-cutting engineering guardrails

## Architectural invariants

The following constraints are mandatory implementation invariants.
They do not redefine the architecture document; they constrain how it may be implemented and evolved.

### Generic core model only

The core model must remain generic.
Do not introduce domain-specific entities or semantics into the generic core.

Examples of domain-specific vocabulary that must stay out of the generic core:

- guest
- student
- family
- classroom
- wedding-only seat semantics

Domain-specific wording belongs in page-specific UI and transform layers.

### Group and Container must remain distinct

Group and Container represent different concepts and must not be merged.

- Group = membership and relation propagation
- Container = assignment destination and capacity structure

Do not encode assignment by using Group.
Do not encode membership by using Container.

### Containment means membership, not assignment

Containment expresses membership only.
It must not silently imply assignment.

If assignment is needed, it must be represented through the solving model:

- item to container in container mode
- item to position, and position to container, in position mode

### Adjacency must stay topology-based

Adjacency must be modeled through generic topology structures, not through domain shortcuts.

Use:

- Position nodes
- containment of positions inside containers
- adjacency relations between positions

Do not introduce wedding-specific adjacency logic into core semantics or solver contracts.

### Hard constraints and soft preferences must remain distinct

Hard constraints and soft preferences are different concepts and must not be conflated.

- hard constraints define validity
- soft preferences define desirability

A solver may ignore unsupported soft preferences, but it must not silently reinterpret them as hard constraints.

### Preserve the validate -> normalize -> solve workflow

The main workflow must remain:

- validate
- normalize
- solve

Validation and normalization must remain separate concerns.
Do not push normalization logic into UI code.
Do not bypass validation when adding new solving paths.

### Keep domain logic out of core model modules

The following boundary must be preserved:

- domain/page-specific logic belongs in `/src/pages` and `/src/core/transform`
- generic modeling belongs in `/src/core/model`
- generic preprocessing belongs in `/src/core/normalize`
- validation belongs in `/src/core/validate`
- solver contracts and implementations belong in `/src/solver`

Do not leak page-specific assumptions into generic core modules.

## Testing constraints

### Solver-impacting changes require tests

Any change that can affect solver behavior must add or update automated tests.

This includes changes to:

- solver adapters and search logic
- solver input contracts
- normalization that affects solver-ready data
- validation rules that change what reaches the solver
- constraint semantics or interpretation
- solution interpretation or shared solver-facing helpers

At minimum, each solver-impacting change must:

- add new tests for new behavior, or
- update existing tests to reflect an intentional semantic change, and
- preserve regression coverage for previously supported behavior

### Relevant existing tests must be run and pass

Work that affects solver behavior is not complete until the relevant existing test suite has been run and passes.

At minimum, verify the impacted automated tests pass before finishing.
When the change is broad, run the wider test suite.

### Prefer regression-style tests for bug fixes

When fixing a solver, normalization, or validation bug, first capture the bug with an automated regression test whenever practical.
Then implement the fix.

## Dependency and license constraints

### MIT license compatibility is required

This project is MIT-licensed.
Any newly added dependency must have a license that is compatible with use in an MIT-licensed project.

Before adding a dependency, verify:

- the dependency license is clearly identified
- the license is compatible with the project’s MIT distribution model
- any required notices or attribution obligations are understood

### Do not add dependencies without justification

Prefer the existing stack unless a new dependency provides clear value.

A new dependency should only be added when it has a concrete benefit such as:

- substantial implementation simplification
- correctness or safety improvements
- strong ecosystem support for a needed capability
- maintainability gains that outweigh added project surface area

### Prefer low-friction dependencies

When a dependency is necessary, prefer packages that are:

- actively maintained
- well understood
- lightweight relative to the need
- easy to audit
- compatible with the current toolchain

## Change management constraints

### Update status documents after meaningful actions

After any meaningful action, update:

- `status.md`, and
- the relevant `docs/status/*.md` file(s)

A meaningful action includes architecture decisions, implementation changes, new documents, structural changes, and discovered blockers.

### Keep master status concise

`status.md` must remain concise.
Detailed technical rationale should live in dedicated documents such as this one or the relevant sub-status files.

## Practical usage rule for future agents

When working on architecture, solver behavior, validation semantics, normalization semantics, or dependency additions:

1. read `status.md` first
2. read `docs/status/01-product-and-architecture.md`
3. read this file
4. then read the concrete implementation files related to the task

When finishing such work, update the relevant status files accordingly.
