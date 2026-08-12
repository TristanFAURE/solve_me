# Feature: Wedding Table Plan

## Goal

Provide a specialized page for building and solving wedding seating plans using wedding-friendly terminology while relying on the shared generic core model.

## Scope

This feature includes:

- creation and editing of guests
- creation and editing of families or custom guest groups
- creation and editing of tables
- optional creation and editing of seats for adjacency-aware seating
- wedding-friendly relation entry for hard constraints and soft preferences
- solver execution for seating plans
- display of one or more seating solutions through the shared solution display layer
- export of seating results to an easy-to-read spreadsheet format suitable for wedding planners

## Out of scope

This feature does not define:

- invitation management
- RSVP workflow
- menu management
- floor plan drawing tools
- exact geometry-based seating visualization beyond generic seat adjacency modeling
- multi-event planning

## User stories

- As a user, I want to create guests and tables for a wedding.
- As a user, I want to define families or other guest groups.
- As a user, I want to express that some guests must sit together.
- As a user, I want to express that some guests must not sit together.
- As a user, I want to express that some guests prefer to sit together or apart.
- As a user, I want to express adjacency-oriented constraints when seat positions are defined.
- As a user, I want group-level rules such as family separation to apply automatically to all affected guests.
- As a user, I want to run the solver and explore valid seating plans.
- As a user, I want to export a seating plan in a spreadsheet that is easy for a wedding planner, venue, or family organizer to read.
- As a user, I want to understand when no valid plan exists.

## Relationship to the generic model

This page is a domain-specific view over the normalized model.

### Wedding-friendly labels mapped to generic nodes

- Guest -> Item
- Family or guest group -> Group
- Table -> Container
- Seat -> Position

### Wedding-friendly labels mapped to generic relations

- guest belongs to family -> contains(Group, Item)
- must sit at same table -> mustShareContainer
- must not sit at same table -> mustNotShareContainer
- prefer same table -> preferShareContainer
- prefer different table -> preferSeparateContainers
- must sit next to -> mustBeAdjacent
- must not sit next to -> mustNotBeAdjacent
- prefer sit next to -> preferAdjacent
- prefer not sit next to -> preferNonAdjacent

## Functional requirements

### Guest management

- The page must allow creating, renaming, and deleting guests.
- Each guest must have a stable identifier and a visible display name.
- The page may allow optional guest metadata later, but it is not required in the MVP.

### Family and group management

- The page must allow creating, renaming, and deleting families or custom guest groups.
- The page must allow assigning guests to groups.
- The page should support multiple groups per guest if the core model allows it.
- The page should clearly show group membership.

### Table management

- The page must allow creating, renaming, and deleting tables.
- The page must allow defining the number of seats or effective capacity for each table.
- In non-positional usage, the table capacity may be entered directly.
- In positional usage, seat count may be derived from defined seats.

### Seat management

Seat management is optional but required for adjacency-based constraints.

- The page must allow creating seats inside a table.
- Each seat must belong to exactly one table.
- The page must allow defining adjacency between seats.
- The page should support quick creation of a standard round-table adjacency topology when useful.
- The page should still store the resulting structure using the generic Position and adjacent relations.

### Relationship and preference management

The page must present user-friendly wedding terminology while writing generic relations internally.

#### Hard relation examples

- Guest A must sit at same table as Guest B
- Guest A must not sit at same table as Guest B
- Family X must not sit with Family Y
- Guest A must sit next to Guest B
- Guest A must not sit next to Guest B

#### Soft preference examples

- Guest A prefers same table as Guest B
- Guest A prefers different table from Guest B
- Guest A prefers to sit next to Guest B
- Guest A prefers not to sit next to Guest B

### Group-level rules

- The page must support group-group rules at least for same-table separation when supported by the domain semantics.
- Group-level same-table separation must propagate to all group members.
- Group-level same-table togetherness should not be exposed by default in the MVP UI because its semantics can easily create confusing or impossible configurations.
- Group-level adjacency constraints should be blocked or deferred unless explicitly supported by the core semantics.

### Solver execution

- The page must provide a Run button.
- The page must validate the seating model before solve.
- The page must send the normalized problem to the solver adapter.
- The page must display solver status, warnings, and result summaries.

## UI behavior

### Section 1: Wedding summary

Shows:

- project or event name
- number of guests
- number of groups
- number of tables
- whether seats are defined
- validation summary

### Section 2: Guests

Allows:

- add guest
- rename guest
- remove guest
- search guests
- optionally view each guest's group memberships

### Section 3: Families and groups

Allows:

- add family or group
- rename group
- delete group
- add or remove guest membership
- inspect members of each group

### Section 4: Tables

Allows:

