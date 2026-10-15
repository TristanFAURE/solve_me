export const DRAFT_STORE_VERSION = 1;
export const LEGACY_GENERIC_DRAFT_KEY = 'constraint-management:draft';

const DRAFT_KEY_PREFIX = 'constraint-management:draft:v1:';
const autosaveBindings = new WeakMap();

export function getDraftStorageKey(pageId) {
  return `${DRAFT_KEY_PREFIX}${pageId}`;
}

export function getBrowserDraftStorage() {
  try {
    return typeof globalThis === 'undefined' ? null : globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readPageDraft(storage, pageId, { legacyKey = null } = {}) {
  if (!storage) {
    return { ok: false, found: false, error: 'Browser storage is unavailable.' };
  }

  try {
    const raw = storage.getItem(getDraftStorageKey(pageId));
    if (raw !== null) {
      const envelope = JSON.parse(raw);
      if (
        !envelope
        || typeof envelope !== 'object'
        || envelope.version !== DRAFT_STORE_VERSION
        || envelope.page !== pageId
        || !Object.hasOwn(envelope, 'data')
      ) {
        return { ok: false, found: true, error: 'The stored draft has an unsupported format.' };
      }

      return { ok: true, found: true, data: envelope.data, source: 'current' };
    }

    if (legacyKey) {
      const legacyRaw = storage.getItem(legacyKey);
      if (legacyRaw !== null) {
        return { ok: true, found: true, data: JSON.parse(legacyRaw), source: 'legacy' };
      }
    }

    return { ok: true, found: false, data: null, source: null };
  } catch (error) {
    return { ok: false, found: true, error: error instanceof Error ? error.message : 'Draft storage could not be read.' };
  }
}

export function writePageDraft(storage, pageId, data) {
  if (!storage) {
    return { ok: false, error: 'Browser storage is unavailable.' };
  }

  try {
    storage.setItem(getDraftStorageKey(pageId), JSON.stringify({
      version: DRAFT_STORE_VERSION,
      page: pageId,
      data,
    }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Draft storage could not be written.' };
  }
}

export function clearPageDraft(storage, pageId) {
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(getDraftStorageKey(pageId));
    return true;
  } catch {
    return false;
  }
}

export function recoverPageDraft({ storage, pageId, fallback, validate, migrate = (value) => value, legacyKey = null }) {
  const readResult = readPageDraft(storage, pageId, { legacyKey });
  const fallbackSnapshot = JSON.stringify(fallback);

  if (!readResult.ok) {
    return {
      data: fallback,
      persistence: createPersistenceState('failed', 'Local draft recovery failed. Current in-memory work remains safe.', fallbackSnapshot),
    };
  }

  if (!readResult.found) {
    return { data: fallback, persistence: createPersistenceState('idle', '', fallbackSnapshot) };
  }

  try {
    const recovered = migrate(readResult.data);
    if (!validate(recovered)) {
      throw new Error('The stored draft is not valid for this page.');
    }

    if (readResult.source === 'legacy' && !writePageDraft(storage, pageId, recovered).ok) {
      return {
        data: recovered,
        persistence: createPersistenceState(
          'failed',
          'Recovered legacy local draft, but saving it in the current format failed. Current in-memory work remains safe.',
          JSON.stringify(recovered),
        ),
      };
    }

    return {
      data: recovered,
      persistence: createPersistenceState(
        'recovered',
        readResult.source === 'legacy' ? 'Recovered legacy local draft.' : 'Recovered local draft.',
        JSON.stringify(recovered),
      ),
    };
  } catch {
    return {
      data: fallback,
      persistence: createPersistenceState('failed', 'Local draft recovery failed. Current in-memory work remains safe.', fallbackSnapshot),
    };
  }
}

export function persistPageDraft(storage, pageId, data, persistence) {
  if (!persistence) {
    return false;
  }

  let snapshot;
  try {
    snapshot = JSON.stringify(data);
  } catch {
    persistence.status = 'failed';
    persistence.message = 'Local draft save failed. Current in-memory work remains safe.';
    return false;
  }

  if (snapshot === persistence.snapshot) {
    return true;
  }

  const writeResult = writePageDraft(storage, pageId, data);
  if (!writeResult.ok) {
    persistence.status = 'failed';
    persistence.message = 'Local draft save failed. Current in-memory work remains safe.';
    return false;
  }

  persistence.snapshot = snapshot;
  persistence.status = 'saved';
  persistence.message = 'Draft saved locally.';
  return true;
}

export function bindPageDraftAutosave(root, storage, pageId, getData, persistence) {
  if (typeof root?.addEventListener !== 'function') {
    return;
  }

  const previousSave = autosaveBindings.get(root);
  if (previousSave && typeof root.removeEventListener === 'function') {
    root.removeEventListener('input', previousSave);
    root.removeEventListener('change', previousSave);
  }

  const save = () => {
    persistPageDraft(storage, pageId, getData(), persistence);
    const statusElement = root.querySelector('.draft-persistence-status');
    if (!statusElement) {
      return;
    }

    statusElement.hidden = !persistence.message || persistence.status === 'idle';
    statusElement.textContent = persistence.message;
    statusElement.classList.toggle('command-bar-feedback-error', persistence.status === 'failed');
  };

  root.addEventListener('input', save);
  root.addEventListener('change', save);
  autosaveBindings.set(root, save);
}

function createPersistenceState(status, message, snapshot) {
  const persistence = { status, message };
  Object.defineProperty(persistence, 'snapshot', { value: snapshot, writable: true });
  return persistence;
}

// Kept for the Generic page's explicit save/load controls.
export function saveDraft(project, storage = getBrowserDraftStorage()) {
  const result = writePageDraft(storage, 'generic', project);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

export function loadDraft(storage = getBrowserDraftStorage()) {
  const result = readPageDraft(storage, 'generic', { legacyKey: LEGACY_GENERIC_DRAFT_KEY });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function clearDraft(storage = getBrowserDraftStorage()) {
  return clearPageDraft(storage, 'generic');
}
