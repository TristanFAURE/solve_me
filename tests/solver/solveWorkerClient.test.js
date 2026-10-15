import { describe, expect, it } from 'vitest';
import { createSolveRequest, isSolveRequest, isSolveResponse, SOLVE_MESSAGE_TYPES } from '../../src/solver/solveProtocol.js';
import { SolveWorkerClient } from '../../src/solver/solveWorkerClient.js';

class FakeWorker {
  terminated = false;
  sent = [];

  postMessage(message) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }
}

describe('solve Worker protocol and client', () => {
  it('recognizes structured requests and responses', () => {
    const request = createSolveRequest(1, { items: [] }, { timeLimitMs: 25 });
    expect(isSolveRequest(request)).toBe(true);
    expect(isSolveRequest({ ...request, requestId: '1' })).toBe(false);
    expect(isSolveResponse({ type: SOLVE_MESSAGE_TYPES.PROGRESS, requestId: 1, progress: {} })).toBe(true);
  });

  it('terminates superseded work and ignores stale request IDs', async () => {
    const workers = [];
    const client = new SolveWorkerClient({ workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    } });
    const first = client.solve({}, { timeLimitMs: 1000 });
    const second = client.solve({}, { timeLimitMs: 1000 });

    expect(workers[0].terminated).toBe(true);
    workers[0].emit({ type: SOLVE_MESSAGE_TYPES.RESULT, requestId: first.requestId, result: { status: 'solved' } });
    workers[1].emit({ type: SOLVE_MESSAGE_TYPES.RESULT, requestId: second.requestId, result: { status: 'unsat' } });

    expect((await first.promise).status).toBe('cancelled');
    expect((await second.promise).status).toBe('unsat');
  });

  it('hard-cancels immediately and preserves the latest incumbent', async () => {
    const worker = new FakeWorker();
    const client = new SolveWorkerClient({ workerFactory: () => worker });
    const handle = client.solve({ items: [] }, { timeLimitMs: 1000 });
    const bestSolution = { assignments: [], score: 4 };
    worker.emit({
      type: SOLVE_MESSAGE_TYPES.PROGRESS,
      requestId: handle.requestId,
      progress: { exploredNodes: 12, prunedNodes: 3, elapsedMs: 20, solutionCount: 1, bestSolution },
    });

    expect(handle.cancel()).toBe(true);
    const result = await handle.promise;
    expect(worker.terminated).toBe(true);
    expect(result.status).toBe('cancelled');
    expect(result.cancelled).toBe(true);
    expect(result.solutions).toEqual([bestSolution]);
  });

  it('keeps the best ranked incumbent when later progress contains a worse solution', async () => {
    const worker = new FakeWorker();
    const client = new SolveWorkerClient({ workerFactory: () => worker });
    const handle = client.solve({ items: [] }, { timeLimitMs: 1000 });
    const bestSolution = { assignments: [], score: 10, fingerprint: 'a' };
    worker.emit({
      type: SOLVE_MESSAGE_TYPES.PROGRESS,
      requestId: handle.requestId,
      progress: { elapsedMs: 10, bestSolution },
    });
    worker.emit({
      type: SOLVE_MESSAGE_TYPES.PROGRESS,
      requestId: handle.requestId,
      progress: { elapsedMs: 20, bestSolution: { assignments: [], score: 1, fingerprint: 'z' } },
    });

    handle.cancel();
    expect((await handle.promise).solutions).toEqual([bestSolution]);
  });

  it('uses the main watchdog and never reports interruption as unsat', async () => {
    const worker = new FakeWorker();
    let watchdog;
    let watchdogDelay;
    const client = new SolveWorkerClient({
      workerFactory: () => worker,
      setTimer(callback, delay) { watchdog = callback; watchdogDelay = delay; return 1; },
      clearTimer() {},
    });
    const handle = client.solve({ items: [{ id: 'a' }], containers: [{ id: 'c' }] }, {});
    expect(worker.sent[0].options.timeLimitMs).toBe(5000);
    expect(watchdogDelay).toBe(5100);

    watchdog();
    const result = await handle.promise;
    expect(result.status).toBe('timeout');
    expect(result.status).not.toBe('unsat');
    expect(result.timeoutReached).toBe(true);
  });
});
