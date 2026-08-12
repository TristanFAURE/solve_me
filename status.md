# Project Status

## Purpose of this file

Use this file to restart work in a new prompt or context.
A future agent should read this file first, then read the referenced documents, and continue from the listed next steps.
A future agent must also update this file after every meaningful step so the project can be resumed from a fresh prompt with minimal lost context.

## Status maintenance rule

Every future agent working on this project must update `status.md` after each meaningful action.

When editing code or docs, prefer small, incremental file operations over large rewrites whenever possible.
For large or partially corrupted files, repair them in small verified chunks to reduce tool failures and accidental corruption.

A meaningful action includes:

- creating a new document
- editing an existing specification
- making an architecture decision
- implementing a feature
- changing the project structure
- identifying a blocker or open question

Each update should record:

- what was done
- which files were created or modified
- what decisions were made
- any open questions or risks
- the recommended next step
- an updated restart prompt that a future agent can use directly

The file should remain concise, readable, and cumulative.
It should be maintained as the primary restart point for future prompts.
The restart prompt section must always be kept in sync with the current project stage.

## Current objective

Design a lightweight web application for generic constraint solving with:

- minimal infrastructure
- no database in the MVP
- pure JavaScript/HTML/CSS approach
- generic core model
- domain-specific pages built on top of that core

## Main product idea

The app lets users define assignment and grouping problems, run a constraint solver, and display one or more valid solutions.

Planned pages include:

- a generic constraint page
- a wedding table plan page
- a school class creation page

## Important modeling decisions already made

### 1. Core model must stay generic

Core logic should avoid domain-specific entities such as person, guest, or student.
The generic node types are:

- Item
- Group
- Container
- Position

### 2. Containment is required

The model supports membership relations such as:

- Robert contained in family FAURE

Containment means membership only.
It does not mean assignment.

### 2b. Group and container must remain distinct

This distinction was reinforced in the semantics document.

- Group = membership and relation propagation
- Container = assignment destination and capacity structure

A group answers: who belongs together conceptually?
A container answers: where is an item assigned?

These concepts must never be merged implicitly.

### 3. Group-level constraints must propagate

Example:

- FAURE incompatible with DUPONT

Semantic meaning:

- every member of FAURE is incompatible with every member of DUPONT

### 4. Hard constraints and soft preferences are both desired

Hard constraints include ideas such as:

- must share container
- must not share container
- must be adjacent
- must not be adjacent

Soft preferences include ideas such as:

- prefer share container
- prefer separate containers
- prefer adjacent
- prefer non-adjacent

Soft preferences depend on solver capabilities.

### 5. “Next to” must be modeled generically

The project should not encode wedding-specific “next to” logic.
Instead it uses:

- Position nodes
- containment of positions inside containers
- adjacency relations between positions

This allows generic support for seat adjacency, desk adjacency, and other topology-based use cases.

### 6. Two assignment modes are planned

- Container mode: item assigned directly to container
- Position mode: item assigned to position, and position belongs to container

Position mode is required for adjacency constraints.

## Documents created so far

- `docs/00-core-architecture.md`
- `docs/01-feature-generic-constraint-page.md`
- `docs/02-feature-wedding-table-plan.md`
- `docs/03-feature-school-class-creation.md`
- `docs/04-feature-solver-capabilities-and-configuration.md`
- `docs/05-feature-import-export.md`
- `docs/06-feature-solution-display-and-scoring.md`
- `docs/07-feature-domain-model-and-semantics.md`
- `status.md`

## What these documents contain

### `docs/01-feature-generic-constraint-page.md`

Defines:

- the generic modeling page purpose and scope
- item, group, container, and position editing requirements
- the implemented board/dashboard workspace structure
- inline editing and sidebar authoring expectations
- support for container mode and position mode
- validation expectations on the page
- solver capability handling in the UI
- integration with shared solution display

### `docs/02-feature-wedding-table-plan.md`

Defines:

- the wedding-specific page scope and user stories
- mapping from wedding terminology to the generic core model
- guest, family/group, table, and seat management requirements
- same-table mode and seat-aware mode behavior
- wedding-friendly hard constraints and soft preferences
- propagation expectations for family or group separation rules
- seat adjacency handling through generic positions and topology
- seat-aware capacity consistency expectations
- solver execution and solution display expectations for seating plans

### `docs/03-feature-school-class-creation.md`

Defines:

- the school-specific page scope and user stories
- mapping from school terminology to the generic core model
- student, class, and group management requirements
- class capacity requirements and validation expectations
- school-friendly hard constraints and soft preferences
- container-mode-first behavior for the MVP
- solver execution and solution display expectations for class assignments

### `docs/04-feature-solver-capabilities-and-configuration.md`

Defines:

- solver capability discovery requirements
- the shared capability model exposed by solver adapters
- solve-time configuration options such as timeout, result count, and solve mode
- fallback behavior for unsupported hard constraints and soft preferences
- metadata expected from solver execution
- shared configuration behavior across generic and specialized pages

### `docs/05-feature-import-export.md`

Defines:

- JSON export requirements for normalized project data
- JSON import workflow and validation requirements
- local draft persistence behavior using browser storage
- versioning and compatibility expectations for saved files
- optional `viewHint` metadata for reopening in an appropriate page
- persistence principles shared across generic and specialized pages

### `docs/06-feature-solution-display-and-scoring.md`

Defines:

- shared solution status and result presentation behavior
- navigation across one or more returned solutions
- grouped assignment display for container mode and position mode
- score, penalty, and soft preference violation display expectations
- warning, truncation, timeout, unsat, validation-failure, and error state presentation
- distinction between limit-based truncation and interruption-based partial results
- domain-friendly labeling over a shared normalized result structure

