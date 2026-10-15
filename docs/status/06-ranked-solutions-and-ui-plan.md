# Ranked Solutions and Shared UI Plan Status

## Purpose

This status file allows a future run to resume the approved ranked-solution and shared-workflow work without repeating product discovery.

Read the authoritative roadmap first:

- `docs/11-feature-ranked-solutions-and-shared-workflow.md`

Also read:

- `docs/09-technical-and-architecture-constraints.md`
- `docs/04-feature-solver-capabilities-and-configuration.md`
- `docs/06-feature-solution-display-and-scoring.md`
- `docs/08-testing-strategy.md`
- `docs/10-feature-event-staffing-planner.md`

## Current milestone state

The documentation and implementation milestone is complete. Automated verification and performance measurements are recorded in `docs/status/05-recent-work-and-next-steps.md`. Playwright coverage is implemented, but execution remains blocked in the current container by missing Chromium system libraries.

Completed documentation work:

- added the ranked-solutions and shared-workflow roadmap
- documented configurable weighted numeric scoring
- selected workload equity as the initial dominant staffing objective
- selected diverse top-K alternatives rather than nearly identical strict alternatives
- documented complete versus best-found search semantics
- documented Web Worker as the first execution isolation step
- selected WebAssembly only after benchmark evidence; the HiGHS WASM adapter is now implemented for large supported staffing models
- selected shared Setup, Data, Rules, Review, and Results workflow tabs
- documented cross-page reliability, persistence, accessibility, and responsive requirements
- updated the Event Staffing direction to dates containing several slots
- documented several category requirements per slot
- documented preferences per person and slot
- separated soft `prefer not` from hard `unavailable`

The roadmap is implemented. `highs@1.15.3` is an exact-pinned MIT runtime dependency for local MILP solving; Playwright is the exact-pinned browser-test development dependency.

## Approved Event Staffing semantics

The use case remains named Event Staffing and keeps generic terminology.

Planned structure:

```text
Date
  Slot
    Category requirement: min/max
    Category requirement: min/max
```

Rules:

- one date can contain several slots
- one slot can contain several category requirements
- one person can occupy at most one category in a slot
- the Rules UI selects one person and displays dates as columns with `Whole day` and staffing-group rows
- a second collapsible date overview provides previous/next date controls, people filtering, people as columns, and staffing groups as rows
- whole-day unavailability blocks every slot/category on that date; group/date cells inherit or override other day preferences
- legacy slot-level preferences and workbook imports remain supported
- prefer, neutral, and prefer not are soft
- unavailable is hard and compiles to forbidden assignments

Migration direction:

- initially allow the existing event structure to represent an assignable slot
- group slots by date metadata in the domain page
- avoid introducing a separate date entity unless required behavior cannot be represented cleanly otherwise

## Approved optimization semantics

The public solver boundary remains adapter-based and evolves to accept solve options.

Planned modes:

- `first`
- `topK`
- `optimize`

Planned initial objectives:

- workload equity
- slot preference satisfaction
- person assignment-target deviation
- optional category target deviation

The initial equity penalty should use integer arithmetic, starting with pairwise absolute differences between eligible people's assignment counts.

Top-K should:

- rank by configured numeric score
- deduplicate canonical assignments
- support minimum assignment distance
- report when requested diversity could not be met

The solver may report unsatisfiable only after complete relevant search. It may report optimality only when a bound proves no better solution exists.

## Shared workflow decision

Every page should migrate to:

1. Setup
2. Data
3. Rules
4. Review
5. Results

Domain language remains page-specific. Raw JSON, normalization details, internal IDs, and solver diagnostics move under Advanced diagnostics.

## Completed implementation phases

- reliability and data-safety defect fixes
- solve options and complete repeated-assignment branching
- weighted scoring and diverse top-K ranking
- shared workflow tabs and lifecycle components
- Event Staffing date/slot migration and planner authoring
- Generic, School, and Wedding workflow migration
- Web Worker progress, cancellation, timeout, and partial results
- automatic HiGHS WASM selection for large supported repeated-assignment models
- workbook and local-draft safety controls

## Remaining follow-up phases

### Browser verification

- run the existing Playwright suite where Chromium system libraries are available
- manually test the shared workflows on desktop and mobile
- verify focus/caret behavior through rerenders
- verify keyboard and screen-reader semantics

### Performance

- deterministic realistic staffing schedule benchmarks are available through `npm run bench:staffing`
- tune HiGHS time limits and objective settings from representative hardware measurements
- retain the JavaScript adapter for small models and unsupported HiGHS semantics

### Dependency risk

- evaluate maintained alternatives or stronger isolation for `xlsx`
- retain file-size, ZIP preflight, workbook-bound, cell-length, and export-field controls

## Known current risks

- general relation preferences remain unsupported even though some pages expose them
- target-scale HiGHS optimization can return a verified feasible incumbent but may remain partial or best-found within browser time limits
- HiGHS WASM is single-threaded and the 360,000-pair lower-bound model uses hundreds of MiB of process/WASM memory
- Event Staffing models slots as event-shaped records grouped by date metadata
- local drafts can contain personal data in browser storage
- full-page rerenders create focus and caret risks
- the Playwright suite covers primary workflows and responsive smoke checks, but has not executed in the current container because Chromium system libraries are unavailable
- `xlsx` has unresolved upstream advisories; preflight controls reduce but cannot eliminate parser risk

## Invariants for every implementation phase

- core model remains generic
- Group and Container remain distinct
- containment remains membership, not assignment
- hard constraints and soft objectives remain distinct
- domain-specific date and slot semantics remain in the staffing page and transform
- existing school and wedding behavior remains regression-protected
- no dependency is added without explicit need, license review, and security review
- static hosting remains supported
- every solver-impacting change includes automated tests
- result claims about unsatisfiability and optimality remain mathematically honest

## Verification baseline

- targeted school tests pass
- targeted wedding tests pass
- full `npm test` passes
- generated two-seat tables contain one undirected adjacency edge
- unlimited school classes do not produce false aggregate-capacity errors
- creating a school preference no longer throws
- deleting a wedding table cannot leave its generated seats orphaned through the normal UI path
- no credentials, tokens, internal URLs, or other secrets are introduced

## Restart prompt

```text
Read `status.md` first, then read:
- `docs/11-feature-ranked-solutions-and-shared-workflow.md`
- `docs/status/06-ranked-solutions-and-ui-plan.md`
- `docs/09-technical-and-architecture-constraints.md`

The ranked-solution, shared-workflow, Event Staffing, Worker, persistence, and workbook implementation is complete. Do not repeat the implementation phases.

Start with the residual risks and recommended follow-up work in status files 05 and 06. Preserve the documented architecture invariants and honest incomplete-search semantics.
```
