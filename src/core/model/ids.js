export function createId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
