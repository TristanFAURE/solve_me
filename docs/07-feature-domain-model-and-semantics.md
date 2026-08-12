# Feature: Domain Model and Semantics

## Goal

Define the generic internal language of the application so that all features, pages, and solver adapters rely on the same concepts and the same interpretation of constraints.

## Scope

This document defines:

- the normalized node types
- assignment semantics
- containment semantics
- topology semantics
- hard and soft relation semantics
- propagation rules
- solution semantics
- validation-oriented interpretation rules

## Out of scope

This document does not define:

- final UI layout details
- a specific solver technology
- a specific JSON schema version
- advanced optimization theory
- full natural-language parsing

## Design principles

- Keep the model generic.
- Avoid domain-specific core terms such as person, guest, student, wedding, or classroom.
- Prefer abstract structural concepts such as item, group, container, and position.
- Separate structural relations from assignment constraints.
- Separate hard constraints from soft preferences.
- Keep semantics precise enough for deterministic implementation.

## Core node types

### Item

An `Item` is an assignable entity.

Examples in domain-specific pages:

- guest
- student
- participant
- object

Core meaning:

- an item is what the solver places into a container or position
- each item is typically assigned exactly once unless a future feature states otherwise

### Group

A `Group` is a logical grouping entity.

Examples in domain-specific pages:

- family
- friend group
- cohort
- category

Core meaning:

- a group organizes items
- a group is not itself an assignment destination unless explicitly modeled as a different node kind elsewhere
- group-level relations may propagate to members

### Container

A `Container` is a destination that can receive assignments directly or indirectly.

Examples in domain-specific pages:

- table
- class
- room
- team bucket

Core meaning:

- items may be assigned directly to containers in container mode
- positions may belong to containers in position mode
- same-container logic is defined relative to containers

### Position

A `Position` is a specific assignable slot inside a container.

Examples in domain-specific pages:

- seat
- desk slot
- workstation position
- numbered place

Core meaning:

- items are assigned to positions in position mode
- each position belongs to one container
- topology relations such as adjacency are defined between positions

## Group versus Container

This distinction is fundamental and must remain explicit throughout the project.

### Group

A group is for membership and semantic organization.

Meaning:

- a group collects items under a shared label or concept
- a group is used for containment and relation propagation
- a group does not directly receive assignments in the solution
- a group does not define capacity in the assignment sense unless a future feature explicitly models something different

Typical examples:

- family
- friend group
- cohort
- category

### Container

A container is for assignment and placement.

Meaning:

- a container is a destination where items are placed directly in container mode
- a container is the parent of positions in position mode
- a container may define assignment capacity
- a container is part of the actual solver output because items end up assigned to it directly or indirectly

Typical examples:

- table
- class
- room
- allocation bucket

### Anti-confusion rules

- Being contained in a group does not place an item anywhere.
- Being assigned to a container is part of the solution.
- Group relations usually influence constraints by propagation to members.
- Container relations define placement structure, capacities, and same-container semantics.
- A group answers the question: "who belongs together conceptually?"
- A container answers the question: "where is an item assigned?"

### Example

- Robert contained in FAURE means Robert is a member of the FAURE group.
- Robert assigned to Table-1 means Robert is placed in the container Table-1.

These two statements are not equivalent and must never be merged.

## Structural relations

### Group containment

`contains(Group, Item)`

Equivalent interpretation:

- item is contained in group
- item is a member of group
- item belongs to group

Semantics:

- containment expresses membership only
- containment does not itself imply assignment to any container or position
- containment does not itself imply must-together behavior

Example:

- Robert contained in FAURE

means:

- Robert is a member of the group FAURE

### Container containment

`contains(Container, Position)`

Semantics:

- a position belongs to exactly one container
- the container relation is structural and fixed before solving

Example:

- Seat-1 contained in Table-A

means:

- Seat-1 is one of the positions of Table-A

## Assignment semantics

The model supports two generic assignment modes.

### Container mode

Assignments are of the form:

- `assign(Item, Container)`

Semantics:

- each item is assigned directly to one container
- container-level capacities and same-container constraints apply directly
- adjacency constraints are not valid unless transformed through an explicit extension strategy

Use cases:

- school class assignment
- simple grouping problems
- wedding planning without seat-level adjacency

### Position mode

Assignments are of the form:

- `assign(Item, Position)`

Semantics:

- each item is assigned to one position
- each position belongs to one container
- same-container relations are derived from the parent container of the assigned position
- adjacency and other topology constraints are evaluated using position relations

Use cases:

- wedding tables with seat adjacency
- classroom seating plans
- any layout-sensitive placement problem

## Cardinality assumptions

Default MVP assumptions:

