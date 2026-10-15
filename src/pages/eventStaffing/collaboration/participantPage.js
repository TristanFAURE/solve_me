import { createCollaborationSessionRepository, CollaborationConflictError } from './sessionRepository.js';

const STATES = [['neutral', 'Neutral'], ['prefer', 'Prefer'], ['preferNot', 'Prefer not'], ['unavailable', 'Unavailable']];

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function repositoryFor(collaboration) {
  return createCollaborationSessionRepository({
    githubClient: collaboration.client,
    repository: collaboration.repository,
    manifestPassword: collaboration.mode.password,
  });
}

function optionList(current) {
  return STATES.map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('');
}

async function initialize(root, state, collaboration) {
  const participant = collaboration.participant;
  participant.status = 'loading';
  renderParticipantCollaborationPage(root, state, collaboration);
  try {
    const loaded = await repositoryFor(collaboration).loadManifest(collaboration.mode.session);
    participant.manifest = loaded.manifest;
    participant.status = 'ready';
    participant.identity ??= { firstName: '', lastName: '', email: '', pin: '' };
    participant.preferences ??= { dayPreferences: {}, dayGroupPreferences: {} };
  } catch (error) {
    participant.status = 'error';
    participant.error = error instanceof Error ? error.message : 'Unable to load the collaboration session.';
  }
  renderParticipantCollaborationPage(root, state, collaboration);
}

function renderLoading(root, participant) {
  root.innerHTML = `<main class="app-shell collaboration-participant-page"><section class="card"><p class="eyebrow">Event Staffing collaboration</p><h1>Participant availability</h1>${participant.error ? `<p role="alert" class="command-bar-feedback command-bar-feedback-error">${escapeHtml(participant.error)}</p>` : '<p role="status">Loading encrypted session...</p>'}</section></main>`;
}

