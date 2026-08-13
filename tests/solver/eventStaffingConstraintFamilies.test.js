import { describe, expect, it } from 'vitest';
import { scenario } from '../helpers/projectBuilder.js';
import { expectSolved, expectUnsat } from '../helpers/solverAssertions.js';
import { solve } from '../helpers/solverScenario.js';

describe('FirstSolverAdapter - additive assignment-oriented constraint families', () => {
  it('carries additive normalized families on normalized projects', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1 })
      .fixedAssignment('A', 'T1')
      .forbiddenAssignment('A', 'T2')
      .softAssignmentScore('A', 'T1', 3)
      .softItemCountTarget('A', ['T1'], 1)
      .buildNormalized();

    expect(project.fixedAssignments).toEqual([{ itemId: 'A', destinationId: 'T1' }]);
    expect(project.forbiddenAssignments).toEqual([{ itemId: 'A', destinationId: 'T2' }]);
    expect(project.softAssignmentScores).toEqual([{ itemId: 'A', destinationId: 'T1', score: 3 }]);
    expect(project.softItemCountTargets).toEqual([{ itemId: 'A', destinationIds: ['T1'], targetCount: 1 }]);
  });

  it('accepts additive hard constraint families in validation for container mode', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 1, T2: 1 })
      .fixedAssignment('A', 'T1')
      .forbiddenAssignment('B', 'T1')
      .assignmentCountUpperBound('A', ['T1', 'T2'], 1)
      .buildNormalized();

    const result = solve(project);

    expect(['solved', 'unsat']).toContain(result.status);
    expect(result.status).not.toBe('error');
  });

  it('enforces fixed assignments in container mode', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 2 })
      .fixedAssignment('A', 'T2')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions.every((solution) => solution.assignments.find((assignment) => assignment.itemRef.id === 'A')?.containerRef?.id === 'T2')).toBe(true);
  });

  it('enforces forbidden assignments in container mode', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .forbiddenAssignment('A', 'T1')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions.every((solution) => solution.assignments.find((assignment) => assignment.itemRef.id === 'A')?.containerRef?.id === 'T2')).toBe(true);
  });

  it('enforces assignment count upper bounds in container mode', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .assignmentCountUpperBound('A', ['T1', 'T2'], 0)
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('accepts multiple fixed destinations per item when multiple container assignments are explicitly enabled', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .fixedAssignment('A', 'T1')
      .fixedAssignment('A', 'T2')
      .buildNormalized();

    project.assignmentMultiplicity = 'multiple';

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions[0]?.assignments).toHaveLength(2);
    expect(result.solutions[0]?.assignments).toContainEqual(expect.objectContaining({
      itemRef: { kind: 'item', id: 'A' },
      containerRef: { kind: 'container', id: 'T1' },
    }));
    expect(result.solutions[0]?.assignments).toContainEqual(expect.objectContaining({
      itemRef: { kind: 'item', id: 'A' },
      containerRef: { kind: 'container', id: 'T2' },
    }));
  });

  it('enforces fixed assignments in position mode', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .fixedAssignment('A', 'P2')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions.every((solution) => solution.assignments.find((assignment) => assignment.itemRef.id === 'A')?.positionRef?.id === 'P2')).toBe(true);
  });

  it('enforces forbidden assignments in position mode', () => {
    const project = scenario()
      .positionMode()
      .items('A')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .forbiddenAssignment('A', 'P1')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions.every((solution) => solution.assignments.find((assignment) => assignment.itemRef.id === 'A')?.positionRef?.id === 'P2')).toBe(true);
  });

  it('enforces assignment exclusions in position mode', () => {
    const project = scenario()
      .positionMode()
      .items('A')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .assignmentExclusion('A', 'P1', 'P2')
      .assignmentCountUpperBound('A', ['P1', 'P2'], 0)
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });
});
