import { afterEach, describe, expect, it } from 'vitest';
import { createAppState } from '../../src/app/state.js';
import { createContainer, createItem } from '../../src/core/model/nodes.js';
import { renderGenericPage } from '../../src/pages/generic/index.js';
import { SOLVE_MESSAGE_TYPES } from '../../src/solver/solveProtocol.js';

let workerInstance;

class BrowserWorker {
  postMessage(message) {
    this.request = message;
    workerInstance = this;
  }

  terminate() {}
}

function createRoot() {
  const button = {
    dataset: { action: 'solve' },
    addEventListener(type, listener) { if (type === 'click') this.click = listener; },
  };
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll(selector) { return selector === '[data-action]' ? [button] : []; },
    button,
  };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Worker;
  workerInstance = null;
});

describe('browser page solve integration', () => {
  it('sends Generic solves to a module Worker with the default timeout', async () => {
    globalThis.window = {};
    globalThis.document = {};
    globalThis.Worker = BrowserWorker;
    const state = createAppState({ storage: null });
    state.genericPage.project.items.push(createItem({ id: 'item-1', label: 'Item' }));
    state.genericPage.project.containers.push(createContainer({ id: 'container-1', label: 'Container', maxCapacity: 1 }));
    const root = createRoot();

    renderGenericPage(root, state);
    root.button.click();

    expect(state.genericPage.solveExecution.status).toBe('solving');
    expect(state.genericPage.solveExecution.progress).toMatchObject({
      phase: 'searching',
      exploredNodes: 0,
      solutionCount: 0,
    });
    expect(state.genericPage.lastSolverResult).toBeNull();
    expect(workerInstance.request.options.timeLimitMs).toBe(5000);
    workerInstance.onmessage({
      data: {
        type: SOLVE_MESSAGE_TYPES.RESULT,
        requestId: workerInstance.request.requestId,
        result: { status: 'solved', solutions: [], warnings: [], runtimeMs: 1 },
      },
    });
    await Promise.resolve();
    expect(state.genericPage.lastSolverResult.status).toBe('solved');
  });
});
