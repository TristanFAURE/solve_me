import { describe, expect, it, vi } from 'vitest';
import {
  applyCollaborationConfiguration,
  collaborationConfiguration,
  closeCollaborationManifest,
  createCollaborationManifest,
  reopenCollaborationManifest,
} from '../../src/pages/eventStaffing/collaboration/collaborationManifest.js';
import {
  collaborationResponsePath,
  createCollaborationResponse,
} from '../../src/pages/eventStaffing/collaboration/responseModel.js';
import {
  applyCollaborationResponses,
  previewCollaborationResponses,
} from '../../src/pages/eventStaffing/collaboration/responseMerge.js';
import {
  CollaborationConflictError,
  createSessionRepository,
} from '../../src/pages/eventStaffing/collaboration/sessionRepository.js';

const project = () => ({
  title: 'Autumn Gala',
  events: [
    { id: 'S1', dateKey: '2026-10-15' },
    { id: 'S2', date: '2026-10-16' },
    { id: 'S3', dateKey: '2026-10-15' },
  ],
  groupTypes: [{ id: 'welcome', label: 'Welcome' }, { id: 'food', label: 'Food' }],
  people: [],
  preferences: [],
});

function response(overrides = {}) {
  return createCollaborationResponse({
    firstName: 'Alex', lastName: 'Smith', displayName: 'Alex Smith', email: 'Alex@Example.org', pin: '0042',
    dayPreferences: { '2026-10-15': 'prefer' },
    dayGroupPreferences: { '2026-10-16': { welcome: 'unavailable' } },
    sessionId: '0123456789abcdef',
    manifestRevision: 1,
    ...overrides,
  }, { savedAt: '2026-10-15T10:00:00.000Z' });
}

