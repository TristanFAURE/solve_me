# Feature: Ranked Solutions and Shared Planning Workflow

## Purpose

This document defines the approved direction for evolving the application from a feasibility-oriented constraint solver into a planning product that can:

- find several valid solutions
- rank solutions with a configurable numeric score
- prefer equitable assignment distributions initially
- return meaningfully different alternatives
- remain usable as a static web application
- present a consistent workflow across the generic, school, wedding, and event staffing pages

This document records the approved workflow. The shared Worker/ranking foundation and Event Staffing migration described below are implemented; later enhancements remain roadmap items where explicitly stated.

## Event Staffing implementation contract

Event Staffing uses the shared Setup, Data, Rules, Review, and Results tabs. Its default explicit solve options are top-K, 10 solutions, 5000 ms, score details enabled, equity 100, preferences 10, targets 20, and diversity enabled with a minimum changed-assignment distance of 2. Every solve passes the current roster IDs as `equityEligibleItemIds` to avoid balancing unrelated generic items.

Results expose selected rank and score, preference/target/equity contributions, per-person counts, search completeness, optimality proof, timeout state, and assignment changes from the previous returned solution. Both slot-centric coverage and person-centric assignment views are retained. The selected solution can be exported using the workbook contract in `docs/10-feature-event-staffing-planner.md`.

Event Staffing uses one workbook preview flow. A full configuration envelope offers explicit full replacement with impact confirmation and an optional preferences-only merge; a legacy Preferences/Slots workbook offers merge only. School and Wedding use the same envelope for full editable configuration replacement while preserving their legacy importers. Selected solved-result exports remain separate. The generic page remains canonical JSON only. Identity order, accepted values, stable slot mapping, security limits, and result export columns are specified in `docs/10-feature-event-staffing-planner.md`.

## Current baseline

The current application already provides:

- a generic project model
- a validate -> normalize -> solve pipeline
- JavaScript and HiGHS WASM solver adapters behind one boundary
- container and position assignment modes
- school, wedding, and event staffing transforms
- weighted assignment, count-target, and pairwise-equity scoring
- canonical or explicitly best-found ranked alternatives with diversity controls
- timeout, progress, cancellation, and partial-result handling in separate module Workers
- shared validation and solution components
- consistent card and hero framing across all use cases, with keyboard-accessible explanatory tooltips for fields whose solver or domain semantics are not self-evident
- static browser execution

The JavaScript repeated-assignment path performs complete or explicitly bounded pair branching. Large supported staffing models use HiGHS WASM with an independently verified greedy incumbent. Target-scale optimization can remain partial or best-found within browser limits, and general relation preferences still lack optimization semantics.

## Architectural invariants

The following rules remain mandatory:

- the core model stays generic
- Group and Container remain distinct
- containment represents membership, not assignment
- domain terminology remains in page and transform layers
- hard constraints define validity
- soft objectives define desirability and never become hard constraints implicitly
- the validate -> normalize -> solve workflow remains intact
- school and wedding behavior must be protected while staffing support evolves
- the application remains deployable as a static web page
- solver-specific implementation details remain behind the adapter boundary

## Event staffing domain direction

Event Staffing remains the domain use case name. Medical terminology is not required in the generic staffing interface.

### Schedule structure

The implemented authoring model is:

```text
Date
  Slot
    Category requirement with min/max staffing
    Category requirement with min/max staffing
  Slot
    Category requirement with min/max staffing
```

Examples of slots include morning, afternoon, evening, night, or any administrator-defined period. Categories remain reusable staffing categories and are not restricted to medical roles.

One date may contain several independently staffed slots. One slot may contain several category requirements.

### Assignment semantics

An assignment conceptually places:

```text
(person, date, slot, category)
```

The initial rule remains:

- a person may be assigned to at most one category in one slot
- a person may be assigned to several slots across the planning period when all hard constraints permit it

### Preference semantics

People provide preferences per slot, not merely per date and not per category.

Initial preference states are:

- prefer
- neutral
- prefer not
- unavailable

