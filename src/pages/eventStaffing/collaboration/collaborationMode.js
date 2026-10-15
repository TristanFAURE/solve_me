import { detectGitHubRepository } from './repositoryDetection.js';

const STORAGE_PREFIX = 'event-staffing-collaboration:';

function bool(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

export function isCollaborationMode(location = globalThis.location) {
  const url = location instanceof URL ? new URL(location) : new URL(location?.href ?? String(location));
  return bool(url.searchParams.get('collab'));
}

export function collaborationStorageKeys(owner, repo) {
  const scope = `${owner ?? 'unknown'}/${repo ?? 'unknown'}`;
  return { token: `${STORAGE_PREFIX}${scope}:token`, password: `${STORAGE_PREFIX}${scope}:password` };
}

export function readCollaborationMode(location = globalThis.location, storage = globalThis.sessionStorage, environment = {}) {
  const url = location instanceof URL ? new URL(location) : new URL(location?.href ?? String(location));
  const repository = detectGitHubRepository(url, environment);
  const keys = collaborationStorageKeys(repository?.owner, repository?.repo);
  const tokenFromUrl = url.searchParams.get('token') ?? '';
  const passwordFromUrl = url.searchParams.get('password') ?? '';
  if (tokenFromUrl) storage?.setItem(keys.token, tokenFromUrl);
  if (passwordFromUrl) storage?.setItem(keys.password, passwordFromUrl);
  return {
    enabled: isCollaborationMode(url),
    userMode: bool(url.searchParams.get('user')),
    session: url.searchParams.get('session') ?? '',
    repository,
    token: tokenFromUrl || storage?.getItem(keys.token) || '',
    password: passwordFromUrl || storage?.getItem(keys.password) || '',
    keys,
    hasSensitiveQuery: Boolean(tokenFromUrl || passwordFromUrl),
  };
}

export function scrubCollaborationSecrets(location = globalThis.location, history = globalThis.history) {
  const url = location instanceof URL ? new URL(location) : new URL(location?.href ?? String(location));
  url.searchParams.delete('token');
  url.searchParams.delete('password');
  history?.replaceState?.(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return url;
}

export function storeCollaborationCredentials(mode, { token, password }, storage = globalThis.sessionStorage) {
  if (token) storage?.setItem(mode.keys.token, token);
  if (password) storage?.setItem(mode.keys.password, password);
  return { ...mode, token: token || mode.token, password: password || mode.password };
}

export function buildParticipantCollaborationUrl({ location = globalThis.location, session, token, password }) {
  const url = new URL(location.href);
  url.hash = '#/event-staffing';
  url.search = '';
  url.searchParams.set('collab', 'true');
  url.searchParams.set('user', 'true');
  url.searchParams.set('session', session);
  url.searchParams.set('token', token);
  url.searchParams.set('password', password);
  return url.toString();
}
