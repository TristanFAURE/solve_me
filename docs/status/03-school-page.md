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

Workbook import is a convenience format, not full-fidelity persistence.

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
- teachers are not yet part of full assignment solving
- school-specific validation is still page-local rather than extracted into a broader domain-validation layer
- spreadsheet import/export increases bundle size because of `xlsx`

## Primary files

- `src/pages/school/index.js`
- `src/pages/school/validateSchoolProject.js`
- `src/pages/school/exportSchoolSolution.js`
- `src/pages/school/importSchoolWorkbook.js`
- `src/core/transform/domainMappings.js`
- `tests/pages/schoolValidation.test.js`
- `docs/03-feature-school-class-creation.md`