describe('collaboration data modules', () => {
  it('creates immutable-folder v1 manifests with real dates and every group', () => {
    const manifest = createCollaborationManifest(project(), { random: '0123456789abcdef9999', now: '2026-10-15T09:00:00.000Z' });
    expect(manifest).toMatchObject({ version: 1, folder: 'autumn-gala--0123456789abcdef', revision: 1, status: 'open' });
    expect(manifest.dateKeys).toEqual(['2026-10-15', '2026-10-16']);
    expect(manifest.groups).toEqual([{ id: 'welcome', label: 'Welcome' }, { id: 'food', label: 'Food' }]);
    expect(manifest.configuration).toMatchObject({
      title: 'Autumn Gala',
      events: project().events,
      groupTypes: project().groupTypes,
      requirements: [],
      cooldownRules: [],
      globalLimits: {},
    });
    expect(manifest.configuration).not.toHaveProperty('people');
    expect(manifest.configuration).not.toHaveProperty('preferences');
    expect(reopenCollaborationManifest(closeCollaborationManifest(manifest, '2026-10-15T11:00:00.000Z'), '2026-10-15T12:00:00.000Z'))
      .toMatchObject({ folder: manifest.folder, sessionId: manifest.sessionId, revision: 3, status: 'open' });
  });

  it('restores administrator configuration while preserving people and relevant preferences', () => {
    const source = project();
    source.requirements = [{ eventId: 'S1', groupTypeId: 'welcome', min: 1, max: 2 }];
    source.cooldownRules = [{ triggerGroupTypes: 'ANY', blockedGroupTypes: 'ANY', blockedNextEventCount: 1 }];
    source.globalLimits = { maxAssignmentsPerPerson: 2 };
    const manifest = createCollaborationManifest(source, { random: '0123456789abcdef', now: '2026-10-15T09:00:00.000Z' });
    const target = {
      title: 'Old', events: [{ id: 'old', dateKey: 'old' }], groupTypes: [{ id: 'old-group', label: 'Old' }], requirements: [], cooldownRules: [], globalLimits: {},
      people: [{ id: 'p1', name: 'Person', email: 'p@example.org' }],
      preferences: [{ personId: 'p1', slotPreferences: { old: 'prefer', S1: 'preferNot' }, dayPreferences: { old: 'prefer', '2026-10-15': 'neutral' }, dayGroupPreferences: { '2026-10-15': { welcome: 'prefer', missing: 'prefer' } } }],
      forcedAssignments: [{ personId: 'p1', eventId: 'old', groupTypeId: 'old-group' }], forbiddenAssignments: [],
    };
    applyCollaborationConfiguration(target, manifest);
    expect(target).toMatchObject({
      title: 'Autumn Gala', events: source.events, groupTypes: source.groupTypes, requirements: source.requirements,
      cooldownRules: source.cooldownRules, globalLimits: source.globalLimits, people: [{ id: 'p1', name: 'Person', email: 'p@example.org' }],
      forcedAssignments: [], forbiddenAssignments: [],
    });
    expect(target.preferences[0].slotPreferences).toEqual({ S1: 'preferNot' });
    expect(target.preferences[0].dayPreferences).toEqual({ '2026-10-15': 'neutral' });
    expect(target.preferences[0].dayGroupPreferences).toEqual({ '2026-10-15': { welcome: 'prefer' } });
    expect(collaborationConfiguration(source)).not.toHaveProperty('people');
  });

  it('models identity precisely and hashes normalized email into the encrypted path', async () => {
    expect(response()).toMatchObject({ version: 1, email: 'alex@example.org', pin: '0042' });
    expect(() => response({ pin: '42' })).toThrow(/4 digits/);
    const hash = vi.fn(async () => 'digest');
    await expect(collaborationResponsePath('folder', 'session', ' ALEX@EXAMPLE.ORG ', hash))
      .resolves.toBe('.event-staffing-collab/folder/responses/digest/response.enc.json');
    expect(hash).toHaveBeenCalledWith('session:alex@example.org');
  });

  it('previews without mutation, blocks duplicates, and atomically merges session values', () => {
    const current = project();
    current.people = [{ id: 'P1', name: 'Old Name', email: 'alex@example.org', retained: true }, { id: 'P2', name: 'Unmatched', email: 'u@example.org' }];
    current.preferences = [{
      personId: 'P1', slotPreferences: { S1: 'preferNot' },
      dayPreferences: { old: 'prefer', '2026-10-15': 'unavailable' },
      dayGroupPreferences: { old: { food: 'prefer' }, '2026-10-16': { food: 'prefer' } },
    }];
    const original = structuredClone(current);
    const manifest = createCollaborationManifest(project(), { random: '0123456789abcdef', now: '2026-10-15T09:00:00.000Z' });
    const preview = previewCollaborationResponses(current, manifest, [response(), response({ email: 'new@example.org', firstName: 'New', lastName: 'Person', displayName: 'New Person', dayPreferences: {} })]);
    expect(current).toEqual(original);
    expect(preview.report).toMatchObject({ new: 1, matched: 1, renamed: 1, changed: 2, stale: 0, errors: [] });
    applyCollaborationResponses(current, preview);
    expect(current.people.find(({ id }) => id === 'P1')).toMatchObject({ name: 'Alex Smith', retained: true });
    expect(current.people.find(({ id }) => id === 'P2')).toBeTruthy();
    expect(current.preferences.find(({ personId }) => personId === 'P1')).toMatchObject({
      slotPreferences: { S1: 'preferNot' }, dayPreferences: { old: 'prefer', '2026-10-15': 'prefer' },
      dayGroupPreferences: { old: { food: 'prefer' }, '2026-10-16': { welcome: 'unavailable' } },
    });
    const duplicate = previewCollaborationResponses(project(), manifest, [response(), response({ email: 'ALEX@example.org' })]);
    expect(duplicate.canApply).toBe(false);
    expect(() => applyCollaborationResponses(project(), duplicate)).toThrow(/blocking errors/);
  });

  it('blocks stale revisions and unknown manifest mappings', () => {
    const manifest = createCollaborationManifest(project(), { random: '0123456789abcdef', now: '2026-10-15T09:00:00.000Z' });
    const stale = previewCollaborationResponses(project(), manifest, [response({ manifestRevision: 2 })]);
    expect(stale.canApply).toBe(false);
    expect(stale.report.stale).toBe(1);
    const unknown = previewCollaborationResponses(project(), manifest, [response({ dayGroupPreferences: { '2026-10-15': { missing: 'prefer' } } })]);
    expect(unknown.canApply).toBe(false);
    expect(unknown.report.errors.join(' ')).toMatch(/unknown session dates or groups/);
  });

  it('uses injected repository services, verifies login, discovers by slug, and maps 409 conflicts', async () => {
    const files = new Map();
    const githubClient = {
      createContent: vi.fn(async ({ path, content }) => {
        if (files.has(path)) throw Object.assign(new Error('sha was not supplied'), { status: 422 });
        files.set(path, { content: btoa(content), sha: 'sha-1' });
      }),
      updateContent: vi.fn(async ({ path, content, sha }) => {
        if (sha === 'stale') throw Object.assign(new Error('conflict'), { status: 409 });
        files.set(path, { content: btoa(content), sha: 'sha-1' });
      }),
      getContent: vi.fn(async ({ path }) => files.get(path)),
      listContents: vi.fn(async () => [{ name: 'autumn-gala--0123456789abcdef' }, { name: 'other--ignored' }]),
      deleteContent: vi.fn(async () => {}),
    };
    const cryptoEnvelope = {
      encryptEnvelope: vi.fn(async (value) => value),
      decryptEnvelope: vi.fn(async (value) => value),
    };
    const repository = createSessionRepository({
      githubClient, cryptoEnvelope, repository: { owner: 'owner', repo: 'repo', branch: 'main' }, manifestPassword: 'manifest password',
      randomUUID: () => '0123456789abcdef', sha256: async () => 'digest', now: () => '2026-10-15T10:00:00.000Z',
    });
    const manifest = await repository.createSession(project());
    expect(await repository.discoverSessions('autumn-gala')).toMatchObject([{ folder: manifest.folder, title: 'Autumn Gala' }]);
    await repository.saveResponse(manifest, response());
    await expect(repository.saveResponse(manifest, response())).rejects.toBeInstanceOf(CollaborationConflictError);
    await expect(repository.loadResponse(manifest, 'alex@example.org', '0042')).resolves.toMatchObject({ response: { email: 'alex@example.org' }, sha: 'sha-1' });
    await expect(repository.loadResponse(manifest, 'alex@example.org', '9999')).rejects.toThrow(/does not match/);
    await expect(repository.saveResponse(manifest, response(), 'stale')).rejects.toBeInstanceOf(CollaborationConflictError);
    await repository.deleteResponse(manifest, 'alex@example.org', 'sha-1');
    expect(githubClient.deleteContent).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('/responses/digest/response.enc.json'), sha: 'sha-1' }));
  });

  it('retries a transient branch conflict for a new response path but not an existing response', async () => {
    let responseCreateAttempts = 0;
    const files = new Map();
    const githubClient = {
      createContent: vi.fn(async ({ path, content }) => {
        if (path.includes('/responses/')) {
          responseCreateAttempts += 1;
          if (files.has(path)) throw Object.assign(new Error('sha missing'), { status: 422 });
          if (responseCreateAttempts === 1) throw Object.assign(new Error('branch moved'), { status: 409 });
        }
        files.set(path, { content: btoa(content), sha: 'sha-1' });
      }),
      updateContent: vi.fn(),
      getContent: vi.fn(async ({ path }) => {
        if (!files.has(path)) throw Object.assign(new Error('not found'), { status: 404 });
        return files.get(path);
      }),
      listContents: vi.fn(async () => []),
      deleteContent: vi.fn(),
    };
    const cryptoEnvelope = { encryptEnvelope: vi.fn(async (value) => value), decryptEnvelope: vi.fn(async (value) => value) };
    const repository = createSessionRepository({
      githubClient, cryptoEnvelope, repository: { owner: 'owner', repo: 'repo', branch: 'main' }, manifestPassword: 'manifest password',
      randomUUID: () => '0123456789abcdef', sha256: async () => 'different-user', now: () => '2026-10-15T10:00:00.000Z',
    });
    const manifest = await repository.createSession(project());
    await expect(repository.saveResponse(manifest, response())).resolves.toMatchObject({ email: 'alex@example.org' });
    expect(responseCreateAttempts).toBe(2);
    await expect(repository.saveResponse(manifest, response())).rejects.toBeInstanceOf(CollaborationConflictError);
  });
});
