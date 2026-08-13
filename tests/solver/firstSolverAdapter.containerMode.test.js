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