The first three states are soft scoring inputs. `Unavailable` is a hard prohibition and must be represented separately from soft preferences in the domain model and user interface.

A slot-level preference is counted once even when the slot contains several categories because one person may occupy at most one category in that slot.

### Implemented migration

The existing internal event structure represents an assignable slot, with date metadata used to group slots in the interface. No separate date entity is currently required.

The transform must continue to compile staffing concepts into generic destinations, exclusions, assignment bounds, fixed assignments, forbidden assignments, and objective terms.

## Solve configuration

The public solver entry point is:

```js
solve(model, options)
```

Implemented core options:

```js
{
  mode: "first" | "topK" | "optimize",
  engine: "auto" | "js" | "highs",
  maxSolutions: 10,
  timeLimitMs: 5000,
  includeScoreDetails: true,
  scoreWeights: {
    equity: 100,
    preferences: 10,
    targets: 20
  },
  diversity: {
    enabled: true,
    minimumAssignmentDistance: 2
  }
}
```

### First mode

- stop after finding the first valid solution
- optimize responsiveness rather than quality
- do not imply that the result is best

### Top-K mode

- return up to `maxSolutions` valid solutions
- rank candidates by configured numeric score
- apply diversity requirements when enabled
- report whether search completed or stopped early

### Optimize mode

- search for the highest-scoring valid solution
- optionally retain other best candidates for comparison
- report whether optimality was proven

## Objective model

The application will initially use a configurable weighted numeric score.

The exact score is the sum of independent objective contributions:

```text
total score = sum(weight * objective contribution)
```

Higher scores are better unless an adapter explicitly documents another direction.

### Initial objectives

The first supported objectives should include:

- assignment preference satisfaction
- deviation from configured person assignment targets
- workload equity across people
- optional per-category target deviation

### Initial equity definition

Equity is the first priority for the staffing use case, expressed through a dominant configurable weight rather than a separate hard rule.

The initial equity penalty should use integer arithmetic and compare assignment counts across eligible people. A suitable first metric is the sum of pairwise absolute workload differences:

```text
equity penalty = sum(abs(assignments(personA) - assignments(personB)))
```

The contribution to the score is the negative weighted penalty.

Later versions may support individual workload coefficients, part-time ratios, unequal targets, night/weekend counters, and other scoped equity measures. These additions must remain generic objective terms or domain-transformed count targets rather than medical-specific core logic.

### Objective-term contract

Each objective term should provide:

- stable identifier
- user-facing description
- configurable integer weight
- completed-solution contribution
- safe optimistic search bound when used for pruning
- per-solution explanation data

Unsupported objective terms must be rejected in optimization mode or reported clearly as ignored. They must never be silently presented as active.

## Diverse top-K solutions

Returning several nearly identical schedules has little planning value. Top-K mode should therefore support assignment-distance diversity.

Initial distance semantics:

```text
distance(solutionA, solutionB) = number of assignment decisions that differ
```

When diversity is enabled:

- duplicate schedules must be removed using a canonical assignment fingerprint
- selected alternatives should satisfy the configured minimum distance when enough candidates exist
- score remains the primary quality measure
- the result must state when the diversity target could not be met

The implementation may generate a larger candidate pool and then select diverse results, or apply diversity constraints during repeated solving. The chosen strategy must be deterministic unless a random seed is explicitly configured.

## Solver search direction

The multiple-assignment staffing path must move from one greedy subset per person to complete or explicitly bounded search.

Recommended search behavior:

- use the current greedy method only to obtain an early valid incumbent
- branch on the most constrained unfilled destination or requirement
- try the most suitable eligible people first
- maintain destination loads, person counts, scoped counts, exclusions, and score contributions incrementally
- include legal optional-unassigned branches where applicable
- prune only with sound feasibility checks and optimistic score bounds
- keep a bounded collection of the best candidate solutions
- stop on completion, configured limit, cancellation, or timeout

The solver must not claim unsatisfiability unless the relevant search space was completed. It must not claim optimality unless the score bound proves that no better valid solution exists.

## Result contract

Solver results should expose enough information to distinguish proven outcomes from best-effort outcomes.

