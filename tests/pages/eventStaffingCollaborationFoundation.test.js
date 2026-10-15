import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CRYPTO_ENVELOPE_PARAMETERS,
  CryptoEnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  sha256OpaqueId,
} from '../../src/pages/eventStaffing/collaboration/cryptoEnvelope.js';
import { detectGitHubRepository } from '../../src/pages/eventStaffing/collaboration/repositoryDetection.js';
import { buildParticipantCollaborationUrl, isCollaborationMode, readCollaborationMode, scrubCollaborationSecrets } from '../../src/pages/eventStaffing/collaboration/collaborationMode.js';
import {
  createGitHubClient,
  GitHubApiError,
  GitHubConflictError,
} from '../../src/pages/eventStaffing/collaboration/githubClient.js';

function cryptoMock() {
  return {
    subtle: webcrypto.subtle,
    getRandomValues: vi.fn((bytes) => webcrypto.getRandomValues(bytes)),
  };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn(async () => body) };
}

describe('collaboration crypto envelope', () => {
  it('round-trips AES-256-GCM using fresh salt and IV with the required PBKDF2 parameters', async () => {
    const crypto = cryptoMock();
    const password = 'correct horse battery staple';
    const first = await encryptEnvelope('private staffing data', password, { crypto });
    const second = await encryptEnvelope('private staffing data', password, { crypto });

    expect(first).not.toBe(second);
    expect(await decryptEnvelope(first, password, { crypto })).toBe('private staffing data');
    expect(crypto.getRandomValues.mock.calls.map(([bytes]) => bytes.length)).toEqual([16, 12, 16, 12]);
    expect(CRYPTO_ENVELOPE_PARAMETERS).toMatchObject({ iterations: 310000, saltBytes: 16, ivBytes: 12 });
  });

  it('rejects short passwords, wrong passwords, and authenticated tampering', async () => {
    const crypto = cryptoMock();
    await expect(encryptEnvelope('secret', 'too short', { crypto })).rejects.toThrow(/12/);
    const envelope = await encryptEnvelope('secret', 'a sufficiently long password', { crypto });
    await expect(decryptEnvelope(envelope, 'another long password', { crypto })).rejects.toBeInstanceOf(CryptoEnvelopeError);

    const parsed = JSON.parse(atob(envelope));
    const ciphertext = Uint8Array.from(atob(parsed.ciphertext), (value) => value.charCodeAt(0));
    ciphertext[0] ^= 1;
    parsed.ciphertext = btoa(String.fromCharCode(...ciphertext));
    const tampered = btoa(JSON.stringify(parsed));
    await expect(decryptEnvelope(tampered, 'a sufficiently long password', { crypto })).rejects.toThrow(/authenticate/);
  });

  it('creates stable URL-safe SHA-256 opaque IDs', async () => {
    const crypto = cryptoMock();
    const first = await sha256OpaqueId('person@example.test', { crypto });
    expect(first).toBe(await sha256OpaqueId('person@example.test', { crypto }));
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('GitHub Pages repository detection', () => {
  it.each([
    ['https://octo.github.io/', { owner: 'octo', repo: 'octo.github.io' }],
    ['https://octo.github.io/staffing/route', { owner: 'octo', repo: 'staffing' }],
  ])('maps %s to its standard repository', (url, expected) => {
    expect(detectGitHubRepository(url)).toEqual(expected);
  });

  it('uses localhost environment values and allows a complete query override', () => {
    expect(detectGitHubRepository('http://localhost:5173/app', { owner: 'local-owner', repo: 'local-repo' }))
      .toEqual({ owner: 'local-owner', repo: 'local-repo' });
    expect(detectGitHubRepository('http://localhost:5173/?owner=query-owner&repo=query-repo', { owner: 'ignored', repo: 'ignored' }))
      .toEqual({ owner: 'query-owner', repo: 'query-repo' });
    expect(detectGitHubRepository('https://example.test/app')).toBeNull();
  });
});

describe('collaboration URL and credential handling', () => {
  it('detects collaboration before application draft recovery', () => {
    expect(isCollaborationMode(new URL('https://example.test/?collab=true#/event-staffing'))).toBe(true);
    expect(isCollaborationMode(new URL('https://example.test/?collab=false#/event-staffing'))).toBe(false);
  });

  it('moves sensitive query credentials into session storage and scrubs the URL', () => {
    const values = new Map();
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const url = new URL('http://localhost:4173/?collab=true&user=true&session=s1&token=pat&password=long-password&owner=owner&repo=repo#/event-staffing');
    const mode = readCollaborationMode(url, storage);
    expect(mode).toMatchObject({ enabled: true, userMode: true, session: 's1', token: 'pat', password: 'long-password', repository: { owner: 'owner', repo: 'repo' } });
    const replaceState = vi.fn();
    scrubCollaborationSecrets(url, { state: null, replaceState });
    expect(replaceState.mock.calls[0][2]).not.toMatch(/token|password/);
  });

  it('builds participant links without duplicating dates or groups', () => {
    const url = buildParticipantCollaborationUrl({
      location: new URL('http://localhost:4173/solve_me/#/event-staffing'), session: 'session--id', token: 'pat', password: 'long-password',
    });
    expect(url).toContain('collab=true');
    expect(url).toContain('user=true');
    expect(url).not.toContain('owner=');
    expect(url).not.toContain('repo=');
    expect(url).not.toContain('groups=');
    expect(url).not.toContain('startDate=');
  });
});

describe('GitHub collaboration client', () => {
  it('uses only fixed API URLs, encodes path components, and gets the default branch', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ default_branch: 'main' }))
      .mockResolvedValueOnce(response({ sha: 'file-sha' }));
    const client = createGitHubClient({ fetch, token: 'test-token-value' });

    expect(await client.getDefaultBranch({ owner: 'space owner', repo: 'repo/name' })).toBe('main');
    await client.getContent({ owner: 'space owner', repo: 'repo/name', path: 'private data/file#.json', ref: 'feature/x' });

    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/space%20owner/repo%2Fname');
    expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/space%20owner/repo%2Fname/contents/private%20data/file%23.json?ref=feature%2Fx');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token-value');
  });

  it('creates, updates, deletes, lists, and probes content with SHA handling', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response([{ name: 'one' }]))
      .mockResolvedValueOnce(response({ content: { sha: 'created-sha' } }))
      .mockResolvedValueOnce(response({ content: { sha: 'updated-sha' } }))
      .mockResolvedValueOnce(response({ commit: { sha: 'deleted' } }))
      .mockResolvedValueOnce(response({ content: { sha: 'probe-sha' } }))
      .mockResolvedValueOnce(response({ commit: { sha: 'probe-deleted' } }));
    const client = createGitHubClient({ fetch, token: 'test-token-value' });
    const target = { owner: 'owner', repo: 'repo', path: 'collaboration/data.json', branch: 'main' };

    expect(await client.listContents({ ...target, path: 'collaboration' })).toEqual([{ name: 'one' }]);
    await client.createContent({ ...target, content: 'hello', message: 'create' });
    await client.updateContent({ ...target, content: 'updated', message: 'update', sha: 'old-sha' });
    await client.deleteContent({ ...target, message: 'delete', sha: 'updated-sha' });
    await expect(client.probeWriteAccess({ owner: 'owner', repo: 'repo', branch: 'main', path: '.probe' })).resolves.toBe(true);

    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ message: 'create', content: 'aGVsbG8=', branch: 'main' });
    expect(JSON.parse(fetch.mock.calls[2][1].body).sha).toBe('old-sha');
    expect(JSON.parse(fetch.mock.calls[3][1].body).sha).toBe('updated-sha');
    expect(JSON.parse(fetch.mock.calls[5][1].body).sha).toBe('probe-sha');
  });

  it('raises typed API and conflict errors without logging the token', async () => {
    const conflictFetch = vi.fn().mockResolvedValue(response({ message: 'sha does not match' }, 409));
    const errorFetch = vi.fn().mockResolvedValue(response({ message: 'not found' }, 404));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(createGitHubClient({ fetch: conflictFetch, token: 'never-log-token' }).createContent({
      owner: 'owner', repo: 'repo', path: 'file', content: 'value', message: 'create',
    })).rejects.toMatchObject({ name: 'GitHubConflictError', status: 409 });
    await expect(createGitHubClient({ fetch: errorFetch, token: 'never-log-token' }).getRepository({ owner: 'owner', repo: 'repo' }))
      .rejects.toBeInstanceOf(GitHubApiError);
    expect(GitHubConflictError.prototype).toBeInstanceOf(GitHubApiError);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('rejects dot-segment content paths', async () => {
    const client = createGitHubClient({ fetch: vi.fn(), token: 'test-token' });
    expect(() => client.getContent({ owner: 'owner', repo: 'repo', path: '../secret', ref: 'main' })).toThrow(/dot segments/);
  });
});
