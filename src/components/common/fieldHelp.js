function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderFieldLabel(label, helpText) {
  const safeLabel = escapeHtml(label);
  const safeHelp = escapeHtml(helpText);
  return `<span class="tooltip-label"><span>${safeLabel}</span><span class="field-tooltip" tabindex="0" role="note" aria-label="${safeLabel} help: ${safeHelp}" data-tooltip="${safeHelp}">?</span></span>`;
}
