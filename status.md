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

## Current project stage

The app now has:

- a generic core model
- validate -> normalize -> solve workflow
- a real generic editing page
- a real school page with `.xlsx` import/export
- a real wedding page with seat topology authoring
- a first solver adapter that supports:
  - container mode
  - position mode
  - adjacency hard constraints
- shared solution display components
- GitHub Pages deployment already configured and working

## Highest-priority current task

Current recommended next work:

- next planned step: finish wiring a real event-staffing validation + planner-facing workflow around the staffing transform
- then add soft-solver behavior for staffing-facing:
  - `softAssignmentScores[]`
  - `softItemCountTargets[]`
- continue regression coverage for existing school and wedding flows
- then continue with manual testing and any performance work revealed by staffing-style constraint expansion

## Key invariant decisions

Preserve these project rules:

- the core model must remain generic
- Group and Container are distinct and must not be merged
- containment is membership, not assignment
- adjacency is modeled through positions and topology, not domain-specific logic
- hard constraints and soft preferences remain distinct
- specialized pages should use domain-facing wording while mapping internally to the generic core

## Latest update

- updated the generic page so it reflects newer solver/model fields beyond basic constraints and preferences
- added generic-page authoring and authored-entry audit coverage for:
  - `fixedAssignments[]`
  - `forbiddenAssignments[]`
  - `assignmentExclusions[]`
  - `assignmentCountUpperBounds[]`
  - `softAssignmentScores[]`
  - `softItemCountTargets[]`
- expanded the generic normalization summary so these newer normalized arrays are visible before solver handoff
- ran `node --check src/pages/generic/index.js`

Files modified:

- `src/pages/generic/index.js`
- `docs/status/02-generic-page.md`
- `docs/status/05-recent-work-and-next-steps.md`
- `status.md`

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

Then read the concrete implementation and spec files directly related to the requested task.

Always preserve these rules:
- core model stays generic
- Group and Container remain distinct
- containment is membership, not assignment
- adjacency uses positions/topology, not domain-specific shortcuts
- hard constraints and soft preferences remain distinct

Before finishing, update `status.md` and the relevant `docs/status/*.md` file(s).

If the task is to implement the event staffing planner solver path, also read:
- `docs/00-core-architecture.md`
- `docs/04-feature-solver-capabilities-and-configuration.md`
- `docs/07-feature-domain-model-and-semantics.md`
- `docs/10-feature-event-staffing-planner.md`

Implementation direction already decided:
- preserve the current public solver API shape
- evolve normalized constraint families additively
- compile ordered-event cooldown logic in transforms where possible
- protect school and wedding behavior with regression tests
- next implementation step to execute: complete `src/pages/eventStaffing/index.js`, wire the `/event-staffing` route end-to-end, then run the new page/domain regression tests plus focused school and wedding coverage
```
