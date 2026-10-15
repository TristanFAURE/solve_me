import { HighsSolverAdapter } from './adapters/highsSolverAdapter.js';
import { buildSearchHints } from './searchHints.js';
import { runSolveService } from './solveService.js';

export function runHighsSolveService(highs, model, options = {}, runtimeHooks = {}) {
  const adapter = new HighsSolverAdapter(highs);
  const validation = adapter.validateModel(model, options);
  if (!validation.valid && options.engine !== 'highs') {
    return runSolveService(model, options, runtimeHooks);
  }
  const result = adapter.solve(model, options, runtimeHooks);
  return { ...result, solverEngine: 'highs-wasm', searchHints: buildSearchHints(model, options, result) };
}