### `docs/00-core-architecture.md`

Defines:

- project vision
- architecture principles
- MVP and non-goals
- normalized problem model
- shared project metadata including optional `viewHint`
- hard vs soft constraints
- containment and propagation
- topology and adjacency
- solver abstraction
- solver result metadata distinctions such as truncation vs interruption
- persistence strategy
- folder structure
- feature document map

### `docs/07-feature-domain-model-and-semantics.md`

Defines:

- formal meaning of Item, Group, Container, Position
- explicit distinction between Group and Container
- containment semantics
- assignment semantics
- container mode vs position mode
- hard constraints and soft preferences
- propagation of group-level relations
- default preprocessing-based expansion of group relations
- execution state semantics distinguishing validation failure from solver outcomes
- adjacency semantics
- validation-oriented semantic rules
- solution semantics

## Recommended next documents to draft

All currently planned core feature documents in this batch have been drafted.

## Recommended next implementation steps

After docs are complete, ask the agent to:

1. initialize the frontend project structure
2. define the initial `/src` module layout
3. create the normalized data model types/modules
4. create validation and normalization modules
5. create storage modules for localStorage and JSON import/export
6. create the generic page UI
7. add specialized pages on top of the shared model
8. integrate a first solver adapter

## Proposed initial `/src` folder structure

Recommended starting structure:

```text
/src
  /app
    bootstrap.js
    router.js
    state.js
  /pages
    /generic
    /wedding
    /school
  /components
    /editors
    /forms
    /solutions
    /common
  /core
    /model
      ids.js
      project.js
      nodes.js
      relations.js
      constraints.js
      preferences.js
      assignmentModes.js
      solution.js
    /normalize
      normalizeProject.js
      expandGroupRelations.js
      buildTopology.js
      computeMustShareComponents.js
    /validate
      validateProject.js
      validateStructure.js
      validateConstraints.js
      validateCapabilities.js
    /transform
      viewModelAdapters.js
      domainMappings.js
  /solver
    solverAdapter.js
    solverCapabilities.js
    solverResult.js
    /adapters
      firstSolverAdapter.js
  /storage
    localDrafts.js
    importExport.js
    modelVersioning.js
  /utils
    collections.js
    graphs.js
    assertions.js
    ids.js
  main.js
  styles.css
```

Structure intent:

- `/app`: application bootstrap, top-level state, and page routing
- `/pages`: page-level orchestration for generic and domain-specific workflows
- `/components`: reusable UI parts shared across pages
- `/core/model`: normalized core entities and shared type-like definitions
- `/core/normalize`: preprocessing from UI/domain input into solver-ready normalized structures
- `/core/validate`: pre-solve validation logic and capability-aware checks
- `/core/transform`: mapping between normalized core data and page-specific view models
- `/solver`: stable solver boundary, capabilities, result contract, and concrete adapters
- `/storage`: localStorage draft handling, JSON import/export, and version migration helpers
- `/utils`: generic helpers with no domain semantics

Recommended implementation order inside `/src`:

1. `/core/model`
2. `/core/validate`
3. `/core/normalize`
4. `/storage`
5. `/solver`
6. `/pages` and `/components`
7. `/app`

Initial architectural decisions captured by this structure:

- page-specific concepts should stay in `/pages` and `/core/transform`, not in `/core/model`
- solver-specific logic should stay behind `/solver/adapters`
- validation and normalization remain separate stages
- solution display can be shared through `/components/solutions`
- import/export and local draft persistence share a versioned storage boundary

## Most recent completed step

Completed:

