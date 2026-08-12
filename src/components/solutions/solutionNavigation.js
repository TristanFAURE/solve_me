function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderSolutionNavigation(currentIndex, totalSolutions) {
  if (totalSolutions <= 1) {
    return '';
  }

  return `
    <div class="solution-navigation top-gap">
      <button type="button" data-action="previous-solution" ${currentIndex === 0 ? 'disabled' : ''}>Previous</button>
      <span class="solution-navigation-label">Viewing solution ${currentIndex + 1} of ${totalSolutions}</span>
      <button type="button" data-action="next-solution" ${currentIndex >= totalSolutions - 1 ? 'disabled' : ''}>Next</button>
    </div>
  `;
}
