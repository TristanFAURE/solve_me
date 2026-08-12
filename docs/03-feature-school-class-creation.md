# Feature: School Class Creation

## Goal

Provide a specialized page for building and solving school class assignment problems using school-only terminology while relying on the shared generic core model behind the scenes.

The page must hide generic constraint-solving language from school users as much as possible.
Users should work with school concepts such as Class, Student, Teacher, and Level, while the tool translates those concepts into the shared normalized model and then calls the solving engine internally.

## Scope

This feature includes:

- creation and editing of students
- creation and editing of teachers
- creation and editing of classes
- creation and editing of levels
- definition of class capacities
- creation of school-language assignment rules and preferences relevant to class composition
- solver execution for class assignment
- display of one or more valid class distributions through the shared solution display layer
- spreadsheet export of solved class distributions in a format that teachers or school staff can read easily
- spreadsheet import of school-authored `.xlsx` workbooks using the same teacher-facing sheet vocabulary as the export baseline
- reopening imported projects in the school page when the saved project metadata indicates the school view

## Out of scope

This feature does not define:

- timetable scheduling
- subject planning
- classroom seating layout in the MVP
- grade management beyond assignment-relevant level tagging
- attendance tracking
- parent communication workflows
- a school-specific import/export format separate from the generic persistence layer

## User stories

- As a user, I want to create students, teachers, levels, and classes using school terms only.
- As a user, I want to define capacities for each class.
- As a user, I want to state that a student or teacher belongs to a level such as First grade or Second grade.
- As a user, I want to create mixed-level classes such as a class that accepts First and Second grade students.
- As a user, I want to express that some people must be together in the same class.
- As a user, I want to express that some people must not be together in the same class.
- As a user, I want to express soft preferences in school wording when solver capabilities allow it.
- As a user, I want the tool to run the solving engine without forcing me to understand generic constraint terminology.
- As a user, I want to run the solver and inspect valid class assignments.
- As a user, I want to export a class distribution in a spreadsheet that teachers or school staff can read and use directly.
- As a user, I want to import a school workbook prepared with the same sheet structure so I can start from an Excel file instead of retyping students and classes.
- As a user, I want to understand when the model is invalid or no valid class assignment exists.

## Relationship to the generic model

This page is a domain-specific view over the normalized model.
The user should not need to see generic labels such as Item, Group, Container, hard constraint, soft preference, or entity reference.
Those concepts remain internal implementation details.

### School-friendly labels mapped to generic nodes

- Student -> Item
- Teacher -> Item
- Level -> Group
- Class -> Container

### School-friendly labels mapped to generic relations

- student belongs to level -> contains(Group, Item)
- teacher can teach level -> contains(Group, Item) when the school wants teacher-level eligibility to be modeled explicitly
- class accepts level -> class metadata interpreted by the school-page mapping layer and enforced through derived generic constraints
- class has lead teacher or associated teachers -> school-page metadata interpreted by the school-page mapping layer and rendered back into school-language views
- must be in same class -> mustShareContainer
- must not be in same class -> mustNotShareContainer
- prefers same class -> preferShareContainer
- prefers different class -> preferSeparateContainers

### Implementation-oriented school mapping rules

The school page should map school concepts into the generic project shape using a small, explicit transform layer.
That layer should be implementation-ready rather than implicit.

#### Participant categories

Students and teachers are both stored as generic Item nodes internally.
They must remain distinguishable through school-page metadata so the UI can filter them and present school wording correctly.

Recommended internal metadata on Item nodes authored from the school page:

- `schoolRole: "student" | "teacher"`

This metadata is page-facing only.
It must not change the generic core semantics of Item.

#### Level semantics

A Level maps to a generic Group.

Level membership means:

- a student belongs to a level when that student is eligible to be placed into classes accepting that level
- a teacher belongs to a level only when the school wants to record that the teacher is eligible to teach that level

A student should normally belong to exactly one primary level in the MVP school workflow.
Mixed-level teaching is modeled through classes accepting multiple levels, not through students belonging to multiple primary levels by default.

