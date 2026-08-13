import { describe, expect, it } from 'vitest';
import { scenario } from '../helpers/projectBuilder.js';
import {
  assignedToContainer,
  expectEverySolution,
  expectSolved,
  expectUnsat,
  inSameContainer,
  notInSameContainer,
} from '../helpers/solverAssertions.js';
import { solve } from '../helpers/solverScenario.js';

describe('FirstSolverAdapter - container mode', () => {
  it('enforces must-share across all returned solutions', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B', 'C')
      .containers({ T1: 3, T2: 3 })
      .mustShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, inSameContainer('A', 'B'));
  });

  it('enforces must-not-share across all returned solutions', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B', 'C')
      .containers({ T1: 2, T2: 2 })
      .mustNotShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, notInSameContainer('A', 'B'));
  });

  it('returns unsat when a must-share component exceeds every container capacity', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B', 'C')
      .containers({ T1: 2, T2: 2 })
      .mustShare('A', 'B')
      .mustShare('B', 'C')
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('respects allowed container restrictions', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 2 })
      .allowed('A', ['T2'])
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, assignedToContainer('A', 'T2'));
  });

  it('respects forbidden container restrictions', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 2 })
      .forbidden('A', ['T1'])
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, assignedToContainer('A', 'T2'));
  });

  it('returns unsat when restrictions leave no available container', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .allowed('A', ['T1'])
      .forbidden('A', ['T1'])
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('returns unsat when must-not-share blocks the only possible placement', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 1 })
      .allowed('A', ['T1'])
      .allowed('B', ['T1'])
      .mustNotShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('enforces container minimum capacities across returned solutions', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B', 'C')
      .containers({ T1: 2, T2: 2 })
      .buildNormalized();

    project.containers = project.containers.map((container) => (
      container.id === 'T1'
        ? {
          ...container,
          metadata: {
            ...container.metadata,
            minCapacity: 2,
          },
        }
        : container
    ));

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions.every((solution) => {
      const t1Load = solution.assignments.filter((assignment) => assignment.containerRef?.id === 'T1').length;
      return t1Load >= 2;
    })).toBe(true);
  });

  it('returns unsat when container minimum capacities cannot all be satisfied', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .buildNormalized();

    project.containers = project.containers.map((container) => ({
      ...container,
      metadata: {
        ...container.metadata,
        minCapacity: 1,
      },
    }));

    const result = solve(project);

    expectUnsat(result);
  });

  it('ranks solutions using soft assignment scores', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 2 })
      .softAssignmentScore('A', 'T2', 5)
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions[0].score).toBe(5);
    expect(result.solutions[0].assignments.find((assignment) => assignment.itemRef.id === 'A')?.containerRef?.id).toBe('T2');
    expect(result.solutions.at(-1)?.score).toBe(0);
  });

  it('ranks solutions using soft item count targets', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .softItemCountTarget('A', ['T1'], 1)
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions[0].score).toBe(0);
    expect(result.solutions[0].assignments.find((assignment) => assignment.itemRef.id === 'A')?.containerRef?.id).toBe('T1');
    expect(result.solutions[1].score).toBe(-1);
  });

  it('keeps hard constraints stronger than soft scoring preferences', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 2 })
      .allowed('A', ['T1'])
      .softAssignmentScore('A', 'T2', 100)
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions.every((solution) => solution.assignments.find((assignment) => assignment.itemRef.id === 'A')?.containerRef?.id === 'T1')).toBe(true);
    expect(result.solutions[0].score).toBe(0);
  });

  it('preserves unsat results even when soft scores are present', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1 })
      .allowed('A', ['T1'])
      .forbidden('A', ['T1'])
      .softAssignmentScore('A', 'T1', 5)
      .softItemCountTarget('A', ['T1'], 1)
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
    expect(result.solutions).toEqual([]);
  });

  it('finds a globally better ranked set than plain enumeration order would keep in container mode', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B', 'C')
      .containers({ T1: 3, T2: 3, T3: 3 })
      .softAssignmentScore('A', 'T3', 100)
      .softAssignmentScore('B', 'T3', 50)
      .softAssignmentScore('C', 'T3', 25)
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions[0].score).toBe(175);
    expect(result.solutions[0].assignments.every((assignment) => assignment.containerRef?.id === 'T3')).toBe(true);
  });

  it('returns no more than ten solutions for a highly symmetric scenario', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B', 'C', 'D')
      .containers({ T1: 4, T2: 4, T3: 4 })
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions).toHaveLength(10);
    expect(result.truncatedByLimit).toBe(true);
  });
});
