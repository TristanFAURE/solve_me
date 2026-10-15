# School Page Status

## Current domain baseline

The school page is now a real school-language editor and solve flow.
It now owns its own school draft instead of reusing the wedding or generic page's live project object.

Main concepts exposed to users:

- Students
- Teachers
- Levels
- Classes

Internal mapping remains generic:

- students and teachers are authored as items
- levels map to groups
- classes map to containers

## Key semantic decisions

- the school page should use school-only wording and avoid generic solver jargon
- students are directly assigned by the solver in the MVP
- teachers are class-linked actors that influence eligibility and display, not independently assigned solver participants
- classes with no selected accepted levels are unrestricted and accept all levels
- mixed-level classes are represented by multiple accepted levels, not a special node type

## Current solve flow

The school page performs:

- school-specific validation
- generic validation
- normalization
- solve

The current transform derives per-student:

- `allowedContainerIds`
- `forbiddenContainerIds`

This lets the current generic container-mode solver enforce school eligibility hints.

## Implemented school features

- school-language editing UI
- accepted-level authoring
- teacher-class links
- school-language validation messages
- shared solution-panel integration
- school-specific solved class cards with school wording
- linked teachers and accepted levels visible on solved class cards
- assigned student levels summarized on solved class cards
- Excel export of solved results
- Excel import of teacher-facing workbooks
- specialized Setup, Data, Rules, Review, Results, and Display workflow
- classroom-style solved display with linked teachers, student desks, represented levels, empty classes, and synchronized solution navigation
- one teacher per class when teachers are configured, with fixed class links, level compatibility, per-class availability/preferences, and teacher/student relationships
- bulk student entry and explicit validation lifecycle
- Web Worker solving with ranked result controls and interruption handling
- versioned local autosave and draft recovery
- full-fidelity configuration workbook export/import with replacement preview
- validated full-configuration JSON export/import in Setup
- regression fixes for preference creation and aggregate capacity when a class is unlimited

## Workbook import/export baseline

### Export

`Export Excel` currently generates a real `.xlsx` workbook with:

- `Summary`
- `Classes`
- `Students`

### Import

Current workbook import baseline:

- `Students` sheet is required
- `Student` column is required
- optional `Level` and `Class` columns may be read from `Students`
- optional `Classes` sheet may enrich classes further
- imported workbook becomes the school page's own project draft with `viewHint: school`

Teacher-facing sheets remain a convenience format. A reserved, hidden configuration envelope now provides full-fidelity round trips when present, with bounded import and replacement preview checks.

## Validation regression coverage

The school validation flow now has a dedicated page-level test file:

- `tests/pages/schoolValidation.test.js`

Current coverage includes:

- minimal valid school scenario
- impossible teacher/student separation detection
- student with no compatible class detection
- multiple-level warning coverage

## Known limitations and risks

- teacher-linked soft preferences are still not optimized by the solver
- teacher assignment is a School-domain matching stage merged into each returned student solution; teachers remain separate from student capacity
- school-specific validation is still page-local rather than extracted into a broader domain-validation layer
- spreadsheet import/export increases bundle size because of `xlsx`
- local drafts may contain student data in browser storage and should only be used in an appropriate browser profile
- Display desk positions are illustrative and do not model physical classroom seats or geometry
- the existing `xlsx` release has unresolved upstream advisories despite file-size and ZIP preflight controls

## Primary files

- `src/pages/school/index.js`
- `src/pages/school/schoolSolutionDisplay.js`
- `src/pages/school/validateSchoolProject.js`
- `src/pages/school/exportSchoolSolution.js`
- `src/pages/school/importSchoolWorkbook.js`
- `src/core/transform/domainMappings.js`
- `tests/pages/schoolValidation.test.js`
- `docs/03-feature-school-class-creation.md`
