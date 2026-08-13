import { describe, expect, it } from 'vitest';
import { scenario } from '../helpers/projectBuilder.js';
import {
  areAdjacent,
  areNotAdjacent,
  expectEverySolution,
  expectSolved,
  expectUnsat,
  inSameContainer,
  notInSameContainer,
} from '../helpers/solverAssertions.js';
import { solve } from '../helpers/solverScenario.js';

describe('FirstSolverAdapter - position mode', () => {
  it('enforces must-be-adjacent across all returned solutions', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1', 'P2'] })
      .adjacent('P1', 'P2')
      .mustBeAdjacent('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, areAdjacent(project, 'A', 'B'));
  });

  it('enforces must-not-be-adjacent across all returned solutions', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1', 'P2', 'P3'] })
      .adjacent('P1', 'P2')
      .mustNotBeAdjacent('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, areNotAdjacent(project, 'A', 'B'));
  });

  it('enforces must-share-container in position mode', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B', 'C')
      .containers({ T1: ['P1', 'P2'], T2: ['P3', 'P4'] })
      .adjacent('P1', 'P2')
      .adjacent('P3', 'P4')
      .mustShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, inSameContainer('A', 'B'));
  });

  it('enforces must-not-share-container in position mode', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .mustNotShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, notInSameContainer('A', 'B'));
  });

  it('returns unsat when adjacency cannot be satisfied by topology', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .mustBeAdjacent('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('respects allowed container restrictions in position mode', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .allowed('A', ['T2'])
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expectEverySolution(result, notInSameContainer('A', 'B'));
    expect(result.solutions.every((solution) => solution.assignments.find((assignment) => assignment.itemRef.id === 'A')?.containerRef?.id === 'T2')).toBe(true);
  });

  it('respects forbidden container restrictions in position mode', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .forbidden('A', ['T1'])
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions.every((solution) => solution.assignments.find((assignment) => assignment.itemRef.id === 'A')?.containerRef?.id === 'T2')).toBe(true);
  });

  it('supports items with unrestricted container choices when sorting candidates', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B', 'C')
      .containers({ T1: ['P1', 'P2'], T2: ['P3'] })
      .allowed('A', ['T1'])
      .mustNotShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
  });

  it('returns unsat when position restrictions leave no candidate positions', () => {
    const project = scenario()
      .positionMode()
      .items('A')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .allowed('A', ['T1'])
      .forbidden('A', ['T1'])
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('returns unsat when must-share conflicts with fixed container options', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .allowed('A', ['T1'])
      .allowed('B', ['T2'])
      .mustShare('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('returns unsat when must-not-be-adjacent is impossible in a fully adjacent container', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1', 'P2'] })
      .adjacent('P1', 'P2')
      .mustNotBeAdjacent('A', 'B')
      .buildNormalized();

    const result = solve(project);

    expectUnsat(result);
  });

  it('returns solved with zero truncation when the exact number of solutions is below the limit', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1'], T2: ['P2'] })
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions).toHaveLength(2);
    expect(result.truncatedByLimit).toBe(false);
  });

  it('limits solutions to the configured maximum', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B', 'C', 'D')
      .containers({ T1: ['P1', 'P2'], T2: ['P3', 'P4'] })
      .adjacent('P1', 'P2')
      .adjacent('P3', 'P4')
      .buildNormalized();

    const result = solve(project);

    expectSolved(result);
    expect(result.solutions).toHaveLength(10);
    expect(result.truncatedByLimit).toBe(true);
  });
});
