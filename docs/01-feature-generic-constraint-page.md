# Feature: Generic Constraint Page

## Goal

Provide a generic graphical page where users can define assignment and grouping problems without needing domain-specific terminology, then run the solver and inspect valid solutions.

## Scope

This feature includes:

- creation and editing of items
- creation and editing of groups
- creation and editing of containers
- optional creation and editing of positions
- creation of containment relations
- creation of hard constraints
- creation of soft preferences when supported
- solver execution from the page
- solution display entry point
- validation feedback before and after solve

## Out of scope

This feature does not define:

- wedding-specific wording or workflows
- school-specific wording or workflows
- advanced bulk import UX beyond generic file import/export
- advanced visualization of large result sets beyond the shared solution display feature
- natural-language constraint entry in the MVP

## User stories

- As a user, I want to create generic entities to model my problem without being limited to a specific domain.
- As a user, I want to define membership between entities and groups.
- As a user, I want to define destinations that can receive assignments.
- As a user, I want to define optional positions inside destinations when I need adjacency constraints.
- As a user, I want to define hard constraints such as together, separate, adjacent, and not adjacent.
- As a user, I want to define soft preferences when the solver supports them.
- As a user, I want to validate my model before running the solver.
- As a user, I want to run the solver and see one or more valid solutions.
- As a user, I want to understand when my model is invalid or unsatisfiable.

## Functional requirements

### General page behavior

- The page must allow the user to create a complete problem model from the browser UI.
- The page must edit a normalized project state compatible with the shared core model.
- The page must support both container mode and position mode.
- The page must remain generic in wording and not require domain-specific labels.

### Item management

- The page must allow creating, renaming, and deleting items.
- Each item must have a stable identifier and a user-visible label.
- The page should allow optional metadata fields for future extensibility.

### Group management

- The page must allow creating, renaming, and deleting groups.
- The page must allow assigning items to one or more groups through containment relations.
- The page should show the current members of each group.

### Container management

- The page must allow creating, renaming, and deleting containers.
- In container mode, the page must allow defining container capacity.
- The page should show current occupancy information in solution display contexts.

### Position management

- The page must allow optional position creation.
- Each position must belong to exactly one container.
- The page must allow creating, renaming, and deleting positions.
- The page must allow defining adjacency relations between positions.
- The page must prevent adjacency constraints from being created unless positions exist or a supported transformation strategy is available.

### Constraint management

The page must allow creation and deletion of the following generic relations, subject to solver capability support and semantic validity.

#### Hard constraints

- must share container
- must not share container
- must be adjacent
- must not be adjacent

#### Soft preferences

- prefer share container
- prefer separate containers
- prefer adjacent
- prefer non-adjacent

### Operand support

- The page must support at least item-item relations.
- The page should support group-group relations when semantics are clearly defined by the core model.
- The page must reject or clearly disable unsupported operand combinations.

### Solver execution

- The page must provide a Run button.
- The page must validate the model before invoking the solver.
- The page must pass the normalized model and selected solver options to the solver adapter.
- The page must display solver status such as solved, unsat, timeout, partial, or error.

### Validation feedback

- The page must show validation errors before solve.
- The page should show warnings for unsupported soft preferences or capability mismatches.
- The page should provide enough context for the user to find and fix invalid references or contradictory inputs.

## UX structure

The generic page should be organized as a lightweight board/dashboard workspace rather than as a long stack of unrelated forms.

### Section 1: Workflow command bar

Shows:

- a validate action
- a validate + normalize + solve action
- a reset project action
- short guidance explaining that the user is editing the current in-memory project directly
- simple recognizable icons beside the primary workflow actions when feasible

The workflow controls should live in a sticky command bar that remains visible while the user scrolls through the workspace so core actions stay immediately reachable.

### Section 2: Project summary hero

Shows:

- project name or working title
- current project description
- current mode: container mode or position mode
- counts of items, groups, containers, positions, and total authored relations

This summary should act as a compact dashboard header rather than a dense detail form.

### Section 3: Main workspace boards

The main workspace should keep visible entities on screen while the user edits them.

#### Items board

Allows:

- add item from a nearby creation card
- press Enter in the item label field to add the item immediately
- edit item label inline directly inside the item card
- delete item from the visible card
- keep existing items visible during editing

#### Groups board

Allows:

- add group from a nearby creation card
- press Enter in the group label field to add the group immediately
- edit group label inline directly inside the group card
- delete group from the visible card
- show current members of the group as a quick summary within the card

#### Containers board

Allows:

- add container from a nearby creation card
- press Enter in the container creation fields to add the container immediately
- edit container label inline directly inside the container card
- edit min and max capacity inline within the visible container card
- delete container from the visible card
- show current contained positions inside the container card when present

#### Positions board

Allows:

- add position from a nearby creation card
- press Enter in the position label field to add the position immediately
- edit position label inline directly inside the position card
- delete position from the visible card
- keep positions visible in the same workspace as containers so the structural model stays legible

### Section 4: Sidebar authoring panels

The page should use a sidebar or adjacent control column for authored relations and metadata rather than forcing users to leave the visible entity boards.

#### Project metadata panel

Allows:

- edit title
- edit description
- switch assignment mode

#### Relations and rules panel

Allows:

- add containment relations
- add adjacency relations
- add hard constraints
- add soft preferences with weight
- choose operand kinds and referenced entities from the current project state
- support a group-internal together shortcut for hard and soft same-container authoring, meaning all members of one selected group must or should be together
- trigger add actions with Enter when focus is on a relevant final field in a relation or rule authoring flow

