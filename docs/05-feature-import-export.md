# Feature: Import and Export

## Goal

Allow users to save, restore, exchange, and continue working on problem definitions without requiring a database, while keeping project data compatible with the shared normalized model.

## Scope

This feature includes:

- export of project data to JSON
- import of project data from JSON
- local draft persistence in browser storage
- versioning metadata for saved files
- validation of imported project data
- compatibility handling for future schema evolution
- shared persistence rules that coexist with separate domain-facing spreadsheet exports for operational use
- distinct Share & Edit, Configuration backup, and Solution workbook purposes for School, Wedding, and Event Staffing

## Implemented Share & Edit contract

School, Wedding, and Event Staffing each expose one self-contained `Share & Edit` sheet. The sheet includes project/purpose/revision/identity metadata, localized English or French instructions and headers, a hidden canonical-header row, hidden stable IDs, filters, frozen headers, and formula-neutralized values. Identity may use full name, email, or administrator code; stable IDs take precedence during matching and unmatched visible keys create participants.

Imports are parsed through the bounded XLSX Worker, validated into an immutable preview, and applied only after administrator confirmation. Duplicate identities, ambiguous matches, self-relations, contradictory columns, stale slot mappings, invalid values, and unknown administrator-owned references block application. Omitted participant rows remain unchanged; deleting a row never deletes a participant.

School and Wedding use semicolon-separated relationship lists. Hard outcomes are deduplicated symmetrically, while soft votes retain directional provenance and aggregate their solver weight. Event Staffing uses one row per person/group, dynamic slot columns, explicit blank-to-neutral replacement, new-person creation, and personalized participant exports. Existing Configuration and Solution workbook formats remain separate and compatible.

## Out of scope

This feature does not define:

- cloud sync
- user accounts
- multi-user collaboration
- encrypted storage
- arbitrary binary formats for the generic page; its canonical interchange remains JSON
- guaranteed backward compatibility across unlimited schema changes
- editing readable spreadsheet cells other than the documented Event Staffing preference matrix

## User stories

- As a user, I want to save my current work without needing an account.
- As a user, I want to reopen a previously saved problem later.
- As a user, I want to share a problem definition with someone else.
- As a user, I want imported data to be validated before it affects my current work.
- As a user, I want the app to recover my in-progress work after a reload.
- As a user, I want clear warnings if an imported file is outdated or incompatible.

## Relationship to the architecture

This feature implements the persistence and interchange strategy described in `docs/00-core-architecture.md`.
It must work for the generic page and all domain-specific pages because they all rely on the same normalized project model.

## Functional requirements

### JSON export

- The application must allow exporting the current project to a JSON file.
- The exported file must contain all information necessary to restore the project state.
- The exported file must use the complete persisted configuration for the active use case rather than transient editor, validation, progress, or solver-result state.
- The exported file must include schema or format version metadata.
- The exported file should include human-readable labels when available.

### JSON import

- The application must allow importing a JSON file representing a saved project.
- The imported data must be validated before replacing current state.
- If import succeeds, the application must rebuild the normalized project state.
- If import fails, the current state must remain unchanged.
- The import flow should provide useful error messages when validation fails.
- Generic, School, Wedding, and Event Staffing expose the same JSON configuration card in Setup while retaining their existing workbook workflows.
- JSON uploads are limited to 2 MB and nesting depth 64, require an object root, reject dangerous prototype keys and sensitive credential-like fields, and replace non-empty work only after confirmation.

### Local draft persistence

- The application must store a local draft in browser storage such as localStorage.
- The application should restore the local draft on reload or on explicit user request.
- The application should allow clearing the local draft.
- The application should avoid silently overwriting a recoverable draft without warning.

### Versioning and compatibility

- Saved project data must include a format version.
- The application should support migration logic for compatible older versions when feasible.
- The application should separate model version from application version when useful.
- The MVP version policy uses semantic-version-style `major.minor.patch` model versions.
- If version metadata is missing, the application may continue import or draft restore with a warning and assume the current model version during migration.
- If version metadata is present but not parseable as `major.minor.patch`, the application may continue with a warning that compatibility could not be verified.
- If the saved model version exactly matches the current model version, import should continue without a version warning.
- If the saved model version differs only by minor or patch within the same major version, import may continue with a warning.
- If the saved model version is older than the minimum supported version, import must fail until a dedicated migration path exists.
- If the saved model version is from an older or newer unsupported major version, import must fail until a dedicated major-version migration path exists.