Planned metadata:

- `status`
- returned solutions
- score and objective breakdown for every solution
- runtime
- explored and pruned node counts when available
- `searchComplete`
- `optimalityProven`
- `truncatedByLimit`
- `interrupted`
- `timeoutReached`
- warnings about ignored or degraded behavior

Pre-solve validation failure remains separate from solver status.

## Static web execution

Static hosting remains a requirement.

### Web Worker

Solving runs in a Web Worker so that:

- the interface remains responsive
- solving can report progress
- cancellation and timeout can be implemented cleanly
- the existing JavaScript solver remains usable

Worker messages must contain serializable project, options, progress, result, and cancellation data. No domain-specific UI state should cross the solver adapter boundary.

### WebAssembly

Representative benchmarks demonstrated that the JavaScript repeated-pair search cannot handle the target staffing scale. The implemented HiGHS WASM adapter now handles supported large multiple-container models locally while preserving static hosting.

The adapter preserves the public solver contract, validates unsupported semantics explicitly, returns a verified greedy incumbent before native optimization, and reports partial/best-found results honestly when timeout or unresolved score ties prevent proof.

## Shared application workflow

All planning pages should use the same top-level workflow while preserving domain-specific terminology.

### Workflow tabs

1. Setup
2. Data
3. Rules
4. Review
5. Results

On small screens, these tabs may become a compact step selector. Moving between tabs must not discard unsaved edits.

### Setup

Contains:

- project title and mode
- import or starter-template actions
- shared defaults
- solver configuration when relevant
- save and recovery status

### Data

Contains the primary domain entities and assignments inputs:

- generic items and destinations
- school students and classes
- wedding guests and tables
- staffing dates, slots, category requirements, and people

### Rules

Contains hard constraints, soft preferences, limits, eligibility, exceptions, and advanced settings. Unsupported controls must be disabled or hidden with an explanation.

### Review

Contains readiness and validation information:

- `Not checked`
- `Ready`
- `Needs attention`

Validation issues should use domain language, link to the affected field, and hide technical paths under advanced details.

### Results

Contains solution navigation, score explanations, completeness metadata, comparisons, and export actions. Raw normalized projects and solver JSON belong under Advanced diagnostics.

## Shared ergonomic requirements

### Data safety

- auto-save recoverable drafts locally
- display dirty, saving, saved, and failed states
- confirm before import or load replaces current work
- show impact before cascading deletion
- provide undo for simple destructive actions where practical
- distinguish editable project backups from domain workbook imports and solved-result exports

### Forms

- use explicit labels and field-level errors
- do not silently ignore incomplete submissions
- disable actions only when the reason is visible
- clear dependent values when a controlling type changes
- replace raw identifier entry with searchable entity selectors
- preserve focus and caret across updates

### Accessibility

- identify the active page with `aria-current`
- provide visible `:focus-visible` styles
- announce success with status regions and failures with alert regions
- provide accessible names for repeated edit and remove controls
- provide table captions and valid semantic markup
- avoid relying on color, emoji, hover, or title attributes alone

### Responsive behavior

- keep the primary solve action compact on mobile
- move secondary commands into an overflow menu or non-sticky panel
- replace wide tables with expandable rows or cards where horizontal scrolling is not usable
- retain visible entity identity while scrolling dense matrices
- test at representative phone, tablet, laptop, and desktop widths

## Page-specific direction

### Generic page

- offer starter templates for container and position assignment
- derive available editors from assignment mode and solver capabilities
- use progressive disclosure for advanced constraint families
- replace raw IDs with searchable selectors
- use human-readable rule sentences
- move audit collections, normalization, and raw JSON into Advanced diagnostics

### School page

- use searchable student and class tables
- support multi-row paste and bulk level assignment
- show live finite or unlimited capacity correctly
- add explicit balancing controls when the solver supports them
- disable general preferences until they influence solving
- compare returned plans by class size and configured composition objectives

### Wedding page

