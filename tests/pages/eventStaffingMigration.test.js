import { describe, expect, it } from 'vitest';
import { migrateEventStaffingProject, PREFERENCE_STATES } from '../../src/pages/eventStaffing/migration.js';
import { validateEventStaffingProject } from '../../src/pages/eventStaffing/validateEventStaffingProject.js';
import { transformEventStaffingProject } from '../../src/core/transform/eventStaffingProject.js';

function legacyProject() {
  return {
    title: 'Legacy',
    events: [{ id: 'E1', label: 'Morning', date: '2026-10-14', orderIndex: 0 }],
    groupTypes: [{ id: 'G1', label: 'Welcome' }, { id: 'G2', label: 'Setup' }],
    requirements: [{ eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 }, { eventId: 'E1', groupTypeId: 'G2', min: 0, max: 1 }],
    people: [{ id: 'P1', name: 'Alex', email: 'alex@example.org' }],
    preferences: [{ personId: 'P1', eventPreferences: { E1: 'U' } }],
    forcedAssignments: [], forbiddenAssignments: [], cooldownRules: [], globalLimits: {},
  };
}

describe('Event Staffing slot migration', () => {
  it('adds slot/date metadata without changing stable ids or references', () => {
    const migrated = migrateEventStaffingProject(legacyProject());
    expect(migrated.events[0]).toMatchObject({ id: 'E1', dateKey: '2026-10-14', date: '2026-10-14', slotLabel: 'Morning' });
    expect(migrated.requirements[0]).toMatchObject({ eventId: 'E1', slotId: 'E1' });
    expect(migrated.preferences[0].slotPreferences.E1).toBe(PREFERENCE_STATES.UNAVAILABLE);
  });

  it('compiles unavailable to every category destination in the slot', () => {
    const transformed = transformEventStaffingProject(legacyProject());
    expect(transformed.forbiddenAssignments).toEqual(expect.arrayContaining([
      { itemId: 'P1', destinationId: 'event:E1::group:G1' },
      { itemId: 'P1', destinationId: 'event:E1::group:G2' },
    ]));
    expect(transformed.softAssignmentScores).toEqual([]);
  });

  it('rejects duplicate emails and forced versus unavailable conflicts', () => {
    const project = legacyProject();
    project.people.push({ id: 'P2', name: 'Other', email: 'ALEX@EXAMPLE.ORG' });
    project.forcedAssignments.push({ personId: 'P1', eventId: 'E1', groupTypeId: 'G1' });
    const validation = validateEventStaffingProject(project);
    expect(validation.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'event-staffing-duplicate-person-email',
      'event-staffing-forced-unavailable-conflict',
    ]));
  });
});
