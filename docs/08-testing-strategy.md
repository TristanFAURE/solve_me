# Testing Strategy

## Purpose

This document defines how we test the generic core, especially solver behavior, before adding larger use cases.

The goal is to keep tests:

- centered on generic semantics
- easy to read
- low on boilerplate
- robust to future solver heuristic changes

## Scope

Automated tests primarily protect generic constraints and solver behavior, with targeted domain-transform and page-workflow tests where domain semantics are being compiled into the generic model.

That means tests should describe behavior in terms of:

- Items
- Containers
- Positions
- adjacency topology
- hard constraints
- solver validation and solving behavior

They should avoid domain-specific wording from school or wedding pages unless a test explicitly targets a transform layer.

Event staffing tests may use date, slot, category, person, and preference wording when they target the staffing transform or page workflow. Solver correctness tests should still express the normalized behavior in generic terms.

## Test layers

### 1. Normalization tests

These verify derived generic semantics before solving.

Examples:

- symmetric constraint deduplication
- must-share connected components
- adjacency map derivation from topology

### 2. Solver behavior tests

These verify solving outcomes for normalized generic projects.

Examples:

- satisfiable scenarios
- unsatisfiable scenarios
- must-share and must-not-share semantics
- adjacency semantics in position mode
- container restrictions such as allowed/forbidden containers

### 3. Solver validation tests

These verify that the active solver adapter rejects or warns on unsupported or malformed generic models.

Examples:

- too few positions in position mode
- orphan positions
- unsupported constraint kinds
- ignored preferences warnings

### 4. Ranked-solution correctness tests

These verify optimization and enumeration behavior independently of heuristic search order.

Required cases include:

- zero, one, and several valid solutions
- strict weighted-score ordering
- deterministic tie behavior
- duplicate solution removal
- diverse top-K minimum-distance behavior
- equity trade-offs
- timeout and best-so-far metadata
- optimality and search-completeness claims

Tiny multiple-assignment models should be compared against an exhaustive brute-force oracle so the solver cannot silently miss a better schedule or report false unsatisfiability.

### 5. Domain workflow tests

These verify domain transforms and critical authoring behavior.

Required staffing cases include:

- several slots on one date
- several category requirements in one slot
- at most one category assignment per person and slot
- slot-level preferences counted once
- hard unavailability compiled into forbidden assignments
- assignment equity across eligible people

School and wedding regressions remain required whenever shared solver behavior changes.

### 6. User-interface quality tests

The shared workflow redesign should add tests for:

- validation states and navigation to errors
- import replacement confirmation
- cascading-delete impact confirmation
- keyboard focus preservation
- accessible names and status announcements
- responsive handling of dense tables and preference matrices

Playwright is the approved browser-testing technology. The suite is intentionally separate from Vitest and runs with `npm run test:e2e`.

Current browser coverage includes:

- Generic, School, Wedding, and Event Staffing route/workflow smoke tests
- 360, 768, 1024, and 1440 pixel viewport checks
- document-overflow checks
- keyboard workflow-tab navigation
- local draft recovery across reload
- a real Event Staffing Web Worker solve

The current development container can discover the suite but cannot launch Chromium because required Linux system libraries are unavailable. The GitHub Pages workflow installs Chromium and its Linux dependencies and runs the suite before deployment; local workstations can use the setup command in `README.md`.

## Structure

```text
tests/
  helpers/
    projectBuilder.js
    solverAssertions.js
    solverScenario.js
  core/
    normalize/
      normalizeProject.test.js
  solver/
    firstSolverAdapter.containerMode.test.js
    firstSolverAdapter.positionMode.test.js
    firstSolverAdapter.validation.test.js
    solverSupport.test.js
scripts/
  solverBenchmark.js
  eventStaffingBenchmark.js
```

## Readability rule

Tests should express scenario intent more than raw object plumbing.

Prefer:

- `scenario().items('A', 'B').containers({ T1: 2 }).mustShare('A', 'B')`

Over:

- manually creating every node, ref, and relation inline in each test

## Assertions rule

Prefer semantic assertions over exact solution enumeration order.

Good assertions:

- two items are always in the same container
- two items are never adjacent
- result is unsat
- solver returns a warning

Avoid coupling tests to:

- exact search order
- exact solution order
- internal heuristic decisions unless that heuristic is the thing being tested

## Coverage usage

Coverage should primarily be used to inspect untested solver and normalization branches.

Current coverage focus:

- `src/solver/**`
- `src/core/**`

Branch coverage is especially important for solver code because many correctness paths live in branching logic.

## Manual benchmark

Large-scale solver capacity and complexity checks should not run as part of the default automated suite.

Instead, use an explicit opt-in benchmark script:

- `npm run bench:solver`
- `npm run bench:staffing`

This benchmark is intended for manual iteration, not for pass/fail correctness gating.

The staffing benchmark runs deterministic, feasible-by-construction 7-, 14-, and 28-day realistic rosters plus scaled lower-bound rosters through Event Staffing generation, transform, normalization, solver validation, startup, and search. The lower bound uses one required doctor in one category per independently staffed slot. It reports model dimensions, RSS/heap/external/WASM stage snapshots, status, nodes, incumbent updates, assignment count, and score. Honest `partial`, `timeout`, and `not-run-safety-limit` results are measurements rather than process failures.

Its purpose is to:

- generate large but solvable scenarios
- measure normalization and solve times
- help identify practical scaling limits
- help reproduce performance regressions with a deterministic seed

Current configuration is controlled through environment variables:

- `BENCH_CONTAINERS`
- `BENCH_ITEMS`
- `BENCH_CONSTRAINTS`
- `BENCH_SEED`
- `BENCH_STAFFING_TIMEOUT_MS` (default `1500` per staffing scenario)
- `BENCH_STAFFING_PROCESS_TIMEOUT_MS` (default `10000` per isolated process)
- `BENCH_STAFFING_MAX_OLD_SPACE_MB` (default `512`)
- `BENCH_STAFFING_MAX_SOLVE_PAIRS` (default `60000`; larger models stop after validation)
- `BENCH_STAFFING_DAYS`, `BENCH_STAFFING_SLOTS_PER_DAY`, `BENCH_STAFFING_PEOPLE`, and `BENCH_STAFFING_CATEGORIES` (define one custom run when `BENCH_STAFFING_DAYS` is set)
- `BENCH_STAFFING_ENGINE=highs|js` and `BENCH_STAFFING_MODE=first|topK|optimize`
- `BENCH_STAFFING_JSON=1` (also print machine-readable results)

The benchmark should always generate a scenario with at least one valid solution so it can exercise real solve work rather than just immediate unsat rejection.
