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
- The page must not imply that groups are family-only; planners must be able to use groups for families, friend circles, bride-side or groom-side subsets, colleagues, wedding party subsets, or any other overlapping planner-defined category.
- The page should explicitly support layered membership examples such as one guest belonging both to a family group and to a custom social group.
- The wedding rule and preference sections should support a dedicated single-group option such as “Keep this group together”, where the planner selects only one group.

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
- The page must provide a bulk action to generate seats for all tables from table capacities when seat-aware mode is active.
- The page must also support per-table generation so planners can regenerate one table without replacing every other table.
- Generated seats should use domain-friendly generic labels derived from the table name plus a 1-based index.
- Tables should expose a planner-facing shape setting such as round, square, or rectangle.
- In the MVP, round, square, and rectangle may all generate a perimeter-ordered ring topology, while preserving the chosen shape metadata for later display improvements.
- Before bulk generation runs, the page must warn clearly that all existing seats will be deleted and recreated.
- Before per-table generation runs, the page must warn clearly that the current seats and seat topology for that table will be replaced.
- The page should support quick creation of a standard round-table adjacency topology when useful.
- The page should still store the resulting structure using the generic Position and adjacent relations.
- Manual seat adjacency authoring in the wedding UI should currently remain table-scoped so planners do not accidentally create cross-table “next to” links.
- Generated seats should record enough page-facing metadata to preserve stable generated order for later left/right editing in the wedding UI.
- After generation, the planner must be able to remove the generated left adjacency, the generated right adjacency, or both around a seat without deleting the seat itself.
- Removing one or both generated adjacencies must not automatically reconnect surrounding seats.
- If a planner deletes a seat entirely after generation, the seat and its adjacency links should be removed without silently closing the resulting gap.
- The seat list should use a compact display suitable for large weddings such as 100 to 200 guests, with denser cards and shorter metadata labels so many seats remain scannable.

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
- The wedding page may expose a group-internal same-table together shortcut directly inside the group editing card, meaning all members of that one group must or should sit together.
- That shortcut should be represented readably in the wedding rule tables rather than as a confusing group-to-itself raw relation.
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
- understand that the same guest may appear in several groups at once
- manage group membership inside the group card
- use the seating rule and preference sections to add a dedicated one-group `Keep this group together` rule or preference
- use wording and helper text that make custom overlapping groups feel natural, not exceptional

### Section 4: Tables

Allows:

- add table
- rename table
- remove table
- set seat count or capacity
- choose a shape such as round, square, or rectangle
- inspect associated seats if seat mode is active
- generate seats and default topology for one table at a time when needed

### Section 5: Seats and adjacency

Visible when adjacency-aware seating is enabled.
Placed after the main authoring and result sections so seats do not dominate the top of the page.

Allows:

- add seats to a table
- remove seats
- generate seats for all tables from current table capacities
- generate seats and topology for one selected table only
- warn that bulk seat generation replaces all currently defined seats
- warn that per-table generation replaces the current seats and topology for that table
- define adjacency between seats
- add arbitrary manual seat-to-seat adjacency links within a table after generation or manual seat creation
- optionally generate a standard round-table adjacency structure
- review seat topology grouped by table
- remove generated left adjacency, generated right adjacency, or both around a seat while keeping the seat itself in place
- see clearly when a generated topology has been adjusted manually and now contains open gaps
- add a custom same-table seat adjacency without regenerating the whole table

### Section 6: Seating rules

Allows:

- choose rule type from wedding-friendly labels
- choose guests or groups as operands when valid
- assign optional weight to preferences if supported
- review current rule list
- delete existing rules
- express layered planning logic such as one custom group needing a dedicated table while a family group is only preferred to stay together
- use a two-line authoring layout for both hard rules and soft preferences:
  - first line = rule or preference kind
  - second line = options
- in this wedding page layout, the options row should use grouped selection rather than labeled left-side and right-side wording
- the grouped selection row should keep the paired selectors visually together because planners think in terms of one pairing rather than two distant sides
- changing Guest versus Group must immediately refresh the matching selector options so the effect is visible without extra interaction
- when the planner selects `Keep this group together`, the options row should switch to a single group selector instead of a two-operand selector

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
- bulk seat generation requires every table to have a positive maximum capacity
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
- A user can assign one guest to multiple overlapping groups such as a family and a groom-side friend group.
- A user can define hard same-table and separate-table rules using wedding wording.
- A user sees both “Must work this way” and “Prefer if possible” authoring areas with a first-line rule selector and a second-line grouped options row.
- A user can define soft table preferences when supported by the solver.
- A user can enable seat-aware mode and define seat adjacency.
- A user can choose a planner-facing table shape such as round, square, or rectangle.
- A user can generate seats for all tables from table capacities after acknowledging that existing seats will be deleted and recreated.
- A user can generate seats and default topology for one table only after acknowledging that the table's current seats will be replaced.
- A user can review seats in a compact display that remains usable for large weddings with many tables and guests.
- A user finds the seats panel after the main wedding editing and result areas, so detailed seat management does not clutter the top of the page.
- A user can remove the generated left adjacency, right adjacency, or both for a seat without deleting the seat itself.
- A user can add a custom same-table seat adjacency after generation or after manual seat creation.
- A user can delete a generated seat without the app silently reconnecting its former neighbors.
- A user can define next-to and not-next-to rules only when seat-aware mode is active.
- Group-level separation rules propagate consistently through the normalized model.
- A planner can add a hard `Keep this group together` rule from `Must work this way` by selecting a single group, and that shortcut propagates through the normalized model.
- A planner can add a soft `Keep this group together` preference from `Prefer if possible` by selecting a single group, and that shortcut propagates through the normalized model.
- The wedding page writes data using the generic core model rather than custom wedding-only structures.
- The page can invoke the solver and display one or more seating plans.
- The page can export a solved seating plan to a readable spreadsheet format suitable for wedding planners.
