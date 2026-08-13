export function renderPageShell({ title, description, body }) {
  return `
    <main class="app-shell">
      <header class="page-header">
        <h1>${title}</h1>
        <p>${description}</p>
        <nav>
          <ul class="nav-list">
            <li><a href="#/generic">Generic</a></li>
            <li><a href="#/wedding">Wedding</a></li>
            <li><a href="#/school">School</a></li>
            <li><a href="#/event-staffing">Event staffing</a></li>
          </ul>
        </nav>
      </header>
      ${body}
    </main>
  `;
}
