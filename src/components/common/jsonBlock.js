function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderJsonBlock(value, label = 'JSON') {
  return `<div class="json-block-wrap"><button type="button" class="json-copy-button" data-copy-json aria-label="Copy ${escapeHtml(label)}">Copy</button><pre class="json-block">${escapeHtml(JSON.stringify(value, null, 2))}</pre></div>`;
}

export function bindJsonCopyButtons(root) {
  root.querySelectorAll?.('[data-copy-json]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.parentElement?.querySelector('.json-block')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy failed';
      }
    });
  });
}
