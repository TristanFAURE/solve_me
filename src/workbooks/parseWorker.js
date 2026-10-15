import { readWorkbookArrayBuffer, WorkbookSafetyError } from './safety.js';
import {
  isWorkbookParseRequest,
  WORKBOOK_PARSE_ERROR_CODES,
  WORKBOOK_PARSE_MESSAGE_TYPES,
} from './parseProtocol.js';

self.onmessage = (event) => {
  const request = event.data;
  if (!isWorkbookParseRequest(request)) return;

  try {
    const workbook = readWorkbookArrayBuffer(request.arrayBuffer);
    self.postMessage({
      type: WORKBOOK_PARSE_MESSAGE_TYPES.RESULT,
      requestId: request.requestId,
      workbook,
    });
  } catch (error) {
    self.postMessage({
      type: WORKBOOK_PARSE_MESSAGE_TYPES.ERROR,
      requestId: request.requestId,
      code: error instanceof WorkbookSafetyError
        ? WORKBOOK_PARSE_ERROR_CODES.INVALID_WORKBOOK
        : WORKBOOK_PARSE_ERROR_CODES.PARSE_FAILED,
    });
  }
};
