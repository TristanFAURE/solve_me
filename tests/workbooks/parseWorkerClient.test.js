import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWorkbookInWorker, WorkbookParseWorkerError } from '../../src/workbooks/parseWorkerClient.js';
import { WORKBOOK_PARSE_MESSAGE_TYPES } from '../../src/workbooks/parseProtocol.js';
import { readWorkbookArrayBuffer, readWorkbookFile } from '../../src/workbooks/safety.js';

class MockWorker {
  sent = [];
  terminated = false;

  postMessage(message, transfer) {
    this.sent.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

function emptyWorkbook() {
  return { SheetNames: [], Sheets: {} };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Worker;
});

describe('workbook parse Worker client', () => {
  it('transfers the buffer and resolves only a valid matching response', async () => {
    const worker = new MockWorker();
    const buffer = new ArrayBuffer(8);
    const promise = parseWorkbookInWorker(buffer, { workerFactory: () => worker });
    const request = worker.sent[0].message;

    expect(request.type).toBe(WORKBOOK_PARSE_MESSAGE_TYPES.PARSE);
    expect(worker.sent[0].transfer).toEqual([buffer]);
    worker.emit({ type: WORKBOOK_PARSE_MESSAGE_TYPES.RESULT, requestId: request.requestId, workbook: emptyWorkbook() });

    await expect(promise).resolves.toEqual(emptyWorkbook());
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('rejects malformed or stale responses and terminates the worker', async () => {
    const worker = new MockWorker();
    const promise = parseWorkbookInWorker(new ArrayBuffer(8), { workerFactory: () => worker });
    const request = worker.sent[0].message;

    worker.emit({ type: WORKBOOK_PARSE_MESSAGE_TYPES.RESULT, requestId: request.requestId + 1, workbook: emptyWorkbook() });

    await expect(promise).rejects.toBeInstanceOf(WorkbookParseWorkerError);
    expect(worker.terminated).toBe(true);
  });

  it('rejects result messages without the declared worksheets', async () => {
    const worker = new MockWorker();
    const promise = parseWorkbookInWorker(new ArrayBuffer(8), { workerFactory: () => worker });
    const request = worker.sent[0].message;

    worker.emit({
      type: WORKBOOK_PARSE_MESSAGE_TYPES.RESULT,
      requestId: request.requestId,
      workbook: { SheetNames: ['People'], Sheets: {} },
    });

    await expect(promise).rejects.toMatchObject({ code: 'invalid-response' });
    expect(worker.terminated).toBe(true);
  });

  it('uses content-free errors and ignores handlers after settlement', async () => {
    const worker = new MockWorker();
    const promise = parseWorkbookInWorker(new ArrayBuffer(8), { workerFactory: () => worker });
    const request = worker.sent[0].message;
    const staleHandler = worker.onmessage;

    worker.onerror(new Error('uploaded cell contents'));
    staleHandler({ data: { type: WORKBOOK_PARSE_MESSAGE_TYPES.RESULT, requestId: request.requestId, workbook: emptyWorkbook() } });

    await expect(promise).rejects.toMatchObject({ name: 'WorkbookParseWorkerError', code: 'worker-failed' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates when posting the request fails', async () => {
    const worker = new MockWorker();
    worker.postMessage = () => { throw new Error('clone failed'); };

    await expect(parseWorkbookInWorker(new ArrayBuffer(8), { workerFactory: () => worker }))
      .rejects.toMatchObject({ code: 'parse-failed' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates and rejects when parsing exceeds its time limit', async () => {
    const worker = new MockWorker();
    let timeoutCallback;
    const promise = parseWorkbookInWorker(new ArrayBuffer(8), {
      workerFactory: () => worker,
      timeoutMs: 25,
      setTimer: (callback) => { timeoutCallback = callback; return 1; },
      clearTimer: () => {},
    });

    timeoutCallback();

    await expect(promise).rejects.toMatchObject({ code: 'timeout' });
    expect(worker.terminated).toBe(true);
  });

  it('preflights browser uploads before parsing them in the Worker', async () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([['Name'], ['Ada']]), 'People');
    const buffer = XLSX.write(source, { bookType: 'xlsx', type: 'array', compression: true });
    const parsed = readWorkbookArrayBuffer(buffer.slice(0));
    let worker;
    globalThis.window = {};
    globalThis.document = {};
    globalThis.Worker = class extends MockWorker {
      constructor() {
        super();
        worker = this;
      }

      postMessage(message, transfer) {
        super.postMessage(message, transfer);
        this.emit({
          type: WORKBOOK_PARSE_MESSAGE_TYPES.RESULT,
          requestId: message.requestId,
          workbook: parsed,
        });
      }
    };

    const workbook = await readWorkbookFile({ size: buffer.byteLength, arrayBuffer: async () => buffer });

    expect(workbook.SheetNames).toEqual(['People']);
    expect(worker.sent[0].transfer).toHaveLength(1);
    expect(worker.terminated).toBe(true);
  });
});
