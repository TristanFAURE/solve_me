import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../../../src/core/normalize/normalizeProject.js';
import {
  createEventStaffingDestinationId,
  transformEventStaffingProject,
} from '../../../src/core/transform/eventStaffingProject.js';
import { validateProject } from '../../../src/core/validate/validateProject.js';
import { FirstSolverAdapter } from '../../../src/solver/adapters/firstSolverAdapter.js';
import { solve } from '../../helpers/solverScenario.js';

function buildBaseDomainProject() {
  return {
    title: 'Staffing',
    events: [
      { id: 'E1', label: 'Event 1', orderIndex: 1 },
      { id: 'E2', label: 'Event 2', orderIndex: 2 },
      { id: 'E3', label: 'Event 3', orderIndex: 3 },
    ],
    groupTypes: [
      { id: 'G1', label: 'Group 1' },
      { id: 'G2', label: 'Group 2' },
    ],
    requirements: [
      { eventId: 'E1', groupTypeId: 'G1', min: 0, max: 1 },
      { eventId: 'E1', groupTypeId: 'G2', min: 0, max: 1 },
      { eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 },
      { eventId: 'E2', groupTypeId: 'G2', min: 0, max: 1 },
      { eventId: 'E3', groupTypeId: 'G1', min: 0, max: 1 },
      { eventId: 'E3', groupTypeId: 'G2', min: 0, max: 1 },
    ],
    people: [
      { id: 'P1', name: 'Alice' },
      { id: 'P2', name: 'Bob' },
    ],
  };
}

function buildLargeOptionalStaffingProject({ eventCount = 12, peopleCount = 3 } = {}) {
  return {
    title: 'Large optional staffing',
    events: Array.from({ length: eventCount }, (_, index) => ({
      id: `E${index + 1}`,
      label: `Event ${index + 1}`,
      orderIndex: index + 1,
    })),
    groupTypes: [
      { id: 'G1', label: 'Group 1' },
      { id: 'G2', label: 'Group 2' },
    ],
    requirements: Array.from({ length: eventCount }, (_, index) => ([
      { eventId: `E${index + 1}`, groupTypeId: 'G1', min: 0, max: 1 },
      { eventId: `E${index + 1}`, groupTypeId: 'G2', min: 0, max: 1 },
    ])).flat(),
    people: Array.from({ length: peopleCount }, (_, index) => ({
      id: `P${index + 1}`,
      name: `Person ${index + 1}`,
    })),
  };
}

function buildLargeRequiredSingleGroupStaffingProject({ eventCount = 31, peopleCount = 3 } = {}) {
  return {
    title: 'Large required single-group staffing',
    events: Array.from({ length: eventCount }, (_, index) => ({
      id: `E${index + 1}`,
      label: `Event ${index + 1}`,
      orderIndex: index + 1,
    })),
    groupTypes: [
      { id: 'G1', label: 'Group 1' },
    ],
    requirements: Array.from({ length: eventCount }, (_, index) => ({
      eventId: `E${index + 1}`,
      groupTypeId: 'G1',
      min: 1,
      max: 1,
    })),
    people: Array.from({ length: peopleCount }, (_, index) => ({
      id: `P${index + 1}`,
      name: `Person ${index + 1}`,
    })),
  };
}

