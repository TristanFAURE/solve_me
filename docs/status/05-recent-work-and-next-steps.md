# Recent Work and Next Steps

## Most recent completed work

Latest meaningful completed step:

- updated the generic page to reflect the evolved solver/model shape instead of only the earlier constraint/preference surface
- added authoring and audit coverage for:
  - fixed assignments
  - forbidden assignments
  - assignment exclusions
  - assignment count upper bounds
  - soft assignment scores
  - soft item count targets
- expanded the normalization summary so the generic page now reports these newer normalized arrays as part of solver handoff visibility
- ran a syntax check on `src/pages/generic/index.js` with `node --check`

## Files touched most recently

- `src/pages/generic/index.js`
- `docs/status/02-generic-page.md`
- `docs/status/05-recent-work-and-next-steps.md`
- `status.md`

## Recommended next step

1. initialize real event staffing default state in `src/app/state.js`
2. replace the placeholder `src/pages/eventStaffing/index.js` with a planner-facing editor shell
3. implement the event section first using:
   - compact summary rows
   - expand/collapse details
   - filtering/search hooks
   - nested event-group requirement editing
4. then add real event-staffing domain validation and UI/workflow integration:
   - reject or report malformed staffing-domain inputs before transform use in planner-facing flows
   - surface staffing-specific validation results alongside generic validation, following the school/wedding pattern
   - add a planner-facing page/workflow that uses the transform before solve
5. then add remaining solver support still needed for the staffing planner’s documented soft goals:
   - soft scoring behavior for `softAssignmentScores[]`
   - soft target behavior for `softItemCountTargets[]`
6. then run broader manual testing and assess performance on larger staffing-style scenarios

## Key open risks

- the current solver baseline still ignores soft optimization inputs such as `softAssignmentScores[]` and `softItemCountTargets[]`, so transformed staffing preferences and targets are preserved but not yet optimized
- transform-based expansion of cooldown and exclusivity rules may significantly increase normalized constraint volume on large schedules
- the staffing transform test coverage is stronger now, but dedicated planner/domain validation is still not implemented in the app workflow
- container minimum capacities are now enforced in container mode, but the current solver baseline still uses backtracking and may slow down as staffing transforms expand larger scenarios
- backward compatibility must continue to be protected for existing school and wedding use cases as staffing transforms are added
- larger staffing scenarios may be slow with the current backtracking solver even before optimization is introduced
