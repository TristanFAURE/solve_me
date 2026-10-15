# Project Status

## Purpose of this file

This is now the master status file.
Read this file first in a new context.
It is intentionally concise and points to more specific sub-status files so an LLM can read only the most relevant context instead of loading one very large file.

## Status maintenance rule

Every future agent working on this project must:

- update `status.md` after each meaningful action
- update any relevant `docs/status/*.md` sub-status files when the change is domain- or area-specific
- keep this master file concise
- prefer adding detail to the most relevant sub-status file rather than growing this master file indefinitely

A meaningful action includes:

- creating a new document
- editing an existing specification
- making an architecture decision
- implementing a feature
- changing the project structure
- identifying a blocker or open question

## How to use the split status structure

Always read `status.md` first.
Then choose only the relevant sub-status files.

### Core sub-status files

Also read this dedicated cross-cutting constraints document when the task touches architecture, solver behavior, validation/normalization semantics, or dependency additions:

- `docs/09-technical-and-architecture-constraints.md`
  - read for technical guardrails, solver-related testing obligations, and dependency/license constraints

- `docs/status/01-product-and-architecture.md`
  - read for product scope, core semantics, architecture boundaries, solver baseline
- `docs/status/02-generic-page.md`
  - read for generic editor, storage/import/export, shared solution UI
- `docs/status/03-school-page.md`
  - read for school semantics, transform rules, Excel import/export, school validation
- `docs/status/04-wedding-page.md`
  - read for wedding semantics, topology generation, seat-aware solving, wedding UI decisions
- `docs/status/05-recent-work-and-next-steps.md`
  - read for the latest completed step, immediate next steps, and current risks
- `docs/status/06-ranked-solutions-and-ui-plan.md`
  - read for the approved ranked-solution roadmap, shared workflow direction, Event Staffing slot semantics, and exact next implementation slice

## Current project stage

The app now has:

- a generic core model
- validate -> normalize -> solve workflow
- a real generic editing page
- a real school page with `.xlsx` import/export
- a real wedding page with seat topology authoring
- a real Event Staffing page with repeated-assignment transforms and schedule-oriented results
- a first solver adapter that supports:
  - container mode
  - position mode
  - adjacency hard constraints
- a HiGHS WASM MILP adapter for large supported repeated-assignment staffing models
- shared solution display components
- GitHub Pages deployment already configured and working

## Highest-priority current task

Current recommended next work:

- run the committed Playwright suite in an environment with Chromium system libraries and complete manual desktop/mobile verification
- validate target-scale HiGHS schedules and optimization quality on representative end-user computers
- evaluate replacement or isolation options for the existing `xlsx` dependency, which has unresolved upstream advisories

## Key invariant decisions

Preserve these project rules:

- the core model must remain generic
- Group and Container are distinct and must not be merged
- containment is membership, not assignment
- adjacency is modeled through positions and topology, not domain-specific logic
- hard constraints and soft preferences remain distinct
- specialized pages should use domain-facing wording while mapping internally to the generic core
- do not propose browser tests using `jsdom` or any other browser-test technology unless the user explicitly asks for that approach

## Latest update

- fixed Event Staffing requirement submission so the selected group and visible min/max values are read atomically when Add is clicked
- implemented the reliability fixes, ranked weighted solving, diverse top-K alternatives, and explicit completeness/optimality metadata
- moved browser solving to a module Web Worker with progress, cancellation, timeout, partial results, and search guidance
- migrated Generic, School, Wedding, and Event Staffing to the shared Setup/Data/Rules/Review/Results workflow
- added versioned local draft recovery and full-fidelity configuration workbook flows for specialized pages
- implemented Event Staffing date/slot migration, category requirements, preferences, unavailability, assignment rules, cooldowns, and ranked schedule results
- bounded solver candidate retention and hardened autosave and workbook handling during final review
- measured Event Staffing through the 180-day x 10-slot x 200-doctor one-category lower bound; preprocessing is safe, but 30-day x 10-slot x 200-doctor search timed out after three nodes and target search was stopped by the pair-work safety gate
- added configurable benchmark dimensions, isolated process/heap limits, internal/external timeouts, phase timings, model/heap metrics, and generator dimension tests
- changed the Event Staffing preference workbook to a planner-friendly two-row date/slot matrix with stable slot-ID mapping and legacy import compatibility
- moved browser workbook parsing to a dedicated module Worker and added Playwright coverage for all workflows and target viewport widths
- aligned Vite with Vitest's supported Vite 8 peer range; production dependency audit now reports only the accepted `xlsx` advisory
- added automatic Worker-hosted HiGHS WASM solving with sparse assignment variables, verified greedy incumbents, hard cancellation, and honest best-found/canonical ranking metadata
- measured the 180-day x 10-slot x 200-doctor lower bound at 360,000 theoretical pairs: a verified partial schedule is returned locally, while optimality remains unproved within a 20-second budget

See `docs/status/05-recent-work-and-next-steps.md` and `docs/status/06-ranked-solutions-and-ui-plan.md` for implementation detail and residual risks.

## Restart prompt for a new context

Use this prompt in a fresh context:

```text
Read `status.md` first.
If the task touches architecture, solver semantics, validation/normalization semantics, or dependency additions, also read `docs/09-technical-and-architecture-constraints.md`.
Then read only the relevant files from `docs/status/` based on the task:
- architecture/core model/solver: `docs/status/01-product-and-architecture.md`
- generic page/storage/shared solution UI: `docs/status/02-generic-page.md`
- school page/import-export/validation: `docs/status/03-school-page.md`
- wedding page/topology/seat-aware solving: `docs/status/04-wedding-page.md`
- latest progress/next steps: `docs/status/05-recent-work-and-next-steps.md`
- ranked solutions/shared UI/next implementation slice: `docs/status/06-ranked-solutions-and-ui-plan.md`

Then read the concrete implementation and spec files directly related to the requested task.

Always preserve these rules:
- core model stays generic
- Group and Container remain distinct
- containment is membership, not assignment
- adjacency uses positions/topology, not domain-specific shortcuts
- hard constraints and soft preferences remain distinct

Before finishing, update `status.md` and the relevant `docs/status/*.md` file(s).

If the task touches the event staffing planner solver path, also read:
- `docs/00-core-architecture.md`
- `docs/04-feature-solver-capabilities-and-configuration.md`
- `docs/07-feature-domain-model-and-semantics.md`
- `docs/10-feature-event-staffing-planner.md`
- `docs/11-feature-ranked-solutions-and-shared-workflow.md`

Current implementation direction:
- preserve the adapter boundary and evolve `solve(model, options)` additively
- keep the core generic and compile date/slot semantics in the Event Staffing transform
- use configurable weighted numeric scoring with equity as the initial dominant staffing objective
- return diverse top-K alternatives with honest completeness and optimality metadata
- keep JavaScript and HiGHS WASM solvers behind the shared Worker and adapter boundary
- migrate all pages toward Setup, Data, Rules, Review, and Results tabs
- protect school and wedding behavior with regression tests
- preserve bounded-memory search and honest incomplete-result metadata
- treat browser workflow verification, performance benchmarking, and the residual `xlsx` advisory as current follow-up work
```
