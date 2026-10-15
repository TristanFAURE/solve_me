import { FirstSolverAdapter } from './adapters/firstSolverAdapter.js';
import { HighsSolverAdapter } from './adapters/highsSolverAdapter.js';
import { buildSearchHints } from './searchHints.js';

export const DEFAULT_BROWSER_SOLVE_TIMEOUT_MS = 5000;
export const HIGHS_AUTO_PAIR_THRESHOLD = 2000;

export function withBrowserSolveDefaults(options = {}) {
  return {
    ...options,
    timeLimitMs: options.timeLimitMs ?? DEFAULT_BROWSER_SOLVE_TIMEOUT_MS,
  };
}

export function runSolveService(model, options = {}, runtimeHooks = {}) {
  const adapter = new FirstSolverAdapter();
  const result = adapter.solve(model, options, runtimeHooks);
  return {
    ...result,
    solverEngine: 'javascript',
    searchHints: buildSearchHints(model, options, result),
  };
}

export function shouldUseHighs(model, options = {}) {
  if (options.engine === 'js') return false;
  if (options.engine === 'highs') return true;
  return model.assignmentMode === 'container'
    && model.assignmentMultiplicity === 'multiple'
    && model.items.length * model.containers.length >= HIGHS_AUTO_PAIR_THRESHOLD;
}

export function runHighsSolveService(highs, model, options = {}, runtimeHooks = {}) {
  const adapter = new HighsSolverAdapter(highs);
  const validation = adapter.validateModel(model, options);
  if (!validation.valid && options.engine !== 'highs') {
    return runSolveService(model, options, runtimeHooks);
  }
  const result = adapter.solve(model, options, runtimeHooks);
  return { ...result, solverEngine: 'highs-wasm', searchHints: buildSearchHints(model, options, result) };
}

export function createInterruptedResult(status, progress = null, warning = '') {
  const bestSolution = progress?.bestSolution ?? null;
  const hasSolution = Boolean(bestSolution);
  const resultStatus = status === 'cancelled' ? 'cancelled' : (hasSolution ? 'partial' : status);
  return {
    status: resultStatus,
    solutions: hasSolution ? [bestSolution] : [],
    warnings: warning ? [warning] : [],
    runtimeMs: Math.max(0, Math.round(progress?.elapsedMs ?? 0)),
    searchComplete: false,
    optimalityProven: false,
    truncatedByLimit: false,
    interrupted: true,
    cancelled: status === 'cancelled',
    timeoutReached: status === 'timeout',
    exploredNodes: progress?.exploredNodes ?? 0,
    prunedNodes: progress?.prunedNodes ?? 0,
    canonicalRankingComplete: false,
    solutionSelection: 'best-found',
    searchHints: [],
  };
}
