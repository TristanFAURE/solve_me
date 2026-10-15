# Recent Work and Next Steps

## Most recent completed work

The ranked-solutions and shared-workflow implementation milestone is complete:

- fixed school preference creation, unlimited aggregate capacity, two-seat wedding adjacency, and cascading wedding-table deletion
- added validated `first`, `topK`, and `optimize` solve options
- added configurable weighted assignment, target-deviation, and equity scoring
- added canonical fingerprints, ranked alternatives, minimum-distance diversity, score details, and honest completeness/optimality metadata
- replaced greedy repeated-assignment selection with complete pair branching, bounded candidate retention, and explicit bounded-search reporting
- moved browser solves to a module Web Worker with progress, cancellation, timeout, partial incumbents, and search-narrowing hints
- added Setup, Data, Rules, Review, and Results tabs to all four pages
- added explicit validation lifecycle and disabled unsupported general-preference authoring truthfully
- added versioned local autosave and recovery without accumulating rerender listeners
- added full-fidelity School, Wedding, and Event Staffing configuration workbooks with preview/replacement flows and workbook safety limits
- added Event Staffing date/slot migration, category requirements, person-slot preferences, hard unavailability, fixed/forbidden assignments, cooldowns, and ranked schedule export
- added cross-domain compatibility, solver-contract, worker, workbook, migration, topology, lifecycle, and regression tests
- extended the Event Staffing benchmark from realistic 7/14/28-day cases through the 180-day x 10-slot x 200-doctor one-category lower bound, with isolated processes, bounded search, stage timings, heap snapshots, model sizes, nodes, and incumbent counts
- changed the staffing preference workbook to a two-row date/slot matrix with stable physical-column mappings and legacy single-header compatibility
- moved XLSX parsing into a dedicated browser Worker while retaining preflight and post-parse bounds
- added 23 Playwright tests for all page workflows, keyboard tabs, persistence, Worker solving, and 360/768/1024/1440 px layouts

The benchmark adds no dependency. Playwright `1.64.1` was added as an exact-pinned Apache-2.0 development dependency, and Vite was upgraded to its Vitest-compatible 8.x line.

## Verification

Final automated verification must include:

- `npm test`
- `npm run build`
- `git diff --check`
- review for credentials, tokens, internal URLs, and database secrets

Final unit verification passed 229 tests across 32 files, the production build completed with its existing large-chunk warning, and `git diff --check` passed. The 23 Playwright tests are discovered correctly but cannot execute in the current container because Chromium's required OS libraries, beginning with `libglib-2.0.so.0`, are unavailable. GitHub Actions installs those dependencies and runs the browser suite before deployment.

## Event Staffing scale result

Measured on 2026-10-15 with Node.js `v22.23.2` on Linux x86_64. Every child had a 512 MiB old-space cap and 10 s external process timeout; searches had a 1500 ms internal budget checked at recursive-node boundaries and were not started above 60,000 doctor/container pairs. Heap values are stage snapshots, so `observed peak` is not a sampled allocation high-water mark.

| Scenario | Generate / transform / normalize / validate | Solver startup / search / finalize | Observed heap peak | Status | Explored / pruned / incumbents |
| --- | --- | --- | --- | --- | --- |
| 7d x 1 x 10, 3 categories | 6.59 / 1.66 / 0.73 / 0.39 ms | 0.81 / 1504.07 / 8.67 ms | 11.36 MiB | partial, 3 returned | 57,524 / 342 / 6 |
| 14d x 1 x 16, 3 categories | 10.16 / 2.04 / 1.42 / 0.54 ms | 1.12 / 1500.28 / 3.84 ms | 46.19 MiB | partial, 3 returned | 11,684 / 16 / 4 |
| 28d x 1 x 24, 3 categories | 38.28 / 5.16 / 4.08 / 0.48 ms | 2.43 / 1498.44 / 0.24 ms | 105.82 MiB | timeout | 587 / 0 / 0 |
| 30d x 10 x 50, 1 category | 21.18 / 29.31 / 9.33 / 0.47 ms | 6.13 / 1564.97 / 0.27 ms | 33.83 MiB | timeout | 14 / 0 / 0 |
| 30d x 10 x 200, 1 category | 30.40 / 64.71 / 23.41 / 0.59 ms | 20.33 / 1515.71 / 0.27 ms | 46.06 MiB | timeout | 3 / 0 / 0 |
| 60d x 10 x 200, 1 category | 65.11 / 156.66 / 42.62 / 0.53 ms | not run | 32.67 MiB | safety limit | 0 / 0 / 0 |
| 90d x 10 x 200, 1 category | 155.03 / 232.94 / 113.23 / 0.58 ms | not run | 39.79 MiB | safety limit | 0 / 0 / 0 |
| 180d x 10 x 200, 1 category | 237.28 / 458.64 / 234.76 / 0.59 ms | not run | 117.80 MiB | safety limit | 0 / 0 / 0 |

The full lower bound has 1,800 slots, 360,000 preference cells/pairs, 17,820 forbidden terms, 162,000 soft-score terms, and 200 count bounds. Preprocessing and validation are practical, but the current repeated-assignment search is not. Its first node constructs/checks the remaining pair space and performs at least `containers x pairs`: 18,000,000 pair inspections at 30d x 10 x 200 versus 648,000,000 at the target. That is 36x the work while the measured checkpoint already reaches only three nodes within its approximately 1.5 s budget. A linear estimate suggests order-of-tens-of-seconds work before meaningful branching at target size, but it is not a precise latency prediction because node costs and runtime conditions vary. Search was therefore stopped at the largest measured safe search size, 30d x 10 x 200; 60, 90, and 180 days were measured through validation only.

The target should use an established CP-SAT or MILP scheduling model with sparse feasible assignment variables, preferably in a Worker-backed WASM build if a supported browser package meets bundle/memory requirements, or in a bounded remote solver service for stronger operational controls. Do not scale the current JavaScript pair-branching solver to this workload; no replacement solver is added in this change.

## Recommended next steps

1. Run `npm run test:e2e` in an environment with Chromium system libraries, then manually verify the four workflows on desktop and mobile.
2. Evaluate a sparse CP-SAT/MILP WASM or bounded remote-service prototype for Event Staffing; retain the current solver only for small models.
3. Review alternatives to `xlsx`, which has unresolved upstream advisories; current upload, ZIP expansion, workbook-shape, and cell limits reduce but do not eliminate parser risk.
4. Keep the Playwright suite in the verification gate once the execution environment provides its browser libraries.
5. Keep the benchmark safety limits in place when comparing any future solver architecture.

## Known residual risks

- general relation preferences remain unsupported by the first solver
- repeated-assignment search remains exponential and can return incomplete bounded or timed-out results on large scenarios
- Event Staffing uses event-shaped slot records grouped by date metadata rather than a separate date entity
- local drafts can contain personal data in origin-local browser storage
- full-page rerenders still warrant manual focus/caret and accessibility checks
- generated wedding shapes share perimeter-ring adjacency semantics
- the production bundle emits a large-chunk warning
- `xlsx` has unresolved upstream security advisories and no available npm audit fix
