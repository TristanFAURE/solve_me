import { describe, expect, it } from 'vitest';
import { getEffectiveAssignmentPreference, migrateEventStaffingProject, moveSlotDayPreferences, PREFERENCE_STATES } from '../../src/pages/eventStaffing/migration.js';
import { movePreferenceMatrixDay, movePreferenceMatrixPerson, renderPreferenceMatrix, setDayAvailability, setDayGroupPreference, setSlotGroupPreference } from '../../src/pages/eventStaffing/preferenceMatrix.js';
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
    expect(migrated.preferences[0].dayPreferences).toEqual({});
    expect(migrated.preferences[0].slotGroupPreferences).toEqual({});
    expect(migrated.modelVersion).toBe(3);
  });

  it('compiles slot/group preferences independently for categories in one slot', () => {
    const project = migrateEventStaffingProject(legacyProject());
    project.preferences = [{
      personId: 'P1',
      dayPreferences: { '2026-10-14': 'preferNot' },
      slotGroupPreferences: { E1: { G1: 'unavailable', G2: 'prefer' } },
    }];
    const transformed = transformEventStaffingProject(project);
    expect(transformed.forbiddenAssignments).toContainEqual(expect.objectContaining({ itemId: 'P1', destinationId: 'event:E1::group:G1' }));
    expect(transformed.forbiddenAssignments).not.toContainEqual(expect.objectContaining({ itemId: 'P1', destinationId: 'event:E1::group:G2' }));
    expect(transformed.softAssignmentScores).toContainEqual({ itemId: 'P1', destinationId: 'event:E1::group:G2', score: 1 });
  });

  it('supports person-centric whole-day preferences with group overrides', () => {
    const project = migrateEventStaffingProject({
      ...legacyProject(),
      events: [
        { id: 'E1', label: 'Morning', slotLabel: 'Morning', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 0 },
        { id: 'E2', label: 'Evening', slotLabel: 'Evening', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 1 },
        { id: 'E3', label: 'Morning', slotLabel: 'Morning', date: '2026-10-15', dateKey: '2026-10-15', orderIndex: 2 },
      ],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 0, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 },
        { eventId: 'E3', groupTypeId: 'G2', min: 0, max: 1 },
      ],
      preferences: [],
    });
    project.people.push({ id: 'P2', name: 'Blair', email: 'blair@example.org' });

    setDayAvailability(project, 'P1', '2026-10-14', 'unavailable');
    setDayGroupPreference(project, 'P1', '2026-10-14', 'G1', 'prefer');
    expect(getEffectiveAssignmentPreference(project.preferences[0], project.events[0], 'G1')).toBe(PREFERENCE_STATES.PREFER);
    expect(getEffectiveAssignmentPreference(project.preferences[0], project.events[1], 'G1')).toBe(PREFERENCE_STATES.PREFER);

    setDayAvailability(project, 'P1', '2026-10-14', 'prefer');
    setDayGroupPreference(project, 'P1', '2026-10-14', 'G1', 'unavailable');
    expect(getEffectiveAssignmentPreference(project.preferences[0], project.events[0], 'G1')).toBe(PREFERENCE_STATES.UNAVAILABLE);
    expect(getEffectiveAssignmentPreference(project.preferences[0], project.events[1], 'G1')).toBe(PREFERENCE_STATES.UNAVAILABLE);
    expect(getEffectiveAssignmentPreference(project.preferences[0], project.events[0], 'G2')).toBe(PREFERENCE_STATES.PREFER);
    setSlotGroupPreference(project, 'P1', 'E1', 'G1', 'neutral');
    expect(getEffectiveAssignmentPreference(project.preferences[0], project.events[0], 'G1')).toBe(PREFERENCE_STATES.NEUTRAL);
    expect(getEffectiveAssignmentPreference(project.preferences[0], project.events[1], 'G1')).toBe(PREFERENCE_STATES.UNAVAILABLE);

    const html = renderPreferenceMatrix(project, 'P1');
    expect(html).toContain('Person availability calendar');
    expect(html.match(/availability-calendar-panel" open/g)).toHaveLength(2);
    expect(html).toContain('<thead><tr><th>Availability</th><th>2026-10-14</th><th>2026-10-15</th></tr></thead>');
    expect(html).toContain('<th>Whole day</th>');
    expect(html).toContain('<th>Welcome</th>');
    expect(html).toContain('<th>Setup</th>');
    expect(html).toContain('data-day-group-preference');
    expect(html).toContain('data-slot-group-preference');
    expect(html).toContain('Previous availability date');
    expect(html).toContain('Next availability date');
    expect(html).toContain('Previous availability person');
    expect(html).toContain('Next availability person');
    expect(html).toContain('name="preferenceMatrixPeopleFilter"');
    expect(html.indexOf('Person availability calendar')).toBeLessThan(html.indexOf('Date availability overview'));
    expect(html.indexOf('2026-10-14')).toBeLessThan(html.indexOf('2026-10-15'));
    expect(movePreferenceMatrixDay(project, '2026-10-14', 1)).toBe('2026-10-15');
    expect(movePreferenceMatrixDay(project, '2026-10-15', -1)).toBe('2026-10-14');
    expect(movePreferenceMatrixPerson(project, 'P1', 1)).toBe('P2');
    expect(movePreferenceMatrixPerson(project, 'P2', -1)).toBe('P1');
  });

  it('compiles whole-day unavailability for every slot and category on that date', () => {
    const project = legacyProject();
    project.events.push({ id: 'E2', label: 'Evening', slotLabel: 'Evening', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 1 });
    project.requirements.push({ eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 });
    project.preferences = [{ personId: 'P1', dayPreferences: { '2026-10-14': 'unavailable' }, slotPreferences: {} }];

    const transformed = transformEventStaffingProject(project);

    expect(transformed.forbiddenAssignments).toEqual(expect.arrayContaining([
      { itemId: 'P1', destinationId: 'event:E1::group:G1' },
      { itemId: 'P1', destinationId: 'event:E1::group:G2' },
      { itemId: 'P1', destinationId: 'event:E2::group:G1' },
    ]));
  });

  it('compiles a date-group override across matching slots without blocking other groups', () => {
    const project = legacyProject();
    project.events.push({ id: 'E2', label: 'Evening', slotLabel: 'Evening', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 1 });
    project.requirements.push({ eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 });
    project.preferences = [{
      personId: 'P1',
      dayPreferences: { '2026-10-14': 'prefer' },
      dayGroupPreferences: { '2026-10-14': { G1: 'unavailable', G2: 'neutral' } },
      slotPreferences: {},
    }];

    const transformed = transformEventStaffingProject(project);

    expect(transformed.forbiddenAssignments).toEqual(expect.arrayContaining([
      { itemId: 'P1', destinationId: 'event:E1::group:G1' },
      { itemId: 'P1', destinationId: 'event:E2::group:G1' },
    ]));
    expect(transformed.forbiddenAssignments).not.toContainEqual({ itemId: 'P1', destinationId: 'event:E1::group:G2' });
  });

  it('rejects a forced assignment on an unavailable day', () => {
    const project = legacyProject();
    project.preferences = [{ personId: 'P1', dayPreferences: { '2026-10-14': 'unavailable' }, slotPreferences: {} }];
    project.forcedAssignments = [{ personId: 'P1', eventId: 'E1', groupTypeId: 'G1' }];

    expect(validateEventStaffingProject(project).errors.map((issue) => issue.code))
      .toContain('event-staffing-forced-unavailable-conflict');
  });

  it('moves day and group preferences when the final slot moves to a new date', () => {
    const project = legacyProject();
    project.preferences = [{
      personId: 'P1',
      dayPreferences: { '2026-10-14': 'prefer' },
      dayGroupPreferences: { '2026-10-14': { G1: 'unavailable' } },
      slotPreferences: {},
    }];

    moveSlotDayPreferences(project, 'E1', '2026-10-14', '2026-10-15');

    expect(project.preferences[0].dayPreferences).toEqual({ '2026-10-15': 'prefer' });
    expect(project.preferences[0].dayGroupPreferences).toEqual({ '2026-10-15': { G1: 'unavailable' } });
  });

  it('keeps date preferences on the original date when another slot remains there', () => {
    const project = legacyProject();
    project.events.push({ id: 'E2', label: 'Evening', slotLabel: 'Evening', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 1 });
    project.preferences = [{
      personId: 'P1',
      dayPreferences: { '2026-10-14': 'prefer' },
      dayGroupPreferences: { '2026-10-14': { G1: 'unavailable' } },
      slotPreferences: {},
    }];

    moveSlotDayPreferences(project, 'E1', '2026-10-14', '2026-10-15');

    expect(project.preferences[0].dayPreferences).toEqual({ '2026-10-14': 'prefer' });
    expect(project.preferences[0].dayGroupPreferences).toEqual({ '2026-10-14': { G1: 'unavailable' } });
  });

  it('keeps invalid day preference values visible to validation', () => {
    const project = legacyProject();
    project.preferences = [{ personId: 'P1', dayPreferences: { '2026-10-14': 'invalid' }, slotPreferences: {} }];

    expect(validateEventStaffingProject(project).errors.map((issue) => issue.code))
      .toContain('event-staffing-invalid-day-preference');
  });

  it('lets an explicit date-group value override legacy slot unavailability during validation', () => {
    const project = legacyProject();
    project.preferences = [{
      personId: 'P1',
      slotPreferences: { E1: 'unavailable' },
      dayGroupPreferences: { '2026-10-14': { G1: 'neutral' } },
    }];
    project.forcedAssignments = [{ personId: 'P1', eventId: 'E1', groupTypeId: 'G1' }];

    expect(validateEventStaffingProject(project).errors.map((issue) => issue.code))
      .not.toContain('event-staffing-forced-unavailable-conflict');
  });

  it('detects impossible group coverage caused by eligibility', () => {
    const project = legacyProject();
    project.people[0].allowedGroupTypeIds = ['G2'];
    project.preferences = [];

    expect(validateEventStaffingProject(project).errors.map((issue) => issue.code))
      .toContain('event-staffing-insufficient-group-coverage');
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
