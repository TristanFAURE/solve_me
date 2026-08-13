import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../../src/core/normalize/normalizeProject.js';
import { transformEventStaffingProject } from '../../src/core/transform/eventStaffingProject.js';
import { validateProject } from '../../src/core/validate/validateProject.js';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import { validateEventStaffingProject } from '../../src/pages/eventStaffing/validateEventStaffingProject.js';

function buildValidDomainProject() {
  return {
    title: 'Planner',
    events: [
      { id: 'E1', label: 'Event 1', orderIndex: 1 },
      { id: 'E2', label: 'Event 2', orderIndex: 2 },
    ],
    groupTypes: [
      { id: 'G1', label: 'Group 1' },
      { id: 'G2', label: 'Group 2' },
    ],
    requirements: [
      { eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 },
      { eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 },
      { eventId: 'E2', groupTypeId: 'G2', min: 0, max: 1 },
    ],
    people: [
      { id: 'P1', name: 'Alice', maxAssignments: 2, targetAssignments: 1 },
      { id: 'P2', name: 'Bob', maxAssignments: 1 },
    ],
    cooldownRules: [
      {
        triggerGroupTypes: ['G1'],
        blockedGroupTypes: ['G2'],
        blockedNextEventCount: 1,
      },
    ],
    forcedAssignments: [
      { personId: 'P1', eventId: 'E1', groupTypeId: 'G1' },
    ],
    forbiddenAssignments: [
      { personId: 'P2', eventId: 'E2', groupTypeId: 'G2' },
    ],
    preferences: [
      { personId: 'P1', eventPreferences: { E1: 'Y', E2: 'N' } },
    ],
    globalLimits: {
      maxAssignmentsPerPerson: 2,
      maxAssignmentsPerGroupType: 2,
    },
  };
}

describe('event staffing planner workflow', () => {
  it('validates a planner-facing domain project before generic transform validation', () => {
    const domainProject = buildValidDomainProject();
    const adapter = new FirstSolverAdapter();

    const domainValidation = validateEventStaffingProject(domainProject);
    expect(domainValidation.valid).toBe(true);

    const transformedProject = transformEventStaffingProject(domainProject);
    const genericValidation = validateProject(transformedProject, adapter.getCapabilities());
    expect(genericValidation.valid).toBe(true);

    const normalizedProject = normalizeProject(transformedProject);
    const result = adapter.solve(normalizedProject);
    expect(result.status).toBe('solved');
  });

  it('reports domain validation errors for malformed staffing inputs', () => {
    const validation = validateEventStaffingProject({
      events: [{ id: 'E1', label: 'Event 1', orderIndex: 1 }, { id: 'E1', label: 'Duplicate', orderIndex: 1 }],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [{ eventId: 'E1', groupTypeId: 'G1', min: 2, max: 1 }],
      people: [{ id: 'P1', name: 'Alice', allowedGroupTypeIds: ['UNKNOWN'] }],
      cooldownRules: [{ triggerGroupTypes: [], blockedGroupTypes: 'ANY', blockedNextEventCount: 0 }],
      forcedAssignments: [{ personId: 'UNKNOWN', eventId: 'E1', groupTypeId: 'G1' }],
      forbiddenAssignments: [],
      preferences: [{ personId: 'P1', eventPreferences: { E999: 'MAYBE' } }],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-duplicate-event-id')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-duplicate-order-index')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-requirement-min-exceeds-max')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-allowed-group-type')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-cooldown-span')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-assignment-person')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-preference-event')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-preference-value')).toBe(true);
  });
});
