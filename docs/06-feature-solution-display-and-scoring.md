# Feature: Solution Display and Scoring

## Goal

Provide a shared way to present solver results across the generic page and domain-specific pages, including assignment visualization, solution navigation, optimization scores, and explanations of soft preference violations when available.

## Scope

This feature includes:

- display of one or more returned solutions
- navigation between solutions
- grouped visualization of assignments
- display of position-based assignments when relevant
- display of optimization scores or penalty summaries when available
- indication of violated soft preferences when available
- handling of truncated or partial result sets
- shared presentation behavior across generic and specialized pages
- support for domain-facing solved-result exports such as readable spreadsheets when a specialized page requires them

## Out of scope

This feature does not define:

- the detailed rendering implementation of every page
- advanced diffing between all solutions
- animated visual layouts
- full unsat explanation tooling
- domain-specific custom graphics beyond data the shared layer can expose

## User stories

- As a user, I want to see the assignments produced by the solver in a readable way.
- As a user, I want to browse multiple valid solutions.
- As a user, I want to know whether results are complete or truncated.
- As a user, I want to know which soft preferences were satisfied or violated.
- As a user, I want to see optimization scores when the solver supports them.
- As a user, I want solution presentation to match the terminology of the page I am using while still relying on shared behavior.
- As a user, I want a clear message when no solution exists.

## Relationship to the architecture

This feature consumes the normalized solution structure described in `docs/00-core-architecture.md` and the semantics defined in `docs/07-feature-domain-model-and-semantics.md`.
It must work for:

- generic constraint problems
- wedding seating plans
- school class assignments

## Functional requirements

### Solution status display

The UI must clearly display the solver outcome.

Supported statuses include:

- solved
- unsat
- timeout
- partial
- error

Pre-solve validation failure is not a solver result status and must be presented separately from solver outcomes.
The display must show a short explanation of what the status means.

### Solution list and navigation

- The UI must support showing a single solution or multiple solutions.
- The UI must allow moving between returned solutions.
- The UI should indicate the current solution index and total returned count.
- If solutions are truncated by configured limits, the UI must say so clearly.
- If execution ended early because of interruption or timeout, the UI must distinguish that from limit-based truncation.

### Assignment display

The UI must display item assignments in a readable grouped form.

#### Container-mode display

- show items grouped by container
- show occupancy counts per container when relevant
- show unassigned items only if the model ever allows them in future modes

#### Position-mode display

- show items grouped by container
- show assignments to positions inside each container
- show adjacency-relevant placements in a readable way

### Scoring and optimization display

If optimization or preference scoring is active, the UI must display:

- overall score or penalty value
- indication of how score direction is interpreted if needed
- summary of satisfied and violated soft preferences when available

If the solve mode is hard-only, the UI should not pretend there is a score unless the adapter returns one for another reason.

### Preference violation display

When available, the UI should display:

- which soft preferences were violated
- which were satisfied
- whether violations are weighted or unweighted
- enough context to understand the trade-offs in a solution

## Shared presentation model

The shared solution display should operate on normalized solution data, not page-specific raw structures.

Expected input data includes:

- solution status
- assignment mapping
- derived container grouping
- derived position grouping when relevant
- score or penalty summary
- violated preference list when available
- runtime metadata
- truncation metadata
- interruption metadata
- warnings

## Domain-specific presentation overlays

The shared display logic should support domain-friendly terminology.

Examples:

- generic page: item, group, container, position
- wedding page: guest, family, table, seat
- school page: student, class

This means:

- the underlying display behavior stays shared
- only labels and optional presentation helpers vary by page

## Solution summary section

Each result view should start with a compact summary.

Recommended fields:

- solver status
- number of solutions returned
- current solution position
- runtime if available
- whether optimization was used
- whether results were truncated by limit
- whether execution was interrupted
- whether timeout was reached
- warning count if any

## Detailed assignment section

The main assignment view should show where each item ended up.

### Container grouping

For each container, display:

- container label
- assigned items
- occupancy summary
- optional capacity summary

### Position grouping

When positions exist, display:

- positions within each container
- assigned item per position
- unfilled positions if useful for understanding the layout

## Soft preference section

When soft preferences exist and the solver returns relevant data, show:

- total number of soft preferences
- number satisfied
- number violated
- weighted total or penalty summary when supported
- details of violated preferences

This section should be hidden or collapsed when not relevant.

## Warning and limitation section

The display must show warnings related to execution.

Examples:

- unsupported preferences were ignored
- result count limit reached
- timeout reached before full enumeration
- only partial results available
- score data unavailable with the selected solver

## No-solution and error states

The UI must provide strong fallback states.

### Validation failure state

Show:

- the model could not be solved because validation failed before solver execution
- the relevant validation errors
- guidance to return to the editor and fix the model

### Unsat state

Show:

- no valid solution found
- that the solver completed but found the hard constraints unsatisfiable
- available warnings or hints

### Timeout state

Show:

- timeout occurred
- whether any partial results are available
- suggestion to reduce problem size or increase timeout if appropriate

### Error state

Show:

- a short understandable message
- technical detail only when helpful and safe

## Result count management

The display must account for the fact that full enumeration may be impossible or expensive.

Required behavior:

- show the number of returned solutions
- show whether the total number of possible solutions is unknown
- show whether a configured cap stopped enumeration
- show whether interruption or timeout stopped execution before completion
- support page-by-page browsing or indexed browsing of returned solutions

## Comparison support

MVP comparison can remain simple.

Recommended MVP support:

- move between solutions one at a time
- compare summaries mentally with stable formatting

Possible future extensions:

- side-by-side comparison
- highlight changed assignments between two solutions
- filter solutions by score or rule satisfaction

## Interaction with feature pages

### Generic page

- show assignments using generic labels
- emphasize normalized constraint outcomes

### Wedding page

- show guests by table
- show seats by table when seat-aware mode is active
- show wedding-friendly wording for satisfied or violated preferences
- support a readable solved-result spreadsheet export appropriate for wedding planners and venue coordination

### School page

- show students by class
- emphasize class occupancy and capacity usage
- support a readable solved-result spreadsheet export appropriate for teachers and school staff

## Technical notes

- The display layer should consume a normalized solution DTO or equivalent shared structure.
- Derived display information should be computed in a shared formatter rather than duplicated in each page.
- Score display should remain robust when some adapters return limited metadata.
- Result rendering should be prepared for partial and truncated result sets.
- The display should remain readable for moderate problem sizes and degrade gracefully for larger ones.
- Domain-facing spreadsheet exports should be derived from the same normalized solved result structure so screen display and export stay consistent.

## Acceptance criteria

- The application can display solver status clearly.
- The application can display a single solution or multiple returned solutions.
- Assignments are shown grouped by container.
- Position-based assignments are shown when relevant.
- Optimization score and soft preference summaries are shown when available.
- Limit-based truncation and interruption-based partial results are clearly distinguished.
- Validation failure, unsat, timeout, and error states are clearly distinguished.
- The same solution display behavior can be reused across generic, wedding, and school pages with domain-friendly labels.
- Wedding and school pages can derive readable domain-facing spreadsheet exports from the solved result structure.
