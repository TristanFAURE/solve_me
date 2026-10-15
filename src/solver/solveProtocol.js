export const SOLVE_MESSAGE_TYPES = Object.freeze({
  SOLVE: 'solve',
  PROGRESS: 'progress',
  RESULT: 'result',
  ERROR: 'error',
});

export function createSolveRequest(requestId, model, options) {
  return { type: SOLVE_MESSAGE_TYPES.SOLVE, requestId, model, options };
}

export function isSolveRequest(message) {
  return message?.type === SOLVE_MESSAGE_TYPES.SOLVE
    && Number.isSafeInteger(message.requestId)
    && message.requestId > 0
    && message.model !== null
    && typeof message.model === 'object'
    && message.options !== null
    && typeof message.options === 'object';
}

export function isSolveResponse(message) {
  return Number.isSafeInteger(message?.requestId)
    && [SOLVE_MESSAGE_TYPES.PROGRESS, SOLVE_MESSAGE_TYPES.RESULT, SOLVE_MESSAGE_TYPES.ERROR].includes(message?.type);
}