## Data included in persisted project files

The exported project should include at least:

- project metadata such as title or description when available
- optional UI metadata such as `viewHint` or `scenarioTemplate` when available
- items
- groups
- containers
- positions when used
- containment relations
- topology relations such as adjacency when used
- hard constraints
- soft preferences
- solver configuration relevant to rerunning the model
- format version metadata

Optional future additions:

- UI preferences
- page-specific display settings
- last viewed solution index

## Persistence model principles

- Persist normalized project data, not transient UI-only state.
- Keep the saved format portable across generic and specialized pages.
- Preserve enough information to reopen a project in the most appropriate page when possible.
- Avoid storing derived data that can be recomputed safely.
- Treat `viewHint` or similar page-selection metadata as optional UI metadata only, never as part of core semantics.
- Keep JSON import/export as the shared persistence mechanism even when some domain pages also provide separate spreadsheet exports for human-readable solved outputs.

## Suggested file structure

A saved file should be JSON and may contain top-level sections such as:

- metadata
- model
- solverOptions
- persistenceInfo

Example high-level content:

- metadata: project name, optional description, created/updated timestamps, optional `viewHint`
- model: normalized nodes and relations
- solverOptions: last used solver-related settings
- persistenceInfo: schema version and migration markers

The implemented JSON shape is the versioned generic project model. Specialized configuration workbooks embed a domain-tagged, versioned JSON envelope while retaining readable domain sheets.

## Import workflow

### Recommended flow

1. User selects a JSON file.
2. Application parses the file.
3. Application validates format version and schema shape.
4. Application classifies version compatibility as pass, warn, or block according to the current version policy.
5. If the version is compatible enough to continue, the application applies migration logic if available and needed.
6. Application validates semantic correctness of the imported model.
7. Application asks for confirmation before replacing current state when appropriate.
8. Application loads the new project into the editor.

### Failure handling

If any step fails:

- show a clear message
- keep current editor state unchanged
- identify whether the issue is parse failure, version incompatibility, schema error, or semantic validation failure
- surface version warnings separately from hard version blocks when possible so users can distinguish caution from incompatibility

## Export workflow

### Recommended flow

1. User triggers export.
2. Application gathers normalized project state.
3. Application includes version metadata and relevant solver options.
4. Application serializes data to JSON.
5. Application downloads the file to the user device.

### File naming

The application should generate a sensible default file name based on:

- project title if available
- otherwise a generic fallback name
- optional timestamp suffix if useful

## Local draft workflow

### Auto-save behavior

- The application should save the current project state automatically after meaningful edits.
- Auto-save should be debounced to avoid excessive writes.
- Auto-save must store a valid serializable form of the normalized project.

### Restore behavior

- On load, the application should detect whether a local draft exists.
- The application should restore automatically or prompt the user, depending on the chosen UX policy.
- If the draft is invalid or outdated, the application should warn and offer reset.

### Clear behavior

- The user should be able to clear the local draft explicitly.
- Clearing the local draft should not affect exported files.

## Validation rules for imported data

Imported data must be validated at multiple levels.

### Parse validation

- valid JSON syntax

### Shape validation

- required top-level sections present
- expected data types present
- version metadata read from the expected project-level field when present
- missing version metadata is tolerated in the MVP with a warning rather than a hard failure

### Reference validation

- relations point to existing nodes
- positions reference valid containers
- constraints reference valid operands

### Semantic validation

- unsupported combinations are rejected according to current semantics
- adjacency-based constraints require positions and topology support
- duplicate identities are handled according to project rules
- capacity values are valid

## UX considerations

- Import and export controls should be available from a shared location, such as a toolbar or project menu.
- The application should clearly distinguish between local draft recovery and file import.
- Warnings should be understandable to non-technical users.
- Export should not require any server interaction in the MVP.

## Interaction with feature pages

