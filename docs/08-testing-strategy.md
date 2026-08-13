# Testing Strategy

## Purpose

This document defines how we test the generic core, especially solver behavior, before adding larger use cases.

The goal is to keep tests:

- centered on generic semantics
- easy to read
- low on boilerplate
- robust to future solver heuristic changes

## Scope

Current automated tests focus on generic constraints only.

That means tests should describe behavior in terms of:

- Items
- Containers
- Positions
- adjacency topology
- hard constraints
- solver validation and solving behavior

They should avoid domain-specific wording from school or wedding pages unless a test explicitly targets a transform layer.

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
