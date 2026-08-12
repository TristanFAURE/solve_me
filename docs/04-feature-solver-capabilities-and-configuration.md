# Feature: Solver Capabilities and Configuration

## Goal

Define how the application discovers solver capabilities, exposes supported options to the user, validates configuration choices, and executes solving in a way that remains compatible with multiple solver implementations.

## Scope

This feature includes:

- solver capability discovery
- solver selection strategy if multiple adapters exist
- configuration of solve-time options
- validation of solver options against model and solver capabilities
- execution limits such as timeout and result count limits
- behavior for unsupported features such as soft preferences or adjacency
- result metadata related to solver execution

## Out of scope

This feature does not define:

- the detailed internal implementation of a specific solver
- the full solution visualization UI
- advanced unsat explanation algorithms
- cloud execution orchestration
- distributed or parallel solving infrastructure

## User stories

- As a user, I want the application to know what the active solver can and cannot do.
- As a user, I want unsupported options to be hidden, disabled, or clearly explained.
- As a user, I want to configure how many solutions to search for.
- As a user, I want to set a timeout or execution limit.
- As a user, I want to enable optimization for soft preferences when available.
- As a user, I want warnings when part of my model cannot be handled by the selected solver.
- As a user, I want useful metadata about the solve operation.

## Relationship to the architecture

This feature depends on the solver adapter abstraction described in `docs/00-core-architecture.md`.
It must work with browser-based or backend-based adapters without changing the core UI contract.

## Capability model

The solver adapter must provide a machine-readable capability description.

### Minimum capability fields

- supportsHardConstraints
- supportsSoftPreferences
- supportsWeightedPreferences
- supportsAllSolutionsEnumeration
- supportsOptimization
- supportsAdjacencyConstraints
- supportsPositionMode
- supportsTimeout
- supportsPartialResults
- supportsUnsatExplanation

### Optional capability fields

- maximumRecommendedSolutions
- maximumRecommendedProblemSize
- supportsGroupLevelPropagationNatively
- supportsFixedAssignments
- supportsForbiddenAssignments
- notes or warnings for the UI

## Functional requirements

### Capability discovery

- The application must query solver capabilities before exposing advanced options.
- The application must keep capability information available to feature pages.
- If the solver changes, capability-dependent UI must refresh accordingly.

### Capability-aware UI behavior

- Unsupported features should be hidden or disabled whenever possible.
- If a saved model uses unsupported features, the UI must show a clear warning.
- If unsupported hard constraints are present, solve must be blocked.
- If unsupported soft preferences are present, the configured fallback policy must be applied.

### Solver selection

If multiple solver adapters exist, the application should support selecting one.

Possible strategies:

- a default built-in solver
- manual solver selection by the user
- automatic selection based on required model features

The selected strategy should remain simple in the MVP.

### Solver configuration options

The feature must support a generic solve configuration model.

#### Core options

- maximum number of solutions to return
- timeout duration
- solve mode: first solution, all solutions, or optimized solution
- whether to include score details when available

#### Preference-related options

Available only when supported.

- enable optimization for soft preferences
- choose objective strategy if more than one is supported later
- optionally configure preference weights if part of the model supports them

#### Advanced options

These may be postponed or hidden behind an advanced section.

Examples:

- random seed
- search strategy selection
- branching heuristics
- explanation mode

## Fallback behavior for unsupported features

The application must define and implement explicit policies.

### Unsupported hard constraints

If the model contains unsupported hard constraints:

- the solve action must be blocked
- the UI must explain which feature is unsupported
- the UI should suggest possible remediation when available

### Unsupported soft preferences

If the model contains unsupported soft preferences, the application may support one of these policies:

- block solving in optimization mode
- ignore soft preferences with a warning
- downgrade to hard-only solving with a warning

The chosen default policy for MVP should be documented clearly and applied consistently.

Recommended MVP default:

- unsupported hard constraints block solve
- unsupported soft preferences disable optimization and show a warning

## Solve modes

The configuration feature must support the following generic modes.

### First valid solution mode

- stop after the first valid solution is found
- useful for quick validation and responsiveness

### Enumerate solutions mode

- return up to N valid solutions
- must respect result count limits and timeout limits
- may return partial results when supported by the adapter

### Optimization mode

- search for a best solution according to soft preference scoring
- available only when the solver supports optimization
- returned solutions should include score or penalty metadata when available

## Configuration validation

The application must validate the solver configuration before solve.

Examples:

- timeout must be a positive number if provided
- maximum solutions must be a positive integer
- optimization mode requires optimization support
- adjacency-heavy models require adjacency and position-mode support
- all-solutions mode requires enumeration support or a compatible fallback strategy

## Result metadata requirements

The solver result should expose metadata that the UI can display.

### Required metadata

- status: solved, unsat, timeout, error, partial
- number of solutions returned
- whether results were truncated
- runtime duration if available
- warnings generated during execution

### Optional metadata

- best score or total penalty
- number of evaluated branches or search nodes if supported
- capability downgrade information
- explanation summary for unsat cases

## UX structure

This feature may be presented through a shared configuration panel or modal.

### Section 1: Active solver

Shows:

- active solver name
- high-level support summary
- notable warnings or limitations

### Section 2: Solve mode

Allows:

- first solution
- enumerate solutions
- optimized solution when supported

### Section 3: Limits

Allows:

- set timeout
- set maximum number of solutions
- possibly show recommended limits from the solver adapter

### Section 4: Preferences and optimization

Visible when soft preference support exists.

Allows:

- enable or disable preference optimization
- show whether weights are supported
- explain how unsupported preferences are handled

### Section 5: Advanced settings

Optional and collapsed by default.

Potential contents:

- search strategy
- random seed
- debug or explanation options

## Default settings recommendation

For MVP, use conservative defaults.

Recommended defaults:

- solve mode: first valid solution for large models, otherwise enumerate with a small cap
- maximum solutions: 50 or 100
- timeout: a short but reasonable default such as 5 to 15 seconds depending on environment
- optimization off unless soft preferences are present and supported

These defaults should be easy to override.

## Interaction with feature pages

Feature pages must rely on this shared configuration model instead of inventing their own solver-specific options.

Examples:

- the wedding page uses the same timeout and result limit controls
- the generic page uses the same fallback behavior for unsupported preferences
- the school page uses the same all-solutions and first-solution behavior

## Technical notes

- Capability discovery should be centralized rather than duplicated in each page.
- Solver options should be normalized into a shared configuration object.
- The configuration object should be serializable for JSON export and local persistence.
- The UI must not expose solver-internal terminology unless clearly labeled as advanced.
- The implementation should be ready for multiple adapters even if only one exists in the MVP.

## Acceptance criteria

- The application can read and expose active solver capabilities.
- Unsupported hard constraints block solve with a clear explanation.
- Unsupported soft preferences are handled according to a documented fallback policy.
- Users can configure timeout and maximum solution count.
- Users can select solve mode from the modes supported by the active solver.
- Optimization options are shown only when supported.
- Solver execution returns metadata usable by the UI.
- Configuration behavior is shared across generic and domain-specific pages.
