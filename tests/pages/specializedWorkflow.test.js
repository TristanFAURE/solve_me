import { describe, expect, it } from 'vitest';
import { createAppState } from '../../src/app/state.js';
import { createContainer, createGroup, createItem } from '../../src/core/model/nodes.js';
import { createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { renderSchoolPage } from '../../src/pages/school/index.js';
import { renderWeddingPage } from '../../src/pages/wedding/index.js';

function createRoot(action = null) {
  const button = action ? {
    dataset: { action },
    addEventListener(type, listener) {
      if (type === 'click') this.click = listener;
    },
  } : null;
  return {
    innerHTML: '',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '[data-action]' && button) return [button];
      return [];
    },
    button,
  };
}

describe('specialized shared workflows', () => {
  it.each([
    ['school', renderSchoolPage],
    ['wedding', renderWeddingPage],
  ])('renders accessible shared tabs and diagnostics for %s', (_name, renderPage) => {
    const root = createRoot();
    renderPage(root, createAppState({ storage: null }));

    expect(root.innerHTML).toContain('aria-label="Project workflow"');
    expect(root.innerHTML).toContain('data-workflow-tab="setup"');
    expect(root.innerHTML).toContain('data-workflow-tab="results"');
    expect(root.innerHTML).toMatch(/data-workflow-tab="results"[\s\S]*data-workflow-tab="display"/);
    expect(root.innerHTML).toContain('id="workflow-panel-display"');
    expect(root.innerHTML).toContain('aria-labelledby="workflow-tab-display"');
    expect(root.innerHTML).toContain('Advanced diagnostics');
    expect(root.innerHTML).toContain('value="5000"');
  });

  it('routes invalid School solves to Review and successful solves to Results', () => {
    const invalidState = createAppState({ storage: null });
    invalidState.schoolPage.project.items.push(createItem({ id: 'student-invalid', label: 'Unassigned student', metadata: { schoolRole: 'student' } }));
    const invalidRoot = createRoot('solve-school');
    renderSchoolPage(invalidRoot, invalidState);
    invalidRoot.button.click();
    expect(invalidState.schoolPage.activeWorkflowTab).toBe('review');

    const state = createAppState({ storage: null });
    state.schoolPage.project.items.push(createItem({ id: 'student-1', label: 'Alice', metadata: { schoolRole: 'student' } }));
    state.schoolPage.project.groups.push(createGroup({ id: 'level-1', label: 'Level 1' }));
    state.schoolPage.project.containers.push(createContainer({ id: 'class-1', label: 'Class 1', maxCapacity: 1 }));
    state.schoolPage.project.containments.push(createContainmentRelation(createEntityRef('group', 'level-1'), createEntityRef('item', 'student-1')));
    const root = createRoot('solve-school');
    renderSchoolPage(root, state);
    root.button.click();
    expect(state.schoolPage.lastSolverResult.status).toBe('solved');
    expect(state.schoolPage.activeWorkflowTab).toBe('results');
    state.schoolPage.activeWorkflowTab = 'display';
    renderSchoolPage(root, state);
    expect(root.innerHTML).toContain('school-classroom');
    expect(root.innerHTML).toContain('Alice');
  });

  it('routes invalid Wedding solves to Review and successful solves to Results', () => {
    const invalidState = createAppState({ storage: null });
    const invalidRoot = createRoot('solve-wedding');
    renderWeddingPage(invalidRoot, invalidState);
    invalidRoot.button.click();
    expect(invalidState.weddingPage.activeWorkflowTab).toBe('review');

    const state = createAppState({ storage: null });
    state.weddingPage.project.items.push(createItem({ id: 'guest-1', label: 'Alex' }));
    state.weddingPage.project.containers.push(createContainer({ id: 'table-1', label: 'Table 1', maxCapacity: 1 }));
    const root = createRoot('solve-wedding');
    renderWeddingPage(root, state);
    root.button.click();
    expect(state.weddingPage.lastSolverResult.status).toBe('solved');
    expect(state.weddingPage.activeWorkflowTab).toBe('results');
    state.weddingPage.activeWorkflowTab = 'display';
    renderWeddingPage(root, state);
    expect(root.innerHTML).toContain('wedding-table-card');
    expect(root.innerHTML).toContain('Alex');
  });

  it.each([
    ['school', 'schoolPage', renderSchoolPage, 'Run the solver to generate a classroom display.'],
    ['wedding', 'weddingPage', renderWeddingPage, 'Run the solver to generate a visual seating display.'],
  ])('accepts Display as the active %s workflow tab', (_name, stateKey, renderPage, message) => {
    const state = createAppState({ storage: null });
    state[stateKey].activeWorkflowTab = 'display';
    const root = createRoot();
    renderPage(root, state);
    expect(root.innerHTML).toContain('id="workflow-panel-display" class="workflow-panel" role="tabpanel"');
    expect(root.innerHTML).toContain(message);
  });
});
