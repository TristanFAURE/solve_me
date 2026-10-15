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
import { buildAdministratorRepairSolveOptions, renderAdministratorRepairPanel, renderStaffingScheduleView } from '../../src/pages/eventStaffing/index.js';

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

  it('renders repair controls only for unsat and accurately describes repaired solutions', () => {
    const domain = project();
    const model = normalized(domain);
    const unsatHtml = renderAdministratorRepairPanel(domain, model, { status: 'unsat' }, {});
    expect(unsatHtml).toContain('Temporary administrator repair');
    expect(unsatHtml).toContain('Coverage min/max and cooldown/rest rules always remain hard');
    expect(unsatHtml).toContain('Select all');
    expect(renderAdministratorRepairPanel(domain, model, { status: 'timeout' }, {})).toBe('');

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
});
