function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderSolveStatus(execution, cancelAttribute = 'data-action="cancel-solve"') {
  if (!execution || execution.status === 'idle') return '';
  const progress = execution.progress;
  if (execution.status !== 'solving') return '';
  const elapsedMs = Math.max(0, Math.round(execution.elapsedMs ?? progress?.elapsedMs ?? 0));
  const timeLimitMs = Number.isFinite(execution.timeLimitMs) && execution.timeLimitMs > 0
    ? execution.timeLimitMs
    : null;
  const phaseLabels = {
    'loading-wasm': 'Loading WASM optimization engine',
    'building-model': 'Building optimization model',
    'preparing-incumbent': 'Preparing a feasible schedule',
    optimizing: 'Optimizing schedule',
    searching: 'Searching assignments',
  };
  const phase = phaseLabels[progress?.phase] ?? 'Starting solver Worker';
  const budgetLabel = timeLimitMs === null
    ? `${elapsedMs} ms elapsed`
    : `${elapsedMs} of ${timeLimitMs} ms time budget used`;

  return `
    <section class="solve-status" role="status" aria-live="polite">
      <div class="solve-status-details">
        <strong>${escapeHtml(phase)}...</strong>
        <span>${progress && Number.isFinite(progress.exploredNodes) ? ` Explored ${escapeHtml(progress.exploredNodes)} nodes, pruned ${escapeHtml(progress.prunedNodes ?? 0)}, found ${escapeHtml(progress.solutionCount ?? 0)} solution(s).` : ''}</span>
        <progress aria-label="Solve time budget"${timeLimitMs === null ? '' : ` max="${timeLimitMs}" value="${Math.min(elapsedMs, timeLimitMs)}"`}></progress>
        <small>${escapeHtml(budgetLabel)}</small>
      </div>
      <button type="button" class="command-bar-button command-bar-button-danger" ${cancelAttribute}>Cancel solve</button>
    </section>
  `;
}
