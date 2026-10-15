const API_ORIGIN = 'https://api.github.com';
const encoder = new TextEncoder();

export class GitHubApiError extends Error {
  constructor(message, { status, response, details } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.response = response;
    this.details = details;
  }
}

export class GitHubConflictError extends GitHubApiError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'GitHubConflictError';
  }
}

function required(value, name) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} is required.`);
  return value;
}

function encodePath(path) {
  return required(path, 'path').split('/').map((segment) => {
    const value = required(segment, 'path segment');
    if (value === '.' || value === '..') throw new TypeError('GitHub content paths cannot contain dot segments.');
    return encodeURIComponent(value);
  }).join('/');
}

function base64Text(value) {
  const bytes = encoder.encode(required(value, 'content'));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function responseDetails(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class GitHubClient {
  constructor({ fetch: fetchImplementation, token } = {}) {
    if (typeof fetchImplementation !== 'function') throw new TypeError('An injected fetch implementation is required.');
    if (typeof token !== 'string' || !token) throw new TypeError('A GitHub token is required.');
    this.fetch = fetchImplementation;
    this.token = token;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(`${API_ORIGIN}${path}`);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    const response = await this.fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const details = await responseDetails(response);
    if (!response.ok) {
      const ErrorType = response.status === 409 || (response.status === 422 && method === 'PUT') ? GitHubConflictError : GitHubApiError;
      throw new ErrorType(details?.message || `GitHub API request failed with status ${response.status}.`, {
        status: response.status,
        response,
        details,
      });
    }
    return details;
  }

  repositoryPath(owner, repo) {
    return `/repos/${encodeURIComponent(required(owner, 'owner'))}/${encodeURIComponent(required(repo, 'repo'))}`;
  }

  getRepository({ owner, repo }) {
    return this.request('GET', this.repositoryPath(owner, repo));
  }

  async getDefaultBranch({ owner, repo }) {
    const repository = await this.getRepository({ owner, repo });
    if (typeof repository?.default_branch !== 'string' || !repository.default_branch) {
      throw new GitHubApiError('GitHub repository response did not include a default branch.');
    }
    return repository.default_branch;
  }

  getContent({ owner, repo, path, ref }) {
    return this.request('GET', `${this.repositoryPath(owner, repo)}/contents/${encodePath(path)}`, { query: { ref } });
  }

  async listContents(options) {
    const contents = await this.getContent(options);
    if (!Array.isArray(contents)) throw new GitHubApiError('GitHub content response is not a directory listing.');
    return contents;
  }

  createContent({ owner, repo, path, content, message, branch }) {
    return this.request('PUT', `${this.repositoryPath(owner, repo)}/contents/${encodePath(path)}`, {
      body: { message: required(message, 'message'), content: base64Text(content), ...(branch ? { branch } : {}) },
    });
  }

  updateContent({ owner, repo, path, content, message, branch, sha }) {
    return this.request('PUT', `${this.repositoryPath(owner, repo)}/contents/${encodePath(path)}`, {
      body: { message: required(message, 'message'), content: base64Text(content), sha: required(sha, 'sha'), ...(branch ? { branch } : {}) },
    });
  }

  deleteContent({ owner, repo, path, message, branch, sha }) {
    return this.request('DELETE', `${this.repositoryPath(owner, repo)}/contents/${encodePath(path)}`, {
      body: { message: required(message, 'message'), sha: required(sha, 'sha'), ...(branch ? { branch } : {}) },
    });
  }

  async probeWriteAccess({ owner, repo, branch, path = '.event-staffing-collaboration-write-probe' }) {
    const created = await this.createContent({ owner, repo, branch, path, content: 'probe', message: 'Probe collaboration write access' });
    const sha = created?.content?.sha;
    if (typeof sha !== 'string' || !sha) throw new GitHubApiError('GitHub create response did not include a content SHA.');
    await this.deleteContent({ owner, repo, branch, path, sha, message: 'Remove collaboration write probe' });
    return true;
  }
}

export function createGitHubClient(options) {
  return new GitHubClient(options);
}
