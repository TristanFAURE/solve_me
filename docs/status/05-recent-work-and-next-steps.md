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

No dependency was added. `package.json` only adds the `test:compat` script.

## Verification

Final automated verification must include:

- `npm test`
- `npm run build`
- `git diff --check`
- review for credentials, tokens, internal URLs, and database secrets

The final verification run passed 212 tests across 30 files, the 5-test compatibility suite, the production build, and `git diff --check`.

## Recommended next steps

1. Manually verify Generic, School, Wedding, and Event Staffing workflows in a real browser on desktop and mobile.
2. Benchmark realistic Event Staffing datasets and tune time limits, candidate budgets, and search hints from measurements.
3. Review alternatives to `xlsx`, which has unresolved upstream advisories; current upload, ZIP expansion, workbook-shape, and cell limits reduce but do not eliminate parser risk.
4. Add browser automation only if explicitly requested; current project guidance does not assume a browser-test framework.
5. Consider WebAssembly only if benchmarks show the Worker-based JavaScript solver is insufficient.

## Known residual risks

- general relation preferences remain unsupported by the first solver
- repeated-assignment search remains exponential and can return incomplete bounded or timed-out results on large scenarios
- Event Staffing uses event-shaped slot records grouped by date metadata rather than a separate date entity
- local drafts can contain personal data in origin-local browser storage
- full-page rerenders still warrant manual focus/caret and accessibility checks
- generated wedding shapes share perimeter-ring adjacency semantics
- the production bundle emits a large-chunk warning
- `xlsx` has unresolved upstream security advisories and no available npm audit fix
