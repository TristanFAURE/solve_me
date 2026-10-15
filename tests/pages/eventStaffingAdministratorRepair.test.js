import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../../src/core/normalize/normalizeProject.js';
import { transformEventStaffingProject } from '../../src/core/transform/eventStaffingProject.js';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import {
  annotateAdministratorRepairResult,
  buildAdministratorRepairCandidates,
  createAdministratorRepairModel,
  selectAllRepairCandidates,
  toggleRepairCandidate,
} from '../../src/pages/eventStaffing/administratorRepair.js';
import { buildAdministratorRepairSolveOptions, getAdministratorRepairSelectedIds, getAdministratorRepairSelection, getVisibleAdministratorRepairDates, moveAdministratorRepairDate, renderAdministratorRepairPanel, renderStaffingScheduleView, updateAdministratorRepairState } from '../../src/pages/eventStaffing/index.js';
import { createAppState } from '../../src/app/state.js';
import { renderEventStaffingPage } from '../../src/pages/eventStaffing/index.js';
import { validateEventStaffingProject } from '../../src/pages/eventStaffing/validateEventStaffingProject.js';

function project() {
  return {
    title: 'Repair test',
    events: [
      { id: 'S1', label: 'Morning', slotLabel: 'Morning', date: '2026-10-15', dateKey: '2026-10-15', orderIndex: 0 },
      { id: 'S2', label: 'Evening', slotLabel: 'Evening', date: '2026-10-15', dateKey: '2026-10-15', orderIndex: 1 },
      { id: 'S3', label: 'Tomorrow', slotLabel: 'Tomorrow', date: '2026-10-16', dateKey: '2026-10-16', orderIndex: 2 },
    ],
    groupTypes: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }],
    requirements: [
      { eventId: 'S1', groupTypeId: 'A', min: 1, max: 1 },
      { eventId: 'S1', groupTypeId: 'B', min: 0, max: 1 },
      { eventId: 'S2', groupTypeId: 'A', min: 0, max: 1 },
      { eventId: 'S3', groupTypeId: 'A', min: 0, max: 1 },
    ],
    people: [
      { id: 'P1', name: 'Alex', allowedGroupTypeIds: ['B'], maxAssignments: 0, maxAssignmentsPerGroupType: { A: 0 } },
      { id: 'P2', name: 'Blair', forbiddenGroupTypeIds: ['B'] },
    ],
    preferences: [
      { personId: 'P1', dayPreferences: { '2026-10-15': 'unavailable' }, slotPreferences: { S3: 'unavailable' } },
      { personId: 'P2', dayGroupPreferences: { '2026-10-15': { A: 'unavailable' } }, slotPreferences: { S1: 'unavailable' } },
    ],
    forbiddenAssignments: [{ personId: 'P1', eventId: 'S1', groupTypeId: 'A' }],
    forcedAssignments: [],
    cooldownRules: [{ triggerGroupTypes: ['A'], blockedGroupTypes: ['A'], blockedNextEventCount: 1 }],
    globalLimits: { maxAssignmentsPerPerson: 4, maxAssignmentsPerGroupType: 3 },
  };
}

function normalized(domain = project()) {
  return normalizeProject(transformEventStaffingProject(domain));
}