describe('transformEventStaffingProject', { timeout: 10000 }, () => {
  it('compiles one-assignment-per-person-per-event exclusivity and eligibility into generic hard families', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [
        { id: 'G1', label: 'Group 1' },
        { id: 'G2', label: 'Group 2' },
      ],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 0, max: 1 },
        { eventId: 'E1', groupTypeId: 'G2', min: 0, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 },
      ],
      people: [
        { id: 'P1', name: 'Alice', allowedGroupTypeIds: ['G1'], maxAssignments: 2 },
      ],
      forbiddenAssignments: [
        { personId: 'P1', eventId: 'E2', groupTypeId: 'G1' },
      ],
      forcedAssignments: [
        { personId: 'P1', eventId: 'E1', groupTypeId: 'G1' },
      ],
    }));

    expect(transformed.assignmentCountUpperBounds).toContainEqual({
      itemId: 'P1',
      destinationIds: [
        createEventStaffingDestinationId('E1', 'G1'),
        createEventStaffingDestinationId('E1', 'G2'),
      ],
      maxCount: 1,
    });

    expect(transformed.forbiddenAssignments).toContainEqual({
      itemId: 'P1',
      destinationId: createEventStaffingDestinationId('E1', 'G2'),
    });

    expect(transformed.forbiddenAssignments).toContainEqual({
      itemId: 'P1',
      destinationId: createEventStaffingDestinationId('E2', 'G1'),
    });

    expect(transformed.fixedAssignments).toContainEqual({
      itemId: 'P1',
      destinationId: createEventStaffingDestinationId('E1', 'G1'),
    });
  });

  it('keeps combined staffing transform output generically valid and preserves forced assignment semantics', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
      ],
      groupTypes: [
        { id: 'G1', label: 'Group 1' },
        { id: 'G2', label: 'Group 2' },
      ],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 0, max: 1 },
        { eventId: 'E1', groupTypeId: 'G2', min: 0, max: 1 },
      ],
      people: [
        {
          id: 'P1',
          name: 'Alice',
          allowedGroupTypeIds: ['G1'],
          maxAssignments: 1,
          maxAssignmentsPerGroupType: { G1: 1, G2: 0 },
        },
        {
          id: 'P2',
          name: 'Bob',
          forbiddenGroupTypeIds: ['G2'],
          maxAssignments: 1,
        },
      ],
      cooldownRules: [],
      forcedAssignments: [
        { personId: 'P1', eventId: 'E1', groupTypeId: 'G1' },
      ],
      forbiddenAssignments: [],
    }));

    const adapter = new FirstSolverAdapter();
    const validation = validateProject(transformed, adapter.getCapabilities());
    expect(validation.valid).toBe(true);

    expect(transformed.fixedAssignments).toContainEqual({
      itemId: 'P1',
      destinationId: createEventStaffingDestinationId('E1', 'G1'),
    });

    expect(transformed.forbiddenAssignments).toContainEqual({
      itemId: 'P1',
      destinationId: createEventStaffingDestinationId('E1', 'G2'),
    });

    expect(transformed.forbiddenAssignments).toContainEqual({
      itemId: 'P2',
      destinationId: createEventStaffingDestinationId('E1', 'G2'),
    });
  });

  it('reveals cooldown and minimum-demand conflicts at the transform output level', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 1, max: 1 },
      ],
      people: [{ id: 'P1', name: 'Alice', maxAssignments: 2 }],
      cooldownRules: [
        {
          triggerGroupTypes: 'ANY',
          blockedGroupTypes: 'ANY',
          blockedNextEventCount: 1,
        },
      ],
    }));

    expect(transformed.assignmentExclusions).toContainEqual({
      itemId: 'P1',
      firstDestinationId: createEventStaffingDestinationId('E1', 'G1'),
      secondDestinationId: createEventStaffingDestinationId('E2', 'G1'),
    });

    expect(transformed.containers.find((container) => container.id === createEventStaffingDestinationId('E1', 'G1'))?.metadata.minCapacity).toBe(1);
    expect(transformed.containers.find((container) => container.id === createEventStaffingDestinationId('E2', 'G1'))?.metadata.minCapacity).toBe(1);
  });

  it('makes transformed minimum-demand conflicts solver-unsat when container minimum capacities cannot all be met', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 1, max: 1 },
      ],
      people: [{ id: 'P1', name: 'Alice', maxAssignments: 2 }],
      cooldownRules: [
        {
          triggerGroupTypes: 'ANY',
          blockedGroupTypes: 'ANY',
          blockedNextEventCount: 1,
        },
      ],
    }));

    const result = solve(transformed);
    expect(result.status).toBe('unsat');
  });

  it('keeps optional-demand staffing solvable without forcing assignments', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 0, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 },
      ],
      people: [{ id: 'P1', name: 'Alice' }],
    }));

    expect(transformed.assignmentMultiplicity).toBe('multiple');
    expect(transformed.containers).toHaveLength(2);
    expect(transformed.containers.every((container) => container.metadata.minCapacity === 0)).toBe(true);

    const result = solve(transformed);
    expect(result.status).toBe('solved');
    expect(result.solutions[0]?.assignments.length).toBeGreaterThanOrEqual(0);
    expect(result.solutions[0]?.assignments.length).toBeLessThanOrEqual(2);
    expect(result.solutions[0]?.assignments.every((assignment) => assignment.itemRef.id === 'P1')).toBe(true);
  });

  it('keeps two required single-group events solvable with two people', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 1, max: 1 },
      ],
      people: [
        { id: 'P1', name: 'Alice' },
        { id: 'P2', name: 'Bob' },
      ],
    }));

    const result = solve(transformed);

    expect(result.status).toBe('solved');
    expect(result.solutions[0]?.assignments).toHaveLength(2);
    expect(result.solutions[0]?.assignments).toContainEqual(expect.objectContaining({
      containerRef: { kind: 'container', id: createEventStaffingDestinationId('E1', 'G1') },
    }));
    expect(result.solutions[0]?.assignments).toContainEqual(expect.objectContaining({
      containerRef: { kind: 'container', id: createEventStaffingDestinationId('E2', 'G1') },
    }));
    expect(new Set(result.solutions[0]?.assignments.map((assignment) => assignment.itemRef.id)).size).toBeGreaterThanOrEqual(1);
    expect(new Set(result.solutions[0]?.assignments.map((assignment) => assignment.itemRef.id)).size).toBeLessThanOrEqual(2);
  });

  it('compiles ordered-event cooldown rules into assignment exclusions', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      ...buildBaseDomainProject(),
      cooldownRules: [
        {
          triggerGroupTypes: ['G1'],
          blockedGroupTypes: ['G1', 'G2'],
          blockedNextEventCount: 2,
        },
      ],
    }));

    expect(transformed.assignmentExclusions).toContainEqual({
      itemId: 'P1',
      firstDestinationId: createEventStaffingDestinationId('E1', 'G1'),
      secondDestinationId: createEventStaffingDestinationId('E2', 'G1'),
    });

    expect(transformed.assignmentExclusions).toContainEqual({
      itemId: 'P1',
      firstDestinationId: createEventStaffingDestinationId('E1', 'G1'),
      secondDestinationId: createEventStaffingDestinationId('E2', 'G2'),
    });

    expect(transformed.assignmentExclusions).toContainEqual({
      itemId: 'P1',
      firstDestinationId: createEventStaffingDestinationId('E1', 'G1'),
      secondDestinationId: createEventStaffingDestinationId('E3', 'G2'),
    });

    expect(transformed.assignmentExclusions).not.toContainEqual({
      itemId: 'P1',
      firstDestinationId: createEventStaffingDestinationId('E1', 'G2'),
      secondDestinationId: createEventStaffingDestinationId('E2', 'G1'),
    });
  });

  it('supports ANY cooldown scopes across the next ordered event', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      ...buildBaseDomainProject(),
      cooldownRules: [
        {
          triggerGroupTypes: 'ANY',
          blockedGroupTypes: 'ANY',
          blockedNextEventCount: 1,
        },
      ],
    }));

    expect(transformed.assignmentExclusions).toContainEqual({
      itemId: 'P2',
      firstDestinationId: createEventStaffingDestinationId('E1', 'G2'),
      secondDestinationId: createEventStaffingDestinationId('E2', 'G1'),
    });

    expect(transformed.assignmentExclusions).toContainEqual({
      itemId: 'P2',
      firstDestinationId: createEventStaffingDestinationId('E2', 'G1'),
      secondDestinationId: createEventStaffingDestinationId('E3', 'G2'),
    });

    expect(transformed.assignmentExclusions).not.toContainEqual({
      itemId: 'P2',
      firstDestinationId: createEventStaffingDestinationId('E1', 'G1'),
      secondDestinationId: createEventStaffingDestinationId('E3', 'G1'),
    });
  });

  it('assigns the same person on each event when each event requires one person', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 1, max: 1 },
      ],
      people: [{ id: 'P1', name: 'Alice' }],
    }));

    const result = solve(transformed);

    expect(result.status).toBe('solved');
    expect(result.solutions[0]?.assignments).toHaveLength(2);
    expect(result.solutions[0]?.assignments).toContainEqual(expect.objectContaining({
      itemRef: { kind: 'item', id: 'P1' },
      containerRef: { kind: 'container', id: createEventStaffingDestinationId('E1', 'G1') },
    }));
    expect(result.solutions[0]?.assignments).toContainEqual(expect.objectContaining({
      itemRef: { kind: 'item', id: 'P1' },
      containerRef: { kind: 'container', id: createEventStaffingDestinationId('E2', 'G1') },
    }));
  });

  it('makes cooldown exclusions solver-effective in container mode', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      title: 'Cooldown enforced',
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 0, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 },
      ],
      people: [{ id: 'P1', name: 'Alice', maxAssignments: 2 }],
      cooldownRules: [
        {
          triggerGroupTypes: 'ANY',
          blockedGroupTypes: 'ANY',
          blockedNextEventCount: 1,
        },
      ],
    }));

    const result = solve(transformed);

    expect(result.status).toBe('solved');
    expect(result.solutions.every((solution) => solution.assignments.length <= 1)).toBe(true);
    expect(result.solutions.every((solution) => solution.assignments.every((assignment) => assignment.containerRef.id !== createEventStaffingDestinationId('E1', 'G1') || solution.assignments.length === 1))).toBe(true);
  });

  it('becomes unsatisfiable when a per-group assignment upper bound blocks staffing both required events', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      events: [
        { id: 'E1', label: 'Event 1', orderIndex: 1 },
        { id: 'E2', label: 'Event 2', orderIndex: 2 },
      ],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [
        { eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 },
        { eventId: 'E2', groupTypeId: 'G1', min: 1, max: 1 },
      ],
      people: [{ id: 'P1', name: 'Alice', maxAssignmentsPerGroupType: { G1: 1 } }],
    }));

    expect(transformed.assignmentCountUpperBounds).toContainEqual({
      itemId: 'P1',
      destinationIds: [
        createEventStaffingDestinationId('E1', 'G1'),
        createEventStaffingDestinationId('E2', 'G1'),
      ],
      maxCount: 1,
    });

    const result = solve(transformed);
    expect(result.status).toBe('unsat');
  });

  it('compiles per-group soft targets and global per-group defaults into scoped soft item count targets', () => {
    const transformed = normalizeProject(transformEventStaffingProject({
      ...buildBaseDomainProject(),
      people: [
        {
          id: 'P1',
          name: 'Alice',
          targetAssignmentsPerGroupType: { G2: 2 },
        },
        {
          id: 'P2',
          name: 'Bob',
        },
      ],
      globalLimits: {
        targetAssignmentsPerGroupType: 1,
      },
    }));

    expect(transformed.softItemCountTargets).toContainEqual({
      itemId: 'P1',
      destinationIds: [
        createEventStaffingDestinationId('E1', 'G2'),
        createEventStaffingDestinationId('E2', 'G2'),
        createEventStaffingDestinationId('E3', 'G2'),
      ],
      targetCount: 2,
    });

    expect(transformed.softItemCountTargets).toContainEqual({
      itemId: 'P1',
      destinationIds: [
        createEventStaffingDestinationId('E1', 'G1'),
        createEventStaffingDestinationId('E2', 'G1'),
        createEventStaffingDestinationId('E3', 'G1'),
      ],
      targetCount: 1,
    });

    expect(transformed.softItemCountTargets).toContainEqual({
      itemId: 'P2',
      destinationIds: [
        createEventStaffingDestinationId('E1', 'G2'),
        createEventStaffingDestinationId('E2', 'G2'),
        createEventStaffingDestinationId('E3', 'G2'),
      ],
      targetCount: 1,
    });
  });

  it('keeps large required single-group staffing solvable with three people across thirty-one events', { timeout: 10000 }, () => {
    const transformed = normalizeProject(transformEventStaffingProject(
      buildLargeRequiredSingleGroupStaffingProject({ eventCount: 31, peopleCount: 3 }),
    ));

    const result = solve(transformed);

    expect(result.status).toBe('solved');
    expect(result.solutions.length).toBeGreaterThan(0);
    expect(result.solutions[0]?.assignments).toHaveLength(31);
    expect(new Set(result.solutions[0]?.assignments.map((assignment) => assignment.containerRef.id)).size).toBe(31);
  });

  it('solves a representative optional multi-assignment staffing case without blowing up', { timeout: 10000 }, () => {
    const transformed = normalizeProject(transformEventStaffingProject(
      buildLargeOptionalStaffingProject({ eventCount: 12, peopleCount: 3 }),
    ));

    const startedAt = performance.now();
    const result = solve(transformed);
    const wallClockMs = performance.now() - startedAt;

    expect(result.status).toBe('solved');
    expect(result.solutions.length).toBeGreaterThan(0);
    expect(result.runtimeMs).toBeLessThan(1000);
    expect(wallClockMs).toBeLessThan(1000);
  });
});