- drafted `docs/00-core-architecture.md`
- drafted `docs/07-feature-domain-model-and-semantics.md`
- updated `docs/07-feature-domain-model-and-semantics.md` to make the Group versus Container distinction explicit
- drafted `docs/01-feature-generic-constraint-page.md`
- drafted `docs/02-feature-wedding-table-plan.md`
- drafted `docs/03-feature-school-class-creation.md`
- drafted `docs/04-feature-solver-capabilities-and-configuration.md`
- drafted `docs/05-feature-import-export.md`
- drafted `docs/06-feature-solution-display-and-scoring.md`
- reviewed the full docs set for consistency gaps
- updated `docs/00-core-architecture.md` to align MVP evolution with capability-aware features, add project metadata, and clarify solver result metadata
- updated `docs/02-feature-wedding-table-plan.md` to clarify seat-aware capacity semantics, multi-group visibility, and MVP handling of group-togetherness
- updated `docs/05-feature-import-export.md` to add optional `viewHint` metadata and clarify that it is UI metadata only
- updated `docs/06-feature-solution-display-and-scoring.md` to distinguish validation failure from solver status and truncation from interruption
- updated `docs/07-feature-domain-model-and-semantics.md` to clarify multi-group membership, default preprocessing of group relations, MVP restriction for group-togetherness UI exposure, and execution state semantics
- created `status.md` as the restart and progress tracking document
- decided that future agents must keep `status.md` updated after every meaningful step
- reviewed the architecture and semantics docs before implementation planning
- proposed an initial `/src` folder structure organized around app, pages, components, core, solver, storage, and utils
- recorded the intended separation between normalized core modules and page-specific/domain-specific mapping layers
- created the initial frontend scaffold with Vite-style entry files, page routing, shared page shell, and base styling
- created initial placeholder modules for core model, normalization, validation, transform, solver, storage, and utility layers
- created a first placeholder solver adapter and placeholder page entry points for generic, wedding, and school views
- tightened `/src/core/model` contracts with explicit kind guards, project/view helpers, entity reference helpers, assignment helpers, and shape checks
- implemented first real validation rules for project structure, node collections, containment legality, adjacency topology legality, reference existence, assignment-mode-sensitive adjacency usage, and capability-aware warnings/errors
- implemented normalization helpers for group-level relation expansion, symmetric topology preparation, must-share component computation, and normalized deduplication of constraints/preferences
- expanded validation coverage for duplicate containments and adjacencies, multiple position parents, container capacity shape, position/container consistency, duplicate constraints/preferences, direct hard-constraint contradictions, MVP adjacency operand restrictions, and impossible must-share component sizes
- connected the generic page to the current validation and normalization pipeline with actions for loading a sample project, validating it, and attempting a solve
- added a first end-to-end generic-page workflow that displays project summary data, structured validation errors and warnings, normalization output, and raw solver adapter results
- initialized app state with an empty generic project plus generic-page workflow state for last validation, normalized model, and solver result
- created a small generic sample project for manual exercise of group containment, container capacities, group-propagated constraints, and soft preference warnings
- added basic UI styling for workflow buttons, summary cards, issue lists, and JSON output panels
- attempted a production build check, but local dependencies are not installed yet and `vite` was not available in the shell
- installed project dependencies with `npm install`, making the local Vite toolchain available
- replaced the sample-project-only generic page workflow with actual editable forms for project metadata, items, groups, containers, positions, containments, topologies, constraints, and preferences
- added editable list views with remove actions so the authored generic model can be changed directly in the browser
- verified the updated frontend builds successfully with `npm run build`
- repaired the previously corrupted tail of `src/pages/generic/index.js` in small incremental edits instead of a full-file rewrite
- restored the board-style generic page render path so it uses `renderWorkspace(...)` rather than the broken legacy `renderNodeList(...)` path
- restored generic-page action wiring for add, remove, validate, solve, inline label editing, and inline container capacity editing
- updated `src/styles.css` in small incremental edits to support the repaired board-style generic page layout, creation cards, entity boards, chips, sidebar panels, and responsive behavior
- verified the updated board-style CSS with a successful `npm run build`
- updated `docs/01-feature-generic-constraint-page.md` to match the implemented board/dashboard workspace, inline editing behavior, sidebar-driven relation authoring, and lower audit/result sections
- improved the generic page lower sections by reintroducing the project summary hero in the render path and styling relations, constraints, validation, normalization, and solve output as paired audit/result cards
- verified the lower-section presentation changes with a successful `npm run build`
- added Enter-key submission for simple generic-page creation fields so item, group, container, and position creation can be triggered directly from the keyboard
- extended Enter-key submission to relevant relation and rule authoring fields in the sidebar so containment, adjacency, hard constraints, and soft preferences can also be added from the keyboard when the focused field is a final submit-relevant control
- updated generic-page audit tables so relations and rules display user-visible labels together with stable ids instead of ids alone
- updated `docs/01-feature-generic-constraint-page.md` to document broader Enter-key add behavior and label-first relation display expectations
- reviewed the normalized project shape and solver boundary before implementing a first real solving pass
- implemented a first real container-mode backtracking solver in `src/solver/adapters/firstSolverAdapter.js` supporting container capacities, must-share components, must-not-share constraints, up to 10 solutions, and solved/unsat results
- improved generic-page solve result rendering so solved assignments are displayed grouped by container, with raw solver JSON kept in a details panel for debugging
- added light solution-list styling for grouped container assignment display
- verified the new solver adapter and result rendering with a successful `npm run build`
- added simple multi-solution navigation to the generic-page solve result area so users can move between returned solutions one at a time while keeping the grouped-by-container presentation
- stored the currently viewed solution index in generic-page editor state and reset it when derived solver state is cleared or a new solve completes
- updated `docs/01-feature-generic-constraint-page.md` to document multi-solution navigation expectations in the generic page
- verified the multi-solution navigation changes with a successful `npm run build`
- replaced the old top workflow card with a sticky always-visible command bar containing validate, validate + normalize + solve, and reset project actions
- added simple text-based icons to the command bar actions to improve scanability without introducing dependencies
- updated `docs/01-feature-generic-constraint-page.md` to describe the sticky workflow command bar behavior and acceptance expectations
- verified the sticky command bar changes with a successful `npm run build`
- extracted grouped solve-result rendering and multi-solution navigation into reusable shared components under `src/components/solutions`
- created `src/components/solutions/containerAssignmentView.js` for grouped-by-container assignment rendering
- created `src/components/solutions/solutionNavigation.js` for reusable previous/next solution controls
- updated `src/components/solutions/solutionPanel.js` to compose the new shared solution subcomponents
- simplified `src/pages/generic/index.js` action binding so shared solution navigation continues to work through shared `data-action` hooks
- verified the shared solution-component extraction with a successful `npm run build`
- added lightweight save draft, load draft, import JSON, and export JSON actions to the sticky command bar using the existing storage module boundary
- wired command-bar storage actions in `src/pages/generic/index.js` to `src/storage/localDrafts.js`, `src/storage/importExport.js`, and `src/storage/modelVersioning.js`
- added command-bar feedback messaging for storage success and error states
- styled the new import/export controls and inline storage feedback in `src/styles.css`
- verified the storage action changes with a successful `npm run build`
- hardened import and load flows so migrated projects are validated before replacing current editor state
- added lightweight imported-project validation helpers in `src/pages/generic/index.js` using the existing `validateProject(...)` pipeline and current solver capabilities
- updated storage failure messaging to surface summarized validation errors for invalid imported or restored projects
- expanded `src/storage/importExport.js` to coerce imported data onto the expected top-level project shape before semantic validation
- verified the hardened import/load validation changes with a successful `npm run build`
- improved storage/import UX with richer command-bar feedback details for import and draft restore outcomes
- added expandable storage feedback details showing version compatibility, validation errors, and validation warnings
- added explicit version-difference and missing-version warnings through `src/storage/modelVersioning.js`
- updated command-bar storage feedback styling to support warning states and detailed validation issue lists
- verified the richer storage/import UX changes with a successful `npm run build`
- implemented a first explicit version-compatibility policy in `src/storage/modelVersioning.js` with semver parsing, minimum supported version handling, same-major warn-vs-block rules, and migration classification statuses
- updated import and draft-load flows in `src/pages/generic/index.js` to block incompatible versions before migration and validation, while still surfacing structured version details in command-bar feedback
- verified the version-policy changes with a successful `npm run build`
- updated `docs/05-feature-import-export.md` to match the implemented version policy, including warn-versus-block rules, import workflow staging, tolerated missing-version handling, and acceptance expectations
- verified the docs alignment update with a successful `npm run build`
- revised `docs/03-feature-school-class-creation.md` to shift the school page fully toward school-only language, add Student/Teacher/Level/Class concepts, describe level-compatible classes including mixed-level classes, and capture example school rules and preferences
- clarified in the school spec that import/export remains shared generic functionality, with school-specific behavior limited to opening the correct page via `viewHint`
- verified the school-spec update with a successful `npm run build`
- updated `docs/02-feature-wedding-table-plan.md` to require a readable spreadsheet export for solved seating plans suitable for wedding planners and venue coordination
- updated `docs/03-feature-school-class-creation.md` to require a readable spreadsheet export for solved class distributions suitable for teachers and school staff
- updated `docs/05-feature-import-export.md` to clarify that wedding and school spreadsheet exports are domain-facing solved outputs and do not replace shared JSON persistence
- updated `docs/06-feature-solution-display-and-scoring.md` to note that wedding and school solved-result exports should derive from the shared normalized solved result structure
- verified the spreadsheet-export documentation updates with a successful `npm run build`
- refined `docs/03-feature-school-class-creation.md` so Teacher, Level, accepted-level, and mixed-level-class semantics are implementation-ready rather than descriptive only
- cleaned stray diff-marker corruption from `docs/03-feature-school-class-creation.md` while refining the school spec
- decided the MVP school solve flow will assign students directly to classes while treating teachers as class-linked actors that influence eligibility and display rather than as independently assigned solver participants
- decided school-authored Item nodes should be distinguishable through page-facing metadata such as `schoolRole`, while school-authored Container nodes should carry page-facing metadata such as `acceptedLevelIds` and `teacherIds`
- implemented explicit school-domain transform helpers in `src/core/transform/domainMappings.js` for student versus teacher role detection, student-level lookup, class accepted-level lookup, mixed-level class detection, teacher-class associations, and derived teacher-linked assignment hints
- implemented the first real school panel in `src/pages/school/index.js` with school-language editing for students, teachers, levels, classes, accepted levels, teacher-class links, hard rules, and preferences 🏫
- extended `src/app/state.js` with initial school-page editor state so the school panel can preserve draft values cleanly
- updated `src/styles.css` with school-panel-specific styling for the new school workspace, checkbox chips, and school summary cards
- wired the school panel into the shared validate → normalize → solve pipeline using the existing validation panel and shared solution panel components
- added school-page workflow state in `src/app/state.js` for school validation, normalized output, solver results, and active solution navigation
- extended `src/pages/school/index.js` with a school workflow command bar, school-to-solver transform step, validation rendering, normalization rendering, solve actions, and shared multi-solution navigation
- extended `src/solver/adapters/firstSolverAdapter.js` so item metadata can restrict allowed and forbidden container ids, enabling school-derived level and teacher eligibility hints without changing the generic core model
- verified the school pipeline integration with a successful `npm run build`
- added a dedicated school-language validation layer in `src/pages/school/validateSchoolProject.js` for missing student levels, classes with no accepted levels, no-compatible-class cases, undersized total capacity, teacher-without-class guidance, and impossible teacher-linked together/separate rules
- fixed school-domain transform mismatches in `src/core/transform/domainMappings.js` so containment reads `from/to`, constraints/preferences read `leftRef/rightRef`, and school summary capacity reflects container `maxCapacity`
- integrated school-language validation into `src/pages/school/index.js` before the generic validation pipeline, merged school and generic validation results, and improved school-page status messages so unfamiliar users get clearer guidance when solve is blocked or unsat
- updated `docs/03-feature-school-class-creation.md` to require school-language validation messages and explicit handling of no-compatible-class, teacher-without-class, and impossible teacher-linked rule cases
- verified the new school validation and transform fixes with a successful `npm run build`
- changed school class semantics so an empty accepted-level selection now means the class accepts all levels, both in UI wording and in solver compatibility logic
- fixed a school solve-transform bug in `src/pages/school/index.js` where teacher level-membership containments were left behind after teachers were removed from solver items, causing generic validation errors such as `unknown-containment-target` during school solve/validate flows
- updated `src/pages/school/validateSchoolProject.js` so classes with no selected levels now produce a school-language warning about accepting all levels instead of a validation error
- updated `docs/03-feature-school-class-creation.md` to document that empty accepted-level selection means an unrestricted class that accepts all levels
- verified the unrestricted-class and containment-fix changes with a successful `npm run build`
- updated shared solution rendering so school solved class cards now show linked teachers and accepted levels in addition to assigned students
- wired `src/pages/school/index.js` to pass the authored school project as display context to the shared solution panel, so teacher and level labels remain visible even though teachers are not direct solver assignments
- updated `docs/03-feature-school-class-creation.md` to require linked teachers on solved class cards in the MVP school page
- verified the school solution-display enrichment with a successful `npm run build`
- added an MIT `LICENSE` file for the project
- created a new root `README.md` describing the app purpose, current MVP scope, stack, setup, project structure, and licensing
- added `vite.config.js` with the GitHub Pages base path for the `solve_me` repository
- added `.github/workflows/deploy.yml` to build and deploy the Vite site to GitHub Pages on pushes to `main`
- added a root `.gitignore` for dependency and build artifacts
- updated `README.md` with GitHub Pages setup, deployment flow, expected site URL, and repository-name/base-path notes
- verified that GitHub Pages deployment works for the current repository setup
- decided school spreadsheet export should use a real `.xlsx` workbook for teacher-facing usability instead of CSV or a renamed fake spreadsheet file
- added the `xlsx` dependency to generate real Excel workbooks in the browser
- created `src/pages/school/exportSchoolSolution.js` to export the selected solved school solution as a multi-sheet `.xlsx` workbook with Summary, Classes, and Students sheets
- added an `Export Excel` action to the school command bar, enabled only when a solved school result exists
- wired school export feedback into the existing school-page status messaging so successful and failed exports are surfaced clearly
- updated `docs/03-feature-school-class-creation.md` to make the `.xlsx` baseline explicit and document the student-oriented sheet in the recommended export structure
- created `src/pages/school/importSchoolWorkbook.js` to import teacher-facing school workbooks into the shared generic project shape
- added an `Import Excel` control to the school command bar supporting `.xlsx` and `.xls` file selection
- implemented the current school workbook import baseline: `Students` sheet required, `Classes` sheet optional, `Student` column required, and optional `Level`, `Class`, `Teachers`, `Accepted levels`, and `Capacity` enrichment when present
- updated `docs/03-feature-school-class-creation.md` and `docs/05-feature-import-export.md` to document school workbook import behavior and its relationship to canonical JSON persistence
- verified the school import/export changes with a successful `npm run build`

