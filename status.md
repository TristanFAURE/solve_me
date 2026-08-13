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

- decide whether to extend automated coverage into `src/core/validate/**` or move on to the next major use case with the current solver baseline
- manually test position-mode solving from the generic page
- manually test wedding seat-aware solving end to end
- fix any issues found in UI, transform, or solution display
- then choose the next major step among:
  - wedding `close gap`
  - solver heuristics/performance
  - soft-preference support

## Key invariant decisions

Preserve these project rules:

- the core model must remain generic
- Group and Container are distinct and must not be merged
- containment is membership, not assignment
- adjacency is modeled through positions and topology, not domain-specific logic
- hard constraints and soft preferences remain distinct
- specialized pages should use domain-facing wording while mapping internally to the generic core

## Latest update

- investigated a GitHub Actions `npm ci` failure caused by `package.json` and `package-lock.json` being out of sync after adding the manual solver benchmark script
- regenerated `package-lock.json` with `npm install --package-lock-only` so the lock file now includes the current `esbuild` dependency set required by the existing Vite/Vitest toolchain
- this should unblock both test and build jobs in `.github/workflows/deploy.yml` without changing the workflow itself

Files modified:

- `status.md`
- `package.json`
- `package-lock.json`
- `vitest.config.js`
- `README.md`
- `docs/08-testing-strategy.md`
- `docs/status/05-recent-work-and-next-steps.md`
- `tests/helpers/projectBuilder.js`
- `tests/helpers/solverAssertions.js`
- `tests/helpers/solverScenario.js`
- `tests/core/normalize/normalizeProject.test.js`
- `tests/solver/firstSolverAdapter.containerMode.test.js`
- `tests/solver/firstSolverAdapter.positionMode.test.js`
- `tests/solver/firstSolverAdapter.validation.test.js`
- `tests/solver/solverSupport.test.js`
- `.github/workflows/deploy.yml`
- `package-lock.json`

## Restart prompt for a new context

Use this prompt in a fresh context:

```text
Read `status.md` first.
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
```
