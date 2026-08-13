import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_MODES } from '../../src/core/model/assignmentModes.js';
import { createConstraint, CONSTRAINT_KINDS } from '../../src/core/model/constraints.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createEntityRef } from '../../src/core/model/relations.js';
import { scenario } from '../helpers/projectBuilder.js';
import { expectValidationError } from '../helpers/solverAssertions.js';
import { solve, validateWithSolver } from '../helpers/solverScenario.js';

describe('FirstSolverAdapter - validation', () => {
  it('accepts supported position-mode adjacency constraints', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1', 'P2'] })
      .adjacent('P1', 'P2')
      .mustBeAdjacent('A', 'B')
      .mustNotBeAdjacent('A', 'B')
      .buildNormalized();

    const validation = validateWithSolver(project);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('rejects unsupported assignment modes', () => {
    const project = createEmptyProject({
      assignmentMode: 'invalid-mode',
    });

    const validation = validateWithSolver(project);

    expectValidationError(validation, 'supports container mode and position mode only');
  });

  it('rejects position mode when there are fewer positions than items', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'] })
      .buildNormalized();

    const validation = validateWithSolver(project);

    expectValidationError(validation, 'at least as many positions as items');
  });

  it('rejects position mode when a position does not belong to a container', () => {
    const base = scenario()
      .positionMode()
      .items('A')
      .containers({ T1: ['P1'] })
      .build();

    const project = createEmptyProject({
      assignmentMode: ASSIGNMENT_MODES.POSITION,
      items: base.items,
      containers: base.containers,
      positions: [
        ...base.positions,
        { id: 'P2', kind: 'position', label: 'P2', metadata: {} },
      ],
      containments: base.containments,
      topologies: [],
      constraints: [],
      preferences: [],
    });

    const validation = validateWithSolver(project);

    expectValidationError(validation, 'every position to belong to a container');
  });

  it('rejects unsupported constraints in container mode', () => {
    const project = createEmptyProject({
      assignmentMode: 'container',
      items: scenario().items('A', 'B').build().items,
      containers: scenario().containers({ T1: 2 }).build().containers,
      positions: [],
      containments: [],
      topologies: [],
      constraints: [createConstraint({
        kind: CONSTRAINT_KINDS.MUST_BE_ADJACENT,
        leftRef: createEntityRef('item', 'A'),
        rightRef: createEntityRef('item', 'B'),
      })],
      preferences: [],
    });

    const validation = validateWithSolver(project);

    expectValidationError(validation, 'supports only mustShareContainer and mustNotShareContainer hard constraints in container mode');
  });

  it('warns that soft preferences are ignored', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2 })
      .preferShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expect(result.warnings).toContain('Soft preferences are ignored by the first solver adapter.');
  });

  it('warns that positions and adjacency are ignored in container mode', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1 })
      .build();

    project.positions.push({ id: 'P1', kind: 'position', label: 'P1', metadata: {} });
    project.topologies.push({
      kind: 'adjacent',
      from: createEntityRef('position', 'P1'),
      to: createEntityRef('position', 'P1'),
      metadata: {},
    });

    const validation = validateWithSolver(project);

    expect(validation.warnings).toContain('Positions and adjacency are ignored by the first solver adapter in container mode.');
  });

  it('returns an error solver result when validation fails', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'] })
      .buildNormalized();

    const result = solve(project);

    expect(result.status).toBe('error');
    expect(result.solutions).toHaveLength(0);
    expect(result.warnings).toContain('Position mode requires at least as many positions as items.');
    expect(result.runtimeMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects unsupported adjacency constraints in container mode through solve path', () => {
    const project = createEmptyProject({
      assignmentMode: ASSIGNMENT_MODES.CONTAINER,
      items: scenario().items('A', 'B').build().items,
      containers: scenario().containers({ T1: 2 }).build().containers,
      positions: [],
      containments: [],
      topologies: [],
      constraints: [createConstraint({
        kind: CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT,
        leftRef: createEntityRef('item', 'A'),
        rightRef: createEntityRef('item', 'B'),
      })],
      preferences: [],
    });

    const result = solve(project);

    expect(result.status).toBe('error');
    expect(result.warnings).toContain('First solver adapter currently supports only mustShareContainer and mustNotShareContainer hard constraints in container mode.');
  });
});
