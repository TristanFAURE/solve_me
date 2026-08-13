# Feature: Event Staffing Planner

## Purpose

This document specifies a new domain-specific planning page for assigning people to group-based staffing demands across an ordered list of events.

This page is intended for schedule planning scenarios where:

- events are usually dates configured by the administrator
- each event can require one or more reusable group types
- staffing minima and maxima are hard constraints
- temporal spacing rules are hard constraints
- people express only soft date preferences
- administrators can define exceptions, eligibility restrictions, and manual forced assignments

This document defines the domain semantics, V1 scope, import format, solution expectations, and mapping considerations for implementation.

## V1 scope

V1 must support:

- an ordered list of events
- reusable global group types
- event-level staffing requirements per group type with hard `min` and `max`
- at most one assignment per person on the same event
- configurable hard cooldown rules across the ordered event list
- global hard assignment maxima with optional per-person hard maximum overrides
- optional per-person soft assignment targets
- default global eligibility with optional per-person group restrictions
- administrator-forced assignments
- people-provided soft event preferences via `.xlsx`
- fairness-oriented optimization among valid solutions
- readable schedule-oriented solution display

V1 does not include:

- person-provided hard unavailability
- partial relaxation of event-group minima
- weekly or monthly caps
- role composition inside a group
- pair / anti-pair rules between people
- recurring schedule templates beyond UI helpers that generate explicit events/requirements

## Domain vocabulary

### Event

An event is one entry in the ordered schedule.

An event usually represents a calendar date, but the semantics for spacing and cooldown use the explicit event order rather than calendar day arithmetic.

Each event has at least:

- `id`
- `label`
- `orderIndex`
- optional display date metadata

### Group type

A group type is a reusable assignment category that may appear on many events.

Examples:

- `GROUP1`
- `GROUP2`

Each group type has at least:

- `id`
- `label`

### Event-group requirement

An event-group requirement activates a group type on a specific event and defines its staffing bounds.

Each requirement has at least:

- `eventId`
- `groupTypeId`
- `min`
- `max`

Semantics:

- `min` is a hard lower bound
- `max` is a hard upper bound
- both must always be satisfied in every valid solution

### Person

A person is an assignable entity.

Each person has at least:

- `id`
- `name`
- optional override settings
- optional eligibility restrictions
- optional person-specific hard maximum overrides
- optional person-specific soft assignment targets

### Assignment

An assignment places one person into one group type on one event.

Conceptually:

- `(person, event, groupType)`

V1 allows at most one assignment per person on the same event.
Therefore, total assignment count and worked-event count are equivalent in V1.

## Core assumptions and semantics

### Ordered event list semantics

Cooldowns and temporal spacing use the ordered list of events.
They do not use real calendar-day arithmetic.

If a person is assigned on event at position `i`, a cooldown of `N` blocks matching assignments on events:

- `i + 1`
- `i + 2`
- ...
- `i + N`

### Group types are reusable across events

Group types are global reusable categories.

The same group type may appear on many events with different staffing bounds.

### One assignment per person on one event

V1 uses a one-person, one-group, one-event rule.

A person may be assigned to at most one group type on a given event.

## Hard constraints

## 1. Event-group staffing bounds

For every active `(event, groupType)` requirement:

- assigned people count must be `>= min`
- assigned people count must be `<= max`

These bounds are mandatory and cannot be softened in V1.

## 2. At most one assignment per person on one event

For every `(person, event)`:

- the number of assignments on that event must be less than or equal to `1`

This is a core V1 rule.

## 3. Total assignments per person

Because V1 allows at most one assignment per person on one event, total assignment count and worked-event count are equivalent.

For every person, V1 must support configurable hard assignment maxima with:

- a global default maximum total assignments
- an optional per-person hard maximum override

This confirms that V1 allows people to have person-specific hard constraints.

## 4. Soft assignment targets per person

V1 should also support optional per-person soft assignment targets.

Recommended semantics:

- use the term `target`, not `minimum`, in the UI and configuration
- a target expresses a desired assignment count for that person
- failing to reach a target does not invalidate the solution
- the solver should prefer solutions that better satisfy configured targets when soft optimization is supported