Review findings:

- MVP staging versus capability-aware features needed alignment
- group-group togetherness needed clearer MVP guidance
- persisted project metadata needed an optional page/view hint
- result display needed a clearer distinction between validation failure, unsat, truncation, and interrupted partial results
- semantics needed a clearer default rule for preprocessing group-level relations and explicit support for multiple group membership
- implementation planning also needed a clearer separation between generic core modules and page-specific mapping logic
- the generic page now exercises the pipeline end to end and has become a basic real editor, though it is still a single-page MVP editor without shared reusable form components
- the school page needed clearer domain wording so users are not exposed to generic constraint-solving terminology and can think only in terms of students, teachers, levels, classes, and school relationships
- the school page now runs the shared validate → normalize → solve workflow, but its transform step still uses a narrow MVP mapping that converts school semantics into item-level allowed and forbidden container ids rather than a richer dedicated normalization stage
- specialized pages also need domain-facing spreadsheet exports for solved outputs so operational users such as teachers and wedding planners can read and share results without using the generic JSON persistence format
- the school page had field-name mismatches in its transform helpers (`parent/child` vs `from/to`, `left/right` vs `leftRef/rightRef`) that would have hidden level membership and teacher-linked rule effects until corrected
- the school solve transform also left teacher membership containments behind after filtering teachers out of solver items, which produced `unknown-containment-target` validation errors until corrected
- the shared solution panel previously showed only directly assigned solver items, so school-linked teachers were invisible in solved class cards until the display layer was enriched with authored-project metadata context
- the repository did not yet have a root open-source license file or a project README, which made distribution and onboarding less clear
- GitHub Pages hosting for this Vite app requires an explicit repository base path and a deployment workflow; without those, static assets would break when served from `/solve_me/`
- school solved-result export needed a format decision; teacher-facing usability favored a real `.xlsx` workbook over CSV or extension spoofing
- school workbook import needed a minimum required structure; the agreed baseline is that a `Students` sheet must exist and its first mandatory column is `Student`, while a `Classes` sheet is optional

