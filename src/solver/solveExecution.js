import { runSolveService, withBrowserSolveDefaults } from './solveService.js';
import { SolveWorkerClient } from './solveWorkerClient.js';

export function createSolveExecutionState() {
  return { status: 'idle', progress: null, handle: null, elapsedMs: 0, timeLimitMs: null };
}

export function isBrowserRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function startSolveExecution({ execution, model, options = {}, onResult, onChange }) {
  execution.handle?.cancel();
  execution.progress = null;
  execution.elapsedMs = 0;

  if (!isBrowserRuntime()) {
    execution.status = 'solving';
    const result = runSolveService(model, options);
    execution.status = 'complete';
    onResult(result);
    return result;
  }

  const browserOptions = withBrowserSolveDefaults(options);
  execution.status = 'solving';
  execution.timeLimitMs = browserOptions.timeLimitMs;
  const startedAt = Date.now();
  onChange?.();
  const client = new SolveWorkerClient();
  const handle = client.solve(model, browserOptions, {
    onProgress(progress) {
      execution.progress = progress;
      execution.elapsedMs = Math.max(execution.elapsedMs, progress.elapsedMs ?? 0);
      onChange?.();
    },
  });
  execution.handle = handle;
  handle.promise.then((result) => {
    if (execution.handle?.requestId !== handle.requestId) return;
    execution.elapsedMs = Date.now() - startedAt;
    execution.handle = null;
    execution.status = result.status === 'cancelled' ? 'cancelled' : 'complete';
    onResult(result, browserOptions);
    onChange?.();
  });
  return handle;
}

export function cancelSolveExecution(execution) {
  if (!execution) return false;
  return execution.handle?.cancel() ?? false;
}

export function discardSolveExecution(execution) {
  if (!execution?.handle) return false;
  const cancelled = execution.handle.cancel();
  execution.handle = null;
  execution.status = 'idle';
  execution.progress = null;
  return cancelled;
}
