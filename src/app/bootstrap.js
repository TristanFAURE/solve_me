import { createAppState } from './state.js';
import { createRouter } from './router.js';

export function bootstrapApp() {
  const root = document.querySelector('#app');

  if (!root) {
    throw new Error('Missing #app root element');
  }

  const state = createAppState();
  const router = createRouter(state);

  router.render(root);
  window.addEventListener('hashchange', () => router.render(root));
}
