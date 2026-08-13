import { renderGenericPage } from '../pages/generic/index.js';
import { renderWeddingPage } from '../pages/wedding/index.js';
import { renderSchoolPage } from '../pages/school/index.js';
import { renderEventStaffingPage } from '../pages/eventStaffing/index.js';

function getRoute() {
  const hash = window.location.hash || '#/generic';
  return hash.replace(/^#/, '');
}

export function createRouter(state) {
  function render(root) {
    const route = getRoute();

    if (route === '/wedding') {
      renderWeddingPage(root, state);
      return;
    }

    if (route === '/school') {
      renderSchoolPage(root, state);
      return;
    }

    if (route === '/event-staffing') {
      renderEventStaffingPage(root, state);
      return;
    }

    renderGenericPage(root, state);
  }

  return { render };
}