Fixes applied:

- aligned architecture wording with capability-aware incremental implementation
- added project metadata guidance including optional `viewHint`
- clarified default normalization/preprocessing behavior for group-level relations
- clarified that group-group togetherness exists in abstract semantics but should not be exposed by default in MVP UIs
- clarified wedding seat-aware capacity consistency rules
- clarified solution and execution-state distinctions in result presentation
- defined a `/src` structure that keeps core semantics generic and isolates domain-specific mappings from the normalized model
- established a shared entity reference shape `{ kind, id }` across relations, constraints, preferences, and assignments for the MVP core model
- added initial validation coverage that enforces the distinction between containment structure and assignment-mode-dependent adjacency semantics
- added a first normalization pipeline that derives expanded and deduplicated solver-ready structures from the authored project model
- wired the generic page through validation, normalization, capability checking, and adapter solve attempts
- preserved a minimal UI by surfacing raw normalized JSON and raw solver result output until richer editors and shared solution components exist
- converted the generic page from a sample loader into a direct-edit MVP editor that mutates the normalized project shape in memory and clears derived workflow results when authored data changes
- added scoped keyboard submission behavior for creation fields and final submit-relevant relation/rule fields, while still leaving non-submit metadata editing on normal input behavior
- made relation and rule audit displays label-first while preserving ids for traceability
- established the first real solver scope as container-mode item assignment only, with must-share and must-not-share hard constraints enforced after normalization
- decided the generic page should now present real solved assignments in a human-readable grouped view before raw JSON, while still keeping raw output available for debugging
- decided multi-solution navigation can stay page-local for now as a simple previous/next control until solution rendering is extracted into shared components
- decided the generic page should keep core workflow actions in a sticky command bar with lightweight text icons so actions remain visible while scrolling without adding an icon library dependency
- decided grouped solve-result rendering and solution navigation should now live in small composable shared solution components, while the generic page remains responsible only for wiring state and handling actions
- decided sticky command bar storage actions can remain lightweight MVP affordances implemented directly in the generic page for now, while still routing persistence work through the shared storage modules
- decided imported and restored projects should pass through shape coercion, migration, and the existing validation pipeline before any state replacement occurs
- decided version compatibility should currently be surfaced as explicit user-facing warnings rather than hard import blockers until real incompatible-version migration boundaries exist
- decided the storage layer now uses a concrete MVP version policy: missing or unparseable versions warn, same-version imports pass, same-major older/newer minor-or-patch versions warn, versions older than the minimum supported version fail, and newer or older major versions fail until dedicated migrations exist
- decided import/load UX should block incompatible versions before migration and validation rather than relying on generic catch-all migration behavior
- decided the school page spec should avoid exposing generic solver vocabulary and instead present school concepts only, with the mapping to generic Items, Groups, and Containers remaining internal
- decided the school page should now explicitly include Teacher and Level concepts, with Level as the main user-facing replacement for generic Group in this domain
- decided the school MVP mapping will use item metadata such as `schoolRole` to distinguish students from teachers without changing core generic semantics
- decided the school MVP mapping will use container metadata such as `acceptedLevelIds` and `teacherIds` to represent level compatibility and teacher-class associations in the transform layer
- decided mixed-level classes should be represented only as classes accepting multiple levels rather than through any special generic node type
- decided teacher-student rules in the MVP school flow should be translated into derived class eligibility hints based on teacher-class associations rather than full teacher assignment solving
- decided the first school panel can write directly into the shared generic project structure in memory, while still presenting only school-facing language in the UI
- decided the initial school panel should expose the underlying shared project JSON temporarily as a debug bridge even after pipeline wiring, so the authored shared model and derived solve path remain easy to inspect while the school transform layer evolves
- decided the narrowest viable school solve integration is to derive per-student `allowedContainerIds` and `forbiddenContainerIds` from accepted levels and teacher-linked rules, then let the existing generic container-mode solver enforce those hints
- decided school-specific import/export behavior should not fork from the shared generic persistence feature; only the `viewHint` should influence reopening in the school page
- decided wedding and school pages should provide domain-appropriate spreadsheet exports for solved results, but those exports are presentation outputs rather than canonical project persistence
- decided spreadsheet exports should be derived from the shared solved-result structure so display and export remain consistent across pages
- decided school-specific validation should live alongside the school page and run before or alongside the generic pipeline so domain-facing errors can be phrased in school language for unfamiliar users
- decided that when users create students, classes, and teachers without restrictive rules, solving should still be possible as long as capacities and level compatibility permit it; an underconstrained school scenario is still solvable and may yield one valid distribution or multiple possible distributions
- decided that in the school page, a class with no selected accepted levels should be treated as unrestricted and accept all levels rather than being treated as invalid
- decided the shared container-assignment display can stay generic while accepting optional display-context data, allowing the school page to show linked teachers and accepted levels without changing the solver result shape
- decided the repository should now include a standard MIT license and a concise root README aligned with the current implemented MVP rather than the longer design-history documents alone
- decided GitHub Pages deployment should use the standard GitHub Actions Pages workflow and a fixed Vite `base` of `/solve_me/` because the site is served from a project repository rather than a user-site root
- decided the first domain-facing solved export implementation should be a real browser-generated `.xlsx` workbook using `xlsx`, because teachers are better served by a native spreadsheet file than by CSV and because fake `.xls` files would create confusing compatibility warnings
- decided the school workbook should currently include three sheets: `Summary`, `Classes`, and `Students`
- decided school workbook import should intentionally be simpler than full JSON persistence: it is a convenience entry format, not a lossless representation of all school-page features
- decided the current workbook import baseline should accept workbooks with only a `Students` sheet, infer placeholder classes from the optional `Class` column there, and enrich classes further only if a `Classes` sheet is present

