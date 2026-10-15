import { describe, expect, it } from 'vitest';
import { createAppState } from '../../src/app/state.js';
import { UNSUPPORTED_GENERAL_PREFERENCES_COPY } from '../../src/components/common/preferenceAuthoringPolicy.js';
import { createItem } from '../../src/core/model/nodes.js';
import { createPreference, PREFERENCE_KINDS } from '../../src/core/model/preferences.js';
import { createEntityRef } from '../../src/core/model/relations.js';
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

describe('unsupported general preference authoring', () => {
  it.each([
    ['Generic', renderGenericPage],
    ['School', renderSchoolPage],
    ['Wedding', renderWeddingPage],
  ])('shows truthful disabled copy in %s while preserving existing entries', (_name, renderPage) => {
    const state = createAppState();
    const pageKey = renderPage === renderGenericPage
      ? 'genericPage'
      : renderPage === renderSchoolPage ? 'schoolPage' : 'weddingPage';
    const project = state[pageKey].project;
    project.items.push(
      createItem({ id: 'item-1', label: 'One' }),
      createItem({ id: 'item-2', label: 'Two' }),
    );
    project.preferences.push(createPreference({
      kind: PREFERENCE_KINDS.PREFER_SHARE_CONTAINER,
      leftRef: createEntityRef('item', 'item-1'),
      rightRef: createEntityRef('item', 'item-2'),
      weight: 1,
    }));
    const root = createRoot();

    renderPage(root, state);

    expect(root.innerHTML).toContain(UNSUPPORTED_GENERAL_PREFERENCES_COPY);
    expect(root.innerHTML).toMatch(/data-action="add(?:-school|-wedding)?-preference" disabled/);
    expect(root.innerHTML).toContain('remove-');
    expect(project.preferences).toHaveLength(1);
  });

  it('does not disable supported assignment score and target authoring in Generic', () => {
    const state = createAppState();
    const root = createRoot();

    renderGenericPage(root, state);

    expect(root.innerHTML).toContain('data-action="add-soft-assignment-score">');
    expect(root.innerHTML).toContain('data-action="add-soft-item-count-target">');
  });
});
