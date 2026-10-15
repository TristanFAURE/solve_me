const OWNER_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/;
const REPOSITORY_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

function validRepository(owner, repo) {
  return OWNER_PATTERN.test(owner ?? '') && REPOSITORY_PATTERN.test(repo ?? '');
}

function queryRepository(url) {
  const owner = url.searchParams.get('owner');
  const repo = url.searchParams.get('repo');
  return validRepository(owner, repo) ? { owner, repo } : null;
}

function environmentRepository(environment) {
  const owner = environment?.owner ?? environment?.VITE_GITHUB_OWNER;
  const repo = environment?.repo ?? environment?.VITE_GITHUB_REPO;
  return validRepository(owner, repo) ? { owner, repo } : null;
}

export function detectGitHubRepository(location = globalThis.location, environment = {}) {
  if (!location) return null;
  let url;
  try {
    url = location instanceof URL ? location : new URL(typeof location === 'string' ? location : location.href);
  } catch {
    return null;
  }

  const override = queryRepository(url);
  if (override) return override;

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
    return environmentRepository(environment);
  }

  const match = /^([a-z0-9-]+)\.github\.io$/.exec(hostname);
  if (!match) return null;
  const owner = match[1];
  const firstPathSegment = url.pathname.split('/').filter(Boolean)[0];
  const repo = firstPathSegment ?? `${owner}.github.io`;
  return validRepository(owner, repo) ? { owner, repo } : null;
}
