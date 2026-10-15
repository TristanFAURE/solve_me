function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPersistenceStatus(persistence) {
  const hidden = !persistence?.message || persistence.status === 'idle';
  const className = persistence?.status === 'failed' ? ' command-bar-feedback-error' : '';
  const role = persistence?.status === 'failed' ? 'alert' : 'status';
  return `<p class="command-bar-feedback draft-persistence-status${className}" role="${role}"${hidden ? ' hidden' : ''}>${escapeHtml(persistence?.message ?? '')}</p>`;
}

const NAV_ITEMS = [
  ['/generic', 'Generic'],
  ['/wedding', 'Wedding'],
  ['/school', 'School'],
  ['/event-staffing', 'Event staffing'],
];

export function renderPageShell({ title, description, body, persistence = null, activeRoute = null }) {
  const currentRoute = activeRoute ?? (typeof window === 'undefined' ? null : window.location.hash.replace(/^#/, ''));
  return `
    <main class="app-shell">
      <header class="page-header">
        <h1>${title}</h1>
        <p>${description}</p>
        <nav>
          <ul class="nav-list">
            ${NAV_ITEMS.map(([route, label]) => `<li><a href="#${route}"${currentRoute === route ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}
          </ul>
        </nav>
      </header>
      ${renderPersistenceStatus(persistence)}
      ${body}
    </main>
  `;
}
