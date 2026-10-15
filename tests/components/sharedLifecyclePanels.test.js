import { describe, expect, it } from 'vitest';
import { createAppState } from '../../src/app/state.js';
import { renderSolutionPanel } from '../../src/components/solutions/solutionPanel.js';
import { renderSolveStatus } from '../../src/components/solutions/solveStatus.js';
import { renderValidationPanel } from '../../src/components/solutions/validationPanel.js';
import { createContainer, createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { renderEventStaffingPage } from '../../src/pages/eventStaffing/index.js';
import { renderGenericPage } from '../../src/pages/generic/index.js';
import { renderSchoolPage } from '../../src/pages/school/index.js';
import { renderWeddingPage } from '../../src/pages/wedding/index.js';

function createRoot() {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function createActionRoot({ action = null, eventStaffingAction = null } = {}) {
  const button = {
    dataset: { action },
    addEventListener(type, listener) {
      if (type === 'click') {
        this.click = listener;
      }
    },
  };

  return {
    button,
    innerHTML: '',
    querySelector(selector) {
      return eventStaffingAction && selector === `[data-event-staffing-action="${eventStaffingAction}"]`
        ? button
        : null;
    },
    querySelectorAll(selector) {
      return action && selector === '[data-action]' ? [button] : [];
    },
  };
}

function buildProject() {
  return createEmptyProject({
    items: [createItem({ id: 'item-1', label: 'Item 1' })],
    containers: [createContainer({ id: 'container-1', label: 'Container 1', maxCapacity: 1 })],
  });
}

function buildResult(status, solutions = []) {
  return {
    status,
    solutions,
    warnings: [],
    runtimeMs: 4,
  };
}

describe('shared validation lifecycle panels', () => {
  it('renders an accessible phase and time-budget progress bar while solving', () => {
    const html = renderSolveStatus({
      status: 'solving',
      elapsedMs: 1250,
      timeLimitMs: 5000,
      progress: { phase: 'loading-wasm' },
    });

    expect(html).toContain('Loading WASM optimization engine');
    expect(html).toContain('aria-label="Solver is working"');
    expect(html).not.toContain('value=');
    expect(html).toContain('5000 ms time budget; latest Worker update at 1250 ms');
    expect(html).toContain('Cancel solve');
  });

  it('renders an explicit state before validation has run', () => {
    const html = renderValidationPanel(null);

    expect(html).toContain('Not validated yet');
    expect(html).toContain('Run validation to check the current project.');
    expect(html).not.toContain('0 errors');
  });

  it('renders explicit validation failures open with actionable details', () => {
    const html = renderValidationPanel({
      valid: false,
      errors: [{ code: 'missing-item', message: 'Add at least one item.', path: 'items' }],
      warnings: [],
    }, { expanded: true });

    expect(html).toContain('validation-panel-details" open');
    expect(html).toContain('Add at least one item.');
    expect(html).toContain('items');
  });

  it.each([
    ['solved', 'Solved', 'The solver reported success but did not return a solution.'],
    ['unsat', 'Unsatisfiable', 'found no valid assignment'],
    ['timeout', 'Timed out', 'reached its time limit'],
    ['partial', 'Partial result', 'stopped early'],
    ['error', 'Solver error', 'could not process this model'],
  ])('renders %s results distinctly', (status, label, message) => {
    const html = renderSolutionPanel(buildProject(), buildResult(status));

    expect(html).toContain(`<dd>${label}</dd>`);
    expect(html).toContain(message);
    expect(html).not.toContain('No concrete assignments');
  });

  it('renders a returned partial solution while identifying it as incomplete', () => {
    const project = buildProject();
    const solution = {
      assignments: [{
        itemRef: { kind: 'item', id: 'item-1' },
        containerRef: { kind: 'container', id: 'container-1' },
        metadata: {},
      }],
    };
    const html = renderSolutionPanel(project, buildResult('partial', [solution]));

    expect(html).toContain('Partial result');
    expect(html).toContain('result set is incomplete');
    expect(html).toContain('Item 1');
  });

  it('counts changed repeated-assignment pairs without collapsing by item ID', () => {
    const project = createEmptyProject({
      assignmentMultiplicity: 'multiple',
      items: [createItem({ id: 'item-1', label: 'Item 1' })],
      containers: [
        createContainer({ id: 'container-1', label: 'Container 1', maxCapacity: 1 }),
        createContainer({ id: 'container-2', label: 'Container 2', maxCapacity: 1 }),
        createContainer({ id: 'container-3', label: 'Container 3', maxCapacity: 1 }),
      ],
    });
    const assignment = (containerId) => ({
      itemRef: { kind: 'item', id: 'item-1' },
      containerRef: { kind: 'container', id: containerId },
      metadata: {},
    });
    const html = renderSolutionPanel(project, buildResult('solved', [
      { assignments: [assignment('container-1'), assignment('container-2')] },
      { assignments: [assignment('container-3'), assignment('container-2')] },
    ]));

    expect(html).toContain('<dt>Assignment differences</dt><dd>2 vs next plan</dd>');
  });

  it('keeps status-only domain views safe when a partial result has solutions', () => {
    const html = renderSolutionPanel(null, buildResult('partial', [{ assignments: [] }]));

    expect(html).toContain('Partial result');
    expect(html).toContain('result set is incomplete');
  });

  it.each([
    ['Generic', renderGenericPage],
    ['School', renderSchoolPage],
    ['Wedding', renderWeddingPage],
    ['Event Staffing', renderEventStaffingPage],
  ])('keeps the %s page unvalidated until an explicit workflow action', (_name, renderPage) => {
    const state = createAppState();
    const root = createRoot();

    renderPage(root, state);

    expect(root.innerHTML).toContain('Not validated yet');
  });

  it.each([
    ['Generic', 'genericPage', renderGenericPage, 'validate', 'solve', null, null],
    ['School', 'schoolPage', renderSchoolPage, 'validate-school', 'solve-school', null, null],
    ['Wedding', 'weddingPage', renderWeddingPage, 'validate-wedding', 'solve-wedding', null, null],
    ['Event Staffing', 'eventStaffingPage', renderEventStaffingPage, null, null, 'validate-domain-project', 'solve-domain-project'],
  ])('opens %s validation errors and does not fabricate a solver result', (
    _name,
    stateKey,
    renderPage,
    validateAction,
    solveAction,
    validateEventAction,
    solveEventAction,
  ) => {
    const state = createAppState();
    if (stateKey === 'genericPage') {
      state.genericPage.project.items = [
        createItem({ id: 'duplicate', label: 'First' }),
        createItem({ id: 'duplicate', label: 'Second' }),
      ];
    }
    if (stateKey === 'schoolPage') {
      state.schoolPage.project.items = [createItem({
        id: 'student-1',
        label: 'Student',
        metadata: { schoolRole: 'student' },
      })];
    }
    const validationRoot = createActionRoot({ action: validateAction, eventStaffingAction: validateEventAction });

    renderPage(validationRoot, state);
    validationRoot.button.click();

    expect(state[stateKey].lastValidation.valid).toBe(false);
    expect(state[stateKey].validationPanelExpanded).toBe(true);
    expect(validationRoot.innerHTML).toContain('validation-panel-details" open');

    const solveRoot = createActionRoot({ action: solveAction, eventStaffingAction: solveEventAction });
    renderPage(solveRoot, state);
    solveRoot.button.click();

    expect(state[stateKey].lastSolverResult).toBeNull();
    expect(solveRoot.innerHTML).not.toContain('validation-failed');
  });
});
