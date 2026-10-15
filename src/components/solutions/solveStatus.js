function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function getSolveStatusView(execution) {
  const progress = execution.progress;
  const elapsedMs = Math.max(0, Math.round(execution.elapsedMs ?? progress?.elapsedMs ?? 0));
  const timeLimitMs = Number.isFinite(execution.timeLimitMs) && execution.timeLimitMs > 0
    ? execution.timeLimitMs
    : null;
  const phaseLabels = {
    'starting-worker': 'Starting solver Worker',
    'loading-wasm': 'Loading WASM optimization engine',
    'building-model': 'Building optimization model',
    'preparing-incumbent': 'Preparing a feasible schedule',
    optimizing: 'Optimizing schedule',
    searching: 'Searching assignments',
  };
  const phase = phaseLabels[progress?.phase] ?? 'Starting solver Worker';
  const budgetLabel = timeLimitMs === null
    ? `${elapsedMs} ms reported elapsed time`
    : elapsedMs > 0
      ? `${timeLimitMs} ms time budget; latest Worker update at ${elapsedMs} ms`
      : `${timeLimitMs} ms time budget; waiting for the first Worker update`;
  const detail = progress && Number.isFinite(progress.exploredNodes)
    ? `Explored ${progress.exploredNodes} nodes, pruned ${progress.prunedNodes ?? 0}, found ${progress.solutionCount ?? 0} solution(s).`
    : '';
  return { phase, detail, budgetLabel };
}

export function renderSolveStatus(execution, cancelAttribute = 'data-action="cancel-solve"') {
  if (!execution || execution.status !== 'solving') return '';
  const { phase, detail, budgetLabel } = getSolveStatusView(execution);

  return `
    <section class="solve-status" role="status" aria-live="polite">
      <div class="solve-status-details">
        <strong data-solve-phase>${escapeHtml(phase)}...</strong>
        <span data-solve-detail>${escapeHtml(detail)}</span>
        <progress aria-label="Solver is working"></progress>
        <small data-solve-budget>${escapeHtml(budgetLabel)}</small>
      </div>
      <button type="button" class="command-bar-button command-bar-button-danger" ${cancelAttribute}>Cancel solve</button>
    </section>
  `;
}

export function updateSolveStatus(root, execution) {
  if (!root || execution?.status !== 'solving') return false;
  const { phase, detail, budgetLabel } = getSolveStatusView(execution);
  const panels = root.querySelectorAll?.('.solve-status') ?? [];
  panels.forEach((panel) => {
    const phaseNode = panel.querySelector('[data-solve-phase]');
    const detailNode = panel.querySelector('[data-solve-detail]');
    const budgetNode = panel.querySelector('[data-solve-budget]');
    if (phaseNode) phaseNode.textContent = `${phase}...`;
    if (detailNode) detailNode.textContent = detail;
    if (budgetNode) budgetNode.textContent = budgetLabel;
  });
  return panels.length > 0;
}