This panel should support authoring new relations while preserving visibility of the existing entity boards.

### Section 5: Lower detail and result sections

Below the workspace, the page may present tabular or list-based sections for:

- containments
- topologies
- hard constraints
- soft preferences
- validation errors
- validation warnings
- normalization summary
- solver result summary

These sections are useful for auditability and debugging even if the primary editing experience is board-oriented.
The displayed relation and rule operands should show the user-visible entity label first, not only the internal identifier.
If a rule was authored as a group-internal together shortcut, the audit table should render that shortcut in readable language rather than as a confusing duplicated group-to-group self-reference.

## Data model usage

This feature must write data using the normalized model defined by `docs/07-feature-domain-model-and-semantics.md`.

### Core entities used

- Item
- Group
- Container
- Position

### Core relations used

- contains(Group, Item)
- contains(Container, Position)
- adjacent(Position, Position)
- mustShareContainer
- mustNotShareContainer
- mustBeAdjacent
- mustNotBeAdjacent
- preferShareContainer
- preferSeparateContainers
- preferAdjacent
- preferNonAdjacent

## Page modes

### Mode A: Container mode

Use when the problem only needs assignment to containers.

UI implications:

- positions section may be hidden or disabled
- adjacency constraints must be hidden, disabled, or rejected
- capacities are defined directly on containers

### Mode B: Position mode

Use when the problem needs topology-based constraints such as adjacency.

UI implications:

- positions section is active
- positions must belong to containers
- adjacency editing is enabled
- same-container constraints are still valid and are interpreted through parent containers

## Validation rules

The page must validate at least the following.

### Basic identity validation

- no duplicate ids
- no duplicate labels where labels are required to be unique
- no empty required labels

### Structural validation

- containment must reference an existing group and item
- position containment must reference an existing container and position
- every position must belong to exactly one container
- adjacency must reference existing positions

### Constraint validity

- hard and soft relations must reference valid operands
- adjacency constraints require position mode or equivalent support
- unsupported operand combinations must be rejected or disabled
- self-relations that are semantically invalid must be rejected
- the group-internal together shortcut must be limited to same-container together semantics unless future semantics explicitly broaden it

### Capacity and assignment validation

- container capacities must be positive integers where required
- direct capacity conflicts should be detected when possible
- obvious unsatisfiable must-share components should be flagged when possible

## Solver capability handling

The page must adapt to the active solver adapter capabilities.

### Required behavior

- Query solver capabilities before enabling advanced options.
- Hide or disable unsupported features when possible.
- If a saved model contains unsupported preferences, show a warning.
- If unsupported hard constraints are present, block solve and explain why.

### Examples

- If soft preferences are unsupported, the page may disable preference creation.
- If adjacency is unsupported, the page may block switching to position mode or show a compatibility warning.

## Solution display integration

The generic page does not need to define the full result visualization, but it must integrate with the shared solution display feature.

The page must pass enough information to display:

- item assignments
- grouping by container
- position assignments when relevant
- scores and violated soft preferences when available
- navigation across one or more returned solutions when multiple solutions exist

## Error and empty states

The page should provide useful empty states.

Examples:

- no items yet
- no containers yet
- no positions defined for position mode
- no constraints yet
- no solution found
- solver unavailable

## Accessibility and usability considerations

- Controls should use clear labels and avoid technical jargon where possible.
- Relation wording should be understandable to non-expert users.
- The page should allow keyboard-friendly data entry.
- Pressing Enter in relevant add-form fields should trigger the corresponding add action when the current authoring control is complete enough to submit.
- Audit tables for relations and rules should show user-visible labels together with stable ids so authored links remain readable and traceable.
- Large lists should remain usable with filtering or grouping.
- Validation errors should point to the relevant section.
- The page should prefer grouped boards, cards, split-pane layouts, and sticky command surfaces over long stacked creation-and-list sections when that improves visibility.
- Users should be able to see existing entities and edit them without losing context or scrolling far away from the edited content.
- Inline editing or side-panel editing should be preferred for common label and capacity updates.
- When multiple solutions are available, users should be able to move between them without losing the grouped assignment view context.

## Technical notes

- This feature should be implemented as a thin UI layer over the shared normalized state model.
- Domain-specific pages should reuse as much of this page logic as possible.
- The page should not encode wedding or school semantics directly.
- The page should support import/export hooks and draft persistence hooks from shared storage modules.

## Acceptance criteria

- A user can create items, groups, and containers from the generic page.
- A user can edit existing items, groups, containers, and positions without navigating far away from the visible entities.
- A user can see created entities in a grouped visual layout instead of only in separated add-form and table-list blocks.
- A user can define containment relations between groups and items.
- A user can submit relevant creation and rule-authoring inputs from the keyboard with Enter.
- A user can work in container mode without defining positions.
- A user can switch to position mode and define positions and adjacency.
- A user can create hard same-container and separation constraints.
- A user can author a shortcut meaning all members of one group must be together.
- A user can author a shortcut meaning all members of one group should preferably be together.
- A user can read relation and rule tables using visible entity labels rather than ids alone.
- A user can create adjacency constraints only when the model supports them.
- A user can create soft preferences when supported by the active solver.
- The page presents validate, validate + normalize + solve, and reset actions in an always-visible command bar.
- The page validates the model before solver execution.
- The page can invoke the solver with the normalized model.
- A user can navigate between multiple returned solutions when the solver provides more than one.
- The page remains generic and does not depend on wedding-specific or school-specific concepts.
