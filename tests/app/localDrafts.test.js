import { describe, expect, it } from 'vitest';
import { createAppState } from '../../src/app/state.js';
import { createEmptyProject, VIEW_HINTS } from '../../src/core/model/project.js';
import { createMockDomainProject } from '../../src/pages/eventStaffing/mockDomainProject.js';
import {
  DRAFT_STORE_VERSION,
  LEGACY_GENERIC_DRAFT_KEY,
  bindPageDraftAutosave,
  clearPageDraft,
  getDraftStorageKey,
  persistPageDraft,
  readPageDraft,
  writePageDraft,
} from '../../src/storage/localDrafts.js';

class FakeStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
    this.readCount = 0;
    this.writeCount = 0;
    this.failReads = false;
    this.failWrites = false;
  }

  getItem(key) {
    this.readCount += 1;
    if (this.failReads) {
      throw new Error('read blocked');
    }
    return this.entries.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrites) {
      throw new Error('write blocked');
    }
    this.writeCount += 1;
    this.entries.set(key, value);
  }

  removeItem(key) {
    this.entries.delete(key);
  }
}

describe('versioned local draft storage', () => {
  it('keeps page drafts in separate versioned envelopes', () => {
    const storage = new FakeStorage();
    writePageDraft(storage, 'generic', { title: 'Generic' });
    writePageDraft(storage, 'school', { title: 'School' });

    expect(readPageDraft(storage, 'generic')).toMatchObject({ ok: true, data: { title: 'Generic' } });
    expect(readPageDraft(storage, 'school')).toMatchObject({ ok: true, data: { title: 'School' } });
    expect(JSON.parse(storage.getItem(getDraftStorageKey('generic')))).toMatchObject({
      version: DRAFT_STORE_VERSION,
      page: 'generic',
    });
  });

  it('reports malformed JSON without throwing', () => {
    const storage = new FakeStorage({ [getDraftStorageKey('wedding')]: '{broken' });

    expect(readPageDraft(storage, 'wedding')).toMatchObject({ ok: false, found: true });
  });

  it('writes only changed snapshots and retains in-memory data after failure', () => {
    const storage = new FakeStorage();
    const data = { title: 'In memory' };
    const persistence = { status: 'idle', message: '', snapshot: JSON.stringify(data) };

    expect(persistPageDraft(storage, 'generic', data, persistence)).toBe(true);
    expect(storage.writeCount).toBe(0);

    data.title = 'Changed';
    storage.failWrites = true;
    expect(persistPageDraft(storage, 'generic', data, persistence)).toBe(false);
    expect(data.title).toBe('Changed');
    expect(persistence.status).toBe('failed');
    expect(persistence.snapshot).not.toBe(JSON.stringify(data));
  });

  it('replaces delegated autosave listeners when the same root is rebound', () => {
    const listeners = new Map();
    const root = {
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      querySelector: () => null,
      dispatch(type) {
        listeners.get(type)?.forEach((listener) => listener());
      },
    };
    const storage = new FakeStorage();
    const persistence = { status: 'idle', message: '', snapshot: '{}' };
    let staleReads = 0;
    let currentReads = 0;

    bindPageDraftAutosave(root, storage, 'generic', () => {
      staleReads += 1;
      return { revision: 'stale' };
    }, persistence);
    bindPageDraftAutosave(root, storage, 'generic', () => {
      currentReads += 1;
      return { revision: 'current' };
    }, persistence);

    expect(listeners.get('input').size).toBe(1);
    expect(listeners.get('change').size).toBe(1);
    root.dispatch('input');
    root.dispatch('change');
    expect(staleReads).toBe(0);
    expect(currentReads).toBe(2);
    expect(storage.writeCount).toBe(1);
  });

  it('clears only the requested page draft', () => {
    const storage = new FakeStorage();
    writePageDraft(storage, 'generic', { title: 'Generic' });
    writePageDraft(storage, 'school', { title: 'School' });

    expect(clearPageDraft(storage, 'school')).toBe(true);
    expect(readPageDraft(storage, 'school')).toMatchObject({ ok: true, found: false });
    expect(readPageDraft(storage, 'generic')).toMatchObject({ ok: true, found: true });
  });
});

describe('app state draft recovery', () => {
  it('recovers valid source state for all four pages without solver outputs', () => {
    const storage = new FakeStorage();
    const generic = createEmptyProject({ title: 'Recovered generic' });
    const school = createEmptyProject({ title: 'Recovered school', viewHint: VIEW_HINTS.SCHOOL });
    const wedding = createEmptyProject({ title: 'Recovered wedding', viewHint: VIEW_HINTS.WEDDING });
    const staffing = { ...createMockDomainProject(), title: 'Recovered staffing' };
    writePageDraft(storage, 'generic', generic);
    writePageDraft(storage, 'school', school);
    writePageDraft(storage, 'wedding', wedding);
    writePageDraft(storage, 'event-staffing', staffing);

    const state = createAppState({ storage });

    expect(state.genericPage.project.title).toBe('Recovered generic');
    expect(state.schoolPage.project.title).toBe('Recovered school');
    expect(state.weddingPage.project.title).toBe('Recovered wedding');
    expect(state.eventStaffingPage.domainProject.title).toBe('Recovered staffing');
    expect(state.genericPage.persistence.status).toBe('recovered');
    expect(state.eventStaffingPage.persistence.status).toBe('recovered');
    expect(state.genericPage.lastSolverResult).toBeNull();
  });

  it('reads and migrates the legacy Generic key', () => {
    const legacyProject = createEmptyProject({ title: 'Legacy generic' });
    const storage = new FakeStorage({ [LEGACY_GENERIC_DRAFT_KEY]: JSON.stringify(legacyProject) });

    const state = createAppState(storage);

    expect(state.genericPage.project.title).toBe('Legacy generic');
    expect(state.genericPage.persistence.status).toBe('recovered');
    expect(readPageDraft(storage, 'generic')).toMatchObject({ ok: true, found: true });
  });

  it('ignores malformed stored JSON and exposes a recoverable failure', () => {
    const storage = new FakeStorage({ [getDraftStorageKey('generic')]: 'not-json' });

    const state = createAppState({ storage });

    expect(state.genericPage.project.title).toBe('Untitled project');
    expect(state.genericPage.persistence.status).toBe('failed');
    expect(state.genericPage.persistence.message).toContain('in-memory work remains safe');
  });

  it('does not read or expose local drafts when draft persistence is disabled', () => {
    const storage = new FakeStorage();
    writePageDraft(storage, 'event-staffing', { ...createMockDomainProject(), title: 'Local staffing data' });
    const readsBeforeStateCreation = storage.readCount;

    const state = createAppState({ storage, draftsEnabled: false });

    expect(storage.readCount).toBe(readsBeforeStateCreation);
    expect(state.draftStorage).toBeNull();
    expect(state.draftsEnabled).toBe(false);
    expect(state.eventStaffingPage.domainProject.title).toBe('Event staffing planner');
    expect(state.eventStaffingPage.persistence).toMatchObject({ status: 'idle', message: '' });
  });
});
