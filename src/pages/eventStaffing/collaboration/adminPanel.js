import { applyCollaborationConfiguration, collaborationConfiguration, collaborationDateKeys, collaborationGroups, slugifyCollaborationTitle } from './collaborationManifest.js';
import { buildParticipantCollaborationUrl } from './collaborationMode.js';
import { applyCollaborationResponses, previewCollaborationResponses } from './responseMerge.js';
import { createCollaborationSessionRepository } from './sessionRepository.js';

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function service(collaboration, password) {
  return createCollaborationSessionRepository({ githubClient: collaboration.client, repository: collaboration.repository, manifestPassword: password });
}

function reportGrid(report) {
  if (!report) return '';
  return `<dl class="summary-grid compact-summary-grid">${Object.entries(report).filter(([, value]) => typeof value === 'number').map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function clearDerivedState(state) {
  state.eventStaffingPage.lastValidation = null;
  state.eventStaffingPage.lastGenericValidation = null;
  state.eventStaffingPage.lastTransformedProject = null;
  state.eventStaffingPage.lastNormalizedProject = null;
  state.eventStaffingPage.lastSolverResult = null;
  state.eventStaffingPage.activeSolutionIndex = 0;
}

export function renderCollaborationAdminPanel(state) {
  const collaboration = state.eventStaffingPage.collaboration;
  if (!collaboration?.mode?.enabled || collaboration.mode.userMode || collaboration.status !== 'verified') return '';
  const admin = collaboration.admin;
  admin.password ??= collaboration.mode.password ?? '';
  const manifest = admin.manifest;
  const preview = admin.preview;
  const responses = admin.responses ?? [];
  return `<section class="card collaboration-admin-panel"><div class="panel-header"><div><p class="eyebrow">GitHub collaboration</p><h2>Collaborative session</h2><p class="muted-text">Repository: ${escapeHtml(`${collaboration.repository.owner}/${collaboration.repository.repo}`)} · ${escapeHtml(collaboration.repository.branch)}</p></div>${manifest ? `<span class="section-count-pill">Revision ${manifest.revision} · ${escapeHtml(manifest.status)}</span>` : ''}</div>${admin.error ? `<p role="alert" class="command-bar-feedback command-bar-feedback-error">${escapeHtml(admin.error)}</p>` : ''}${admin.message ? `<p role="status" class="command-bar-feedback">${escapeHtml(admin.message)}</p>` : ''}<div class="form-grid two-columns"><label>Session name<input name="collaborationSessionName" value="${escapeHtml(admin.sessionName ?? '')}" /></label><label>Encryption password<input type="password" minlength="12" name="collaborationSessionPassword" autocomplete="off" value="${escapeHtml(admin.password ?? '')}" /></label></div>${admin.candidates?.length > 1 ? `<label>Matching session<select name="collaborationSessionFolder"><option value="">Select a session</option>${admin.candidates.map((candidate) => `<option value="${escapeHtml(candidate.folder)}">${escapeHtml(candidate.folder)} · revision ${candidate.revision}</option>`).join('')}</select></label>` : ''}<div class="button-row top-gap"><button type="button" data-collab-admin-action="apply-session">Apply session</button><button type="button" data-collab-admin-action="refresh"${manifest ? '' : ' disabled'}>Refresh responses</button><button type="button" data-collab-admin-action="start"${manifest ? '' : ' disabled'}>Start Collaboration</button>${manifest ? `<button type="button" data-collab-admin-action="toggle-status">${manifest.status === 'open' ? 'Close session' : 'Reopen session'}</button>` : ''}</div>${admin.generatedUrl ? `<div class="result-status-banner"><strong>Participant URL</strong><textarea readonly rows="4">${escapeHtml(admin.generatedUrl)}</textarea><button type="button" data-collab-admin-action="copy-url">Copy URL</button></div>` : ''}${preview ? `<section class="workspace-panel top-gap"><h3>Response preview</h3>${reportGrid(preview.report)}${preview.report.errors?.length ? `<ul class="issue-list">${preview.report.errors.map((error) => `<li class="issue-list-item error">${escapeHtml(error)}</li>`).join('')}</ul>` : ''}<div class="button-row"><button type="button" data-collab-admin-action="apply-responses"${preview.canApply ? '' : ' disabled'}>Apply response changes</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Person</th><th>Email</th><th>Revision</th><th>PIN</th><th>Actions</th></tr></thead><tbody>${responses.filter(({ response }) => response).map(({ response, sha }) => `<tr><td>${escapeHtml(response.displayName)}</td><td>${escapeHtml(response.email)}</td><td>${response.manifestRevision}</td><td>${admin.revealedPins?.has(response.email) ? escapeHtml(response.pin) : '••••'}</td><td><button type="button" data-reveal-pin="${escapeHtml(response.email)}">Reveal</button><button type="button" class="ghost-danger-button" data-delete-response="${escapeHtml(response.email)}" data-response-sha="${escapeHtml(sha)}">Delete</button></td></tr>`).join('')}</tbody></table></div></section>` : ''}</section>`;
}

async function refresh(state, rerender) {
  const collaboration = state.eventStaffingPage.collaboration;
  const admin = collaboration.admin;
  admin.error = '';
  try {
    const repository = service(collaboration, admin.password);
    admin.responses = await repository.loadResponses(admin.manifest);
    admin.preview = previewCollaborationResponses(state.eventStaffingPage.domainProject, admin.manifest, admin.responses);
    admin.message = `Loaded ${admin.responses.filter(({ response }) => response).length} participant response(s).`;
  } catch (error) {
    admin.error = error instanceof Error ? error.message : 'Unable to refresh responses.';
  }
  rerender();
}

export function bindCollaborationAdminPanel(root, state, rerender) {
  const collaboration = state.eventStaffingPage.collaboration;
  if (!collaboration?.admin) return;
  const admin = collaboration.admin;
  root.querySelector('[name="collaborationSessionName"]')?.addEventListener('input', (event) => { admin.sessionName = event.target.value; });
  root.querySelector('[name="collaborationSessionPassword"]')?.addEventListener('input', (event) => { admin.password = event.target.value; });
  root.querySelector('[name="collaborationSessionFolder"]')?.addEventListener('change', (event) => { admin.selectedFolder = event.target.value; });
  root.querySelector('[data-collab-admin-action="apply-session"]')?.addEventListener('click', async () => {
    admin.error = '';
    try {
      if (!admin.sessionName?.trim()) throw new Error('Enter a session name.');
      if (!admin.password || admin.password.length < 12) throw new Error('Encryption password must contain at least 12 characters.');
      collaboration.mode.password = admin.password;
      globalThis.sessionStorage?.setItem(collaboration.mode.keys.password, admin.password);
      const repository = service(collaboration, admin.password);
      const candidates = await repository.discoverSessions(slugifyCollaborationTitle(admin.sessionName));
      if (candidates.length > 1 && !admin.selectedFolder) {
        admin.candidates = candidates;
        admin.message = 'Select the collaboration session to load.';
        rerender();
        return;
      }
      if (candidates.length === 0) {
        admin.manifest = await repository.createSession(state.eventStaffingPage.domainProject, { title: admin.sessionName, random: globalThis.crypto.randomUUID().replaceAll('-', '') });
        admin.message = 'Collaboration session created.';
      } else {
        const folder = admin.selectedFolder || candidates[0].folder;
        admin.manifest = (await repository.loadManifest(folder)).manifest;
        applyCollaborationConfiguration(state.eventStaffingPage.domainProject, admin.manifest);
        clearDerivedState(state);
        admin.message = admin.manifest.configuration
          ? 'Collaboration session and administrator configuration loaded.'
          : 'Legacy collaboration session loaded without administrator configuration. The current setup was retained; use Start Collaboration to publish it.';
      }
      admin.candidates = [];
      await refresh(state, rerender);
      return;
    } catch (error) {
      admin.error = error instanceof Error ? error.message : 'Unable to apply the collaboration session.';
    }
    rerender();
  });
  root.querySelector('[data-collab-admin-action="refresh"]')?.addEventListener('click', () => void refresh(state, rerender));
  root.querySelector('[data-collab-admin-action="apply-responses"]')?.addEventListener('click', () => {
    if (!admin.preview?.canApply || !globalThis.confirm?.('Apply the previewed participant responses?')) return;
    try {
      applyCollaborationResponses(state.eventStaffingPage.domainProject, admin.preview);
      clearDerivedState(state);
      admin.message = 'Participant responses applied.';
      admin.preview = null;
    } catch (error) {
      admin.error = error instanceof Error ? error.message : 'Unable to apply participant responses.';
    }
    rerender();
  });
  root.querySelector('[data-collab-admin-action="start"]')?.addEventListener('click', async () => {
    try {
      const repository = service(collaboration, admin.password);
      admin.manifest = await repository.updateManifest(admin.manifest.folder, {
        title: admin.sessionName,
        status: 'open',
        dateKeys: collaborationDateKeys(state.eventStaffingPage.domainProject),
        groups: collaborationGroups(state.eventStaffingPage.domainProject),
        configuration: collaborationConfiguration(state.eventStaffingPage.domainProject),
      });
      admin.generatedUrl = buildParticipantCollaborationUrl({ location: globalThis.location, ...collaboration.repository, session: admin.manifest.folder, token: collaboration.mode.token, password: admin.password });
      admin.message = 'A new collaboration revision was published.';
    } catch (error) {
      admin.error = error instanceof Error ? error.message : 'Unable to publish collaboration.';
    }
    rerender();
  });
  root.querySelector('[data-collab-admin-action="toggle-status"]')?.addEventListener('click', async () => {
    try {
      admin.manifest = admin.manifest.status === 'open'
        ? await service(collaboration, admin.password).closeSession(admin.manifest.folder)
        : await service(collaboration, admin.password).reopenSession(admin.manifest.folder);
      admin.message = `Session ${admin.manifest.status}.`;
    } catch (error) {
      admin.error = error instanceof Error ? error.message : 'Unable to update session status.';
    }
    rerender();
  });
  root.querySelector('[data-collab-admin-action="copy-url"]')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(admin.generatedUrl);
    admin.message = 'Participant URL copied.';
    rerender();
  });
  root.querySelectorAll('[data-reveal-pin]').forEach((button) => button.addEventListener('click', () => {
    admin.revealedPins ??= new Set();
    admin.revealedPins.add(button.dataset.revealPin);
    rerender();
  }));
  root.querySelectorAll('[data-delete-response]').forEach((button) => button.addEventListener('click', async () => {
    if (!globalThis.confirm?.(`Delete the response for ${button.dataset.deleteResponse}?`)) return;
    try {
      await service(collaboration, admin.password).deleteResponse(admin.manifest, button.dataset.deleteResponse, button.dataset.responseSha);
      const normalizedEmail = button.dataset.deleteResponse.toLowerCase();
      const removedIds = new Set(state.eventStaffingPage.domainProject.people
        .filter((person) => String(person.email ?? '').trim().toLowerCase() === normalizedEmail)
        .map((person) => person.id));
      state.eventStaffingPage.domainProject.people = state.eventStaffingPage.domainProject.people.filter((person) => !removedIds.has(person.id));
      state.eventStaffingPage.domainProject.preferences = state.eventStaffingPage.domainProject.preferences.filter((preference) => !removedIds.has(preference.personId));
      state.eventStaffingPage.domainProject.forcedAssignments = state.eventStaffingPage.domainProject.forcedAssignments.filter((assignment) => !removedIds.has(assignment.personId));
      state.eventStaffingPage.domainProject.forbiddenAssignments = state.eventStaffingPage.domainProject.forbiddenAssignments.filter((assignment) => !removedIds.has(assignment.personId));
      await refresh(state, rerender);
      return;
    } catch (error) {
      admin.error = error instanceof Error ? error.message : 'Unable to delete response.';
    }
    rerender();
  }));
}
