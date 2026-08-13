# Recent Work and Next Steps

## Most recent completed work

Latest meaningful completed step:

- reviewed the wedding topology implementation and confirmed the current wedding baseline already includes bulk/per-table seat generation, generated left/right removal, `remove both sides`, manual same-table adjacency creation, and single-group `Keep this group together`
- reviewed the normalized topology path and confirmed the main solver gap was position-mode adjacency solving
- extended `src/solver/adapters/firstSolverAdapter.js` so the first solver now supports both container mode and position mode
- updated solver capabilities so the adapter now reports `adjacency: true` and `positionMode: true`
- kept soft preferences unsupported
- updated shared solution rendering so position-mode solutions display position labels
- verified with `npm run build`

## Files touched most recently

- `src/solver/adapters/firstSolverAdapter.js`
- `src/components/solutions/containerAssignmentView.js`
- `status.md`

## Recommended next step

1. manually test position-mode solving from the generic page with a small scenario covering:
   - `mustBeAdjacent`
   - `mustNotBeAdjacent`
   - `mustShareContainer`
   - `mustNotShareContainer`
2. manually test the wedding page in seat-aware mode end to end using generated seats and at least one adjacency rule
3. fix any UI, transform, or display issues found during those tests
4. after that, choose between:
   - implementing wedding `close gap`
   - improving solver heuristics
   - adding soft-preference support

## Key open risks

- position-mode solving is build-verified but still needs browser-level testing
- larger seat-aware scenarios may be slow with current backtracking
- shared solution display may need more wedding-specific wording once exercised more heavily
- soft preferences remain unoptimized across the app
