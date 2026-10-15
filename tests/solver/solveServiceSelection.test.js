import { describe, expect, it } from 'vitest';
import { runHighsSolveService } from '../../src/solver/highsSolveService.js';
import { HIGHS_AUTO_PAIR_THRESHOLD, shouldUseHighs } from '../../src/solver/solveService.js';
import { scenario } from '../helpers/projectBuilder.js';

function model(items, containers, overrides = {}) {
  return {
    assignmentMode: 'container', assignmentMultiplicity: 'multiple',
    items: Array.from({ length: items }, (_, index) => ({ id: `i${index}` })),
    containers: Array.from({ length: containers }, (_, index) => ({ id: `c${index}` })),
    ...overrides,
  };
}

describe('HiGHS service selection', () => {
  it('keeps small and single-assignment models on JS', () => {
    expect(shouldUseHighs(model(2, 2))).toBe(false);
    expect(shouldUseHighs(model(100, 100, { assignmentMultiplicity: 'single' }))).toBe(false);
  });

  it('selects large repeated-assignment models and honors validated overrides', () => {
    expect(shouldUseHighs(model(20, HIGHS_AUTO_PAIR_THRESHOLD / 20))).toBe(true);
    expect(shouldUseHighs(model(2, 2), { engine: 'highs' })).toBe(true);
    expect(shouldUseHighs(model(100, 100), { engine: 'js' })).toBe(false);
  });

  it('selects HiGHS for weighted repeated-assignment optimization even below the size threshold', () => {
    expect(shouldUseHighs(model(3, 94), {
      mode: 'topK',
      scoreWeights: { equity: 100, preferences: 10, targets: 20 },
    })).toBe(true);
  });

  it('falls back from unsupported HiGHS validation in auto mode without a pair-count exception', () => {
    const project = scenario().containerMode()
      .items(...Array.from({ length: 90 }, (_, index) => `i${index}`))
      .containers(Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`c${index}`, 90])))
      .buildNormalized();
    project.assignmentMultiplicity = 'single';

    const result = runHighsSolveService({ createModel() { throw new Error('must not solve'); } }, project, {
      engine: 'auto', mode: 'first', maxSolutions: 1,
    });

    expect(project.items.length * project.containers.length).toBeGreaterThan(HIGHS_AUTO_PAIR_THRESHOLD * 4);
    expect(result.status).toBe('solved');
  });
});
