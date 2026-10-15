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

- `hardConstraints`
- `softPreferences`
- `weightedPreferences`
- `enumerateSolutions`
- `optimization`
- `adjacency`
- `positionMode`
- `timeout`
- `partialResults`
- `unsatExplanation`
- `assignmentExclusions`
- `perItemAssignmentUpperBounds`
- `scopedAssignmentUpperBounds`
- `fixedAssignments`
- `forbiddenAssignments`
- `softAssignmentScores`
- `softItemCountTargets`
- `firstSolution`
- `scoreDetails`
- `scoreWeights`
- `diversity`
- `solutionFingerprints`
- `searchStatistics`

### Optional capability fields

- maximumRecommendedSolutions
- maximumRecommendedProblemSize
- supportsGroupLevelPropagationNatively
- supportsDerivedIncompatibilityExpansion
- supportsScoreBreakdown
- supportsSoftItemCountTargets
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
- New hard-constraint families should be added to capability checks in a backward-compatible way so existing pages keep working without API churn.

### Solver selection

The application supports automatic and explicit selection between the JavaScript and HiGHS WASM adapters.

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
- solve mode: `first`, `topK`, or `optimize`
- engine: `auto`, `js`, or `highs`
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

### Ranked top-K mode

- return up to N valid solutions
- must respect result count limits and timeout limits
- may return partial results when supported by the adapter

### Optimization mode

- search for a best solution according to soft preference scoring
- available only when the solver supports optimization
- returned solutions should include score or penalty metadata when available

## Approved ranked-solution configuration

The implemented generic modes are `first`, `topK`, and `optimize`, with explicit scoring and diversity options.

Implemented configuration shape:

```js
{
  mode: "first" | "topK" | "optimize",
  engine: "auto" | "js" | "highs",
  maxSolutions: 10,
  timeLimitMs: 5000,
  includeScoreDetails: true,
  scoreWeights: {
    equity: 100,
    preferences: 10,
    targets: 20
  },
  diversity: {
    enabled: true,
    minimumAssignmentDistance: 2
  }
}
```

`auto` keeps single-assignment, position, and small feasibility-only models on the JavaScript adapter. It selects the Worker-hosted HiGHS WASM adapter for weighted repeated-assignment optimization or sufficiently large supported multiple-container models. `highs` is an explicit request and therefore returns an error for unsupported semantics or initialization failure; it does not silently downgrade. `js` forces the original adapter.

The initial optimization strategy is a configurable weighted numeric score. Staffing should initially assign the dominant default weight to workload equity while retaining configurable preference and target weights.

`topK` means ranked alternatives, with duplicate removal and optional minimum assignment distance. It does not mean that the solver may return arbitrary valid solutions and label them as best.

Configuration validation must additionally ensure:

- all weights are finite integers within an implementation-defined safe range
- the diversity distance is a non-negative integer
- diversity is used only with a multi-solution mode
- requested objective terms are supported by the selected adapter
- optimality is not promised when timeout or interruption prevents proof

The full objective, diversity, worker, and implementation roadmap is defined in `docs/11-feature-ranked-solutions-and-shared-workflow.md`.

## Configuration validation

The application must validate the solver configuration before solve.

Examples:

- timeout must be a positive number if provided
- maximum solutions must be a positive integer
- optimization mode requires optimization support
- adjacency-heavy models require adjacency and position-mode support
- all-solutions mode requires enumeration support or a compatible fallback strategy
- models using per-item hard maxima require corresponding assignment-bound support
- models using fixed or forbidden assignments require those capabilities or an equivalent preprocessing path

## Result metadata requirements

The solver result should expose metadata that the UI can display.

### Required metadata

- status: solved, unsat, timeout, error, partial
- number of solutions returned

### Ranked-solution metadata

The result contract also exposes:

- score and objective breakdown for each solution
- `searchComplete`
- `optimalityProven`
- `truncatedByLimit`
- `interrupted`
- `timeoutReached`
- explored and pruned node counts when available
- warnings when requested diversity or objectives could not be applied
- solver engine and whether canonical ranking was proved or alternatives are best-found
- `incumbentCount`
- `canonicalRankingComplete`
- `solutionSelection`
- `solverEngine`

The solver must not report `unsat` without completing the relevant search, and must not report a proven optimum without a valid objective bound.
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

Shared defaults are `topK`, 10 solutions, score details off, and diversity off. Browser execution supplies a 5000 ms timeout. Event Staffing enables score details, weighted objectives, and diversity by default; users can select first, ranked alternatives, or optimize and choose automatic, JavaScript, or HiGHS execution.

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
- JavaScript and HiGHS WASM adapters implement the shared boundary.
- New solver features should extend the current solver contract in place when possible rather than introducing parallel public APIs.
- Backward compatibility matters: existing generic, school, and wedding flows should continue to use the same solver entry points and option structure.
- Domain transforms may compile domain-specific semantics such as ordered-event cooldowns into generic incompatibility constraints before solve, avoiding domain leakage into the solver API.
- Solver evolution should prefer additive capability fields and additive normalized constraint families over renaming or reshaping the existing public API.

## Implemented Event Staffing solver evolution

Event Staffing preserves the generic solver API and compiles date/slot behavior in its transform:

- cooldowns become assignment exclusions
- one-category-per-person-per-slot becomes scoped assignment bounds
- eligibility and unavailability become forbidden assignments
- locked duties become fixed assignments
- preferences become soft assignment scores
- workload targets become soft item count targets

Both adapters consume these generic families. Cross-domain regression tests protect Generic, School, and Wedding behavior when shared solver code changes.

## Acceptance criteria

- The application can read and expose active solver capabilities.
- Unsupported hard constraints block solve with a clear explanation.
- Unsupported soft preferences are handled according to a documented fallback policy.
- Users can configure timeout and maximum solution count.
- Users can select solve mode from the modes supported by the active solver.
- Optimization options are shown only when supported.
- Solver execution returns metadata usable by the UI.
- Configuration behavior is shared across generic and domain-specific pages.
