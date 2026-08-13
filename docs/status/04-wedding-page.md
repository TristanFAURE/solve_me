# Wedding Page Status

## Current domain baseline

The wedding page is now a real planner-facing editor using wedding-only language.
It now owns its own wedding draft instead of reusing the school or generic page's live project object.

Main concepts exposed to users:

- Guests
- Groups
- Tables
- Seats

Groups are general overlapping planner-defined groups, not family-only groups.
A guest may belong to several groups.

## Current wedding capabilities

Implemented features include:

- guest, group, table, and seat editing
- overlapping groups
- table shapes: `round`, `square`, `rectangle`
- bulk seat generation from table capacities
- per-table seat generation and topology generation
- generated left/right adjacency controls
- `remove both sides` gap creation without deleting the seat
- delete-seat behavior without auto-reconnect
- manual same-table seat-to-seat adjacency creation
- validate -> normalize -> solve wiring
- single-group `Keep this group together` authoring in both hard-rule and preference sections
- seats panel moved to the end of the page for better authoring flow
- denser seat-card presentation for larger weddings

## Topology model

Wedding topology remains built on the generic model:

- seats are positions
- seats belong to tables via containment
- seat adjacency uses generic adjacency relations

Generated topology currently uses a perimeter-ring adjacency model for all supported shapes.
The shape metadata is preserved for future improvements.

## Current solver baseline for wedding use

The first solver now supports seat-aware position-mode solving with:

- one guest per seat
- must sit together at the same table
- must not share table
- must be adjacent
- must not be adjacent

Soft preferences are still not optimized.

## Important UX decisions

- `Keep this group together` is authored in rule/preference sections, not in group cards
- switching into or out of `Keep this group together` should refresh controls immediately
- seat panels should stay dense and compact for large events
- advanced seat editing belongs later in the page than core authoring
- shared solve-result components must still use wedding-specific wording such as guests/tables and must not inherit school-specific metadata blocks

## Validation regression coverage

The wedding validation flow now has a dedicated page-level test file:

- `tests/pages/weddingValidation.test.js`

Current coverage includes:

- minimal valid seat-aware wedding scenario
- cross-table seat adjacency rejection
- adjacency-rule rejection outside seat-aware mode
- seat-count versus capacity mismatch warnings

## Known limitations and risks

- generated `round`, `square`, and `rectangle` shapes currently share the same perimeter-ring adjacency semantics
- the dedicated `close gap` convenience action has not been implemented yet
- wedding-specific solution presentation may still need refinement after more seat-aware testing
- large seating plans may stress the current backtracking solver
- the UI may still need dynamic operand filtering for adjacency rules so unsupported operand combinations are hidden rather than merely validated later

## Primary files

- `src/pages/wedding/index.js`
- `src/pages/wedding/tableTopology.js`
- `src/pages/wedding/validateWeddingProject.js`
- `tests/pages/weddingValidation.test.js`
- `docs/02-feature-wedding-table-plan.md`