export function renderParticipantPlanning(planning) {
  if (!planning) return '';
  const rows = planning.assignments.length
    ? planning.assignments.map((assignment) => `<tr><td>${escapeHtml(assignment.dateKey)}</td><td>${escapeHtml(assignment.slotLabel)}</td><td>${escapeHtml(assignment.groupTypeLabel)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted-text">You have no assignments in this planning.</td></tr>';
  return `<section class="card" data-participant-planning><div class="panel-header"><div><p class="eyebrow">Saved planning</p><h2>Your assignments</h2></div><span class="section-count-pill">Solution ${escapeHtml(planning.solutionNumber)}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Day</th><th>Slot</th><th>Group</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderParticipantCollaborationPage(root, state, collaboration) {
  const participant = collaboration.participant;
  if (!participant.status || participant.status === 'idle') {
    void initialize(root, state, collaboration);
    return;
  }
  if (participant.status !== 'ready') {
    renderLoading(root, participant);
    return;
  }
  const manifest = participant.manifest;
  const identity = participant.identity;
  const preferences = participant.preferences;
  root.innerHTML = `<main class="app-shell collaboration-participant-page"><section class="hero-card event-staffing-hero-card"><div><p class="eyebrow">Collaborative availability</p><h1>${escapeHtml(manifest.title)}</h1><p class="hero-description">Session revision ${manifest.revision} · ${manifest.status === 'open' ? 'Open for responses' : 'Closed'}</p></div></section>${participant.error ? `<p role="alert" class="command-bar-feedback command-bar-feedback-error">${escapeHtml(participant.error)}</p>` : ''}${participant.message ? `<p role="status" class="command-bar-feedback">${escapeHtml(participant.message)}</p>` : ''}<section class="card"><h2>Your identity</h2><div class="form-grid four-columns"><label>First name<input name="collabFirstName" required value="${escapeHtml(identity.firstName)}" /></label><label>Last name<input name="collabLastName" required value="${escapeHtml(identity.lastName)}" /></label><label>Email<input name="collabEmail" type="email" required value="${escapeHtml(identity.email)}" /></label><label>4-digit PIN<input name="collabPin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required value="${escapeHtml(identity.pin)}" /></label></div><div class="button-row top-gap"><button type="button" data-collab-user-action="load">Load existing response</button></div></section><section class="card"><h2>Availability and preferences</h2><p class="muted-text">Choose a whole-day value, then optionally override individual staffing groups.</p><div class="table-wrap"><table class="data-table collaboration-preference-table"><thead><tr><th>Date / group</th>${manifest.dateKeys.map((dateKey) => `<th>${escapeHtml(dateKey)}</th>`).join('')}</tr></thead><tbody><tr><th>Whole day</th>${manifest.dateKeys.map((dateKey) => `<td><select data-collab-day="${escapeHtml(dateKey)}">${optionList(preferences.dayPreferences[dateKey] ?? 'neutral')}</select></td>`).join('')}</tr>${manifest.groups.map((group) => `<tr><th>${escapeHtml(group.label)}</th>${manifest.dateKeys.map((dateKey) => `<td><select data-collab-day-group="${escapeHtml(dateKey)}" data-group-id="${escapeHtml(group.id)}">${optionList(preferences.dayGroupPreferences[dateKey]?.[group.id] ?? 'neutral')}</select></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="button-row top-gap"><button type="button" class="command-bar-button command-bar-button-primary" data-collab-user-action="save"${manifest.status === 'open' ? '' : ' disabled'}>Save response</button></div></section></main>`;
  root.querySelector('main')?.insertAdjacentHTML('beforeend', renderParticipantPlanning(participant.planning));
  bindParticipant(root, state, collaboration);
}

function bindParticipant(root, state, collaboration) {
  const participant = collaboration.participant;
  [['collabFirstName', 'firstName'], ['collabLastName', 'lastName'], ['collabEmail', 'email'], ['collabPin', 'pin']].forEach(([name, key]) => {
    root.querySelector(`[name="${name}"]`)?.addEventListener('input', (event) => {
      participant.identity[key] = event.target.value;
      participant.planning = null;
      if (key === 'email' || key === 'pin') participant.responseSha = undefined;
      root.querySelector('[data-participant-planning]')?.remove();
    });
  });
  root.querySelectorAll('[data-collab-day]').forEach((select) => select.addEventListener('change', () => {
    participant.preferences.dayPreferences[select.dataset.collabDay] = select.value;
  }));
  root.querySelectorAll('[data-collab-day-group]').forEach((select) => select.addEventListener('change', () => {
    const values = participant.preferences.dayGroupPreferences[select.dataset.collabDayGroup] ?? {};
    values[select.dataset.groupId] = select.value;
    participant.preferences.dayGroupPreferences[select.dataset.collabDayGroup] = values;
  }));
  root.querySelector('[data-collab-user-action="load"]')?.addEventListener('click', async () => {
    participant.error = '';
    participant.planning = null;
    try {
      const loaded = await repositoryFor(collaboration).loadParticipantData(participant.manifest, participant.identity.email, participant.identity.pin);
      participant.identity = { firstName: loaded.response.firstName, lastName: loaded.response.lastName, email: loaded.response.email, pin: loaded.response.pin };
      participant.preferences = { dayPreferences: loaded.response.dayPreferences, dayGroupPreferences: loaded.response.dayGroupPreferences };
      participant.responseSha = loaded.sha;
      participant.planning = loaded.planning;
      participant.message = 'Existing response loaded.';
    } catch (error) {
      participant.error = error?.status === 404 ? 'No existing response was found for this email.' : (error instanceof Error ? error.message : 'Unable to load the response.');
    }
    renderParticipantCollaborationPage(root, state, collaboration);
  });
  root.querySelector('[data-collab-user-action="save"]')?.addEventListener('click', async () => {
    participant.error = '';
    try {
      const repository = repositoryFor(collaboration);
      const saved = await repository.saveMergedResponse(participant.manifest, {
        ...participant.identity,
        displayName: `${participant.identity.firstName} ${participant.identity.lastName}`.trim(),
        dayPreferences: participant.preferences.dayPreferences,
        dayGroupPreferences: participant.preferences.dayGroupPreferences,
      }, participant.responseSha);
      participant.message = `Response saved at ${saved.response.savedAt}.`;
      const loaded = await repository.loadParticipantData(participant.manifest, participant.identity.email, participant.identity.pin);
      participant.responseSha = loaded.sha;
      participant.planning = loaded.planning;
    } catch (error) {
      participant.error = error instanceof CollaborationConflictError
        ? 'The response kept changing while it was being merged. Please try saving again.'
        : (error instanceof Error ? error.message : 'Unable to save the response.');
    }
    renderParticipantCollaborationPage(root, state, collaboration);
  });
}