If future schools require exceptional multi-level student membership, the transform layer may allow it, but the MVP school page should treat that as unusual and validate or warn clearly.

#### Class accepted-level semantics

A Class maps to a generic Container.

Accepted levels should be stored as school-page metadata on the class-facing container and then converted by the mapping layer into solver-enforced compatibility behavior.

Recommended internal metadata on Container nodes authored from the school page:

- `acceptedLevelIds: string[]`
- `teacherIds: string[]` for teacher associations shown in the school page

Accepted levels mean:

- a student may be assigned to a class only if the student belongs to at least one level accepted by that class
- a class with more than one accepted level is a mixed-level class
- a class with zero accepted levels is treated as unrestricted in the school page, meaning all levels are currently accepted

#### Teacher semantics for the MVP

Teachers should be implementation-ready now even if solver support remains narrower at first.

MVP decision:

- students are the primary assigned participants sent to the container-mode solver
- teachers are modeled as class-linked actors, not as independently assigned participants in the first school-page solve flow
- teacher-to-student and teacher-to-class school rules are interpreted through class eligibility and exclusion logic derived by the mapping layer

Operationally, this means:

- a teacher may be associated with one or more classes before solving
- if a teacher is attached to a class, any student hard rule involving that teacher is translated into class eligibility restrictions for the affected student
- teacher associations do not consume class capacity in the MVP unless a later requirement introduces that concept explicitly

Examples:

- `Teacher Caroline must not be with Student Alban` means Alban cannot be assigned to any class associated with Caroline
- `Teacher Caroline must be with Student Mael` means Mael must be assigned to a class associated with Caroline; if Caroline is linked to multiple classes, Mael may be placed in any of them unless narrowed further
- `Teacher Caroline prefers to be with Student Mael` becomes a derived soft preference favoring classes associated with Caroline when solver capabilities allow it

The MVP school page should not yet expose free-form teacher assignment solving unless a later solver step is designed specifically for that.

#### Mixed-level class semantics

Mixed-level classes are supported in the MVP school view through accepted levels on classes.
They do not require any special generic node type.

Semantics:

- a mixed-level class accepts students from more than one level
- must-share and must-not-share rules still operate on participants, not on levels
- level compatibility is a feasibility filter applied before or during solver mapping

Examples:

- Class C accepting First grade and Second grade can contain students from either level
- if Alban is in First grade and Leandre is in Second grade, a must-share rule between them is feasible only if at least one class accepts both levels and has enough capacity

#### Derived generic constraints from school data

The transform layer should derive generic solver inputs using these rules:

1. Student-to-student together or separate rules map directly to generic constraints or preferences.
2. Teacher-linked hard rules are converted into allowed-class or forbidden-class restrictions for the affected student based on teacher-class associations.
3. Level compatibility is enforced as assignment eligibility, not as containment assignment.
4. Mixed-level support is represented only by multiple accepted levels on a class.
5. The generated generic project must remain container-mode in the MVP school page.

### Page-language rule

The school page must speak in school language only.
For example, the UI should say:

- Student
- Teacher
- Level
- Class
- Must be together
- Must not be together
- Prefers to be together
- Prefers not to be together

The UI should not expose phrases such as:

- Item
- Group
- Container
- mustShareContainer
- mustNotShareContainer
- preference weight unless deliberately phrased in a school-friendly way

## Functional requirements

### Student management

- The page must allow creating, renaming, and deleting students.
- Each student must have a stable identifier and a visible display name.
- The page must allow assigning a student to one or more levels when the school model requires it.
- The page may allow optional metadata fields later, but they are not required in the MVP.

### Teacher management

- The page must allow creating, renaming, and deleting teachers.
- Each teacher must have a stable identifier and a visible display name.
- The page must allow associating a teacher with one or more classes for the MVP mapping.
- The page may optionally allow assigning teachers to levels to express teaching eligibility.
- Teachers participate in class-assignment rules using the same school-language rule builder as students.
- In the MVP solve flow, teachers are modeled as class-linked actors whose relations affect student-to-class eligibility rather than as independently assigned participants.

