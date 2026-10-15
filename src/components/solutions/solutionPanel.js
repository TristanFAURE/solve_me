import { renderContainerAssignmentView } from './containerAssignmentView.js';
import { renderSolutionNavigation } from './solutionNavigation.js';
import { renderJsonBlock } from '../common/jsonBlock.js';
import { assignmentDistance } from '../../solver/solutionRanking.js';

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

export function renderSearchHints(result, vocabulary = {}) {
  const hints = result?.searchHints ?? [];
  if (hints.length === 0) return '';
  return `<section class="search-hints top-gap"><h3>Ways to narrow the search</h3><ul>${hints.map((hint) => {
    const wording = vocabulary[hint.code];
    const title = typeof wording === 'string' ? wording : (wording?.title ?? hint.title);
    const description = wording?.description ?? hint.description;
    return `<li><strong>${escapeHtml(title)}</strong>: ${escapeHtml(description)}</li>`;
  }).join('')}</ul></section>`;
}

export function renderSolutionPanel(project, result, activeSolutionIndex = 0, options = {}) {
  const panelTitle = options.panelTitle ?? 'Solve result';
  const panelEyebrow = options.panelEyebrow ?? 'Solver output';
  const emptyResultMessage = options.emptyResultMessage ?? 'Run solve after validation to see adapter output.';
  const unsatMessage = options.unsatMessage ?? 'The solver completed but found no valid assignment satisfying the current hard constraints.';
  const noWarningsMessage = options.noWarningsMessage ?? 'No solver warnings.';
  const rawJsonSummaryLabel = options.rawJsonSummaryLabel ?? 'View raw solver result JSON';

  if (!result) {
    return renderAuditSection(panelTitle, panelEyebrow, `<p class="muted-text">${escapeHtml(emptyResultMessage)}</p>`);
  }

  const solutionCount = result.solutions?.length ?? 0;
  const clampedSolutionIndex = solutionCount === 0
    ? 0
    : Math.min(Math.max(activeSolutionIndex, 0), solutionCount - 1);

  const canShowReturnedSolution = Boolean(project)
    && ['solved', 'partial', 'timeout', 'cancelled'].includes(result.status)
    && solutionCount > 0;
  const solutionNavigation = canShowReturnedSolution
    ? renderSolutionNavigation(clampedSolutionIndex, solutionCount)
    : '';
  const statusLabels = {
    solved: 'Solved',
    unsat: 'Unsatisfiable',
    timeout: 'Timed out',
    partial: 'Partial result',
    cancelled: 'Cancelled',
    error: 'Solver error',
  };
  const statusMessages = {
    solved: solutionCount > 0 ? '' : 'The solver reported success but did not return a solution.',
    unsat: unsatMessage,
    timeout: solutionCount > 0
      ? 'The solver reached its time limit. The returned solution is usable, but the search did not finish.'
      : 'The solver reached its time limit before returning a solution. Review the model or try again.',
    partial: solutionCount > 0
      ? 'The solver stopped early. The returned solution is usable, but the result set is incomplete.'
      : 'The solver stopped early without returning a solution. Review the solver warnings and try again.',
    cancelled: solutionCount > 0
      ? 'The solve was cancelled. The latest available solution is shown, but search did not finish.'
      : 'The solve was cancelled before a solution was available.',
    error: 'The solver could not process this model. Review the solver warnings, fix the model, and try again.',
  };
  const statusMessage = statusMessages[result.status]
    ?? `The solver returned an unrecognized status: ${result.status}. Review the raw result and solver warnings.`;
  const solutionSummary = `
    ${statusMessage ? `<p class="result-status-banner">${escapeHtml(statusMessage)}</p>` : '<p class="result-status-banner">A usable result is available. Review assignments and score details below.</p>'}
    ${canShowReturnedSolution ? `${solutionNavigation}${renderContainerAssignmentView(project, result.solutions[clampedSolutionIndex], clampedSolutionIndex, solutionCount, options)}` : ''}
  `;

  const warnings = result.warnings ?? [];
  const activeSolution = canShowReturnedSolution ? result.solutions[clampedSolutionIndex] : null;
  const comparisonSolution = canShowReturnedSolution && solutionCount > 1
    ? result.solutions[clampedSolutionIndex === 0 ? 1 : clampedSolutionIndex - 1]
    : null;
  const changedAssignments = comparisonSolution
    ? assignmentDistance(activeSolution, comparisonSolution)
    : 0;
  const occupancy = (solution) => (solution?.assignments ?? []).reduce((counts, assignment) => {
    const containerId = assignment.containerRef?.id;
    if (containerId) counts.set(containerId, (counts.get(containerId) ?? 0) + 1);
    return counts;
  }, new Map());
  const activeOccupancy = occupancy(activeSolution);
  const comparisonOccupancy = occupancy(comparisonSolution);
  const changedOccupancies = comparisonSolution
    ? new Set([...activeOccupancy.keys(), ...comparisonOccupancy.keys()])
      .size - [...new Set([...activeOccupancy.keys(), ...comparisonOccupancy.keys()])]
        .filter((containerId) => activeOccupancy.get(containerId) === comparisonOccupancy.get(containerId)).length
    : 0;
  const diversity = activeSolution?.diversity
    ? `Distance ${activeSolution.diversity.minimumAssignmentDistance}; nearest ${activeSolution.diversity.nearestSelectedDistance ?? 'n/a'}`
    : 'Not applied';
  const content = `
    <div role="${['error', 'timeout'].includes(result.status) ? 'alert' : 'status'}" aria-live="polite">
    <dl class="summary-grid audit-summary-grid">
      <div><dt>Status</dt><dd>${escapeHtml(statusLabels[result.status] ?? result.status)}</dd></div>
      <div><dt>Solutions</dt><dd>${solutionCount}</dd></div>
      <div><dt>Warnings</dt><dd>${warnings.length}</dd></div>
      <div><dt>Runtime</dt><dd>${result.runtimeMs} ms</dd></div>
      <div><dt>Completeness</dt><dd>${result.searchComplete ? 'Complete' : 'Incomplete'}</dd></div>
      <div><dt>Truncation</dt><dd>${result.truncatedByLimit ? 'Limited' : 'Not truncated'}</dd></div>
      <div><dt>Optimality</dt><dd>${result.optimalityProven ? 'Proven' : 'Not proven'}</dd></div>
      <div><dt>Engine</dt><dd>${escapeHtml(result.solverEngine ?? 'Not reported')}</dd></div>
      <div><dt>Selection</dt><dd>${result.solutionSelection === 'canonical' ? 'Canonical ranking proven' : result.solutionSelection === 'equity-first' ? 'Equity first' : 'Best found'}</dd></div>
      <div><dt>Diversity</dt><dd>${escapeHtml(diversity)}</dd></div>
      <div><dt>Assignment differences</dt><dd>${comparisonSolution ? `${changedAssignments} vs ${clampedSolutionIndex === 0 ? 'next' : 'previous'} plan` : 'No alternative'}</dd></div>
      <div><dt>Occupancy differences</dt><dd>${comparisonSolution ? `${changedOccupancies} container(s)` : 'No alternative'}</dd></div>
    </dl>
    ${warnings.length > 0 ? `<ul class="issue-list compact-issue-list top-gap">${warnings.map((warning) => `<li class="issue-list-item warning"><div>${escapeHtml(warning)}</div></li>`).join('')}</ul>` : `<p class="muted-text">${escapeHtml(noWarningsMessage)}</p>`}
    ${renderSearchHints(result, options.searchHintVocabulary)}
    ${solutionSummary}
    ${activeSolution?.scoreDetails ? `<details class="details-panel top-gap"><summary>Score details</summary>${renderJsonBlock(activeSolution.scoreDetails, 'score details JSON')}</details>` : ''}
    </div>
    <details class="details-panel advanced-diagnostics">
      <summary>Advanced diagnostics: ${escapeHtml(rawJsonSummaryLabel)}</summary>
      ${renderJsonBlock(result, 'solver result JSON')}
    </details>
  `;

  return renderAuditSection(panelTitle, panelEyebrow, content);
}