## 5. Maximum assignments per group type per person

For every person and group type:

- the total number of assignments in that group type must be less than or equal to a configured limit

V1 must support:

- a global default per group type limit
- optional per-person override

## 6. Eligibility restrictions

Default semantics:

- every person is eligible for every group type

V1 must support exceptions so that some people may be:

- allowed only in specific group types, or
- forbidden from specific group types

Any assignment violating eligibility is invalid.

## 7. Cooldown rules

Cooldowns are hard temporal rules over the ordered event list.

V1 must support a configurable list of cooldown rules.

Each cooldown rule has:

- `triggerGroupTypes`: a set of group types or `ANY`
- `blockedGroupTypes`: a set of group types or `ANY`
- `blockedNextEventCount`: integer `N >= 1`

Semantics:

If a person is assigned to any trigger group on event `i`, then that person may not be assigned to any blocked group on the next `N` events.

That means blocking on events:

- `i + 1`
- `i + 2`
- ...
- `i + N`

Examples:

### Example A: no assignment at all on the next event

- trigger group types = `ANY`
- blocked group types = `ANY`
- blocked next event count = `1`

### Example B: after `GROUP1`, block `GROUP1` and `GROUP2` for the next two events

- trigger group types = `{GROUP1}`
- blocked group types = `{GROUP1, GROUP2}`
- blocked next event count = `2`

## 8. Administrator-forced assignments

The administrator may force a specific assignment.

Example:

- Pierre must be assigned to `GROUP1` on event `2026-06-23`

Forced assignments are hard constraints and must appear in every valid solution.

## 9. Administrator-forbidden assignments

The administrator may forbid a specific assignment.

Example:

- Marie may not be assigned to `GROUP2` on event `2026-06-24`

Forbidden assignments are hard constraints and must not appear in any valid solution.

## Soft preferences and optimization goals

## 1. People provide soft event preferences only

People do not provide hard unavailability in V1.
They only express soft preferences at the event level.

Allowed meanings:

- `Y` = prefer being assigned on that event
- `N` = prefer not being assigned on that event
- empty = neutral

These preferences apply to the event as a whole, not to specific group types.

## 2. Preference scoring is per assignment day/event

Because V1 allows at most one assignment per person on one event, event preference scoring is naturally counted once for that person on that event.

## 3. Per-person assignment targets are soft goals

When configured, per-person assignment targets are optimization goals, not validity rules.

The solver should prefer solutions that move each person closer to their configured target assignment count.

## 4. Fairness is a V1 optimization goal

When multiple valid solutions exist, the solver should prefer fairer distributions.

At minimum, V1 should support fairness based on:

- total assignments per person

Because of the one-assignment-per-event rule, this is equivalent to worked-event count in V1.

## 5. Preference and fairness remain soft

The solver must never reinterpret soft preferences or fairness objectives as hard constraints.

If optimization support is partial in the first implementation, the UI and documentation must state which soft goals are actually optimized.

## Import format: `.xlsx` preference matrix

## Purpose

The spreadsheet import is only for person-provided event preferences.

Schedule structure, staffing bounds, cooldown rules, eligibility exceptions, and forced assignments are configured in the web UI.

## Matrix shape

Recommended V1 matrix:

- first column: person name or stable person identifier
- next columns: one column per event in schedule order
- cell value: `Y`, `N`, or empty

Example:

| Person | 2026-06-23 | 2026-06-24 | 2026-06-25 |
| --- | --- | --- | --- |
| Pierre | Y | N | |
| Marie | | Y | N |

## Accepted cell values

V1 should accept:

- `Y`
- `N`
- empty

It may also normalize lowercase values:

- `y` -> `Y`
- `n` -> `N`

Any other non-empty value should be treated as invalid input.

## Import validation expectations

Import validation should detect at least:

- unknown person rows
- duplicated people rows
- unknown event columns
- missing required header structure
- invalid non-empty cell values

The UI should present import errors in readable business terms.

## UI expectations

## 1. Schedule configuration UI

The web UI configures:

- ordered events
- group types
- event-group requirements with `min` and `max`
- cooldown rules
- global assignment limits
- per-person overrides, including person-specific hard maximums and optional soft assignment targets
- eligibility restrictions
- forced and forbidden assignments

