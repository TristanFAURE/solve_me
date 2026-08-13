import { escapeHtml, formatGroupTypeList } from './utils.js';

function renderGroupTypeOptions(domainProject, selectedIds = [], inputName = 'groupTypeSelection') {
  return domainProject.groupTypes.map((groupType) => `
    <label class="event-staffing-checkbox-option">
      <input type="checkbox" name="${escapeHtml(inputName)}" value="${escapeHtml(groupType.id)}"${selectedIds.includes(groupType.id) ? ' checked' : ''} />
      <span>${escapeHtml(groupType.label)}</span>
      <span class="muted-text">${escapeHtml(groupType.id)}</span>
    </label>
  `).join('');
}

function renderPerGroupLimitRows(domainProject, rows = [], valueName, limitName, emptyText) {
  if (domainProject.groupTypes.length === 0) {
    return `
      <div class="empty-board event-staffing-empty-state top-gap">
        <p>Add a group type first to configure per-group limits.</p>
      </div>
    `;
  }

  if (rows.length === 0) {
    return `<p class="muted-text">${escapeHtml(emptyText)}</p>`;
  }

  return rows.map((row, index) => `
    <div class="form-grid three-columns compact-form-grid top-gap event-staffing-limit-row">
      <label>
        Group type
        <select name="${valueName}" data-row-index="${index}">
          <option value="">Select group type</option>
          ${domainProject.groupTypes.map((groupType) => `<option value="${escapeHtml(groupType.id)}"${row.groupTypeId === groupType.id ? ' selected' : ''}>${escapeHtml(groupType.label)}</option>`).join('')}
        </select>
      </label>
      <label>
        Limit
        <input type="number" name="${limitName}" data-row-index="${index}" value="${escapeHtml(String(row.value ?? ''))}" min="0" step="1" />
      </label>
      <label class="button-label">
        Action
        <button type="button" class="ghost-danger-button" data-event-staffing-action="remove-${valueName}-row" data-row-index="${index}">Remove row</button>
      </label>
    </div>
  `).join('');
}

function renderEmptyStateChecklist(items) {
  return `
    <ul class="empty-state-checklist">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `;
}

function renderSupportEmptyState(title, message, checklist = []) {
  return `
    <div class="empty-board event-staffing-empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${checklist.length > 0 ? renderEmptyStateChecklist(checklist) : ''}
    </div>
  `;
}

function summarizePerGroupMap(valuesByGroupTypeId, groupTypeLabelsById) {
  const entries = Object.entries(valuesByGroupTypeId ?? {});
  if (entries.length === 0) {
    return '—';
  }

  return entries
    .map(([groupTypeId, value]) => `${groupTypeLabelsById.get(groupTypeId) ?? groupTypeId}: ${value}`)
    .join(', ');
}

