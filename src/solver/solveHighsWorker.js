import {
  createInterruptedResult, runSolveService,
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

export async function solveHighsWorkerRequest(request, dependencies = {}) {
  const startedAt = performance.now();
  const loadRuntime = dependencies.loadHighsRuntime ?? loadHighsRuntime;
  const runJs = dependencies.runSolveService ?? runSolveService;
  const hooks = dependencies.hooks ?? {};
  hooks.onProgress?.({ phase: 'starting-worker', elapsedMs: 0 });

  let highs;
  let solveWithHighs = dependencies.runHighsSolveService;
  try {
    hooks.onProgress?.({ phase: 'loading-wasm', elapsedMs: 0 });
    const [runtime, service] = await Promise.all([
      loadRuntime(),
      solveWithHighs ? Promise.resolve(null) : import('./highsSolveService.js'),
    ]);
    highs = runtime;
    solveWithHighs ??= service.runHighsSolveService;
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
  return solveWithHighs(highs, request.model, optionsWithRemainingTime(request.options, startedAt), hooks);
}

if (typeof self !== 'undefined') self.onmessage = async (event) => {
  const request = event.data;
  if (!isSolveRequest(request)) return;

  try {
    const result = await solveHighsWorkerRequest(request, {
      hooks: {
        onProgress(progress) {
          post(SOLVE_MESSAGE_TYPES.PROGRESS, request.requestId, { progress });
        },
      },
    });
    post(SOLVE_MESSAGE_TYPES.RESULT, request.requestId, { result });
  } catch (error) {
    post(SOLVE_MESSAGE_TYPES.ERROR, request.requestId, {
      error: error instanceof Error ? error.message : 'Unknown worker solve error.',
    });
  }
};
