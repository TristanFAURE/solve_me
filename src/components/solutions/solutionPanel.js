import { renderContainerAssignmentView } from './containerAssignmentView.js';
import { renderSolutionNavigation } from './solutionNavigation.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAuditSection(title, eyebrow, content) {
  return `
    <section class="card audit-card">
      <div class="audit-card-header">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${title}</h2>
        </div>
      </div>
      ${content}
    </section>
  `;
}

export function renderSolutionPanel(project, result, activeSolutionIndex = 0, options = {}) {
  if (!result) {
    return renderAuditSection('Solve result', 'Solver output', '<p class="muted-text">Run solve after validation to see adapter output.</p>');
  }

  const solutionCount = result.solutions?.length ?? 0;
  const clampedSolutionIndex = solutionCount === 0
    ? 0
    : Math.min(Math.max(activeSolutionIndex, 0), solutionCount - 1);

  const solutionNavigation = result.status === 'solved'
    ? renderSolutionNavigation(clampedSolutionIndex, solutionCount)
    : '';

  const solutionSummary = result.status === 'solved' && solutionCount > 0
    ? `${solutionNavigation}${renderContainerAssignmentView(project, result.solutions[clampedSolutionIndex], clampedSolutionIndex, solutionCount, options)}`
    : result.status === 'unsat'
      ? '<p class="muted-text top-gap">The solver completed but found no valid assignment satisfying the current hard constraints.</p>'
      : '<p class="muted-text top-gap">No concrete assignments are available for this solver result.</p>';

  const warnings = result.warnings ?? [];
  const content = `
    <dl class="summary-grid audit-summary-grid">
      <div><dt>Status</dt><dd>${escapeHtml(result.status)}</dd></div>
      <div><dt>Solutions</dt><dd>${solutionCount}</dd></div>
      <div><dt>Warnings</dt><dd>${warnings.length}</dd></div>
      <div><dt>Runtime</dt><dd>${result.runtimeMs} ms</dd></div>
    </dl>
    ${warnings.length > 0 ? `<ul class="issue-list compact-issue-list top-gap">${warnings.map((warning) => `<li class="issue-list-item warning"><div>${escapeHtml(warning)}</div></li>`).join('')}</ul>` : '<p class="muted-text">No solver warnings.</p>'}
    ${solutionSummary}
    <details class="details-panel top-gap">
      <summary>View raw solver result JSON</summary>
      <pre class="json-block">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;

  return renderAuditSection('Solve result', 'Solver output', content);
}