describe('Event Staffing administrator repair', () => {
  it('generates stable date-relevant candidates without coverage or cooldown candidates', () => {
    const domain = project();
    const candidates = buildAdministratorRepairCandidates(domain, normalized(domain), '2026-10-15');

    expect(candidates.map((candidate) => candidate.type)).toEqual(expect.arrayContaining([
      'whole-day-unavailability',
      'group-unavailability',
      'slot-unavailability',
      'category-eligibility',
      'explicit-forbidden-assignment',
      'total-workload-maximum',
      'category-workload-maximum',
    ]));
    expect(candidates.every((candidate) => candidate.id.startsWith('repair:2026-10-15:'))).toBe(true);
    expect(candidates.map((candidate) => candidate.type)).not.toEqual(expect.arrayContaining(['coverage', 'cooldown']));
    expect(candidates.find((candidate) => candidate.type === 'whole-day-unavailability')?.label)
      .toContain('2026-10-15 (Morning, Evening)');
    expect(buildAdministratorRepairCandidates(domain, normalized(domain), '2026-10-15').map(({ id }) => id))
      .toEqual(candidates.map(({ id }) => id));
  });

  it('supports select all, clear, and individual selection as pure operations', () => {
    const candidates = [{ id: 'a' }, { id: 'b' }];
    expect(selectAllRepairCandidates(candidates)).toEqual(['a', 'b']);
    expect(toggleRepairCandidate([], 'b', true)).toEqual(['b']);
    expect(toggleRepairCandidate(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(toggleRepairCandidate(['a'], 'a', false)).toEqual([]);
  });

  it('preserves selected temporary exceptions independently for each date', () => {
    let state = updateAdministratorRepairState({}, '2026-10-15', ['a', 'b']);
    state = updateAdministratorRepairState(state, '2026-10-16', ['c']);
    state = updateAdministratorRepairState(state, '2026-10-15');

    expect(getAdministratorRepairSelectedIds(state, '2026-10-15')).toEqual(['a', 'b']);
    expect(getAdministratorRepairSelectedIds(state, '2026-10-16')).toEqual(['c']);
    expect(state.selectedCandidateIds).toEqual(['a', 'b']);
  });

  it('combines selected temporary exceptions from every blocking date', () => {
    const domain = project();
    const model = normalized(domain);
    const dates = getVisibleAdministratorRepairDates(domain, [
      { code: 'event-staffing-insufficient-group-coverage', path: 'events.S1' },
      { code: 'event-staffing-insufficient-group-coverage', path: 'events.S3' },
    ]).dates;
    const firstCandidate = buildAdministratorRepairCandidates(domain, model, dates[0].dateKey)[0];
    const secondCandidate = buildAdministratorRepairCandidates(domain, model, dates[1].dateKey)[0];
    let state = updateAdministratorRepairState({}, dates[0].dateKey, [firstCandidate.id]);
    state = updateAdministratorRepairState(state, dates[1].dateKey, [secondCandidate.id]);
    state = updateAdministratorRepairState(state, dates[0].dateKey);

    const selection = getAdministratorRepairSelection(domain, model, dates, state);

    expect(selection.selectedIds).toEqual([firstCandidate.id, secondCandidate.id]);
    expect(selection.candidates.map(({ id }) => id)).toEqual(expect.arrayContaining(selection.selectedIds));
  });

  it('keeps temporary exceptions costly and equity active in repair solves', () => {
    const options = buildAdministratorRepairSolveOptions({
      mode: 'topK',
      scoreWeights: { preferences: 0, equity: 0, targets: 20 },
    }, [{ id: 'P1' }, { id: 'P2' }]);

    expect(options.scoreWeights).toEqual({ preferences: 1, equity: 100, targets: 20 });
    expect(options.equityEligibleItemIds).toEqual(['P1', 'P2']);
  });

  it('opens an assignment only when every overlapping blocker is selected and adds a strong penalty', () => {
    const domain = project();
    const model = normalized(domain);
    const candidates = buildAdministratorRepairCandidates(domain, model, '2026-10-15');
    const destinationId = 'event:S1::group:A';
    const blockers = candidates.filter((candidate) => candidate.kind === 'forbidden'
      && candidate.itemId === 'P1' && candidate.destinationIds.includes(destinationId));

    const partial = createAdministratorRepairModel(model, candidates, [blockers[0].id]);
    expect(partial.forbiddenAssignments).toContainEqual(expect.objectContaining({ itemId: 'P1', destinationId }));

    const repaired = createAdministratorRepairModel(model, candidates, blockers.map(({ id }) => id));
    expect(repaired.forbiddenAssignments).not.toContainEqual(expect.objectContaining({ itemId: 'P1', destinationId }));
    expect(repaired.softAssignmentScores).toContainEqual({ itemId: 'P1', destinationId, score: -100_000 });
    expect(createAdministratorRepairModel(model, candidates, blockers.map(({ id }) => id), -777).softAssignmentScores)
      .toContainEqual({ itemId: 'P1', destinationId, score: -777 });
    expect(model.forbiddenAssignments).toContainEqual(expect.objectContaining({ itemId: 'P1', destinationId }));
  });

  it('allows only one selected-date maximum exception and never changes coverage or cooldowns', () => {
    const domain = project();
    const model = normalized(domain);
    const candidates = buildAdministratorRepairCandidates(domain, model, '2026-10-15');
    const maximum = candidates.find((candidate) => candidate.type === 'total-workload-maximum' && candidate.itemId === 'P1');
    const originalContainers = structuredClone(model.containers);
    const originalExclusions = structuredClone(model.assignmentExclusions);
    const repaired = createAdministratorRepairModel(model, candidates, [maximum.id]);
    const raised = repaired.assignmentCountUpperBounds[maximum.boundIndex];
    const guard = repaired.assignmentCountUpperBounds.find((bound) => bound.metadata?.repairCandidateId === maximum.id);

    expect(raised.maxCount).toBe(maximum.originalMax + 1);
    expect(guard).toMatchObject({ itemId: 'P1', maxCount: maximum.originalMax });
    expect(guard.destinationIds).toEqual(['event:S3::group:A']);
    expect(repaired.softAssignmentScores).toEqual(model.softAssignmentScores);
    expect(repaired.containers).toEqual(originalContainers);
    expect(repaired.assignmentExclusions).toEqual(originalExclusions);
  });

  it('applies selected workload maximum exceptions across multiple dates', () => {
    const domain = project();
    const model = normalized(domain);
    const first = buildAdministratorRepairCandidates(domain, model, '2026-10-15')
      .find((candidate) => candidate.type === 'total-workload-maximum' && candidate.itemId === 'P1');
    const second = buildAdministratorRepairCandidates(domain, model, '2026-10-16')
      .find((candidate) => candidate.type === 'total-workload-maximum' && candidate.itemId === 'P1');
    const repaired = createAdministratorRepairModel(model, [first, second], [first.id, second.id]);

    expect(repaired.assignmentCountUpperBounds[first.boundIndex].maxCount).toBe(first.originalMax + 2);
    expect(repaired.assignmentCountUpperBounds).toContainEqual(expect.objectContaining({
      itemId: 'P1',
      maxCount: first.originalMax + 1,
      metadata: expect.objectContaining({ eventStaffingScope: 'repair-other-date-guard' }),
    }));
  });

  it('does not mistake slot exclusivity for a relaxable workload maximum', () => {
    const domain = project();
    domain.groupTypes = [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }];
    domain.requirements = [
      { eventId: 'S1', groupTypeId: 'A', min: 0, max: 1 },
      { eventId: 'S1', groupTypeId: 'B', min: 0, max: 1 },
    ];
    domain.people = [{ id: 'P1', name: 'Alex', maxAssignments: 1, maxAssignmentsPerGroupType: {} }];
    domain.preferences = [];
    domain.forbiddenAssignments = [];
    domain.cooldownRules = [];
    domain.globalLimits = { maxAssignmentsPerPerson: null, maxAssignmentsPerGroupType: null };
    const model = normalized(domain);
    const candidates = buildAdministratorRepairCandidates(domain, model, '2026-10-15');
    expect(model.assignmentCountUpperBounds[0].metadata.eventStaffingScope).toBe('slot-exclusivity');
    const maxima = candidates.filter((candidate) => candidate.kind === 'maximum');
    expect(maxima).toHaveLength(1);

    const repaired = createAdministratorRepairModel(model, candidates, [maxima[0].id]);
    expect(repaired.assignmentCountUpperBounds.find((bound) => bound.metadata?.eventStaffingScope === 'slot-exclusivity')?.maxCount).toBe(1);
    expect(repaired.assignmentCountUpperBounds.find((bound) => bound.metadata?.eventStaffingScope === 'person-total-maximum')?.maxCount).toBe(2);
  });

  it('solves through a selected exception and annotates only exceptions actually used', () => {
    const domain = project();
    domain.people = [{ id: 'P1', name: 'Alex' }];
    domain.preferences = [{ personId: 'P1', dayPreferences: { '2026-10-15': 'unavailable' } }];
    domain.forbiddenAssignments = [];
    domain.cooldownRules = [];
    domain.requirements = [{ eventId: 'S1', groupTypeId: 'A', min: 1, max: 1 }];
    const model = normalized(domain);
    expect(new FirstSolverAdapter().solve(model).status).toBe('unsat');
    const candidates = buildAdministratorRepairCandidates(domain, model, '2026-10-15');
    const day = candidates.find((candidate) => candidate.type === 'whole-day-unavailability');
    const unused = { ...day, id: `${day.id}:unused`, destinationIds: ['event:S2::group:A'] };
    const result = new FirstSolverAdapter().solve(createAdministratorRepairModel(model, [...candidates, unused], [day.id, unused.id]));
    const annotated = annotateAdministratorRepairResult(result, [...candidates, unused], [day.id, unused.id], '2026-10-15');

    expect(annotated.status).toBe('solved');
    expect(annotated.solutions[0].administratorExceptionsUsed).toEqual([{ id: day.id, type: day.type, label: day.label }]);
  });

  it('marks a selected workload maximum only when the returned solution exceeds it', () => {
    const domain = project();
    const model = normalized(domain);
    const maximum = buildAdministratorRepairCandidates(domain, model, '2026-10-15')
      .find((candidate) => candidate.type === 'total-workload-maximum' && candidate.itemId === 'P1');
    const result = annotateAdministratorRepairResult({
      status: 'solved',
      solutions: [{ assignments: [{ itemRef: { id: 'P1' }, containerRef: { id: 'event:S1::group:A' } }] }],
    }, [maximum], [maximum.id], '2026-10-15');
    expect(result.solutions[0].administratorExceptionsUsed).toEqual([
      { id: maximum.id, type: maximum.type, label: maximum.label },
    ]);

    const unused = annotateAdministratorRepairResult({ status: 'solved', solutions: [{ assignments: [] }] }, [maximum], [maximum.id], '2026-10-15');
    expect(unused.solutions[0].administratorExceptionsUsed).toEqual([]);
  });

  it('attributes a multi-date workload exception only to the date that uses it', () => {
    const domain = project();
    const model = normalized(domain);
    const first = buildAdministratorRepairCandidates(domain, model, '2026-10-15')
      .find((candidate) => candidate.type === 'total-workload-maximum' && candidate.itemId === 'P1');
    const second = buildAdministratorRepairCandidates(domain, model, '2026-10-16')
      .find((candidate) => candidate.type === 'total-workload-maximum' && candidate.itemId === 'P1');
    const result = annotateAdministratorRepairResult({
      status: 'solved',
      solutions: [{ assignments: [{ itemRef: { id: 'P1' }, containerRef: { id: 'event:S1::group:A' } }] }],
    }, [first, second], [first.id, second.id], ['2026-10-15', '2026-10-16']);

    expect(result.solutions[0].administratorExceptionsUsed).toEqual([
      { id: first.id, type: first.type, label: first.label },
    ]);
  });

  it('renders repair controls only for unsat and accurately describes repaired solutions', () => {
    const domain = project();
    const model = normalized(domain);
    const unsatHtml = renderAdministratorRepairPanel(domain, model, { status: 'unsat' }, {});
    expect(unsatHtml).toContain('Temporary administrator repair');
    expect(unsatHtml).toContain('Coverage min/max and cooldown/rest rules always remain hard');
    expect(unsatHtml).toContain('Select all');
    expect(unsatHtml).toContain('Previous blocking date');
    expect(unsatHtml).toContain('Next blocking date');
    expect(unsatHtml).toContain('class="navigation-arrow"');
    expect(unsatHtml).toContain('all dates, not only the date currently shown');
    expect(renderAdministratorRepairPanel(domain, model, { status: 'timeout' }, {})).toBe('');
    expect(renderAdministratorRepairPanel(domain, model, null, {
      validationErrors: [{ code: 'event-staffing-insufficient-group-coverage', path: 'events.S1' }],
    })).toContain('Repairable hard-constraint conflict');
    expect(renderAdministratorRepairPanel(domain, model, null, {
      validationErrors: [{ code: 'event-staffing-invalid-requirement-bounds' }],
    })).toBe('');

    const solution = {
      assignments: [{ itemRef: { id: 'P1' }, containerRef: { id: 'event:S1::group:A' } }],
      administratorExceptionsUsed: [{ id: 'x', type: 'whole-day-unavailability', label: 'Alex: whole-day unavailability' }],
    };
    const html = renderStaffingScheduleView(domain, {
      status: 'solved', repairedModel: true, solutions: [solution], warnings: [], runtimeMs: 1,
    });
    expect(html).toContain('Administrator exceptions used');
    expect(html).toContain('The original hard model was not satisfied');
    expect(html).not.toContain('<strong>Hard constraints:</strong> satisfied');
  });

  it('limits the repair date selector to dates identified by validation', () => {
    const domain = project();
    const result = getVisibleAdministratorRepairDates(domain, [
      { code: 'event-staffing-insufficient-group-coverage', path: 'events.S3' },
    ]);

    expect(result.filteredToBlockingDates).toBe(true);
    expect(result.dates).toEqual([{ dateKey: '2026-10-16', label: '2026-10-16' }]);
    expect(moveAdministratorRepairDate(result.dates, '2026-10-16', -1)).toBe('2026-10-16');
  });

  it('does not present every date as blocking when no date-local conflict is known', () => {
    const domain = project();
    const model = normalized(domain);

    const html = renderAdministratorRepairPanel(domain, model, { status: 'unsat' }, { validationErrors: [] });

    expect(getVisibleAdministratorRepairDates(domain, []).dates).toEqual([]);
    expect(html).toContain('No date-local blocking constraint was identified');
    expect(html).not.toContain('name="administratorRepairDate"');
  });

  it('binds the visible repair date and bulk-selection controls', () => {
    const state = createAppState({ storage: null });
    state.eventStaffingPage.domainProject = project();
    state.eventStaffingPage.lastValidation = validateEventStaffingProject(state.eventStaffingPage.domainProject);
    state.eventStaffingPage.lastNormalizedProject = normalized(state.eventStaffingPage.domainProject);
    state.eventStaffingPage.lastSolverResult = { status: 'unsat', solutions: [], warnings: [], runtimeMs: 1 };
    state.eventStaffingPage.activeWorkflowTab = 'results';
    const controls = new Map();
    const makeControl = () => ({
      addEventListener(type, listener) { if (type === 'click' || type === 'change') this.activate = listener; },
    });
    const root = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll(selector) {
        if (!controls.has(selector)) controls.set(selector, [makeControl()]);
        return controls.get(selector);
      },
    };

    renderEventStaffingPage(root, state);
    controls.get('[data-event-staffing-action="select-all-repair-candidates"]')[0].activate();
    expect(state.eventStaffingPage.editor.administratorRepair.selectedCandidateIds.length).toBeGreaterThan(0);
    controls.get('[data-event-staffing-action="clear-repair-candidates"]')[0].activate();
    expect(state.eventStaffingPage.editor.administratorRepair.selectedCandidateIds).toEqual([]);
  });

  it('shows temporary repair in Results but not Review', () => {
    const state = createAppState({ storage: null });
    state.eventStaffingPage.domainProject = project();
    state.eventStaffingPage.lastValidation = validateEventStaffingProject(state.eventStaffingPage.domainProject);
    state.eventStaffingPage.lastNormalizedProject = normalized(state.eventStaffingPage.domainProject);
    state.eventStaffingPage.lastSolverResult = { status: 'unsat', solutions: [], warnings: [], runtimeMs: 1 };
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

    state.eventStaffingPage.activeWorkflowTab = 'review';
    renderEventStaffingPage(root, state);
    const reviewPanel = root.innerHTML.match(/<section id="workflow-panel-review"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(reviewPanel).not.toContain('Temporary administrator repair');

    state.eventStaffingPage.activeWorkflowTab = 'results';
    renderEventStaffingPage(root, state);
    const resultsPanel = root.innerHTML.match(/<section id="workflow-panel-results"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(resultsPanel).toContain('Temporary administrator repair');
  });

  it('shows Worker progress and cancellation in Results during a repair solve', () => {
    const state = createAppState({ storage: null });
    state.eventStaffingPage.activeWorkflowTab = 'results';
    state.eventStaffingPage.solveExecution = {
      status: 'solving',
      progress: { phase: 'optimizing', elapsedMs: 100, exploredNodes: 0, prunedNodes: 0, solutionCount: 1 },
      timeLimitMs: 5000,
      handle: null,
    };
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };

    renderEventStaffingPage(root, state);

    const resultsPanel = root.innerHTML.match(/<section id="workflow-panel-results"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(resultsPanel).not.toContain(' hidden');
    expect(resultsPanel).toContain('Optimizing schedule');
    expect(resultsPanel).toContain('data-event-staffing-action="cancel-solve"');
  });
});
