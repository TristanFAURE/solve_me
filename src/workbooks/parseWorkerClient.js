import {
  createWorkbookParseRequest,
  isWorkbookParseResponse,
  WORKBOOK_PARSE_ERROR_CODES,
  WORKBOOK_PARSE_MESSAGE_TYPES,
} from './parseProtocol.js';

let nextRequestId = 1;
const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

function defaultWorkerFactory() {
  return new Worker(new URL('./parseWorker.js', import.meta.url), { type: 'module' });
}

export class WorkbookParseWorkerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WorkbookParseWorkerError';
    this.code = code;
  }
}

export function parseWorkbookInWorker(arrayBuffer, {
  workerFactory = defaultWorkerFactory,
  timeoutMs = DEFAULT_PARSE_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const requestId = nextRequestId++;

  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;
    let timer = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      callback(value);
    };

    try {
      worker = workerFactory();
      worker.onmessage = (event) => {
        const message = event?.data;
        if (!isWorkbookParseResponse(message) || message.requestId !== requestId) {
          finish(reject, new WorkbookParseWorkerError('invalid-response'));
          return;
        }
        if (message.type === WORKBOOK_PARSE_MESSAGE_TYPES.RESULT) finish(resolve, message.workbook);
        else finish(reject, new WorkbookParseWorkerError(message.code));
      };
      worker.onerror = () => finish(reject, new WorkbookParseWorkerError('worker-failed'));
      worker.onmessageerror = () => finish(reject, new WorkbookParseWorkerError('invalid-response'));
      timer = setTimer(() => finish(
        reject,
        new WorkbookParseWorkerError(WORKBOOK_PARSE_ERROR_CODES.TIMEOUT),
      ), timeoutMs);
      worker.postMessage(createWorkbookParseRequest(requestId, arrayBuffer), [arrayBuffer]);
    } catch {
      finish(reject, new WorkbookParseWorkerError(WORKBOOK_PARSE_ERROR_CODES.PARSE_FAILED));
    }
  });
}