Files modified:

- `status.md`
- `index.html`
- `package.json`
- `src/main.js`
- `src/styles.css`
- `src/app/bootstrap.js`
- `src/app/router.js`
- `src/app/state.js`
- `src/pages/generic/index.js`
- `docs/01-feature-generic-constraint-page.md`
- `src/pages/wedding/index.js`
- `src/pages/school/index.js`
- `src/pages/school/exportSchoolSolution.js`
- `src/pages/school/importSchoolWorkbook.js`
- `src/pages/school/validateSchoolProject.js`
- `docs/03-feature-school-class-creation.md`
- `src/components/common/pageShell.js`
- `src/components/editors/.gitkeep`
- `src/components/forms/.gitkeep`
- `src/components/solutions/.gitkeep`
- `src/components/solutions/containerAssignmentView.js`
- `src/components/solutions/solutionNavigation.js`
- `src/components/solutions/solutionPanel.js`
- `src/core/model/ids.js`
- `src/core/model/project.js`
- `src/core/model/nodes.js`
- `src/core/model/relations.js`
- `src/core/model/constraints.js`
- `src/core/model/preferences.js`
- `src/core/model/assignmentModes.js`
- `src/core/model/solution.js`
- `src/core/normalize/normalizeProject.js`
- `src/core/normalize/expandGroupRelations.js`
- `src/core/normalize/buildTopology.js`
- `src/core/normalize/computeMustShareComponents.js`
- `src/core/validate/validateProject.js`
- `src/core/validate/validateStructure.js`
- `src/core/validate/validateConstraints.js`
- `src/core/validate/validateCapabilities.js`
- `src/core/transform/viewModelAdapters.js`
- `src/core/transform/domainMappings.js`
- `docs/03-feature-school-class-creation.md`
- `src/solver/solverAdapter.js`
- `src/solver/solverCapabilities.js`
- `src/solver/solverResult.js`
- `src/solver/adapters/firstSolverAdapter.js`
- `src/storage/localDrafts.js`
- `src/storage/importExport.js`
- `src/storage/modelVersioning.js`
- `src/pages/generic/index.js`
- `src/utils/collections.js`
- `src/utils/graphs.js`
- `src/utils/assertions.js`
- `src/utils/ids.js`
- `LICENSE`
- `README.md`
- `vite.config.js`
- `.gitignore`
- `.github/workflows/deploy.yml`
- `package-lock.json`

