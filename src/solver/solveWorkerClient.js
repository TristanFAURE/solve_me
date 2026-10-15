import { createSolveRequest, isSolveResponse, SOLVE_MESSAGE_TYPES } from './solveProtocol.js';
import { createInterruptedResult, withBrowserSolveDefaults } from './solveService.js';
import { buildSearchHints } from './searchHints.js';

const WORKER_DEADLINE_GRACE_MS = 100;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function betterSolution(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  const leftScore = Number.isFinite(left.score) ? left.score : Number.NEGATIVE_INFINITY;
  const rightScore = Number.isFinite(right.score) ? right.score : Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) return leftScore > rightScore ? left : right;
  const leftFingerprint = left.fingerprint ?? '';
  const rightFingerprint = right.fingerprint ?? '';
  return leftFingerprint.localeCompare(rightFingerprint) <= 0 ? left : right;
}

function defaultWorkerFactory() {
  return new Worker(new URL('./solveWorker.js', import.meta.url), { type: 'module' });
}

export class SolveWorkerClient {
  constructor({ workerFactory = defaultWorkerFactory, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.workerFactory = workerFactory;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.nextRequestId = 1;
    this.active = null;
  }

  solve(model, options, { onProgress } = {}) {
    if (this.active) this.cancel(this.active.requestId);

    const requestId = this.nextRequestId++;
    const effectiveOptions = withBrowserSolveDefaults(options);
    let worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return {
        requestId,
        promise: Promise.resolve({
          ...createInterruptedResult('error', null, error instanceof Error ? error.message : 'Solver Worker failed to start.'),
          status: 'error',
          interrupted: false,
        }),
        cancel() {},
      };
    }

    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const active = {
      requestId,
      worker,
      resolve: resolvePromise,
      latestProgress: null,
      model,
      options: effectiveOptions,
      timer: null,
      settled: false,
    };
    this.active = active;

    const finish = (result) => {
      if (active.settled) return;
      active.settled = true;
      this.clearTimer(active.timer);
      worker.terminate();
      if (this.active?.requestId === requestId) this.active = null;
      active.resolve(result);
    };

    worker.onmessage = (event) => {
      const message = event.data;
      if (!isSolveResponse(message) || message.requestId !== requestId || this.active?.requestId !== requestId) return;
      if (message.type === SOLVE_MESSAGE_TYPES.PROGRESS) {
        active.latestProgress = {
          ...message.progress,
          bestSolution: betterSolution(active.latestProgress?.bestSolution, message.progress.bestSolution),
        };
        onProgress?.(message.progress);
      } else if (message.type === SOLVE_MESSAGE_TYPES.RESULT) {
        finish(message.result);
      } else if (message.type === SOLVE_MESSAGE_TYPES.ERROR) {
        finish({ ...createInterruptedResult('error', active.latestProgress, message.error), status: 'error' });
      }
    };
    worker.onerror = () => finish({
      ...createInterruptedResult('error', active.latestProgress, 'The solver Worker stopped unexpectedly.'),
      status: 'error',
    });

    const interrupted = (status, warning) => {
      const result = createInterruptedResult(status, active.latestProgress, warning);
      return { ...result, searchHints: buildSearchHints(model, effectiveOptions, result) };
    };
    active.timer = this.setTimer(() => {
      finish(interrupted('timeout', 'The browser solve watchdog reached its time limit.'));
    }, Math.min(effectiveOptions.timeLimitMs + WORKER_DEADLINE_GRACE_MS, MAX_TIMER_DELAY_MS));
    try {
      worker.postMessage(createSolveRequest(requestId, model, effectiveOptions));
    } catch (error) {
      finish({
        ...interrupted('error', error instanceof Error ? error.message : 'The solve request could not be sent to the Worker.'),
        status: 'error',
      });
    }

    return { requestId, promise, cancel: () => this.cancel(requestId) };
  }

  cancel(requestId = this.active?.requestId) {
    const active = this.active;
    if (!active || active.requestId !== requestId || active.settled) return false;
    active.settled = true;
    this.clearTimer(active.timer);
    active.worker.terminate();
    this.active = null;
    const result = createInterruptedResult('cancelled', active.latestProgress, 'Solve cancelled by the user.');
    active.resolve({ ...result, searchHints: buildSearchHints(active.model, active.options, result) });
    return true;
  }
}
