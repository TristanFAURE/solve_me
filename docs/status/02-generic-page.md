# Generic Page Status

## Current implementation baseline

The generic page is now a real in-browser editor rather than a sample-loader-only page.
It now owns its own project draft instead of sharing the same live project object with school and wedding pages.

Implemented capabilities include:

- editable project metadata
- editable items, groups, containers, and positions
- editable containments, adjacencies, hard constraints, and soft preferences
- editable solver-facing assignment inputs:
  - fixed assignments
  - forbidden assignments
  - assignment exclusions
  - assignment count upper bounds
  - soft assignment scores
  - soft item count targets
- inline editing and remove actions
- sticky command bar for core workflow actions
- validate -> normalize -> solve wiring
- shared solution display integration
- storage actions for save/load/import/export
- shared Setup, Data, Rules, Review, and Results tabs
- solve-mode, score-weight, diversity, result-limit, and timeout controls
- Web Worker solving with progress, cancellation, partial results, and search hints
- versioned autosave and local draft recovery

## UX details

The page currently includes:

- board/dashboard style workspace
- sticky always-visible command bar
- Enter-key submission for simple create flows and selected relation/rule forms
- label-first audit tables that still preserve ids for traceability
- lower audit/result sections for validation, normalization, and solving
- dedicated authored-entry audit tables for the newer solver-facing arrays so generic authoring now reflects the evolved normalized model shape

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

before replacing the generic page's own current draft.

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
- domain-configurable panel copy so shared result components can use generic, school, or wedding wording without leaking wedding-specific labels into other pages
- ranked solution comparison, score details, completeness, optimality, and diversity diagnostics

## Known limitations

- generic editor state still uses direct in-memory mutation and re-rendering
- lower sections are still somewhat debug/audit oriented
- some newer solver-facing authoring inputs currently use id-list text entry for destination sets rather than richer multi-select widgets
- general relation preferences are stored but not optimized; assignment scores and item count targets are optimized
- larger scenarios may eventually need stronger UI organization or progressive disclosure
- real-browser accessibility, focus/caret, and responsive behavior still require manual regression checks

## Primary files

- `src/pages/generic/index.js`
- `src/components/solutions/solutionPanel.js`
- `src/components/solutions/containerAssignmentView.js`
- `src/components/solutions/solutionNavigation.js`
- `src/styles.css`