export function renderPeopleRows(domainProject, groupTypeLabelsById) {
  const preferencesByPersonId = new Map(domainProject.preferences.map((entry) => [entry.personId, entry.eventPreferences ?? {}]));

  return domainProject.people.map((person, index) => {
    const allowed = Array.isArray(person.allowedGroupTypeIds) && person.allowedGroupTypeIds.length > 0
      ? person.allowedGroupTypeIds.map((groupTypeId) => groupTypeLabelsById.get(groupTypeId) ?? groupTypeId).join(', ')
      : 'All group types';
    const forbidden = Array.isArray(person.forbiddenGroupTypeIds) && person.forbiddenGroupTypeIds.length > 0
      ? person.forbiddenGroupTypeIds.map((groupTypeId) => groupTypeLabelsById.get(groupTypeId) ?? groupTypeId).join(', ')
      : 'None';
    const preferenceSummary = Object.entries(preferencesByPersonId.get(person.id) ?? {})
      .map(([eventId, value]) => `${eventId}: ${value || '–'}`)
      .join(' · ');
    const perGroupMaxSummary = summarizePerGroupMap(person.maxAssignmentsPerGroupType, groupTypeLabelsById);
    const perGroupTargetSummary = summarizePerGroupMap(person.targetAssignmentsPerGroupType, groupTypeLabelsById);

    return `
      <tr>
        <td>${escapeHtml(person.name)}</td>
        <td>${escapeHtml(String(person.maxAssignments ?? '—'))}</td>
        <td>${escapeHtml(String(person.targetAssignments ?? '—'))}</td>
        <td>${escapeHtml(perGroupMaxSummary)}</td>
        <td>${escapeHtml(perGroupTargetSummary)}</td>
        <td>${escapeHtml(allowed)}</td>
        <td>${escapeHtml(forbidden)}</td>
        <td>${escapeHtml(preferenceSummary || 'No imported preferences')}</td>
        <td>
          <button type="button" class="event-staffing-primary-button" data-event-staffing-action="edit-person" data-person-index="${index}">Edit</button>
          <button type="button" class="ghost-danger-button" data-event-staffing-action="remove-person" data-person-index="${index}">Remove</button>
        </td>
      </tr>
    `;
  }).join('');
}

export function renderAssignmentList(assignments, domainProject, emptyText) {
  const peopleById = new Map(domainProject.people.map((person) => [person.id, person.name]));
  const eventById = new Map(domainProject.events.map((event) => [event.id, event.label]));
  const groupTypeById = new Map(domainProject.groupTypes.map((groupType) => [groupType.id, groupType.label]));

  if (!assignments.length) {
    return `<p>${escapeHtml(emptyText)}</p>`;
  }

  return `
    <ul>
      ${assignments.map((assignment) => `<li>${escapeHtml(peopleById.get(assignment.personId) ?? assignment.personId)} → ${escapeHtml(groupTypeById.get(assignment.groupTypeId) ?? assignment.groupTypeId)} on ${escapeHtml(eventById.get(assignment.eventId) ?? assignment.eventId)}</li>`).join('')}
    </ul>
  `;
}

