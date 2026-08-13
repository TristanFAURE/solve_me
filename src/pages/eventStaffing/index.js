import { renderPageShell } from '../../components/common/pageShell.js';

export function renderEventStaffingPage(root, state) {
  const message = state?.eventStaffingPage?.message || 'This planner-facing page is not implemented yet.';

  root.innerHTML = renderPageShell({
    title: 'Event staffing planner',
    description: 'Planner-facing workflow for staffing events, group types, people, and staffing requirements.',
    body: `
      <section class="panel">
        <h2>Coming soon</h2>
        <p>${message}</p>
        <p>The route is now wired so the application can build while the event-staffing editor and solve workflow are implemented.</p>
      </section>
    `,
  });
}
