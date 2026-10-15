export const WORKBOOK_PARSE_MESSAGE_TYPES = Object.freeze({
  PARSE: 'parse-workbook',
  RESULT: 'workbook-result',
  ERROR: 'workbook-error',
});

export const WORKBOOK_PARSE_ERROR_CODES = Object.freeze({
  INVALID_WORKBOOK: 'invalid-workbook',
  PARSE_FAILED: 'parse-failed',
  TIMEOUT: 'timeout',
});

export function createWorkbookParseRequest(requestId, arrayBuffer) {
  return { type: WORKBOOK_PARSE_MESSAGE_TYPES.PARSE, requestId, arrayBuffer };
}

export function isWorkbookParseRequest(message) {
  return message?.type === WORKBOOK_PARSE_MESSAGE_TYPES.PARSE
    && Number.isSafeInteger(message.requestId)
    && message.requestId > 0
    && message.arrayBuffer instanceof ArrayBuffer;
}

function hasWorkbookShape(workbook) {
  return workbook !== null
    && typeof workbook === 'object'
    && Array.isArray(workbook.SheetNames)
    && workbook.SheetNames.every((name) => typeof name === 'string')
    && workbook.Sheets !== null
    && typeof workbook.Sheets === 'object'
    && !Array.isArray(workbook.Sheets)
    && workbook.SheetNames.every((name) => Object.hasOwn(workbook.Sheets, name)
      && workbook.Sheets[name] !== null
      && typeof workbook.Sheets[name] === 'object');
}

export function isWorkbookParseResponse(message) {
  if (!Number.isSafeInteger(message?.requestId) || message.requestId <= 0) return false;
  if (message.type === WORKBOOK_PARSE_MESSAGE_TYPES.RESULT) return hasWorkbookShape(message.workbook);
  return message.type === WORKBOOK_PARSE_MESSAGE_TYPES.ERROR
    && Object.values(WORKBOOK_PARSE_ERROR_CODES).includes(message.code);
}
