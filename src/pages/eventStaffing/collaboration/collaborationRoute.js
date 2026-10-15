import { renderEventStaffingPage } from '../index.js';
import { createGitHubClient } from './githubClient.js';
import { readCollaborationMode, scrubCollaborationSecrets, storeCollaborationCredentials } from './collaborationMode.js';
import { renderParticipantCollaborationPage } from './participantPage.js';

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function environment() {
  return { VITE_GITHUB_OWNER: import.meta.env?.VITE_GITHUB_OWNER, VITE_GITHUB_REPO: import.meta.env?.VITE_GITHUB_REPO };
}

function renderGate(root, collaboration, state) {
  const needsPassword = collaboration.mode.userMode;
  root.innerHTML = `<main class="app-shell collaboration-gate"><section class="card"><p class="eyebrow">Event Staffing collaboration</p><h1>Connect to the collaboration repository</h1><p class="muted-text">A short-lived fine-grained GitHub token with Contents read/write access is required.</p>${collaboration.error ? `<p role="alert" class="command-bar-feedback command-bar-feedback-error">${escapeHtml(collaboration.error)}</p>` : ''}<form data-collaboration-credentials><label>GitHub token<input type="password" name="collaborationToken" required autocomplete="off" value="${escapeHtml(collaboration.mode.token)}" /></label>${needsPassword ? `<label>Session password<input type="password" name="collaborationPassword" minlength="12" required autocomplete="off" value="${escapeHtml(collaboration.mode.password)}" /></label>` : ''}<button type="submit" class="command-bar-button command-bar-button-primary"${collaboration.status === 'verifying' ? ' disabled' : ''}>${collaboration.status === 'verifying' ? 'Verifying...' : 'Verify and continue'}</button></form></section></main>`;
  root.querySelector('[data-collaboration-credentials]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    collaboration.mode = storeCollaborationCredentials(collaboration.mode, {
      token: String(form.get('collaborationToken') ?? '').trim(),
      password: String(form.get('collaborationPassword') ?? collaboration.mode.password),
    });
    collaboration.status = 'pending';
    collaboration.error = '';
    renderEventStaffingRoute(root, state);
  });
}

async function verify(root, state, collaboration) {
  collaboration.status = 'verifying';
  renderGate(root, collaboration, state);
  try {
    if (!collaboration.mode.repository) throw new Error('Unable to determine the GitHub repository. Configure VITE_GITHUB_OWNER and VITE_GITHUB_REPO for localhost.');
    const client = createGitHubClient({ fetch: globalThis.fetch.bind(globalThis), token: collaboration.mode.token });
    const repositoryDetails = await client.getRepository(collaboration.mode.repository);
    const branch = repositoryDetails?.default_branch;
    if (typeof branch !== 'string' || !branch) throw new Error('GitHub repository response did not include a default branch.');
    if (repositoryDetails?.permissions?.push === false) throw new Error('The GitHub token does not have repository write permission.');
    collaboration.client = client;
    collaboration.repository = { ...collaboration.mode.repository, branch };
    collaboration.status = 'verified';
    collaboration.error = '';
    renderEventStaffingRoute(root, state);
  } catch (error) {
    collaboration.status = 'error';
    collaboration.error = error instanceof Error ? error.message : 'GitHub verification failed.';
    renderGate(root, collaboration, state);
  }
}

export function renderEventStaffingRoute(root, state) {
  const page = state.eventStaffingPage;
  if (!page.collaboration) {
    const mode = readCollaborationMode(globalThis.location, globalThis.sessionStorage, environment());
    if (!mode.enabled) {
      renderEventStaffingPage(root, state);
      return;
    }
    if (mode.hasSensitiveQuery) scrubCollaborationSecrets();
    page.collaboration = { mode, status: 'pending', error: '', admin: {}, participant: {} };
  }
  const collaboration = page.collaboration;
  if (!collaboration.mode.enabled) {
    renderEventStaffingPage(root, state);
    return;
  }
  if (!collaboration.mode.token || (collaboration.mode.userMode && (!collaboration.mode.password || !collaboration.mode.session))) {
    renderGate(root, collaboration, state);
    return;
  }
  if (collaboration.status === 'pending') {
    void verify(root, state, collaboration);
    return;
  }
  if (collaboration.status === 'verifying' || collaboration.status === 'error') {
    renderGate(root, collaboration, state);
    return;
  }
  if (collaboration.mode.userMode) {
    renderParticipantCollaborationPage(root, state, collaboration);
    return;
  }
  renderEventStaffingPage(root, state);
}

export function isCollaborativeAdministrator(state) {
  const collaboration = state?.eventStaffingPage?.collaboration;
  return Boolean(collaboration?.mode?.enabled && !collaboration.mode.userMode && collaboration.status === 'verified');
}
