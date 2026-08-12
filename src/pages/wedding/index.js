import { renderPageShell } from '../../components/common/pageShell.js';

export function renderWeddingPage(root) {
  root.innerHTML = renderPageShell({
    title: 'Wedding Table Plan',
    description: 'Wedding-specific workflow built on the generic core model.',
    body: `
      <section class="card">
        <h2>Scaffold ready</h2>
        <p>Wedding-specific editors and seat-aware views will be added later.</p>
      </section>
    `,
  });
}
