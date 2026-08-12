const STORAGE_KEY = 'constraint-management:draft';

export function saveDraft(project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function loadDraft() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
}
