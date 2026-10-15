import { describe, expect, it } from 'vitest';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import { SOLVE_MODES } from '../../src/solver/solveOptions.js';
import { scenario } from '../helpers/projectBuilder.js';

function repeatedProject(builder) {
  const project = builder.buildNormalized();
  project.assignmentMultiplicity = 'multiple';
  return project;
}

function independentFingerprint(pairs) {
  return JSON.stringify(pairs.map(({ itemId, containerId }) => (
    JSON.stringify([containerId, null, itemId])
  )).sort());
}

function bruteForceTiny(model) {
  const pairs = model.containers.flatMap((container) => (
    model.items.map((item) => ({ itemId: item.id, containerId: container.id }))
  ));
  const fingerprints = [];
  for (let mask = 0; mask < 2 ** pairs.length; mask += 1) {
    const chosen = pairs.filter((_, index) => (mask & (1 << index)) !== 0);
    const valid = model.containers.every((container) => {
      const load = chosen.filter((pair) => pair.containerId === container.id).length;
      return load >= (container.metadata?.minCapacity ?? 0)
        && load <= (container.metadata?.maxCapacity ?? Number.POSITIVE_INFINITY);
    }) && model.items.every((item) => {
      const destinations = chosen.filter((pair) => pair.itemId === item.id).map((pair) => pair.containerId);
      const allowed = item.metadata?.allowedContainerIds;
      const forbidden = item.metadata?.forbiddenContainerIds ?? [];
      return destinations.every((id) => (!allowed?.length || allowed.includes(id)) && !forbidden.includes(id));
    });
    if (valid) fingerprints.push(independentFingerprint(chosen));
  }
  return fingerprints.sort();
}

describe('FirstSolverAdapter - complete repeated assignments and ranking', () => {
  it('matches an independent brute-force oracle for zero, one, and many assignments', () => {
    const project = repeatedProject(scenario().containerMode().items('A').containers({ C1: 1, C2: 1 }));
    const result = new FirstSolverAdapter().solve(project, { maxSolutions: 1000 });

    expect(result.searchComplete).toBe(true);
    expect(result.solutions.map((solution) => solution.fingerprint).sort()).toEqual(bruteForceTiny(project));
    expect(result.solutions.map((solution) => solution.assignments.length).sort()).toEqual([0, 1, 1, 2]);
  });

  it('backtracks after a tempting assignment instead of reporting false unsat', () => {
    const project = repeatedProject(scenario()
      .containerMode().items('A', 'B').containers({ C1: 1, C2: 1 }).allowed('B', ['C1'])
      .assignmentCountUpperBound('A', ['C1', 'C2'], 1));
    project.containers.forEach((container) => { container.metadata.minCapacity = 1; });

    const result = new FirstSolverAdapter().solve(project, { mode: SOLVE_MODES.OPTIMIZE });

    expect(result.status).toBe('solved');
    expect(result.searchComplete).toBe(true);
    expect(result.solutions[0].assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemRef: { kind: 'item', id: 'A' }, containerRef: { kind: 'container', id: 'C2' } }),
      expect.objectContaining({ itemRef: { kind: 'item', id: 'B' }, containerRef: { kind: 'container', id: 'C1' } }),
    ]));
  });

  it('ranks optional assignments and reports exact weighted details', () => {
    const project = repeatedProject(scenario().containerMode().items('A').containers({ C1: 1, C2: 1 })
      .softAssignmentScore('A', 'C1', 3).softItemCountTarget('A', ['C1', 'C2'], 1));
    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.OPTIMIZE,
      includeScoreDetails: true,
      scoreWeights: { preferences: 2, targets: 4 },
    });

    expect(result.solutions[0]).toMatchObject({
      score: 6,
      scoreDetails: { assignmentScores: 6, itemCountTargets: 0, equity: 0, total: 6 },
    });
    expect(result.solutions[0].assignments).toHaveLength(1);
  });

  it('applies equity only with an explicit eligible set', () => {
    const project = repeatedProject(scenario().containerMode().items('A', 'B').containers({ C1: 2, C2: 2 })
      .softAssignmentScore('A', 'C1', 1));
    const invalid = new FirstSolverAdapter().solve(project, { scoreWeights: { equity: 10 } });
    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.OPTIMIZE,
      includeScoreDetails: true,
      scoreWeights: { equity: 10 },
      equityEligibleItemIds: ['A', 'B'],
    });

    expect(invalid.status).toBe('error');
    expect(result.solutions[0].scoreDetails.equity).toBe(0);
    expect(result.solutions[0].scoreDetails.total).toBe(result.solutions[0].score);
  });

  it('deduplicates canonical fingerprints and selects diverse top-K deterministically', () => {
    const project = repeatedProject(scenario().containerMode().items('A').containers({ C1: 1, C2: 1 }));
    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.TOP_K,
      maxSolutions: 4,
      diversity: { enabled: true, minimumAssignmentDistance: 3 },
    });

    expect(new Set(result.solutions.map((solution) => solution.fingerprint)).size).toBe(result.solutions.length);
    expect(result.solutions).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('minimum assignment distance'))).toBe(true);
  });

  it('searches beyond adjacent constant-objective candidates for diverse alternatives', () => {
    const containers = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`C${index}`, 1]));
    const project = repeatedProject(scenario().containerMode().items('A').containers(containers));
    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.TOP_K,
      maxSolutions: 2,
      diversity: { enabled: true, minimumAssignmentDistance: 6 },
    });

    expect(result.solutions).toHaveLength(2);
    expect(result.searchComplete).toBe(false);
    expect(result.optimalityProven).toBe(false);
  });

  it('does not claim complete diversity semantics after the retained pool is exhausted', () => {
    const containers = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`C${index}`, 1]));
    const project = repeatedProject(scenario().containerMode().items('A').containers(containers));
    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.TOP_K,
      maxSolutions: 2,
      diversity: { enabled: true, minimumAssignmentDistance: 100 },
    });

    expect(result.solutions).toHaveLength(1);
    expect(result.searchComplete).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('Bounded candidate retention'))).toBe(true);
  });

  it('returns timeout metadata without a false unsat or optimality claim', () => {
    const labels = Array.from({ length: 14 }, (_, index) => `I${index}`);
    const project = repeatedProject(scenario().containerMode().items(labels).containers({
      C1: 14, C2: 14, C3: 14, C4: 14,
    }).softAssignmentScore('I0', 'C1', 1));
    const result = new FirstSolverAdapter().solve(project, {
      mode: SOLVE_MODES.OPTIMIZE,
      timeLimitMs: 1,
    });

    expect(['partial', 'timeout']).toContain(result.status);
    expect(result.status).not.toBe('unsat');
    expect(result.timeoutReached).toBe(true);
    expect(result.interrupted).toBe(true);
    expect(result.searchComplete).toBe(false);
    expect(result.optimalityProven).toBe(false);
  });

  it('is deterministic when model item and destination input order changes', () => {
    const project = repeatedProject(scenario().containerMode().items('B', 'A').containers({ C2: 2, C1: 2 }));
    const reordered = { ...project, items: [...project.items].reverse(), containers: [...project.containers].reverse() };
    const options = { mode: SOLVE_MODES.TOP_K, maxSolutions: 8 };

    const first = new FirstSolverAdapter().solve(project, options);
    const second = new FirstSolverAdapter().solve(reordered, options);
    expect(first.solutions.map((solution) => solution.fingerprint))
      .toEqual(second.solutions.map((solution) => solution.fingerprint));
  });
});
