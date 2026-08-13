# Recent Work and Next Steps

## Most recent completed work

Latest meaningful completed step:

- reworked the staffing people section into a clearer two-column quick-add plus saved-list layout with advanced person settings collapsed behind a details panel
- fixed the repeated-add workflow so successful add/save rerenders keep focus on the person name field, making multi-person entry practical
- made the people editor a real form and bound add/save through form submit so both clicking the Add/Save button and pressing Enter now use the same robust GUI path without depending on a fragile click-only handler
- aligned staffing-domain validation with optional numeric semantics so blank/null person limits and blank/null global defaults are ignored instead of being treated as invalid provided values
- fixed the person editor bug where per-group hard and soft target draft rows were not both restored correctly when entering edit mode
- added first-class GUI controls inside the person form for per-event prefer / prefer-not / neutral choices and wired those edits directly into `domainProject.preferences`
- bounded the in-form event-preferences table with its own scroll region so long event lists stay usable without making the whole person editor grow excessively
- kept the saved-people table inside the bounded staffing scroll region so larger rosters remain manageable instead of growing the page indefinitely
- preserved regression coverage for person add/edit/reset behavior, rendered people-section layout structure, and per-person event preference editing

## Files touched most recently

- `src/pages/eventStaffing/index.js`
- `src/pages/eventStaffing/summarySections.js`
- `src/styles.css`
- `tests/pages/eventStaffingWorkflow.test.js`
- `docs/status/05-recent-work-and-next-steps.md`
- `status.md`

## Recommended next step

1. continue the event staffing editor from the current planner workflow shell:
   - add first-class authoring controls for the remaining planner rule data: cooldown rules, forced assignments, and forbidden assignments
   - consider whether saved-people summaries should show event labels instead of raw event ids now that preferences can be authored directly in the GUI
   - verify other event-browser filters and editing inputs for similar rerender-driven focus or caret regressions now that search has been repaired
   - keep refining editing safeguards and feedback around date/order changes and any remaining destructive flows
   - if the user explicitly requests it later, consider browser-level interaction coverage with an approved browser-test approach
2. then run broader manual testing and assess performance on larger staffing-style scenarios
3. then consider further solver refinement only if needed:
   - tighten pruning bounds further for complex mixed hard/soft cases
   - evaluate whether staffing-scale scenarios need deeper best-first search or additional dominance pruning

## Key open risks

- the intended next UI direction is to reuse existing shared page styling patterns rather than invent page-specific ad hoc markup
- solver milestone 1 now ranks returned solutions using `softAssignmentScores[]` and `softItemCountTargets[]`, but the search still returns the best solution only among the enumerated set and does not yet guarantee a global optimum
- transform-based expansion of cooldown and exclusivity rules may significantly increase normalized constraint volume on large schedules
- the staffing page now has planner-facing multi-solution navigation plus a direct solution picker, and the event/person lists are bounded with scroll regions; the workflow and bulk-edit areas are now split, but larger solution sets may still need richer ranking or comparison UX
- the people list now uses the bounded scroll box as intended, but if the roster table gains many more columns later it may still need column prioritization or a card/list fallback on narrower screens
- the keyboard-only add/save shortcut currently triggers from the person name field specifically; if broader keyboard-first editing is desired later, other staffing editor sections may need explicit Enter / shortcut semantics too
- removing sample bootstrap data makes the first-run planner experience cleaner; direct creation flows now exist for group types, people, edited people, and global limits including default per-group soft targets, but the page still needs first-class authoring for cooldown rules and assignment exceptions
- event insert/delete, multi-select, validation display, and bulk requirement actions include confirmation safeguards; the event search focus regression is now fixed, but other rerender-sensitive inputs should still be sanity-checked, and browser-level interaction test work should not be proposed unless the user explicitly asks for that direction
- container minimum capacities are now enforced in container mode, but the current solver baseline still uses backtracking and may slow down as staffing transforms expand larger scenarios
- backward compatibility must continue to be protected for existing school and wedding use cases as staffing transforms are added
- larger staffing scenarios may be slow with the current backtracking solver even before optimization is introduced
