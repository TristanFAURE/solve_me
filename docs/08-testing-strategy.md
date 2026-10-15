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

The concrete browser or DOM testing technology should be selected explicitly before adding a dependency.

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

This benchmark is intended for manual iteration, not for pass/fail correctness gating.

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

The benchmark should always generate a scenario with at least one valid solution so it can exercise real solve work rather than just immediate unsat rejection.
