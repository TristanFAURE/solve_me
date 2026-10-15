const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SENSITIVE_KEYS = new Set(['password', 'secret', 'token', 'apikey', 'accesskey', 'privatekey', 'clientsecret', 'credentials', 'authorization', 'databaseurl', 'connectionstring']);

function normalizedKey(value) {
  return String(value).replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
}

function inspectJson(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new Error('JSON configuration exceeds the maximum nesting depth.');
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, child]) => {
    if (DANGEROUS_KEYS.has(key)) throw new Error(`JSON configuration contains the forbidden key "${key}".`);
    if (SENSITIVE_KEYS.has(normalizedKey(key))) throw new Error(`JSON configuration contains the sensitive field "${key}", which must not be imported.`);
    inspectJson(child, depth + 1);
  });
}

export function renderJsonConfigurationSetup({ prefix, domainLabel, exportAction, importAction }) {
  return `<section class="card"><h2>JSON configuration</h2><p class="muted-text">Export the complete ${domainLabel} configuration as readable JSON, or import a previously exported JSON configuration. Import replaces the current draft after validation and confirmation.</p><div class="button-row"><button type="button" data-action="${exportAction ?? `export-${prefix}-json`}">Export JSON configuration</button><label class="command-bar-button command-bar-file-button">Import JSON configuration<input type="file" data-action="${importAction ?? `import-${prefix}-json`}" accept="application/json,.json" hidden /></label></div></section>`;
}

export async function readJsonConfigurationFile(file) {
  if (!file || typeof file.text !== 'function') throw new Error('Select a JSON configuration file.');
  if (file.size > MAX_JSON_BYTES) throw new Error('JSON configuration must not exceed 2 MB.');
  if (file.name && !file.name.toLowerCase().endsWith('.json')) throw new Error('Configuration import requires a .json file.');
  const text = await file.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new Error('JSON configuration must not exceed 2 MB.');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON configuration must contain one project object.');
  inspectJson(value);
  return value;
}

export function downloadJsonConfiguration(project, fallbackName = 'configuration') {
  const safeName = String(project?.title || fallbackName).trim().replaceAll(/[^a-z0-9-_]+/gi, '-').replaceAll(/^-+|-+$/g, '') || fallbackName;
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}-configuration.json`;
  link.click();
  URL.revokeObjectURL(url);
}