- add table
- rename table
- remove table
- set seat count or capacity
- inspect associated seats if seat mode is active

### Section 5: Seats and adjacency

Visible when adjacency-aware seating is enabled.

Allows:

- add seats to a table
- remove seats
- define adjacency between seats
- optionally generate a standard round-table adjacency structure
- review seat topology grouped by table

### Section 6: Seating rules

Allows:

- choose rule type from wedding-friendly labels
- choose guests or groups as operands when valid
- assign optional weight to preferences if supported
- review current rule list
- delete existing rules

### Section 7: Solve and results

Allows:

- run solver
- show busy state
- show solved, unsat, timeout, partial, or error status
- review returned seating solutions via the shared solution display feature

## Modes of operation

### Same-table mode

Use when only table assignment matters.

Behavior:

- guests are assigned directly to tables
- capacities are table capacities
- same-table and separate-table constraints are available
- next-to constraints are disabled

### Seat-aware mode

Use when adjacency matters.

Behavior:

- guests are assigned to seats
- seats belong to tables
- next-to constraints are enabled
- same-table logic is derived from seat parent tables

## Validation rules

The page must validate at least the following.

### Guest and group validation

- guest names required
- group names required
- duplicate identities rejected or warned according to shared rules
- group membership references must be valid

### Table and seat validation

- every table must have a valid capacity or a valid set of seats
- every seat must belong to exactly one table
- seat adjacency must reference existing seats
- seat mode must not be enabled without usable seat definitions
- in seat-aware mode, the effective table capacity is determined by usable seat count
- if explicit table capacity and seat count are both present, they must match or trigger a validation warning or error

### Constraint validation

- same-table constraints require valid operands
- next-to constraints require seat-aware mode
- unsupported group-level adjacency rules must be blocked
- contradictory or obviously impossible hard constraints should be flagged when feasible

### Capacity validation

- total seating capacity should be checked against number of guests
- hard must-sit-together components larger than any table capacity should be flagged when feasible
- contradictions caused by overlapping group memberships and propagated group-level rules should be flagged when feasible

## Solver capability handling

The page must respond to the active solver adapter capabilities.

### Examples

- If soft preferences are unsupported, the preference controls should be disabled or clearly marked unavailable.
- If positional solving is unsupported, seat-aware mode should be unavailable or blocked.
- If all-solution enumeration is limited, the page should communicate that results may be truncated.

## Output expectations

The page must integrate with the shared solution display and provide wedding-friendly presentation.

Expected display options:

- guests grouped by table
- guests grouped by seat when seat-aware mode is active
- score or penalty summary for soft preferences when available
- warnings when only the first N solutions are shown
- easy comparison between seating alternatives if supported later

### Spreadsheet export expectations

The wedding page must provide a spreadsheet export for solved seating plans.
The export should be appropriate for real operational use by wedding planners, families, or venue staff.

Expected spreadsheet characteristics:

- readable without knowing the internal model
- organized with wedding terminology only
- suitable for printing or sharing
- stable enough to be opened in Excel-compatible tools

Recommended export structure:

- one summary sheet with event name, selected solution number, and solver status metadata when useful
- one main seating sheet listing each table and its assigned guests
- in seat-aware mode, seat labels should appear clearly beside guest names
- optional additional sheet for unassigned guests or warnings if such states are ever supported

Recommended columns for the main seating sheet:

- Table
- Seat when relevant
- Guest
- Family or group labels when helpful
- Notes if the domain later introduces planner-facing annotations

The wedding spreadsheet export should prioritize clarity over full technical traceability.
It should not expose generic terms such as Item, Group, Container, Position, constraint kind, or preference kind.

## Technical notes

- This feature must remain a thin specialization over the generic model.
- Wedding-specific wording belongs in the UI only.
- Family semantics are modeled using generic Group nodes.
- Guests may belong to multiple groups if the core model allows it, and the UI should make those memberships visible.
- “Sit next to” must be implemented through seat Positions and adjacency relations, not through custom wedding-specific solver logic.
- Standard seat-layout helpers may exist, but they must generate generic Position and adjacent data.

## Acceptance criteria

- A user can create guests, groups, and tables from the wedding page.
- A user can assign guests to families or custom groups.
- A user can define hard same-table and separate-table rules using wedding wording.
- A user can define soft table preferences when supported by the solver.
- A user can enable seat-aware mode and define seat adjacency.
- A user can define next-to and not-next-to rules only when seat-aware mode is active.
- Group-level separation rules propagate consistently through the normalized model.
- The wedding page writes data using the generic core model rather than custom wedding-only structures.
- The page can invoke the solver and display one or more seating plans.
- The page can export a solved seating plan to a readable spreadsheet format suitable for wedding planners.
