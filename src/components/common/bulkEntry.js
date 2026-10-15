export function parseBulkLabels(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(/\r?\n|,/)
    .map((label) => label.trim())
    .filter((label) => {
      const key = label.toLocaleLowerCase();
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
