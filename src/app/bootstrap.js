import { createAppState } from './state.js';
import { createRouter } from './router.js';
import { isCollaborationMode } from '../pages/eventStaffing/collaboration/collaborationMode.js';

export function bootstrapApp() {
  const root = document.querySelector('#app');

  if (!root) {
    throw new Error('Missing #app root element');
  }

  const state = createAppState({ draftsEnabled: !isCollaborationMode(globalThis.location) });
  const router = createRouter(state);

  router.render(root);
  window.addEventListener('hashchange', () => router.render(root));
}