## 2. Event generation helpers

The UI may provide convenience tools such as:

- generate events from a date range
- create requirements for every Friday, Saturday, Sunday
- bulk-apply the same group requirement pattern to matching events
- insert a new event before or after a selected event in the ordered list
- delete one or more selected events

These helpers are only authoring conveniences.
They must generate explicit event and requirement data in the underlying configuration.

## 2.1 Bulk selection and bulk requirement authoring

The planner UI should support multi-select on events so the administrator can work on several dates at once.

Recommended V1 bulk authoring operations include:

- select multiple events from the event browser
- assign one group type requirement to all selected events at once using one shared `min` and `max`
- remove one group type requirement from all selected events at once
- copy the full requirement pattern from the focused event to the rest of the selected events
- remove all requirements from the selected events at once
- delete all selected events at once

Bulk assign semantics:

- if a selected event does not yet have the chosen `(eventId, groupTypeId)` requirement, create it
- if a selected event already has that requirement, update its `min` and `max`

Bulk remove semantics:

- remove the chosen `(eventId, groupTypeId)` requirement from each selected event if present
- leave other requirements untouched

Bulk copy-from-focused semantics:

- use the currently focused event as the source
- copy every requirement from that source event to the rest of the selected events
- create missing target requirements and update matching target requirements when they already exist

Bulk remove-all semantics:

- remove every requirement attached to each selected event
- do not alter the event rows themselves unless the delete-events action is used

## 3. Solution display

V1 solution display must prioritize readability.

At minimum, provide:

### Event-centric view

For each event:

- active group requirements
- assigned people per group
- `min` / `max` staffing status

### Person-centric view

For each person:

- assignments by event and group type
- total assignment count
- per-group usage summary
- any person-specific hard maximum and soft target summary where relevant

## Feasibility behavior

Because event-group minima and maxima are hard, infeasible configurations must be reported as unsolved rather than partially satisfied.

The product should provide readable infeasibility feedback whenever practical.

At minimum, V1 must clearly state:

- no valid solution found

Future improvements may include more detailed explanations of likely causes, such as capacity or cooldown conflicts.

## Suggested domain configuration shape

This section is illustrative and not a final implementation contract.
It exists to clarify the expected domain semantics.

Possible schedule-domain concepts:

- `events[]`
- `groupTypes[]`
- `requirements[]`
- `people[]`
- `globalLimits`
- `personOverrides[]`
- `eligibilityRules[]`
- `cooldownRules[]`
- `forcedAssignments[]`
- `forbiddenAssignments[]`
- `preferences`

The implementation may choose different naming as long as these semantics are preserved.

## Mapping guidance to the generic core

This page must remain a domain-specific layer on top of the generic core.
The generic core must not gain schedule-specific entities such as event or staffing group.

A likely mapping strategy is:

- person -> generic `Item`
- event-group requirement -> generic assignment destination
- soft event preferences remain domain-level inputs translated into generic or solver-level soft scoring structures where supported

The exact transform should be defined during implementation design and kept outside the generic core model.

## Open implementation design questions

These questions should be resolved during technical design before coding the page:

1. how the event staffing domain maps onto current generic container/position abstractions without leaking schedule semantics into the core
2. how person-specific soft assignment targets should be represented in solver scoring and solution display
3. how forced assignments interact with cooldown and hard maximum validation in pre-solve checks
4. what level of soft optimization is feasible in the current solver baseline

## Acceptance criteria for V1

V1 is complete when:

- an administrator can define events, group types, requirements, limits, cooldowns, and overrides in the web UI, including person-specific hard maximums and optional soft assignment targets
- the administrator can multi-select events and apply at least the documented bulk actions for event insertion/deletion, group requirement assign/remove, copy-from-focused, and remove-all workflows
- a preference matrix with `Y` / `N` values can be imported from `.xlsx`
- the system can validate the domain configuration and reject invalid inputs
- the solver can find valid schedules when they exist
- every returned schedule satisfies all hard constraints defined in this document
- the UI can display solutions in both event-centric and person-centric views
- the product clearly reports when no valid solution exists
