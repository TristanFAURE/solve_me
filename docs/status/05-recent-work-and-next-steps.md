# Recent Work and Next Steps

## Most recent completed work

The ranked-solutions and shared-workflow implementation milestone is complete:

- fixed Event Staffing requirement submission so visible group/min/max controls cannot be replaced by stale editor state
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

The local large-model solver uses exact-pinned `highs@1.15.3` (MIT) and emits a 3.53 MB WASM asset. Playwright `1.64.1` remains the exact-pinned Apache-2.0 browser-test development dependency.

## Verification

Final automated verification must include:

- `npm test`
- `npm run build`
- `git diff --check`
- review for credentials, tokens, internal URLs, and database secrets

Final unit verification passed 251 tests, the production build emitted the Worker and 3.53 MB WASM assets, and `git diff --check` passed. The 23 Playwright tests are discovered correctly but cannot execute in the current container because Chromium's required OS libraries, beginning with `libglib-2.0.so.0`, are unavailable. GitHub Actions installs those dependencies and runs the browser suite before deployment.

## Event Staffing scale result

Measured on 2026-10-15 with Node.js `v22.23.2` on Linux x86_64. The lower-bound target has 180 days, 10 independently staffed slots per day, 200 doctors, one category per slot, 1,800 containers, 360,000 theoretical assignment pairs, 17,820 forbidden assignments, and 162,000 soft-score terms.

HiGHS uses 342,180 feasible binary assignment variables after pruning. It receives a deterministic schedule that is independently checked against capacities, eligibility, fixed/forbidden assignments, cooldown exclusions, count bounds, and supported relation constraints before native optimization starts.

In `first` mode with a 5-second budget, the target lower bound returned a verified 1,800-assignment schedule with score 17,910 in approximately 1.88 seconds of adapter work (about 3.25 seconds including generation, transform, normalization, WASM loading, and validation). The observed stage-maximum RSS was approximately 344 MiB. No native branch-and-bound run is needed when the verified first solution satisfies the request; completeness and optimality are not claimed.

With a 20-second requested budget in direct Node execution:

- generation: approximately 0.47 s
- transform and normalization: approximately 1.95 s
- WASM load and validation: approximately 0.09 s
- MILP model startup: approximately 3.29 s
- native search: approximately 19.24 s
- total adapter wall time: approximately 22.56 s
- observed stage-maximum RSS: approximately 664 MiB
- result: one verified partial solution; optimality was not proved

HiGHS can overrun its native time limit during long presolve/native sections. Browser execution remains bounded because the main-thread watchdog terminates the Worker after the requested limit plus a delivery grace and preserves the verified incumbent reported before native optimization. HiGHS WASM is single-threaded; faster computers can improve search, but target-scale optimization and diverse top-K remain best-found unless the result explicitly proves completeness.

## Recommended next steps

1. Run `npm run test:e2e` in an environment with Chromium system libraries, then manually verify the four workflows on desktop and mobile.
2. Validate HiGHS schedule quality and memory use on representative end-user computers; tune timeout and objective settings from those measurements.
3. Review alternatives to `xlsx`, which has unresolved upstream advisories; current upload, ZIP expansion, workbook-shape, and cell limits reduce but do not eliminate parser risk.
4. Keep the Playwright suite in the verification gate once the execution environment provides its browser libraries.
5. Consider a bounded remote CP-SAT service only if local HiGHS quality or latency is insufficient on representative hardware.

## Known residual risks

- general relation preferences remain unsupported by both current optimization paths
- target-scale HiGHS results may be partial or best-found; equal-score canonical top-K can remain unproved
- the target lower-bound model used roughly 664 MiB RSS in the measured Node process
- Event Staffing uses event-shaped slot records grouped by date metadata rather than a separate date entity
- local drafts can contain personal data in origin-local browser storage
- full-page rerenders still warrant manual focus/caret and accessibility checks
- generated wedding shapes share perimeter-ring adjacency semantics
- the production bundle emits a large-chunk warning
- `xlsx` has unresolved upstream security advisories and no available npm audit fix
