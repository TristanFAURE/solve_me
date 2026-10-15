import { describe, expect, it, vi } from 'vitest';
import { solveWorkerRequest } from '../../src/solver/solveWorker.js';

function largeModel() {
  return {
    assignmentMode: 'container', assignmentMultiplicity: 'multiple',
    items: Array.from({ length: 50 }, (_, index) => ({ id: `i${index}` })),
    containers: Array.from({ length: 50 }, (_, index) => ({ id: `c${index}` })),
  };
}

describe('solve Worker engine fallback', () => {
  it('uses the JS engine when automatic HiGHS initialization fails', async () => {
    const runJs = vi.fn(() => ({ status: 'solved' }));
    const result = await solveWorkerRequest({ model: largeModel(), options: { engine: 'auto', timeLimitMs: 1000 } }, {
      loadHighsRuntime: () => Promise.reject(new Error('WASM unavailable')),
      runSolveService: runJs,
    });

    expect(result.status).toBe('solved');
    expect(runJs).toHaveBeenCalledOnce();
    expect(runJs.mock.calls[0][1].timeLimitMs).toBeLessThanOrEqual(1000);
  });

  it('reports a clear failure for an explicitly requested HiGHS engine', async () => {
    await expect(solveWorkerRequest({ model: largeModel(), options: { engine: 'highs', timeLimitMs: 1000 } }, {
      loadHighsRuntime: () => Promise.reject(new Error('WASM unavailable')),
    })).rejects.toThrow('HiGHS engine initialization failed: WASM unavailable');
  });
});