### Class management

- The page must allow creating, renaming, and deleting classes.
- The page must allow defining a capacity for each class.
- The page must allow defining accepted levels for each class.
- If no accepted level is selected for a class, that class must be treated as open to all levels.
- The page must allow associating zero or more teachers with each class for school-facing display and rule translation.
- The page should support cases such as:
  - a Class of First grade, size 10
  - a Class of Second grade, size 15
  - a mixed Class of First and Second grade, size 10
- The page should show class capacity usage in result views.

### Level management

- The page must allow creating, renaming, and deleting levels.
- The page must allow assigning students to levels.
- The page may allow assigning teachers to levels when the school needs that concept.
- The page should clearly show level membership.
- Level semantics must remain compatible with the shared generic Group model internally.
- The page should avoid exposing the word Group to the end user unless a future school requirement introduces a truly separate school grouping concept.

### Rule and preference management

The page must expose school-friendly wording while storing generic relations internally.
The UI should focus on understandable school sentences rather than solver jargon.

#### Hard rule examples

- Student Alban must not be with Teacher Caroline
- Teacher Caroline must not be with Student Alban
- Teacher Caroline must be with Student Mael
- Student Alban must be with Student Mael
- Student Mael must not be with Student Leandre

#### Soft preference examples

- Teacher Caroline prefers to be with Student Mael
- Student Alban prefers to be with Student Mael
- Student Alban prefers not to be with Student Leandre

#### Operand support

- The rule builder must support at least Student-to-Student and Teacher-to-Student rules.
- Teacher-to-Class rules may be exposed through simpler school-language controls such as class teacher association rather than a generic free-form rule builder.
- The rule builder may later support Teacher-to-Teacher rules if the school workflow needs them.
- Level-level rules should not be a primary exposed concept on this page unless a strong school use case justifies them.

### Solver execution

- The page must provide a Run button.
- The page must validate the model before solve.
- The page must first surface school-language validation messages before or alongside generic pipeline validation messages.
- The page must send the normalized problem to the solver adapter.
- The page must display solver status, warnings, and result summaries.

### Spreadsheet import

- The page must allow importing a school workbook in `.xlsx` or compatible Excel format.
- The import should use the same school-facing sheet vocabulary as the export baseline when possible.
- A `Students` sheet is mandatory.
- A `Classes` sheet is optional.
- In the `Students` sheet, the first mandatory column is `Student`.
- The `Students` sheet may also include `Level` and `Class` columns.
- If the `Classes` sheet is present, it may include `Class`, `Teachers`, `Accepted levels`, and `Capacity` columns.
- If the `Classes` sheet is absent, the workbook must still be importable as long as the `Students` sheet exists and contains the required first column.
- Spreadsheet import should create or infer levels and classes from the workbook rows when enough information is present.
- Imported workbook data should be converted into the same underlying generic project shape used by the school page.

## UI behavior

### Section 1: School assignment summary

Shows:

- project or scenario name
- number of students
- number of teachers
- number of classes
- number of levels
- total capacity summary
- validation summary

### Section 2: Students

Allows:

- add student
- rename student
- remove student
- search students
- inspect assigned levels

### Section 3: Teachers

Allows:

- add teacher
- rename teacher
- remove teacher
- optionally inspect assigned levels

### Section 4: Classes

Allows:

- add class
- rename class
- remove class
- set class capacity
- select accepted levels
- inspect current assignment counts in result views

### Section 5: Levels

Allows:

- add level
- rename level
- delete level
- assign students to levels
- optionally assign teachers to levels
- inspect current level members

### Section 6: School rules

Allows:

- select rule type with school-friendly wording
- choose students and teachers as operands when valid
- define optional preference strength if supported and phrased clearly
- review current rules
- delete rules
- avoid exposing generic solver terms in labels and help text

### Section 7: Solve and results

Allows:

- run solver
- import a school workbook
- export a solved workbook
- show busy state
- show solved, unsat, timeout, partial, or error status
- review returned class assignment solutions through the shared solution display feature