export function renderSupportSections(domainProject, groupTypeLabelsById, editor = {}) {
  const perGroupMaxRows = Array.isArray(editor.draftPersonMaxAssignmentsPerGroupTypeRows)
    ? editor.draftPersonMaxAssignmentsPerGroupTypeRows
    : [];
  const perGroupTargetRows = Array.isArray(editor.draftPersonTargetAssignmentsPerGroupTypeRows)
    ? editor.draftPersonTargetAssignmentsPerGroupTypeRows
    : [];
  const allowedGroupTypeIds = Array.isArray(editor.draftPersonAllowedGroupTypeIds)
    ? editor.draftPersonAllowedGroupTypeIds
    : [];
  const forbiddenGroupTypeIds = Array.isArray(editor.draftPersonForbiddenGroupTypeIds)
    ? editor.draftPersonForbiddenGroupTypeIds
    : [];
  const isEditingPerson = editor.editingPersonIndex !== null && editor.editingPersonIndex !== undefined;
  const preferenceChoices = [
    { value: '', label: 'Neutral' },
    { value: 'Y', label: 'Prefer' },
    { value: 'N', label: 'Prefer not' },
  ];
  return `
    <section class="panel">
      <h2>🧩 Group types</h2>
      <p>Create the reusable staffing groups that events and rules refer to.</p>
      <div class="form-grid three-columns compact-form-grid top-gap">
        <label>
          Label
          <input type="text" name="draftGroupTypeLabel" value="${escapeHtml(editor.draftGroupTypeLabel ?? '')}" placeholder="Setup" />
        </label>
        <label>
          Id override (optional)
          <input type="text" name="draftGroupTypeId" value="${escapeHtml(editor.draftGroupTypeId ?? '')}" placeholder="setup" />
        </label>
        <label class="button-label">
          Action
          <button type="button" class="event-staffing-primary-button" data-event-staffing-action="add-group-type">Add group type</button>
        </label>
      </div>
      ${domainProject.groupTypes.length > 0
      ? `
        <div class="table-wrap top-gap">
          <table class="data-table">
            <thead>
              <tr><th>Label</th><th>Id</th><th>Action</th></tr>
            </thead>
            <tbody>
              ${domainProject.groupTypes.map((groupType, index) => `<tr><td><strong>${escapeHtml(groupType.label)}</strong></td><td>${escapeHtml(groupType.id)}</td><td><button type="button" class="ghost-danger-button" data-event-staffing-action="remove-group-type" data-group-type-index="${index}">Remove</button></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `
      : renderSupportEmptyState(
        'No group types yet',
        'Start by defining the reusable staffing groups that events can request.',
        [
          'Create labels such as Setup, Welcome, Kitchen, Cleanup, or Group A / Group B.',
          'Use consistent group names because requirements, eligibility, and cooldown rules all refer to these group types.',
          'After group types exist, add requirements to individual events or apply them in bulk from the event browser.',
        ],
      )}
    </section>

    <section class="panel">
      <div class="section-summary-row">
        <div>
          <h2>👥 People and targets</h2>
          <p class="muted-text">Use the compact form to add people quickly, then open advanced settings only when a person needs exceptions.</p>
        </div>
        <span class="section-count-pill">${escapeHtml(String(domainProject.people.length))} people</span>
      </div>

      <div class="event-staffing-people-layout top-gap">
        <section class="event-staffing-person-editor-card${isEditingPerson ? ' is-editing' : ''}">
          <form data-event-staffing-form="person-editor">
            <div class="section-summary-row event-staffing-person-form-header">
              <div>
                <h3>${isEditingPerson ? 'Edit person' : 'Quick add person'}</h3>
                <p class="muted-text">${isEditingPerson ? 'You are editing an existing person. Save changes or cancel to return to quick-add mode.' : 'Enter the main person details, save, and immediately continue with the next person.'}</p>
              </div>
              <div class="event-staffing-inline-actions">
                <button type="submit" class="event-staffing-primary-button" data-event-staffing-action="add-person">${isEditingPerson ? 'Save person' : 'Add person'}</button>
                ${isEditingPerson ? '<button type="button" class="event-staffing-secondary-button" data-event-staffing-action="cancel-edit-person">Cancel edit</button>' : ''}
              </div>
            </div>

            <div class="form-grid four-columns compact-form-grid top-gap">
              <label>
                Name
                <input type="text" name="draftPersonName" value="${escapeHtml(editor.draftPersonName ?? '')}" placeholder="Alex Martin" />
              </label>
              <label>
                Id override (optional)
                <input type="text" name="draftPersonId" value="${escapeHtml(editor.draftPersonId ?? '')}" placeholder="alex-martin" ${isEditingPerson ? 'disabled' : ''} />
              </label>
              <label>
                Hard max assignments
                <input type="number" name="draftPersonMaxAssignments" value="${escapeHtml(editor.draftPersonMaxAssignments ?? '')}" min="0" step="1" placeholder="Use global" />
              </label>
              <label>
                Soft target assignments
                <input type="number" name="draftPersonTargetAssignments" value="${escapeHtml(editor.draftPersonTargetAssignments ?? '')}" min="0" step="1" placeholder="Optional" />
              </label>
            </div>

            <p class="muted-text top-gap">Most people only need a name. Use advanced settings only for per-group limits or eligibility exceptions.</p>

            <details class="event-staffing-advanced-editor top-gap"${isEditingPerson ? ' open' : ''}>
              <summary>Advanced person settings</summary>
              <div class="stacked-form-sections event-staffing-advanced-editor-body top-gap">
                <section>
                  <div class="section-summary-row">
                    <div>
                      <h3>Per-group hard max</h3>
                      <p class="muted-text">Override the global per-group limit only when this person needs a stricter or custom cap.</p>
                    </div>
                    <button type="button" class="event-staffing-primary-button" data-event-staffing-action="add-draftPersonMaxAssignmentsPerGroupTypeRows-row">Add row</button>
                  </div>
                  ${renderPerGroupLimitRows(domainProject, perGroupMaxRows, 'draftPersonMaxAssignmentsPerGroupTypeRows', 'draftPersonMaxAssignmentsPerGroupTypeRowValue', 'No per-group hard max overrides yet.')}
                </section>
                <section>
                  <div class="section-summary-row">
                    <div>
                      <h3>Per-group soft target</h3>
                      <p class="muted-text">Use this only when a person should preferably serve a specific group type a certain number of times.</p>
                    </div>
                    <button type="button" class="event-staffing-primary-button" data-event-staffing-action="add-draftPersonTargetAssignmentsPerGroupTypeRows-row">Add row</button>
                  </div>
                  ${renderPerGroupLimitRows(domainProject, perGroupTargetRows, 'draftPersonTargetAssignmentsPerGroupTypeRows', 'draftPersonTargetAssignmentsPerGroupTypeRowValue', 'No per-group soft target overrides yet.')}
                </section>
                <section>
                  <h3>Allowed groups</h3>
                  ${domainProject.groupTypes.length > 0
      ? `<div class="event-staffing-checkbox-grid top-gap">${renderGroupTypeOptions(domainProject, allowedGroupTypeIds)}</div>`
      : '<p class="muted-text">Add group types to configure eligibility.</p>'}
                  <p class="muted-text top-gap">Leave all unchecked to allow every group type.</p>
                </section>
                <section>
                  <h3>Forbidden groups</h3>
                  ${domainProject.groupTypes.length > 0
      ? `<div class="event-staffing-checkbox-grid top-gap">${renderGroupTypeOptions(domainProject, forbiddenGroupTypeIds)}</div>`
      : '<p class="muted-text">Add group types to configure eligibility.</p>'}
                  <p class="muted-text top-gap">Forbidden groups always win if a group appears in both lists.</p>
                </section>
                <section>
                  <h3>Event preferences</h3>
                  ${domainProject.events.length > 0
      ? `
                    <div class="table-wrap top-gap event-staffing-scroll-box event-staffing-preferences-scroll-box">
                      <table class="data-table">
                        <thead>
                          <tr><th>Event</th><th>Date</th><th>Preference</th></tr>
                        </thead>
                        <tbody>
                          ${domainProject.events
        .slice()
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((event) => `
                              <tr>
                                <td><strong>${escapeHtml(event.label)}</strong></td>
                                <td>${escapeHtml(event.date || '—')}</td>
                                <td>
                                  <select name="draftPersonEventPreference" data-event-id="${escapeHtml(event.id)}">
                                    ${preferenceChoices.map((choice) => `<option value="${escapeHtml(choice.value)}"${(editor.draftPersonEventPreferences?.[event.id] ?? '') === choice.value ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`).join('')}
                                  </select>
                                </td>
                              </tr>
                            `).join('')}
                        </tbody>
                      </table>
                    </div>
                  `
      : '<p class="muted-text">Add events to set per-person prefer / prefer-not choices.</p>'}
                  <p class="muted-text top-gap">These values map to Y = prefer, N = prefer not, and empty = neutral.</p>
                </section>
              </div>
            </details>
          </form>
        </section>

        <section class="event-staffing-people-list-card">
          <div class="section-summary-row">
            <div>
              <h3>Saved people</h3>
              <p class="muted-text">Review the current roster, then edit a person only when they need exceptions or corrections.</p>
            </div>
          </div>

          ${domainProject.people.length > 0
      ? `
            <div class="table-wrap event-staffing-scroll-box">
              <table class="data-table">
                <thead>
                  <tr><th>Person</th><th>Max assignments</th><th>Soft target</th><th>Per-group max</th><th>Per-group target</th><th>Allowed groups</th><th>Forbidden groups</th><th>Imported preferences</th><th>Action</th></tr>
                </thead>
                <tbody>${renderPeopleRows(domainProject, groupTypeLabelsById)}</tbody>
              </table>
            </div>
          `
      : renderSupportEmptyState(
        'No people yet',
        'Add the first person in the quick-add form, then continue entering the rest of the roster one after another.',
        [
          'Each person can later have a hard maximum assignment count and an optional soft target.',
          'Eligibility exceptions can restrict some people to only certain group types or forbid specific ones.',
          'Advanced settings stay out of the way until you need them for a specific person.',
        ],
      )}
        </section>
      </div>
    </section>

    <section class="panel">
      <h2>⚙️ Global limits</h2>
      <p>Set shared defaults that apply unless a person-specific override is present.</p>
      <div class="form-grid four-columns compact-form-grid top-gap">
        <label>
          Max assignments per person
          <input type="number" name="draftGlobalMaxAssignmentsPerPerson" value="${escapeHtml(String(editor.draftGlobalMaxAssignmentsPerPerson ?? domainProject.globalLimits?.maxAssignmentsPerPerson ?? ''))}" min="0" step="1" placeholder="Optional" />
        </label>
        <label>
          Max assignments per group type
          <input type="number" name="draftGlobalMaxAssignmentsPerGroupType" value="${escapeHtml(String(editor.draftGlobalMaxAssignmentsPerGroupType ?? domainProject.globalLimits?.maxAssignmentsPerGroupType ?? ''))}" min="0" step="1" placeholder="Optional" />
        </label>
        <label>
          Soft target per group type
          <input type="number" name="draftGlobalTargetAssignmentsPerGroupType" value="${escapeHtml(String(editor.draftGlobalTargetAssignmentsPerGroupType ?? domainProject.globalLimits?.targetAssignmentsPerGroupType ?? ''))}" min="0" step="1" placeholder="Optional" />
        </label>
        <label class="button-label">
          Action
          <button type="button" class="event-staffing-primary-button" data-event-staffing-action="save-global-limits">Save limits</button>
        </label>
      </div>
    </section>

    <section class="panel">
      <h2>⏱️ Cooldown rules</h2>
      ${domainProject.cooldownRules.length > 0
      ? `
        <ul>
          ${domainProject.cooldownRules.map((rule, index) => `<li>Rule ${index + 1}: after ${escapeHtml(formatGroupTypeList(rule.triggerGroupTypes, groupTypeLabelsById))}, block ${escapeHtml(formatGroupTypeList(rule.blockedGroupTypes, groupTypeLabelsById))} for the next ${escapeHtml(String(rule.blockedNextEventCount))} event(s).</li>`).join('')}
        </ul>
      `
      : renderSupportEmptyState(
        'No cooldown rules yet',
        'That is valid for small or simple schedules. Add cooldown rules when staffing someone should block them from nearby future events.',
        [
          'Cooldowns use event order, not calendar-day arithmetic.',
          'A rule can block any next event or only specific group types for the next N events.',
        ],
      )}
    </section>

    <section class="panel">
      <h2>📌 Forced and forbidden assignments</h2>
      <h3>Forced</h3>
      ${renderAssignmentList(domainProject.forcedAssignments, domainProject, 'No forced assignments yet.')}
      <h3>Forbidden</h3>
      ${renderAssignmentList(domainProject.forbiddenAssignments, domainProject, 'No forbidden assignments yet.')}
    </section>

    <section class="panel">
      <h2>📥 Preference import</h2>
      <p>Expected spreadsheet semantics in V1:</p>
      <ul>
        <li><strong>Y</strong> = prefers being assigned on that event</li>
        <li><strong>N</strong> = prefers not being assigned on that event</li>
        <li><strong>empty</strong> = neutral</li>
      </ul>
    </section>
  `;
}
