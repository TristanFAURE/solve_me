import { describe, expect, it } from 'vitest';
import { createAppState } from '../../src/app/state.js';
import { renderPageShell } from '../../src/components/common/pageShell.js';
import { renderFieldLabel } from '../../src/components/common/fieldHelp.js';
import { renderWorkflowPanel, renderWorkflowTabs } from '../../src/components/common/workflowTabs.js';
import { renderValidationPanel } from '../../src/components/solutions/validationPanel.js';
import { createContainer, createItem } from '../../src/core/model/nodes.js';
import { buildGenericSolveOptions, renderGenericPage } from '../../src/pages/generic/index.js';

function createActionRoot(action) {
  const button = {
    dataset: { action },
    addEventListener(type, listener) {
      if (type === 'click') this.click = listener;
    },
  };
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === '[data-action]' ? [button] : [];
    },
    button,
  };
}

describe('workflow foundation', () => {
  it('renders keyboard-accessible field help with escaped tooltip text', () => {
    const html = renderFieldLabel('Time limit', 'Stops after <5 seconds> & returns safely.');

    expect(html).toContain('class="field-tooltip"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="note"');
    expect(html).toContain('data-tooltip="Stops after &lt;5 seconds&gt; &amp; returns safely."');
    expect(html).toContain('aria-label="Time limit help:');
  });

  it('renders accessible workflow tabs and panels', () => {
    const tabs = renderWorkflowTabs('rules');
    const panel = renderWorkflowPanel('rules', 'rules', '<p>Rules</p>');

    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('data-workflow-tab="rules">Rules</button>');
    expect(tabs).toContain('aria-selected="true"');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).not.toContain(' hidden');
  });

  it('marks the active shell route', () => {
    const html = renderPageShell({ title: 'Test', description: '', body: '', activeRoute: '/school' });
    expect(html).toContain('href="#/school" aria-current="page"');
    expect(html).not.toContain('href="#/generic" aria-current="page"');
  });

  it('supports distinct validation panel headings for layered validation', () => {
    const html = renderValidationPanel(null, { eyebrow: 'Solver validation', title: 'Transformed model' });

    expect(html).toContain('Solver validation');
    expect(html).toContain('Transformed model');
  });

  it('builds explicit typed solve options from page drafts', () => {
    expect(buildGenericSolveOptions({
      solveMode: 'topK',
      solveMaxSolutions: '4',
      solveTimeLimitMs: '250',
      solveIncludeScoreDetails: true,
      solveEquityEligibleItemIds: ['item-1'],
      solvePreferenceWeight: '2',
      solveTargetWeight: '3',
      solveEquityWeight: '4',
      solveDiversityEnabled: true,
      solveMinimumAssignmentDistance: '2',
    })).toEqual({
      mode: 'topK',
      maxSolutions: 4,
      timeLimitMs: 250,
      includeScoreDetails: true,
      equityEligibleItemIds: ['item-1'],
      scoreWeights: { preferences: 2, targets: 3, equity: 4 },
      diversity: { enabled: true, minimumAssignmentDistance: 2 },
    });
  });

  it('moves a valid solve to Results and a validation failure to Review', () => {
    const solvedState = createAppState();
    solvedState.genericPage.project.items.push(createItem({ id: 'item-1', label: 'Item' }));
    solvedState.genericPage.project.containers.push(createContainer({ id: 'container-1', label: 'Container', maxCapacity: 1 }));
    const solvedRoot = createActionRoot('solve');
    renderGenericPage(solvedRoot, solvedState);
    solvedRoot.button.click();
    expect(solvedState.genericPage.activeWorkflowTab).toBe('results');

    const failedState = createAppState();
    failedState.genericPage.project.items.push(
      createItem({ id: 'duplicate', label: 'One' }),
      createItem({ id: 'duplicate', label: 'Two' }),
    );
    const failedRoot = createActionRoot('solve');
    renderGenericPage(failedRoot, failedState);
    failedRoot.button.click();
    expect(failedState.genericPage.activeWorkflowTab).toBe('review');
  });
});