## Modeling mode

The MVP school class creation page should primarily use container mode.

Behavior:

- students are assigned directly to classes
- class capacities are required
- same-class and different-class constraints are available
- adjacency and position-based relations are out of scope for this page in the MVP

Future extension:

- a separate classroom seating feature could use position mode later
- that should remain a different feature from class creation itself

## Validation rules

The page must validate at least the following.

### Student and class validation

- student names required
- class names required
- class capacities must be positive integers
- duplicate identities rejected or warned according to shared rules

### Group validation

- group names required
- group membership references must be valid
- unsupported group-level relation combinations must be blocked

### Rule validation

- together and separate rules require valid operands
- teacher-student rules must be validated using the same underlying assignment semantics as student-student rules
- adjacency constraints must not be available on this page in the MVP
- contradictory or obviously impossible hard rules should be flagged when feasible

### Level and class validation

- if a class has no accepted level selected, it should be treated as accepting all levels rather than as invalid
- every student should belong to at least one level in the MVP school workflow
- a student should normally belong to exactly one primary level in the MVP school workflow unless an explicitly supported exception is enabled later
- student-to-class feasibility should account for level compatibility
- if a student has a level but no class accepts that level, the page must raise a clear school-language error before solve
- a class left without selected levels should be explained as an unrestricted class in school wording, not as a broken class
- mixed-level classes must be allowed when explicitly configured
- teacher-linked rules must be checked against class associations so impossible teacher-driven requirements can be detected early when feasible
- if a teacher-based must-be-together rule is used but the teacher is linked to no class, the page must raise a clear school-language error before solve
- if a teacher-based together or separate rule makes assignment impossible because of class links and accepted levels, the page should explain that situation in school wording rather than generic solver wording

### Capacity validation

- total class capacity should be checked against student count
- when total class capacity is too small, the page should explain in simple wording that some students would have nowhere to go
- hard must-share components larger than every compatible class capacity should be flagged when feasible

## Solver capability handling

The page must respond to the active solver adapter capabilities.

### Examples

- If soft preferences are unsupported, the preference controls should be disabled or clearly marked unavailable.
- If all-solution enumeration is limited, the page should communicate that results may be truncated.
- If group-level propagation is limited by the active adapter or implementation stage, the page should provide a warning or disable unsupported combinations.

## Output expectations

The page must integrate with the shared solution display and provide school-friendly presentation.

Expected display options:

- students grouped by class
- teachers grouped or associated by class when that concept is part of the solved model
- in the MVP school page, linked teachers must be shown on each solved class card even though teachers are not independently assigned solver participants
- class occupancy summary
- visible level labels for each class
- score or penalty summary for soft preferences when available
- warnings when only the first N solutions are shown
- easy comparison between valid class distributions if supported later

### Spreadsheet export expectations

The school page must provide a spreadsheet export for solved class distributions.
The export should be readable by teachers, school directors, and administrative staff without requiring any knowledge of the generic solver model.
In the current implementation baseline, this export should be a real `.xlsx` workbook rather than CSV or a renamed fake spreadsheet file.

Expected spreadsheet characteristics:

- readable with school terminology only
- suitable for operational use, printing, or sharing
- stable enough to open in Excel-compatible tools
- structured for quick review of each class and its assigned students

Recommended export structure:

- one summary sheet with scenario name, selected solution number, and useful solve metadata when appropriate
- one main class-distribution sheet listing each class and its assigned students
- one student-oriented sheet listing each student, their level, and their assigned class
- optional additional sheet for teacher assignments or teacher-related class associations if that concept is part of the solved model
- optional additional sheet for warnings or unresolved items if such states are ever supported

Recommended columns for the main class-distribution sheet:

- Class
- Accepted levels or class level label
- Student
- Student level
- Teacher when relevant
- Notes if the school workflow later introduces planner-facing annotations

The school spreadsheet export should prioritize clarity over technical completeness.
It should not expose generic terms such as Item, Group, Container, constraint kind, or preference kind.

### Spreadsheet import expectations

