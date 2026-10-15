import {
  COLLABORATION_ROOT,
  collaborationManifestPath,
  createCollaborationManifest,
  manifestPickerData,
  reviseCollaborationManifest,
  validateCollaborationManifest,
} from './collaborationManifest.js';
import {
  collaborationResponsePath,
  createCollaborationResponse,
  validateCollaborationResponse,
  verifyCollaborationResponseIdentity,
} from './responseModel.js';
import * as defaultCryptoEnvelope from './cryptoEnvelope.js';

export class CollaborationConflictError extends Error {
  constructor(message = 'The collaboration data changed since it was loaded.', options) {
    super(message, options);
    this.name = 'CollaborationConflictError';
  }
}

function isConflict(error) {
  return error?.status === 409 || error?.status === 422
    || error?.statusCode === 409 || error?.statusCode === 422
    || error?.response?.status === 409 || error?.response?.status === 422;
}

function isNotFound(error) {
  return error?.status === 404 || error?.statusCode === 404 || error?.response?.status === 404;
}

function decodeGitHubContent(file) {
  if (typeof file?.content !== 'string') throw new Error('GitHub file content is missing.');
  return new TextDecoder().decode(Uint8Array.from(atob(file.content.replaceAll('\n', '')), (character) => character.charCodeAt(0)));
}

function fileSha(file) {
  return file?.sha ?? file?.data?.sha;
}

function safeSessionFolder(folder) {
  const value = String(folder ?? '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*--[A-Za-z0-9]{8,64}$/.test(value)) throw new Error('Collaboration session folder is invalid.');
  return value;
}

export function createCollaborationSessionRepository({ githubClient, cryptoEnvelope = defaultCryptoEnvelope, repository, manifestPassword, now, randomUUID, sha256 } = {}) {
  if (!githubClient || !repository?.owner || !repository?.repo || !manifestPassword) {
    throw new Error('githubClient, repository, and manifestPassword are required.');
  }
  const clock = now ?? (() => new Date().toISOString());
  const target = (path) => ({ ...repository, path });
  const encrypt = (value, password) => cryptoEnvelope.encryptEnvelope(JSON.stringify(value), password);
  const decrypt = async (file, password) => JSON.parse(await cryptoEnvelope.decryptEnvelope(decodeGitHubContent(file), password));
  const read = (path) => githubClient.getContent({ ...target(path), ref: repository.branch });

  async function writeEncrypted(path, value, password, options = {}) {
    try {
      const request = { ...target(path), content: await encrypt(value, password), message: options.message };
      return options.sha
        ? await githubClient.updateContent({ ...request, sha: options.sha })
        : await githubClient.createContent(request);
    } catch (error) {
      if (isConflict(error)) throw new CollaborationConflictError(undefined, { cause: error });
      throw error;
    }
  }

  async function loadManifest(folder) {
    const file = await read(collaborationManifestPath(safeSessionFolder(folder)));
    return { manifest: validateCollaborationManifest(await decrypt(file, manifestPassword)), sha: fileSha(file) };
  }

  async function saveManifest(manifest, sha) {
    validateCollaborationManifest(manifest);
    await writeEncrypted(collaborationManifestPath(manifest.folder), manifest, manifestPassword, { sha, message: `Update collaboration session ${manifest.slug}` });
    return manifest;
  }

  async function updateManifest(folder, changes) {
    const loaded = await loadManifest(folder);
    const manifest = reviseCollaborationManifest(loaded.manifest, changes, clock());
    return saveManifest(manifest, loaded.sha);
  }

  return {
    async createSession(project, options = {}) {
      const manifest = createCollaborationManifest(project, {
        ...options,
        now: clock(),
        random: options.random ?? randomUUID?.(),
      });
      await writeEncrypted(collaborationManifestPath(manifest.folder), manifest, manifestPassword, { message: `Create collaboration session ${manifest.slug}` });
      return manifest;
    },

    loadManifest,

    saveManifest,

    updateManifest,

    async closeSession(folder) {
      return updateManifest(folder, { status: 'closed' });
    },

    async reopenSession(folder) {
      return updateManifest(folder, { status: 'open' });
    },

    async discoverSessions(slug) {
      const normalizedSlug = String(slug ?? '').trim().toLowerCase();
      let entries;
      try {
        entries = await githubClient.listContents({ ...target(COLLABORATION_ROOT), ref: repository.branch });
      } catch (error) {
        if (error?.status === 404) return [];
        throw error;
      }
      const folders = (entries ?? []).map((entry) => typeof entry === 'string' ? entry : entry.name)
        .filter((name) => name?.startsWith(`${normalizedSlug}--`));
      const loaded = await Promise.all(folders.map(async (folder) => {
        try {
          return manifestPickerData((await loadManifest(folder)).manifest);
        } catch {
          return { folder, slug: normalizedSlug, title: folder, status: 'encrypted', revision: null, updatedAt: '' };
        }
      }));
      return loaded.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },

    async loadResponse(manifest, email, pin) {
      validateCollaborationManifest(manifest);
      const path = await collaborationResponsePath(manifest.folder, manifest.sessionId, email, sha256);
      const file = await read(path);
      return { response: verifyCollaborationResponseIdentity(await decrypt(file, manifestPassword), email, pin), sha: fileSha(file), path };
    },

    async loadResponses(manifest) {
      validateCollaborationManifest(manifest);
      const root = `${COLLABORATION_ROOT}/${manifest.folder}/responses`;
      let directories;
      try {
        directories = await githubClient.listContents({ ...target(root), ref: repository.branch });
      } catch (error) {
        if (error?.status === 404) return [];
        throw error;
      }
      return Promise.all((directories ?? []).filter((entry) => typeof entry === 'string' || entry?.type === 'dir').map(async (entry) => {
        const name = typeof entry === 'string' ? entry : entry.name;
        const path = `${root}/${name}/response.enc.json`;
        try {
          const file = await read(path);
          return { response: validateCollaborationResponse(await decrypt(file, manifestPassword)), sha: fileSha(file), path };
        } catch (error) {
          return { path, error };
        }
      }));
    },

    async saveResponse(manifest, input, sha) {
      validateCollaborationManifest(manifest);
      if (manifest.status !== 'open') throw new Error('This collaboration session is closed.');
      const response = createCollaborationResponse({ ...input, sessionId: manifest.sessionId, manifestRevision: manifest.revision }, { savedAt: clock() });
      const path = await collaborationResponsePath(manifest.folder, manifest.sessionId, response.email, sha256);
      if (sha) {
        await writeEncrypted(path, response, manifestPassword, { sha, message: 'Update collaboration response' });
        return response;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await writeEncrypted(path, response, manifestPassword, { message: 'Create collaboration response' });
          return response;
        } catch (error) {
          if (!(error instanceof CollaborationConflictError)) throw error;
          try {
            await read(path);
            throw error;
          } catch (readError) {
            if (!isNotFound(readError)) throw readError;
          }
          if (attempt === 2) throw error;
        }
      }
      return response;
    },

    async deleteResponse(manifest, email, sha) {
      if (!sha) throw new Error('Response SHA is required for deletion.');
      const path = await collaborationResponsePath(manifest.folder, manifest.sessionId, email, sha256);
      try {
        await githubClient.deleteContent({ ...target(path), sha, message: 'Delete collaboration response' });
      } catch (error) {
        if (isConflict(error)) throw new CollaborationConflictError(undefined, { cause: error });
        throw error;
      }
    },
  };
}

export const createSessionRepository = createCollaborationSessionRepository;
