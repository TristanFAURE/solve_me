import {
  createInterruptedResult, runHighsSolveService, runSolveService, shouldUseHighs,
} from './solveService.js';
import { isSolveRequest, SOLVE_MESSAGE_TYPES } from './solveProtocol.js';
import { SOLVER_ENGINES } from './solveOptions.js';

function post(type, requestId, payload) {
  self.postMessage({ type, requestId, ...payload });
}

async function loadHighsRuntime() {
  const [{ default: loadHighs }, wasmUrl] = await Promise.all([
    import('highs'),
    import('highs/runtime?url').then((module) => module.default),
  ]);
  return loadHighs({ locateFile: () => wasmUrl });
}

function optionsWithRemainingTime(options, startedAt) {
  if (options.timeLimitMs === null || options.timeLimitMs === undefined) return options;
  return { ...options, timeLimitMs: Math.max(1, options.timeLimitMs - Math.ceil(performance.now() - startedAt)) };
}

export async function solveWorkerRequest(request, dependencies = {}) {
  const startedAt = performance.now();
  const loadRuntime = dependencies.loadHighsRuntime ?? loadHighsRuntime;
  const runHighs = dependencies.runHighsSolveService ?? runHighsSolveService;
  const runJs = dependencies.runSolveService ?? runSolveService;
  const hooks = dependencies.hooks ?? {};
  hooks.onProgress?.({ phase: 'starting-worker', elapsedMs: 0 });
  if (!shouldUseHighs(request.model, request.options)) {
    hooks.onProgress?.({ phase: 'searching', elapsedMs: Math.round(performance.now() - startedAt) });
    return runJs(request.model, request.options, hooks);
  }

  let highs;
  try {
    hooks.onProgress?.({ phase: 'loading-wasm', elapsedMs: 0 });
    highs = await loadRuntime();
    hooks.onProgress?.({ phase: 'building-model', elapsedMs: Math.round(performance.now() - startedAt) });
  } catch (error) {
    if ((request.options.engine ?? SOLVER_ENGINES.AUTO) === SOLVER_ENGINES.HIGHS) {
      const detail = error instanceof Error ? error.message : 'unknown initialization error';
      throw new Error(`HiGHS engine initialization failed: ${detail}`);
    }
    const remainingOptions = optionsWithRemainingTime(request.options, startedAt);
    if (request.options.timeLimitMs != null && performance.now() - startedAt >= request.options.timeLimitMs) {
      return createInterruptedResult('timeout', null, 'HiGHS initialization consumed the solve time limit.');
    }
    return runJs(request.model, remainingOptions, hooks);
  }
  if (request.options.timeLimitMs != null && performance.now() - startedAt >= request.options.timeLimitMs) {
    return createInterruptedResult('timeout', null, 'HiGHS initialization consumed the solve time limit.');
  }
  return runHighs(highs, request.model, optionsWithRemainingTime(request.options, startedAt), hooks);
}

if (typeof self !== 'undefined') self.onmessage = async (event) => {
  const request = event.data;
  if (!isSolveRequest(request)) return;

  try {
    const hooks = {
      onProgress(progress) {
        post(SOLVE_MESSAGE_TYPES.PROGRESS, request.requestId, { progress });
      },
    };
    const result = await solveWorkerRequest(request, { hooks });
    post(SOLVE_MESSAGE_TYPES.RESULT, request.requestId, { result });
  } catch (error) {
    post(SOLVE_MESSAGE_TYPES.ERROR, request.requestId, {
      error: error instanceof Error ? error.message : 'Unknown worker solve error.',
    });
  }
};
