function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderIssueList(issues, emptyMessage, className) {
  if (!issues || issues.length === 0) {
    return `<p class="muted-text">${escapeHtml(emptyMessage)}</p>`;
  }

  const items = issues
    .map(
      (issue) => `
        <li class="issue-list-item ${className}">
          <strong>${escapeHtml(issue.code)}</strong>
          <div>${escapeHtml(issue.message)}</div>
          <div class="issue-path">${escapeHtml(issue.path)}</div>
        </li>
      `,
    )
    .join('');

  return `<ul class="issue-list compact-issue-list">${items}</ul>`;
}

export function renderValidationPanel(validation, options = {}) {
  const eyebrow = escapeHtml(options.eyebrow ?? 'Validation');
  const title = escapeHtml(options.title ?? 'Validation results');
  if (validation === null || validation === undefined) {
    return `
      <section class="card validation-panel-card" role="status" aria-live="polite">
        <div class="validation-panel-summary">
          <div>
            <p class="eyebrow">${eyebrow}</p>
            <h2>${title}</h2>
          </div>
          <div class="validation-panel-pills">
            <span class="section-count-pill">Not validated yet</span>
          </div>
        </div>
        <div class="validation-panel-content">
          <p class="muted-text">Run validation to check the current project.</p>
        </div>
      </section>
    `;
  }

  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const hasComputedSolution = Boolean(options.hasComputedSolution);
  const expanded = options.expanded ?? hasComputedSolution;

  return `
    <section class="card validation-panel-card" role="${errors.length > 0 ? 'alert' : 'status'}" aria-live="polite">
      <details class="validation-panel-details" ${expanded ? 'open' : ''}>
        <summary class="validation-panel-summary">
          <div>
            <p class="eyebrow">${eyebrow}</p>
            <h2>${title}</h2>
          </div>
          <div class="validation-panel-pills">
            <span class="section-count-pill validation-pill-error">${errors.length} error${errors.length === 1 ? '' : 's'}</span>
            <span class="section-count-pill validation-pill-warning">${warnings.length} warning${warnings.length === 1 ? '' : 's'}</span>
          </div>
        </summary>
        <div class="validation-panel-content">
          <div class="validation-panel-grid">
            <section>
              <h3>Errors</h3>
              ${renderIssueList(errors, 'No validation errors.', 'error')}
            </section>
            <section>
              <h3>Warnings</h3>
              ${renderIssueList(warnings, 'No validation warnings.', 'warning')}
            </section>
          </div>
        </div>
      </details>
    </section>
  `;
}
