function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderSolveStatus(execution, cancelAttribute = 'data-action="cancel-solve"') {
  if (!execution || execution.status === 'idle') return '';
  const progress = execution.progress;
  if (execution.status !== 'solving') return '';

  return `
    <section class="solve-status" role="status" aria-live="polite">
      <div><strong>Solving...</strong><span>${progress ? ` Explored ${escapeHtml(progress.exploredNodes)} nodes, pruned ${escapeHtml(progress.prunedNodes)}, found ${escapeHtml(progress.solutionCount)} solution(s).` : ' Starting solver Worker.'}</span></div>
      <button type="button" class="command-bar-button command-bar-button-danger" ${cancelAttribute}>Cancel solve</button>
    </section>
  `;
}