- prioritize the guests -> tables -> rules -> results path
- support guest search, bulk entry, and bulk group assignment
- make seat topology table-centric and visual rather than a long seat-card list
- disable unsupported preference behavior
- preview workbook imports before replacement
- clearly separate simple table mode from advanced seat-aware mode

### Event Staffing page

- organize authoring around Dates and slots, Categories and coverage, People, Preferences, and Rules
- provide a person-by-slot preference matrix
- distinguish soft `Prefer not` from hard `Unavailable`
- support category min/max requirements per slot
- show coverage readiness before solving
- compare diverse schedules by score, equity, preference satisfaction, and changed assignments

## Immediate reliability work before redesign

The reliability phase after documentation approval must address these known correctness and data-safety issues:

- fix school preference creation using an undeclared weight value
- fix school aggregate capacity behavior for unlimited classes
- fix duplicate adjacency generation for two-seat wedding tables
- prevent table deletion from leaving orphaned wedding seats
- stop presenting unsupported general preferences as active solver inputs
- add an explicit `Not validated yet` state
- open and focus validation results when validation fails
- confirm before imports, loads, or resets replace existing work
- distinguish validation failure from solver result statuses

These fixes should be small and independently tested before structural UI work begins.

The first approved implementation slice is intentionally narrower: implement only the first four defect fixes in this list and their focused regression tests. Complete the remaining reliability items in a subsequent slice rather than combining them with the solver rewrite or workflow-tab migration.

## Implementation phases

### Phase 0: Documentation

- create this roadmap
- reconcile existing architecture, staffing, solver, result, and testing specifications
- create a resumable status document
- make no application code changes

### Phase 1: Reliability and data safety

- implement the immediate reliability work listed above
- add regression coverage for each corrected defect
- add consistent destructive-action safeguards

### Phase 2: Solver contract and correctness

- implement solve options and configuration validation
- extend result metadata
- replace incomplete multiple-assignment search
- add canonical solution deduplication
- prove behavior against exhaustive tiny-instance oracles

### Phase 3: Scoring and diverse top-K

- add generic objective terms and score breakdowns
- implement initial equity scoring
- add configurable weights
- implement diverse top-K selection
- add comparison metadata

### Phase 4: Shared workflow foundation

- add shared application navigation and workflow tabs
- standardize buttons, fields, panels, alerts, badges, empty states, and result states
- add shared persistence and replacement safeguards
- add focus, announcement, and responsive foundations

### Phase 5: Event Staffing workflow

- introduce date grouping and multiple slots per date
- support category requirements per slot
- implement slot-level preference and hard-unavailability authoring
- add rule and exception editors
- add readiness checks and ranked-solution comparison

### Phase 6: Other page migrations

- migrate Generic
- migrate School
- migrate Wedding
- keep raw technical details under Advanced diagnostics

### Phase 7: Worker and performance

- run solving in a Web Worker
- add progress, cancellation, and timeout behavior
- benchmark representative staffing scenarios
- benchmark HiGHS WASM on representative end-user hardware and retain hard Worker cancellation

## Testing requirements

Every solver-impacting phase must preserve existing school and wedding regressions.

Required additions include:

- exhaustive tiny multiple-assignment oracle tests
- zero, one, and several-solution cases
- strict score ordering and deterministic ties
- solution deduplication and diversity tests
- equity trade-off tests
- timeout and best-so-far metadata tests
- staffing date/slot/category transform tests
- preference versus hard-unavailability tests
- page workflow and destructive-action tests
- keyboard, focus, accessible-name, and status-announcement tests
- responsive checks for dense tables and preference matrices

Performance benchmarks remain opt-in and must not replace correctness tests.

## Acceptance criteria for the documentation milestone

The documentation milestone is complete when:

- this roadmap exists
- existing affected specifications reference the approved direction
- the date -> slot -> category model is explicit
- slot-level preference and hard-unavailability semantics are explicit
- weighted scoring, initial equity, and diverse top-K semantics are explicit
- current limitations are not described as completed features
- a new status document provides an exact restart path
- `status.md` points to the new roadmap and status document
- no source code, tests, dependencies, or runtime configuration are changed
