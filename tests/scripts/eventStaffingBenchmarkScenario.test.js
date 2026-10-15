import { describe, expect, it } from 'vitest';
import {
  createEventStaffingBenchmarkScenario,
  EVENT_STAFFING_BENCHMARK_SCENARIOS,
} from '../../scripts/eventStaffingBenchmarkScenario.js';
import { transformEventStaffingProject } from '../../src/core/transform/eventStaffingProject.js';

describe('Event Staffing benchmark scenario generation', () => {
  it('is deterministic and defines the representative scenario sizes', () => {
    expect(EVENT_STAFFING_BENCHMARK_SCENARIOS.map(({ dayCount }) => dayCount)).toEqual([7, 14, 28]);
    expect(createEventStaffingBenchmarkScenario(EVENT_STAFFING_BENCHMARK_SCENARIOS[0]))
      .toEqual(createEventStaffingBenchmarkScenario(EVENT_STAFFING_BENCHMARK_SCENARIOS[0]));
  });

  it.each(EVENT_STAFFING_BENCHMARK_SCENARIOS)('builds realistic coverage, eligibility, preferences, and targets for $id', (definition) => {
    const project = createEventStaffingBenchmarkScenario(definition);
    const transformed = transformEventStaffingProject(project);

    expect(project.events).toHaveLength(definition.dayCount);
    expect(project.requirements).toHaveLength(definition.dayCount * 3);
    expect(project.requirements.reduce((sum, requirement) => sum + requirement.min, 0)).toBe(definition.dayCount * 4);
    expect(project.people).toHaveLength(definition.peopleCount);
    expect(project.people.every((person) => person.allowedGroupTypeIds.length > 0)).toBe(true);
    expect(project.preferences.every((preference) => Object.keys(preference.slotPreferences).length === definition.dayCount)).toBe(true);
    expect(transformed.assignmentMultiplicity).toBe('multiple');
    expect(transformed.containers).toHaveLength(definition.dayCount * 3);
    expect(transformed.forbiddenAssignments.length).toBeGreaterThan(0);
    expect(transformed.softAssignmentScores.length).toBeGreaterThan(0);
    expect(transformed.softItemCountTargets).toHaveLength(definition.peopleCount);
  });

  it('builds configurable day, slot, category, and doctor dimensions', () => {
    const project = createEventStaffingBenchmarkScenario({
      id: 'dimension-check',
      dayCount: 3,
      slotsPerDay: 4,
      categoryCount: 1,
      peopleCount: 20,
    });
    const transformed = transformEventStaffingProject(project);

    expect(project.events).toHaveLength(12);
    expect(new Set(project.events.map((event) => event.dateKey))).toHaveLength(3);
    expect(project.groupTypes).toHaveLength(1);
    expect(project.requirements).toHaveLength(12);
    expect(project.requirements.every(({ min, max }) => min === 1 && max === 1)).toBe(true);
    expect(project.people).toHaveLength(20);
    expect(project.preferences.every(({ slotPreferences }) => (
      Object.keys(slotPreferences).length === 12
    ))).toBe(true);
    expect(transformed.containers).toHaveLength(12);
  });

  it.each([
    { slotsPerDay: 0 },
    { categoryCount: 0 },
  ])('rejects invalid generated dimensions: %j', (dimensions) => {
    expect(() => createEventStaffingBenchmarkScenario({
      dayCount: 1,
      peopleCount: 4,
      ...dimensions,
    })).toThrow(/positive integers/);
  });
});
