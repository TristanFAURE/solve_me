import loadHighs from 'highs';
import { beforeAll, describe, expect, it } from 'vitest';
import { HighsSolverAdapter, verifyHardConstraints } from '../../src/solver/adapters/highsSolverAdapter.js';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import { scenario } from '../helpers/projectBuilder.js';

function repeated(builder) {
  const model = builder.buildNormalized();
  model.assignmentMultiplicity = 'multiple';
  return model;
}

describe('HighsSolverAdapter', () => {
  let highs;
  let adapter;
  beforeAll(async () => {
    highs = await loadHighs();
    adapter = new HighsSolverAdapter(highs);
  });

  it('enforces sparse feasibility, capacities, fixed assignments, exclusions, bounds, and relations', () => {
    const model = repeated(scenario().containerMode()
      .items('A', 'B')
      .containers({ X: 1, Y: 2 })
      .allowed('A', ['X', 'Y'])
      .forbidden('B', ['X'])
      .fixedAssignment('A', 'X')
      .assignmentExclusion('A', 'X', 'Y')
      .assignmentCountUpperBound('B', ['Y'], 1)
      .mustNotShare('A', 'B'));

    const result = adapter.solve(model, { mode: 'optimize' });

    expect(result.status).toBe('solved');
    expect(result.solutions[0].assignments.map((entry) => `${entry.itemRef.id}:${entry.containerRef.id}`)).toEqual(['A:X']);
  });

  it('matches brute-force scoring for preferences, absolute targets, and pairwise equity', () => {
    const model = repeated(scenario().containerMode()
      .items('A', 'B')
      .containers({ X: 1, Y: 1 })
      .assignmentCountUpperBound('A', ['X', 'Y'], 1)
      .assignmentCountUpperBound('B', ['X', 'Y'], 1)
      .softAssignmentScore('A', 'X', 3)
      .softAssignmentScore('B', 'Y', 2)
      .softItemCountTarget('A', ['X', 'Y'], 1)
      .softItemCountTarget('B', ['X', 'Y'], 1));
    const options = {
      mode: 'optimize', includeScoreDetails: true,
      equityEligibleItemIds: ['A', 'B'], scoreWeights: { preferences: 2, targets: 3, equity: 5 },
    };

    const wasm = adapter.solve(model, options);
    const js = new FirstSolverAdapter().solve(model, options);

    expect(wasm.solutions[0].score).toBe(js.solutions[0].score);
    expect(wasm.solutions[0].scoreDetails).toEqual(js.solutions[0].scoreDetails);
    expect(wasm.solutions[0].score).toBe(10);
  });

  it('reports proven infeasibility', () => {
    const model = repeated(scenario().containerMode().items('A').containers({ X: 0 }).fixedAssignment('A', 'X'));
    const result = adapter.solve(model, { mode: 'optimize' });
    expect(result).toMatchObject({ status: 'unsat', searchComplete: true, optimalityProven: false });
  });

  it('reports timeout metadata without claiming completion', () => {
    const builder = scenario().containerMode().items(...Array.from({ length: 40 }, (_, index) => `P${index}`));
    builder.containers(Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`D${index}`, 20])));
    const result = adapter.solve(repeated(builder), { mode: 'optimize', timeLimitMs: 1 });
    expect(result.timeoutReached).toBe(true);
    expect(result.searchComplete).toBe(false);
    expect(['timeout', 'partial']).toContain(result.status);
  });

  it('returns a verified greedy incumbent immediately in first mode', () => {
    let nativeModelCreated = false;
    const instrumented = new Proxy(highs, {
      get(target, property) {
        if (property !== 'createModel') return target[property];
        return (...args) => {
          nativeModelCreated = true;
          return target.createModel(...args);
        };
      },
    });
    const model = repeated(scenario().containerMode().items('A', 'B').containers({ X: 1, Y: 1 }));
    model.containers.forEach((container) => { container.metadata.minCapacity = 1; });

    const result = new HighsSolverAdapter(instrumented).solve(model, { mode: 'first', maxSolutions: 1 });

    expect(result).toMatchObject({
      status: 'solved', searchComplete: false, optimalityProven: false,
      incumbentCount: 1, solutionSelection: 'best-found',
    });
    expect(result.solutions[0].assignments).toHaveLength(2);
    expect(nativeModelCreated).toBe(false);
  });

  it('returns a verified greedy incumbent when the solve budget expires during startup', () => {
    const builder = scenario().containerMode().items(...Array.from({ length: 40 }, (_, index) => `P${index}`));
    builder
      .containers(Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`D${index}`, index === 0 ? 2 : 1])))
      .fixedAssignment('P38', 'D0')
      .forbidden('P1', ['D0'])
      .assignmentExclusion('P2', 'D1', 'D2')
      .assignmentCountUpperBound('P3', Array.from({ length: 40 }, (_, index) => `D${index}`), 1)
      .mustShare('P38', 'P39')
      .mustNotShare('P6', 'P7');
    const model = repeated(builder);
    model.containers.forEach((container, index) => { container.metadata.minCapacity = index === 0 ? 2 : 1; });

    const result = adapter.solve(model, { mode: 'optimize', timeLimitMs: 1 });

    expect(result).toMatchObject({ status: 'partial', timeoutReached: true, searchComplete: false });
    expect(result.solutions[0].assignments).toHaveLength(41);
    expect(new Set(result.solutions[0].assignments.map((entry) => entry.containerRef.id)).size).toBe(40);
    const assignments = new Set(result.solutions[0].assignments.map((entry) => `${entry.itemRef.id}:${entry.containerRef.id}`));
    expect(assignments.has('P38:D0')).toBe(true);
    expect(assignments.has('P39:D0')).toBe(true);
    expect(assignments.has('P1:D0')).toBe(false);
    expect(assignments.has('P2:D1') && assignments.has('P2:D2')).toBe(false);
    expect([...assignments].filter((entry) => entry.startsWith('P3:'))).toHaveLength(1);
    for (let index = 0; index < 40; index += 1) {
      expect(assignments.has(`P38:D${index}`)).toBe(assignments.has(`P39:D${index}`));
      expect(assignments.has(`P6:D${index}`) && assignments.has(`P7:D${index}`)).toBe(false);
    }
  });

  it('gives large native models the remaining five-second budget instead of reserving ten seconds', () => {
    const observedTimeLimits = [];
    let runCount = 0;
    const instrumented = new Proxy(highs, {
      get(target, property) {
        if (property !== 'createModel') return target[property];
        return (data) => {
          const nativeModel = target.createModel(data);
          const setOption = nativeModel.options.set.bind(nativeModel.options);
          nativeModel.options.set = (name, value) => {
            if (name === 'time_limit') observedTimeLimits.push(value);
            return setOption(name, value);
          };
          const run = nativeModel.run.bind(nativeModel);
          nativeModel.run = (...args) => { runCount += 1; return run(...args); };
          return nativeModel;
        };
      },
    });
    const builder = scenario().containerMode()
      .items(...Array.from({ length: 400 }, (_, index) => `P${index}`))
      .containers(Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`D${index}`, 0])));

    new HighsSolverAdapter(instrumented).solve(repeated(builder), { mode: 'optimize', timeLimitMs: 5000 });

    expect(runCount).toBe(1);
    expect(observedTimeLimits[0]).toBeGreaterThan(0);
    expect(observedTimeLimits[0]).toBeLessThanOrEqual(5);
  }, 10_000);

  it('does not submit or return an invalid seed for an infeasible model', () => {
    const model = repeated(scenario().containerMode()
      .items('A', 'B')
      .containers({ X: 1 })
      .fixedAssignment('A', 'X')
      .fixedAssignment('B', 'X'));

    const result = adapter.solve(model, { mode: 'optimize' });

    expect(result).toMatchObject({ status: 'unsat', solutions: [] });
  });

  it('returns bounded, distinct top-K solutions with a minimum-distance cut', () => {
    const model = repeated(scenario().containerMode().items('A', 'B').containers({ X: 2, Y: 2 }));
    const result = adapter.solve(model, {
      mode: 'topK', maxSolutions: 3, diversity: { enabled: true, minimumAssignmentDistance: 2 },
    });
    expect(result.status).toBe('partial');
    expect(result).toMatchObject({ canonicalRankingComplete: false, solutionSelection: 'best-found' });
    expect(result.warnings).toContain('HiGHS diversity cuts do not prove the shared canonical fingerprint ranking; returned solutions are best-found candidates.');
    expect(result.solutions).toHaveLength(3);
    expect(new Set(result.solutions.map((solution) => solution.fingerprint)).size).toBe(3);
    expect(result.solutions.every((solution) => solution.diversity.minimumAssignmentDistance === 2)).toBe(true);
  });

  it('does not claim the canonical winner after sampling an all-zero tie', () => {
    const model = repeated(scenario().containerMode().items('A', 'B').containers({ X: 2, Y: 2 }));
    const canonical = new FirstSolverAdapter().solve(model, { mode: 'topK', maxSolutions: 1 });
    const result = adapter.solve(model, { mode: 'topK', maxSolutions: 1 });

    expect(canonical).toMatchObject({
      status: 'solved', canonicalRankingComplete: true, solutionSelection: 'canonical',
    });
    expect(result).toMatchObject({
      status: 'partial', searchComplete: false, canonicalRankingComplete: false,
      solutionSelection: 'best-found', truncatedByLimit: true,
    });
    expect(result.solutions).toHaveLength(1);
    expect(result.warnings).toContain('HiGHS found additional equal-score optima without exhausting the tie; returned solutions are best-found candidates, not a proven canonical fingerprint top-K.');
  });

  it('probes beyond K before reporting complete or truncated enumeration', () => {
    const model = repeated(scenario().containerMode().items('A').containers({ X: 1 }));

    const exact = adapter.solve(model, { mode: 'topK', maxSolutions: 2 });
    const limited = adapter.solve(model, { mode: 'topK', maxSolutions: 1 });

    expect(exact.solutions).toHaveLength(2);
    expect(exact).toMatchObject({ searchComplete: true, truncatedByLimit: false });
    expect(limited.solutions).toHaveLength(1);
    expect(limited).toMatchObject({ searchComplete: false, truncatedByLimit: true });
  });

  it('reports an unmet diversity request without claiming complete enumeration', () => {
    const model = repeated(scenario().containerMode().items('A').containers({ X: 1 }));
    const result = adapter.solve(model, {
      mode: 'topK', maxSolutions: 2,
      diversity: { enabled: true, minimumAssignmentDistance: 3 },
    });

    expect(result.solutions).toHaveLength(1);
    expect(result.searchComplete).toBe(false);
    expect(result.truncatedByLimit).toBe(false);
    expect(result.warnings).toContain('Only 1 solutions met the requested minimum assignment distance.');
  });

  it('does not let the greedy seed consume a native top-K slot', () => {
    const model = repeated(scenario().containerMode().items('A').containers({ X: 1, Y: 1 })
      .softAssignmentScore('A', 'X', 2)
      .softAssignmentScore('A', 'Y', 1));
    const result = adapter.solve(model, { mode: 'topK', maxSolutions: 2 });

    expect(result.solutions.map((solution) => solution.score)).toEqual([3, 2]);
    expect(result).toMatchObject({
      status: 'solved', searchComplete: true, canonicalRankingComplete: true,
      solutionSelection: 'canonical', truncatedByLimit: true,
    });
    expect(result.solutions.map((solution) => solution.fingerprint)).toEqual(
      [...result.solutions].sort((left, right) => right.score - left.score || left.fingerprint.localeCompare(right.fingerprint))
        .map((solution) => solution.fingerprint),
    );
  });

  it('uses deterministic ranking when model input order changes', () => {
    const model = repeated(scenario().containerMode().items('B', 'A').containers({ Y: 2, X: 2 }));
    const reordered = { ...model, items: [...model.items].reverse(), containers: [...model.containers].reverse() };
    const options = { mode: 'topK', maxSolutions: 3 };

    expect(adapter.solve(model, options).solutions.map((solution) => solution.fingerprint))
      .toEqual(adapter.solve(reordered, options).solutions.map((solution) => solution.fingerprint));
  });

  it('independently rejects assignments forbidden by item metadata', () => {
    const compiled = {
      pairCount: 2,
      itemCount: 1,
      destinationCount: 2,
      itemIds: ['A'],
      destinationIds: ['X', 'Y'],
      itemIndex: new Map([['A', 0]]),
      destinationIndex: new Map([['X', 0], ['Y', 1]]),
      pairItemIndices: Int32Array.from([0, 0]),
      pairDestinationIndices: Int32Array.from([0, 1]),
      destinationMinimums: Float64Array.from([0, 0]),
      destinationMaximums: Float64Array.from([1, 1]),
    };
    const base = {
      fixedAssignments: [], forbiddenAssignments: [], assignmentExclusions: [],
      assignmentCountUpperBounds: [], constraints: [],
      containers: [{ metadata: { minCapacity: 0, maxCapacity: 1 } }, { metadata: { minCapacity: 0, maxCapacity: 1 } }],
    };

    expect(verifyHardConstraints([0, 1], compiled, {
      ...base, items: [{ id: 'A', metadata: { allowedContainerIds: ['X'] } }],
    })).toBe(false);
    expect(verifyHardConstraints([0, 1], compiled, {
      ...base, items: [{ id: 'A', metadata: { forbiddenContainerIds: ['Y'] } }],
    })).toBe(false);
  });

  it('rejects unsupported semantics instead of dropping them', () => {
    const model = repeated(scenario().containerMode().items('A').containers({ X: 1 }).preferShare('A', 'A'));
    expect(adapter.validateModel(model, { scoreWeights: { equity: -1 } }).errors).toEqual(expect.arrayContaining([
      'HiGHS does not support general soft preferences.',
      'HiGHS requires nonnegative objective weights.',
    ]));
  });
});