The school page should also support importing a workbook that follows the same teacher-facing vocabulary as the export baseline.
This import is for convenient data entry, not for preserving every possible school-page feature.

Current import baseline:

- `Students` sheet required
- `Classes` sheet optional
- `Student` column required in the `Students` sheet
- `Level` and `Class` columns optional in the `Students` sheet
- `Class` column required only when a `Classes` sheet is present
- `Teachers`, `Accepted levels`, and `Capacity` are optional enrichments on the `Classes` sheet

Current interpretation rules:

- each `Student` row creates a student if the name is not empty
- `Level` values may be comma-separated and create level membership relations
- `Class` values in the `Students` sheet may create placeholder classes when needed even if no `Classes` sheet exists
- `Classes` sheet rows enrich classes with accepted levels, teachers, and capacity when present
- duplicate student names in the import workbook are currently collapsed to a single imported student row by label

The import flow should fail clearly when the workbook has no `Students` sheet or when that sheet lacks the required `Student` column.

## Technical notes

- This feature must remain a thin specialization over the generic model.
- School-specific wording belongs in the UI only.
- Students and teachers are both modeled through the generic Item concept internally, even though the UI must distinguish them clearly.
- The school transform layer should tag school-authored items with metadata such as `schoolRole` so student and teacher lists can be reconstructed reliably.
- Levels are modeled using generic Group nodes internally.
- Classes are modeled using generic Container nodes internally.
- The school transform layer should store class-facing metadata such as `acceptedLevelIds` and `teacherIds` on the container-facing view model and derive generic eligibility behavior from that metadata.
- This page should use container mode in the MVP.
- In the MVP solve flow, students are assigned directly to classes, while teachers remain class-linked actors used to derive eligibility and display information.
- Position and adjacency concepts should not be introduced here unless a future seating-related feature explicitly requires them.
- Import and export behavior should rely on the shared generic persistence feature; this page only needs school-oriented `viewHint` handling so imported projects can reopen in the correct panel when appropriate.
- Spreadsheet export may use a school-specific presentation formatter, but it should derive its data from the shared solved model rather than introducing a separate persistence format.
- Spreadsheet import may use a school-specific workbook parser, but it must convert imported rows into the same shared generic project shape used by the school page editor.

## Worked example scenarios to support

The page design should support scenarios such as:

- Class A: First grade, size 10
- Class B: Second grade, size 15
- Class C: First and Second grade, size 10
- Alban is a student in First grade
- Mael is a student in First grade
- Leandre is a student in Second grade
- Caroline is a teacher
- Caroline must not be with Alban
- Caroline prefers to be with Mael
- Alban wants to be with Mael
- Mael must not be with Leandre

The page should allow users to enter that scenario entirely with school wording and without needing to understand the generic model.

## Acceptance criteria

- A user can create students, teachers, classes, and levels from the school page.
- A user can define class capacities and accepted levels.
- A class with no selected accepted levels is interpreted as accepting all levels.
- A user can associate teachers with classes for MVP rule translation and display.
- A user can assign students to levels.
- A user can define hard together or separate rules using school wording.
- A user can define soft class-composition preferences when supported by the solver.
- The page validates the model before solver execution.
- Validation messages shown in the school page should be understandable for unfamiliar users and should prefer school wording over generic constraint-model wording whenever the issue is school-specific.
- The page writes data using the generic core model rather than custom school-only structures.
- The transform layer has an explicit documented mapping for student items, teacher items, level groups, class containers, accepted levels, and teacher-class associations.
- The MVP solve flow treats teachers as class-linked actors and students as the directly assigned participants.
- The page can invoke the solver and display one or more valid class assignments.
- The page can export a solved class distribution to a readable `.xlsx` workbook suitable for teachers or school staff.
- The page can import a school workbook when it contains at least a `Students` sheet with a required `Student` column.
- The page uses shared generic import/export behavior for canonical JSON persistence and adds school-specific workbook import/export only for teacher-facing spreadsheet workflows.
- The page does not expose adjacency or seat-based features in the MVP.