- each item must be assigned exactly once
- each container may receive zero or more items subject to capacity rules
- each position may receive at most one item
- each position belongs to exactly one container
- each item may belong to zero or more groups unless a future restriction says otherwise

If later needed, stricter membership cardinality rules can be added by feature documents.
Multiple group membership is therefore allowed by default, and validation should account for contradictions that may be introduced by overlapping propagated group-level rules.

## Capacity semantics

Capacity constraints apply at container level.

### Direct capacity

`accepts(Container, maxCount)`

Semantics in container mode:

- the number of items assigned directly to the container must not exceed `maxCount`

Semantics in position mode:

- container capacity is typically implied by the number of positions it contains
- explicit capacity may still be kept for validation consistency checks

Optional future extension:

- minimum capacity
- exact capacity
- weighted capacity

## Topology semantics

Topology is generic and independent of any use case.

### Adjacency

`adjacent(PositionA, PositionB)`

Semantics:

- two positions are neighbors according to the modeled topology
- adjacency is a structural relation between positions, not between items
- item-level adjacency constraints are satisfied when the assigned positions satisfy adjacency

Adjacency should normally be treated as symmetric.

Example:

- if Seat-1 is adjacent to Seat-2
- and Robert is assigned to Seat-1
- and Julie is assigned to Seat-2

then:

- Robert and Julie are adjacent in that solution

## Hard constraints

Hard constraints must always be satisfied.
If one hard constraint cannot be satisfied together with the others, the problem is unsatisfiable.

### Must share container

`mustShareContainer(A, B)`

Valid operands:

- item-item
- group-group
- item-group, if supported by implementation

Primary meaning for item-item:

- A and B must be assigned to the same container

Evaluation:

- in container mode: same direct assigned container
- in position mode: parent container of assigned positions must be the same

### Must not share container

`mustNotShareContainer(A, B)`

Primary meaning for item-item:

- A and B must not be assigned to the same container

### Must be adjacent

`mustBeAdjacent(A, B)`

Primary meaning for item-item:

- A and B must be assigned to adjacent positions

Validity condition:

- requires position mode or an equivalent transformation strategy

### Must not be adjacent

`mustNotBeAdjacent(A, B)`

Primary meaning for item-item:

- A and B must not be assigned to adjacent positions

Validity condition:

- requires position mode or equivalent support

## Soft preferences

Soft preferences should be satisfied when possible but may be violated.
They should influence ranking, score, or optimization when the solver supports them.

### Prefer share container

`preferShareContainer(A, B, weight?)`

Meaning:

- prefer A and B to be assigned to the same container

### Prefer separate containers

`preferSeparateContainers(A, B, weight?)`

Meaning:

- prefer A and B to be assigned to different containers

### Prefer adjacent

`preferAdjacent(A, B, weight?)`

Meaning:

- prefer A and B to be assigned to adjacent positions

### Prefer non-adjacent

`preferNonAdjacent(A, B, weight?)`

Meaning:

- prefer A and B not to be assigned to adjacent positions

### Weight semantics

If weights are supported:

- higher weight means stronger preference impact
- the exact optimization semantics depend on solver capabilities and selected strategy

If weights are not supported:

- preferences may be treated as equal-priority penalties

## Hard versus soft precedence

Hard constraints take priority over soft preferences.

If a soft preference conflicts with a hard constraint:

- the hard constraint wins
- the soft preference is considered violated if it cannot be satisfied

Example:

- `mustNotShareContainer(A, B)`
- `preferShareContainer(A, B)`

Result:

- A and B must be separated
- the preference is violated in every valid solution

## Group-level relation semantics

Group-level relations are allowed because groups are first-class nodes.
Their meaning is defined through propagation or equivalent solver-native interpretation.

Default implementation rule:

- group-level relations should be normalized into equivalent member-level relations during preprocessing unless the active solver adapter supports an equivalent native representation
- native support does not change the semantics, only the implementation path

### Group-to-group hard separation

`mustNotShareContainer(Group1, Group2)`

Semantics:

- for every member `x` of Group1 and every member `y` of Group2,
  derive `mustNotShareContainer(x, y)`

### Group-to-group hard togetherness

`mustShareContainer(Group1, Group2)`

Candidate semantics:

- for every member of both groups, all involved items must share the same container

Warning:

- this can easily become unsatisfiable if the combined member count exceeds container capacity
- validation should detect obvious impossible cases when feasible

MVP note:

- this relation is part of the abstract semantics but should not be exposed by default in MVP feature UIs unless a feature document explicitly enables it

### Group-to-group adjacency

`mustBeAdjacent(Group1, Group2)`

This relation is potentially ambiguous at group level.
For MVP, it should either:

- be disallowed, or
- be explicitly defined by a future feature document

Reason:

