import { describe, expect, it } from 'vitest';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import { SOLVE_MODES } from '../../src/solver/solveOptions.js';
import { scenario } from '../helpers/projectBuilder.js';

describe('FirstSolverAdapter - solve contract', () => {
  it('preserves solve(model) as ranked top-10 behavior', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B', 'C', 'D')
      .containers({ T1: 4, T2: 4, T3: 4 })
      .buildNormalized();

    const result = new FirstSolverAdapter().solve(project);

    expect(result.status).toBe('solved');
    expect(result.solutions).toHaveLength(10);
    expect(result.truncatedByLimit).toBe(true);
  });

  it('does not infer truncation when exactly the limit qualifies', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1, T3: 1, T4: 1, T5: 1, T6: 1, T7: 1, T8: 1, T9: 1, T10: 1 })
      .buildNormalized();

    const result = new FirstSolverAdapter().solve(project);

    expect(result.solutions).toHaveLength(10);
    expect(result.truncatedByLimit).toBe(false);
    expect(result.searchComplete).toBe(true);
  });

  it('stops first mode after one qualifying solution without claiming completion', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 2 })
      .buildNormalized();

    const result = new FirstSolverAdapter().solve(project, { mode: SOLVE_MODES.FIRST });

    expect(result.solutions).toHaveLength(1);
    expect(result.searchComplete).toBe(false);
    expect(result.optimalityProven).toBe(false);
    expect(result.truncatedByLimit).toBe(false);
  });

  it('returns a configurable top-K and marks truncation only after another candidate', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2, T2: 2 })
      .buildNormalized();

    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.TOP_K,
      maxSolutions: 2,
    });

    expect(result.solutions).toHaveLength(2);
    expect(result.truncatedByLimit).toBe(true);
    expect(result.searchComplete).toBe(true);
  });

  it('reports a proven optimum only after complete optimize search', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .softAssignmentScore('A', 'T2', 10)
      .buildNormalized();

    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.OPTIMIZE,
      includeScoreDetails: true,
    });

    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]).toMatchObject({
      score: 10,
      scoreDetails: { assignmentScores: 10, itemCountTargets: 0, total: 10 },
    });
    expect(typeof result.solutions[0].fingerprint).toBe('string');
    expect(result.searchComplete).toBe(true);
    expect(result.optimalityProven).toBe(true);
    expect(result.exploredNodes).toBeGreaterThan(0);
    expect(result.prunedNodes).toBeGreaterThanOrEqual(0);
    expect(result.incumbentCount).toBeGreaterThan(0);
  });

  it('reports complete unsatisfiability without claiming an optimum', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 1 })
      .buildNormalized();

    const result = new FirstSolverAdapter().solve(project, { mode: SOLVE_MODES.OPTIMIZE });

    expect(result.status).toBe('unsat');
    expect(result.searchComplete).toBe(true);
    expect(result.optimalityProven).toBe(false);
  });

  it('proves an optimum after complete repeated-assignment search', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1 })
      .buildNormalized();
    project.assignmentMultiplicity = 'multiple';

    const result = new FirstSolverAdapter().solve(project, { mode: SOLVE_MODES.OPTIMIZE });

    expect(result.status).toBe('solved');
    expect(result.searchComplete).toBe(true);
    expect(result.optimalityProven).toBe(true);
  });

  it('advertises and accepts direct timeout checks', () => {
    const project = scenario().containerMode().items('A').containers({ T1: 1 }).buildNormalized();
    const adapter = new FirstSolverAdapter();

    const result = adapter.solve(project, { timeLimitMs: 100 });

    expect(adapter.getCapabilities().timeout).toBe(true);
    expect(result.status).toBe('solved');
    expect(result.timeoutReached).toBe(false);
  });
});