Decisions made:

- `/core/model` will hold the normalized generic model only
- `/core/transform` will hold page/domain mapping logic rather than mixing it into the core model
- `/core/validate` and `/core/normalize` remain separate modules and execution stages
- `/solver` will expose a stable adapter boundary with concrete implementations under `/solver/adapters`
- reusable solution rendering should live in shared components rather than page-specific code
- the initial scaffold will use plain JavaScript ES modules and minimal custom hash routing for the MVP foundation
- placeholder implementations are acceptable at this stage as long as module boundaries match the architecture documents
- the MVP core model will use a shared entity reference object shape `{ kind, id }` for cross-entity operands
- validation should return structured issues with `level`, `code`, `message`, and `path`
- capability validation may return warnings for degradable soft-preference support and errors for unsupported required hard features
- the first generic page workflow can be intentionally minimal and may expose raw normalized JSON and raw solver result data before richer editors and shared solution components exist
- the MVP generic editor can operate as a single-page in-memory editor before extracting shared form components or persistence flows
- the board-style generic page should be stabilized with CSS-first incremental passes when possible, to reduce risk after restoring the page logic
- the feature spec should be updated promptly after meaningful UI direction changes so the docs stay aligned with the implemented workspace behavior
- Enter-key add behavior should stay scoped to creation inputs and explicitly submit-relevant relation/rule fields unless broader form-submission semantics are designed intentionally
- relation and rule audit displays should prefer label-first rendering while retaining ids for disambiguation and debugging
- the first real solver adapter should stay intentionally narrow: container mode only, hard constraints limited to must-share and must-not-share, preferences ignored with warnings, and positions/topologies ignored with warnings

Open questions or risks:

- whether to keep plain JavaScript only or add JSDoc typing for the core model contracts soon
- whether the first solver adapter should remain a simple in-browser backtracking engine for the MVP or later be replaced by a stronger adapter with optimization support
- whether container capacity should stay in node metadata for MVP or move to a more explicit dedicated structure soon
- normalization currently expands group relations pairwise, which may create large derived models for large groups and may later need optimization
- must-share capacity checks are currently coarse and compare against maximum available capacity rather than richer container feasibility analysis
- validation is stronger now but still incomplete for advanced contradiction detection, overlapping propagated group rules, and full solver-facing normalization details
- the first real solver currently ignores container minimum capacities when deciding satisfiability and only enforces maximum capacity during search
- the current backtracking solver now has grouped display plus simple multi-solution navigation extracted into shared solution components, but only the generic page consumes them so far
- the generic editor currently uses direct in-memory mutations and re-rendering rather than a more structured state/update architecture
- imported data now passes through parse, top-level shape coercion, version-policy classification, migration, and the existing project validation pipeline before state replacement, with incompatible versions now blocked explicitly; however, migration branches are still mostly pass-through because only model version `0.1.0` is currently known
- the new version policy assumes semver-style `major.minor.patch` strings; if model versioning later needs prerelease/build metadata or non-semver formats, the compatibility parser and policy will need extension
- the school MVP mapping now treats teachers as class-linked actors rather than independently assigned participants, but the exact future evolution path for full teacher assignment solving still remains open
- the school page currently derives allowed and forbidden class eligibility only for students; teacher-linked soft preferences are still displayed and stored but not consumed by the first solver adapter beyond its standard warning that preferences are ignored
- the current school transform step filters teachers out of direct solver assignment, which matches the MVP decision, but future teacher-assignment solving would require a broader transform and likely solver changes
- teacher-linked soft preferences are still not converted into solver-consumed optimization signals; they remain visible and stored, but the first solver still warns that preferences are ignored
- school-specific validation now covers several important authoring mistakes in school wording, but it is still page-local and not yet extracted into a broader reusable domain-validation boundary
- the school spreadsheet-export requirement now has an initial implementation with real `.xlsx` generation, but the wedding page still needs its own export implementation and the long-term shared export abstraction is still open
- the new school workbook import currently covers teacher-facing roster/class entry only; it does not attempt to reconstruct hard rules, soft preferences, or every page-level setting from spreadsheets
- the added `xlsx` dependency increases bundle size noticeably, and the new workbook import/export path pushed the built JS chunk above Vite's 500 kB warning threshold, so future work may need lazy-loading or chunking improvements
- any future repository push still depends on local GitHub authentication being available in the execution environment; remote push may fail without user credentials or token configuration
- if the repository name changes from `solve_me`, the GitHub Pages deployment will break until `vite.config.js` is updated to match the new repository path
- GitHub Pages deployment also depends on the repository Pages setting being configured to use GitHub Actions as the source
- unrestricted classes are now allowed in the school page, but if many classes are left unrestricted the solve space may grow quickly and later may need better guidance or heuristics for large scenarios
- the shared container-assignment view now shows school-linked teachers and accepted levels when container metadata is available, but other domain pages may need clearer opt-in presentation rules if they later attach additional metadata to containers
- the generic editor UI now has a more consistent workspace-plus-audit layout plus sticky command bar, but the lower sections are still primarily tabular/debug-oriented and may later need stronger prioritization, collapsing, or progressive disclosure
- Enter-key handling is now implemented for simple node creation and selected relation/rule submit fields, but the interaction model is still field-name-driven and may later need a more explicit form-level abstraction
- large single-file edits can fail or leave files partially corrupted in this environment, so future work should prefer smaller chunked edits and intermediate verification reads