- pairwise expansion may create unrealistic or impossible requirements

### Group-level soft preferences

Group-level soft preferences may expand to multiple item-level soft preferences.
This can create many derived penalties.

Implementation note:

- feature documents or solver configuration should define whether expanded preferences are unweighted copies, summed penalties, or normalized penalties

## Item-group relations

Item-group relations may be supported later but should be treated carefully.

Example:

- item must not share container with group

Possible semantics:

- the item must not share a container with any member of the group

For MVP, support for item-group relation operands should be explicit and not assumed by default.

## Symmetry and normalization

The following relations should normally be normalized as symmetric:

- mustShareContainer
- mustNotShareContainer
- mustBeAdjacent
- mustNotBeAdjacent
- preferShareContainer
- preferSeparateContainers
- preferAdjacent
- preferNonAdjacent

Normalization should:

- order operands consistently when useful
- remove duplicates
- avoid double-counting the same meaning

## Must-together components

Hard same-container links create equivalence-like components.

Example:

- A must share container with B
- B must share container with C

Derived meaning:

- A, B, and C must all share the same container

Preprocessing should:

- compute connected components of hard must-share-container relations
- use them in validation and solver reduction

Validation benefit:

- a component larger than every available container capacity is immediately unsatisfiable in container mode
- in position mode, a component larger than every container's number of positions is immediately unsatisfiable

## Constraint validity rules

The system should reject or warn about invalid semantic combinations.

Examples:

- adjacency constraints without positions
- adjacency relation referring to containers instead of positions
- position assigned without parent container
- group containment where parent is not a group
- position containment where parent is not a container
- unsupported operand combinations such as ambiguous group adjacency in MVP

## Solver capability interaction

Not every solver will support every semantic feature.

The solver adapter should expose capabilities such as:

- hard constraints supported
- soft preferences supported
- weighted preferences supported
- all-solutions enumeration supported
- adjacency supported
- optimization supported

Fallback policy should be explicit.
Possible behaviors:

- reject unsupported models before solving
- ignore unsupported soft preferences with a warning
- downgrade to hard-only solving mode with a warning

## Execution state semantics

The application must distinguish between pre-solve validation outcomes and solver execution outcomes.

### Validation failure

A validation failure means:

- the model or solver configuration is invalid before solve begins
- the solver is not invoked
- no solver result status should be produced for this case

### Solver execution outcome

Only after validation succeeds may the solver produce statuses such as:

- solved
- unsat
- timeout
- partial
- error

`partial` should be reserved for interrupted execution that still returns usable results.
Limit-based enumeration cutoff should be represented separately through truncation metadata rather than by overloading the meaning of `partial`.

## Solution semantics

A solution is valid if:

- every assignment cardinality rule is satisfied
- every hard constraint is satisfied
- every structural reference is respected
- every capacity rule is respected

A solution may be optimal or non-optimal depending on solver mode.

### In hard-only mode

- any valid solution is acceptable
- enumeration may return one or more valid solutions

### In optimization mode

- each solution may have a score, penalty, or preference-violation summary
- lower penalty or higher score should be interpreted consistently across the application

## Derived solution facts

The application may derive useful facts for display.

Examples:

- items sharing a container
- items adjacent in position mode
- violated soft preferences
- group members distributed across containers

These derived facts are presentation-friendly outputs and should not change the underlying raw assignment semantics.

## Examples

### Example 1: family separation

Input facts:

- contains(FAURE, Robert)
- contains(DUPONT, Jean)
- mustNotShareContainer(FAURE, DUPONT)

Derived semantic effect:

- mustNotShareContainer(Robert, Jean)

### Example 2: hard togetherness chain

Input facts:

- mustShareContainer(A, B)
- mustShareContainer(B, C)

Derived semantic effect:

- A, B, and C form one must-share-container component

### Example 3: adjacency through positions

Input facts:

- contains(Table-1, Seat-1)
- contains(Table-1, Seat-2)
- adjacent(Seat-1, Seat-2)
- assign(Robert, Seat-1)
- assign(Julie, Seat-2)

Derived semantic effect:

- Robert and Julie are adjacent
- Robert and Julie share the same container Table-1

## Acceptance criteria

- The domain model defines item, group, container, and position as the core node types.
- Containment semantics are clearly separated from assignment semantics.
- The model supports both container mode and position mode.
- Same-container and adjacency semantics are defined generically.
- Hard constraints and soft preferences are distinguished explicitly.
- Group-level relations have defined propagation rules or explicit MVP restrictions.
- Must-together transitive behavior is documented.
- Validation failure is clearly distinguished from solver execution outcomes.
- Unsupported or ambiguous combinations are identified for validation.
- The semantics are generic and avoid domain-specific core terminology.
