import { SOLVE_MODES } from '../../solver/solveOptions.js';
import { renderFieldLabel } from './fieldHelp.js';
import { renderJsonBlock } from './jsonBlock.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createWorkflowSolveDraft() {
  return {
    solveMode: SOLVE_MODES.TOP_K,
    solveMaxSolutions: '10',
    solveTimeLimitMs: '5000',
    solveIncludeScoreDetails: true,
  };
}

export function buildWorkflowSolveOptions(editor) {
  return {
    mode: editor.solveMode,
    maxSolutions: editor.solveMode === SOLVE_MODES.FIRST ? 1 : Number(editor.solveMaxSolutions),
    timeLimitMs: Number(editor.solveTimeLimitMs),
    includeScoreDetails: Boolean(editor.solveIncludeScoreDetails),
  };
}

export function solveOptionIssues(errors) {
  return errors.map((message, index) => ({
    level: 'error',
    code: 'invalid-solve-option',
    message,
    path: `solveOptions[${index}]`,
  }));
}

export function renderSolveConfiguration(editor, prefix) {
  return `
    <section class="card">
      <h2>Solve configuration</h2>
      <p class="muted-text">Solving runs in the shared Worker and never blocks the browser thread.</p>
      <div class="form-grid four-columns compact-form-grid">
        <label>${renderFieldLabel('Mode', 'First solution stops after one valid plan. Multiple solutions returns alternatives. Optimize spends the available time searching for the highest-scoring plan.')}<select name="solveMode">
          <option value="${SOLVE_MODES.FIRST}"${editor.solveMode === SOLVE_MODES.FIRST ? ' selected' : ''}>First solution</option>
          <option value="${SOLVE_MODES.TOP_K}"${editor.solveMode === SOLVE_MODES.TOP_K ? ' selected' : ''}>Multiple solutions</option>
          <option value="${SOLVE_MODES.OPTIMIZE}"${editor.solveMode === SOLVE_MODES.OPTIMIZE ? ' selected' : ''}>Optimize</option>
        </select></label>
        <label>${renderFieldLabel('Maximum solutions', 'The maximum number of distinct plans to return. For example, 1 returns one plan quickly; 20 requests more alternatives and can take longer. First solution mode always returns at most one.')}<input type="number" min="1" max="1000" name="solveMaxSolutions" value="${escapeHtml(editor.solveMaxSolutions)}"${editor.solveMode === SOLVE_MODES.FIRST ? ' disabled' : ''} /></label>
        <label>${renderFieldLabel('Time limit (ms)', 'Maximum solver search time. For example, 1000 gives a fast one-second search that may be partial; 30000 allows up to 30 seconds to improve or prove the result.')}<input type="number" min="1" name="solveTimeLimitMs" value="${escapeHtml(editor.solveTimeLimitMs)}" /></label>
        <label class="checkbox-chip"><input type="checkbox" name="solveIncludeScoreDetails"${editor.solveIncludeScoreDetails ? ' checked' : ''} />${renderFieldLabel('Include score details', 'Include the preference, target, and equity contribution breakdown in each returned solution.')}</label>
      </div>
      <div class="button-row top-gap">
        <button type="button" data-action="validate-${prefix}">Validate and review</button>
        <button type="button" data-action="solve-${prefix}">Solve in Worker</button>
      </div>
    </section>`;
}

export function renderWorkbookSetup(importState, prefix, domainLabel) {
  const preview = importState?.preview;
  return `
    <section class="card">
      <h2>Configuration workbook</h2>
      <p class="muted-text">Export the editable configuration, or preview a full configuration or legacy workbook before replacing this draft.</p>
      <div class="button-row">
        <button type="button" data-action="export-${prefix}-configuration">Export configuration workbook</button>
        <label class="command-bar-button command-bar-file-button">Preview workbook<input type="file" data-action="import-${prefix}-workbook" accept=".xlsx,.xls" hidden /></label>
      </div>
      ${importState?.status === 'busy' ? '<p role="status">Reading workbook...</p>' : ''}
      ${importState?.error ? `<p role="alert" class="command-bar-feedback command-bar-feedback-error">${escapeHtml(importState.error)}</p>` : ''}
      ${preview ? `
        <div class="result-status-banner" role="status">
          <strong>${escapeHtml(preview.fileName)}</strong> is a ${preview.source === 'configuration' ? 'complete configuration' : 'legacy'} workbook.
          Confirming replaces the current ${escapeHtml(domainLabel)} data and clears validation and solved results.
        </div>
        <div class="button-row">
          <button type="button" data-action="confirm-${prefix}-workbook">Confirm replacement</button>
          <button type="button" data-action="cancel-${prefix}-workbook">Cancel import</button>
        </div>` : ''}
    </section>`;
}

export function renderAdvancedDiagnostics(project, normalizedProject) {
  return `
    <details class="details-panel advanced-diagnostics">
      <summary>Advanced diagnostics</summary>
      <h3>Raw project JSON</h3>
      ${renderJsonBlock(project, 'raw project JSON')}
      ${normalizedProject ? `<h3>Normalized solver JSON</h3>${renderJsonBlock(normalizedProject, 'normalized solver JSON')}` : '<p class="muted-text">Validate the project to generate normalized solver JSON.</p>'}
    </details>`;
}
