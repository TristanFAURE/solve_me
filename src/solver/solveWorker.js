import { runSolveService } from './solveService.js';
import { isSolveRequest, SOLVE_MESSAGE_TYPES } from './solveProtocol.js';

function post(type, requestId, payload) {
  self.postMessage({ type, requestId, ...payload });
}

self.onmessage = (event) => {
  const request = event.data;
  if (!isSolveRequest(request)) return;

  try {
    const result = runSolveService(request.model, request.options, {
      onProgress(progress) {
        post(SOLVE_MESSAGE_TYPES.PROGRESS, request.requestId, { progress });
      },
    });
    post(SOLVE_MESSAGE_TYPES.RESULT, request.requestId, { result });
  } catch (error) {
    post(SOLVE_MESSAGE_TYPES.ERROR, request.requestId, {
      error: error instanceof Error ? error.message : 'Unknown worker solve error.',
    });
  }
};
