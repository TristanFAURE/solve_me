# Generic Page Status

## Current implementation baseline

The generic page is now a real in-browser editor rather than a sample-loader-only page.

Implemented capabilities include:

- editable project metadata
- editable items, groups, containers, and positions
- editable containments, adjacencies, hard constraints, and soft preferences
- inline editing and remove actions
- sticky command bar for core workflow actions
- validate -> normalize -> solve wiring
- shared solution display integration
- storage actions for save/load/import/export

## UX details

The page currently includes:

- board/dashboard style workspace
- sticky always-visible command bar
- Enter-key submission for simple create flows and selected relation/rule forms
- label-first audit tables that still preserve ids for traceability
- lower audit/result sections for validation, normalization, and solving

## Storage and import/export baseline

The generic page now supports lightweight:

- save draft
- load draft
- import JSON
- export JSON

Imported and restored projects go through:

- shape coercion
- version-policy classification
- migration
- validation

before replacing current state.

## Version-policy baseline

Current storage version policy:

- missing or unparseable versions warn
- same version passes
- same-major minor/patch differences warn
- too-old versions fail
- major-version differences fail

## Shared solution display

The generic page now uses shared solution components for:

- grouped container assignment display
- previous/next solution navigation
- position label display when position-mode solutions include a `positionRef`

## Known limitations

- generic editor state still uses direct in-memory mutation and re-rendering
- lower sections are still somewhat debug/audit oriented
- soft preferences are stored and shown but not optimized by the solver
- larger scenarios may eventually need stronger UI organization or progressive disclosure

## Primary files

- `src/pages/generic/index.js`
- `src/components/solutions/solutionPanel.js`
- `src/components/solutions/containerAssignmentView.js`
- `src/components/solutions/solutionNavigation.js`
- `src/styles.css`
