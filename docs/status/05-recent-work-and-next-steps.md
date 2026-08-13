# Recent Work and Next Steps

## Most recent completed work

Latest meaningful completed step:

- separated generic, school, and wedding into independent per-page drafts so authored data no longer leaks across business domains when switching routes
- kept the generic page as its own draft rather than a cross-domain live object shared by specialized pages
- preserved the earlier domain-configurable solve-result panel behavior
- verified the full Vitest suite still passes after the draft isolation refactor

## Files touched most recently

- `src/app/state.js`
- `src/pages/school/index.js`
- `src/pages/wedding/index.js`
- `src/pages/generic/index.js`
- `docs/status/02-generic-page.md`
- `docs/status/03-school-page.md`
- `docs/status/04-wedding-page.md`
- `docs/status/05-recent-work-and-next-steps.md`
- `status.md`

## Recommended next step

1. add real event-staffing domain validation and UI/workflow integration:
   - reject or report malformed staffing-domain inputs before transform use in planner-facing flows
   - surface staffing-specific validation results alongside generic validation, following the school/wedding pattern
   - add a planner-facing page/workflow that uses the transform before solve
2. add remaining solver support still needed for the staffing planner’s documented soft goals:
   - soft scoring behavior for `softAssignmentScores[]`
   - soft target behavior for `softItemCountTargets[]`
3. wire the transform into an actual event-staffing page or planner-facing workflow
4. then run broader manual testing and assess performance on larger staffing-style scenarios

## Key open risks

- the current solver baseline still ignores soft optimization inputs such as `softAssignmentScores[]` and `softItemCountTargets[]`, so transformed staffing preferences and targets are preserved but not yet optimized
- transform-based expansion of cooldown and exclusivity rules may significantly increase normalized constraint volume on large schedules
- the staffing transform test coverage is stronger now, but dedicated planner/domain validation is still not implemented in the app workflow
- container minimum capacities are now enforced in container mode, but the current solver baseline still uses backtracking and may slow down as staffing transforms expand larger scenarios
- backward compatibility must continue to be protected for existing school and wedding use cases as staffing transforms are added
- larger staffing scenarios may be slow with the current backtracking solver even before optimization is introduced