Recommended next step:

- manually test the new school `Import Excel` and `Export Excel` actions together with representative teacher-facing workbooks, including the minimal case with only a `Students` sheet and the richer case with both `Students` and `Classes`
- then decide whether workbook parsing and workbook generation should be lazy-loaded or split into shared spreadsheet utility boundaries to reduce bundle weight before extending spreadsheet support further
- after that, implement the wedding solved-result export using the same real `.xlsx` approach unless a domain-specific reason suggests a different workbook layout

## Restart prompt for a new context

Use the following prompt in a fresh context:

```text
Read `status.md` first and use it as the source of truth for project continuity.
Then read these files in order:
- `docs/00-core-architecture.md`
- `docs/07-feature-domain-model-and-semantics.md`
- `docs/01-feature-generic-constraint-page.md`
- `src/pages/generic/index.js`
- `src/components/solutions/solutionPanel.js`
- `src/components/solutions/containerAssignmentView.js`
- `src/components/solutions/solutionNavigation.js`
- `src/app/state.js`
- `src/core/validate/validateProject.js`
- `src/core/normalize/normalizeProject.js`
- `src/solver/adapters/firstSolverAdapter.js`
- `src/styles.css`

Important points to preserve:
- the core model must remain generic
- Group and Container are distinct concepts and must not be merged
- containment is membership, not assignment
- adjacency must be modeled through positions and topology, not domain-specific logic
- hard constraints and soft preferences must remain distinct

Current expected task:
- use the editable generic modeling page, refreshed board-style CSS, sticky command bar, updated generic-page spec, current Enter-key submission behavior, label-first audit tables, working container-mode solver, extracted shared solution-display components, richer validated storage feedback, refined school-domain mapping, implemented school panel, wired school pipeline, and newly implemented school `.xlsx` import/export baseline as the baseline
- preserve the repository metadata and hosting files: `LICENSE` is MIT, `README.md` documents onboarding and deployment, `vite.config.js` sets the GitHub Pages base path, and `.github/workflows/deploy.yml` performs the Pages build/deploy
- keep the current validate -> normalize -> solve sequence intact
- treat the current storage version policy in `src/storage/modelVersioning.js` as the baseline: missing/unparseable versions warn, same-major minor-or-patch differences warn, unsupported major-version differences fail, and too-old versions fail
- treat the version-policy documentation in `docs/05-feature-import-export.md` as the current baseline and extend migration branches if a new schema version is introduced
- use `docs/03-feature-school-class-creation.md`, `src/core/transform/domainMappings.js`, and `src/pages/school/validateSchoolProject.js` as the current source of truth for school semantics and school-facing validation: students are directly assigned, teachers are class-linked actors, levels map to groups, mixed-level classes are represented through `acceptedLevelIds`, and a class with no selected accepted levels is treated as unrestricted and accepts all levels
- use `src/pages/school/index.js` as the current implementation baseline for the school editor and school solve flow: it now supports school-language authoring plus school validation → generic validation → normalize → solve, derives per-student `allowedContainerIds` and `forbiddenContainerIds` for the existing container-mode solver, strips non-student containments from the solver-facing project so school validation does not produce spurious `unknown-containment-target` errors, passes the authored school project into the shared solution panel so linked teachers and accepted levels appear on solved class cards, and exposes both `Import Excel` and `Export Excel` actions for teacher-facing workbook flows
- use `src/pages/school/exportSchoolSolution.js` as the current export baseline: it generates a real `.xlsx` workbook with `Summary`, `Classes`, and `Students` sheets from the authored school project plus the selected solver solution
- use `src/pages/school/importSchoolWorkbook.js` as the current import baseline: it requires a `Students` sheet with a `Student` column, optionally reads `Level` and `Class` there, optionally enriches classes from a `Classes` sheet, and converts the workbook into the shared generic project shape with `viewHint: school`
- preserve the product rule that if users simply create students, classes, and teachers without adding restrictive rules, solving should still be possible as long as capacities and level compatibility permit it; in that situation the solver may return a valid distribution or multiple possible distributions rather than reporting an error just because the model is underconstrained
- deployment is already confirmed working at `https://tristanfaure.github.io/solve_me/`
- first, manually test the new school `.xlsx` import/export round-trip with representative teacher-facing workbooks and confirm both minimal and richer workbook variants behave as expected
- then decide whether workbook parsing/generation should share a common spreadsheet utility layer or be lazy-loaded before extending the same pattern to other pages
- then consider whether to give the wedding page a comparable real editor and pipeline integration pattern alongside its own solved-result export

Note:
- dependencies are now installed and `npm run build` succeeds in the current environment
- the repository currently assumes the GitHub Pages project URL path `/solve_me/`; if the repository is renamed, update `vite.config.js`

Before finishing, update `status.md` with:
- what you reviewed or changed
- files created or modified
- decisions made
- open questions or risks
- the next recommended step
- an updated restart prompt matching the new project stage

Important workflow note:
- prefer small file operations and chunked repairs over large whole-file rewrites, especially for long UI files
```

## How to resume in a new prompt

Short instruction if needed:

- Read `status.md` first.
- Follow the restart prompt written inside `status.md`.

## Notes for future agent

- Update `status.md` before finishing your turn whenever you make meaningful progress.

- Keep the model generic.
- Do not collapse containment into assignment.
- Do not introduce domain-specific semantics into the core if they can be represented structurally.
- Treat adjacency as a topology relation between positions.
- Respect the difference between hard constraints and soft preferences.