- The generic page, wedding page, and school page must all use the same persistence format.
- A project created in one page should remain readable from the shared model in another page when semantically compatible.
- Domain-specific labels may be reconstructed in the UI, but the persisted data should remain generic.
- If `viewHint` is present, the application may use it to reopen the project in the most appropriate page.
- If `viewHint` is missing or unsupported, the application should still load the project through the shared normalized model.
- School, Wedding, and Event Staffing provide an editable configuration workbook before solving. A reserved `_Configuration` sheet carries a domain-tagged, versioned, chunked canonical JSON envelope so all persisted constraints, preferences, metadata, assignment arrays, positions, and topology survive round-trip.
- Configuration workbook import validates workbook bounds before decoding, verifies the domain and envelope version, migrates and validates the project, previews impact, and requires confirmation before replacement. Invalid or cancelled imports leave active state unchanged.
- Event Staffing configuration workbooks retain editable `Preferences` and stable `Slots` sheets. The same import control can apply only preference cells; legacy Preferences/Slots workbooks remain supported as merge-only inputs.
- Event Staffing preferences use one person per row, ISO dates grouped across the first header row, and slot labels in the second header row. The `Slots` sheet maps physical columns to stable slot IDs. Exports use `P`/blank/`N`/`U`; imports also accept `X`, legacy `Y`, and the documented case-insensitive words.
- School readable views use `Student`, `Levels`, `Student ID`; teacher and class rows; and `First participant`, `Rule`, `Second participant`. Wedding views similarly use guest/group/table vocabulary, with Seats and Topology later as advanced references.
- School and Wedding readable sheets are convenience views and legacy-template examples, not editable overlays on the envelope. The web UI is recommended for edits; legacy workbook formats remain convenience data-entry imports. Solved-result workbooks remain separate and are clearly named as selected-result exports.
- The generic page remains the canonical JSON import/export workflow and does not wrap arbitrary generic models in Excel.
- The school page may also support importing a teacher-facing workbook as a convenience data-entry flow, but that workbook import is page-specific and must still be converted into the shared normalized project model before validation and editing.

## Technical notes

- Local draft persistence should use a stable storage key strategy.
- The saved JSON format should be versioned from the beginning.
- Import should not trust incoming data and must validate before state replacement.
- Export and local save logic should share the same serialization path when possible.
- Migration logic should be isolated so future schema changes remain manageable.
- The current implementation stores model version information in the top-level project field `modelVersion`.
- The current implementation classifies versions before migration and validation so obviously incompatible versions are blocked early.
- The current implementation exposes compatibility results as structured status plus warning or error messages for import and draft-restore UX.
- Page-specific spreadsheet importers should validate required sheets and required columns before converting workbook rows into shared project data.
- Configuration JSON is split into numbered cells of at most 8,000 characters. Reconstruction is capped at 2 MB and depth 64; malformed ordering, dangerous prototype keys, sensitive fields, unsupported versions, and wrong-domain workbooks are rejected.
- Human-readable workbook sheets neutralize formula-leading strings. The existing `xlsx` package has two high-severity advisories with no npm fix; upload, ZIP-expansion, workbook-bound, cell-length, and Worker-timeout controls reduce but do not eliminate parser risk.
- Human-readable tabular sheets include practical column widths and auto-filters. `_Configuration` is hidden when the workbook format supports it, but import always discovers and validates it by reserved name rather than trusting hidden state.
- In the current school workbook importer baseline, a `Students` sheet is mandatory, a `Classes` sheet is optional, and the `Student` column is required in the `Students` sheet.

## Acceptance criteria

- A user can export the current project to a JSON file.
- A user can import a valid project JSON file.
- Invalid imports do not destroy the current working state.
- The application stores and restores a local draft without requiring a database.
- Saved data includes version metadata.
- Import validation covers parse, shape, reference, and semantic checks.
- Imports with missing or unparseable version metadata continue with warnings in the MVP.
- Imports with unsupported major-version differences or versions older than the minimum supported version are blocked.
- The same persistence model works across generic and specialized pages.
- Domain-facing spreadsheet workflows for wedding and school do not replace the shared JSON persistence model.
- The school page can import a teacher-facing workbook for convenience, but canonical cross-page persistence remains JSON-based.
- Specialized full-configuration imports are previewed and confirmed before replacement; Event Staffing can apply only edited preference cells.
- Browser XLSX parsing runs in a dedicated module Worker and is terminated on timeout.
