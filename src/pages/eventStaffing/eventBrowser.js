import {
  createGroupTypeLabelsById,
  createRequirementsByEventId,
  escapeHtml,
  normalizeForSearch,
  summarizeRequirements,
} from './utils.js';

export function getEventBrowserState(state) {
  const editor = state?.eventStaffingPage?.editor ?? {};
  const selectedEventIds = Array.isArray(editor.selectedEventIds)
    ? editor.selectedEventIds.filter((eventId) => typeof eventId === 'string' && eventId.length > 0)
    : [];

  return {
    searchText: typeof editor.eventSearchText === 'string' ? editor.eventSearchText : '',
    onlyHeavyEvents: Boolean(editor.onlyHeavyEvents),
    selectedGroupTypeId: typeof editor.selectedGroupTypeId === 'string' && editor.selectedGroupTypeId.length > 0 ? editor.selectedGroupTypeId : 'all',
    selectedEventId: typeof editor.selectedEventId === 'string' ? editor.selectedEventId : '',
    selectedEventIds,
    bulkActionsExpanded: Boolean(editor.bulkActionsExpanded),
    draftBulkRequirementGroupTypeId: typeof editor.draftBulkRequirementGroupTypeId === 'string' ? editor.draftBulkRequirementGroupTypeId : '',
    draftBulkRequirementMin: typeof editor.draftBulkRequirementMin === 'string' ? editor.draftBulkRequirementMin : '0',
    draftBulkRequirementMax: typeof editor.draftBulkRequirementMax === 'string' ? editor.draftBulkRequirementMax : '1',
  };
}

export function selectVisibleEvent(domainProject, browserState) {
  const groupTypeLabelsById = createGroupTypeLabelsById(domainProject);
  const requirementsByEventId = createRequirementsByEventId(domainProject);

  const sortedEvents = domainProject.events
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex);

  const filteredEvents = sortedEvents.filter((event) => {
    const requirements = requirementsByEventId.get(event.id) ?? [];
    const haystack = [
      event.date,
      event.label,
      event.id,
      ...requirements.map((requirement) => groupTypeLabelsById.get(requirement.groupTypeId) ?? requirement.groupTypeId),
    ].map(normalizeForSearch).join(' ');

    const matchesSearch = !browserState.searchText || haystack.includes(normalizeForSearch(browserState.searchText));
    const matchesGroupType = browserState.selectedGroupTypeId === 'all'
      || requirements.some((requirement) => requirement.groupTypeId === browserState.selectedGroupTypeId);
    const totals = summarizeRequirements(requirements);
    const matchesLoadFilter = !browserState.onlyHeavyEvents || totals.totalMin >= 4;

    return matchesSearch && matchesGroupType && matchesLoadFilter;
  });

  const selectedEvent = filteredEvents.find((event) => event.id === browserState.selectedEventId)
    ?? filteredEvents[0]
    ?? sortedEvents[0]
    ?? null;

  const selectedEventIds = filteredEvents
    .filter((event) => browserState.selectedEventIds.includes(event.id))
    .map((event) => event.id);

  return {
    groupTypeLabelsById,
    requirementsByEventId,
    filteredEvents,
    selectedEvent,
    selectedEventIds,
    selectedRequirements: selectedEvent ? (requirementsByEventId.get(selectedEvent.id) ?? []) : [],
  };
}

export function syncSelectedEventDrafts(editor, selectedEvent, selectedRequirements) {
  if (!selectedEvent) {
    editor.lastSyncedSelectedEventId = '';
    editor.draftSelectedEventLabel = '';
    editor.draftSelectedEventDate = '';
    editor.draftSelectedEventOrderIndex = '';
    return;
  }

  const shouldRefresh = editor.lastSyncedSelectedEventId !== selectedEvent.id;

  if (shouldRefresh) {
    editor.selectedEventId = selectedEvent.id;
    editor.lastSyncedSelectedEventId = selectedEvent.id;
    editor.draftSelectedEventLabel = selectedEvent.label ?? '';
    editor.draftSelectedEventDate = selectedEvent.date ?? '';
    editor.draftSelectedEventOrderIndex = String(selectedEvent.orderIndex ?? '');
  }

  if (!editor.draftRequirementGroupTypeId) {
    editor.draftRequirementGroupTypeId = selectedRequirements[0]?.groupTypeId ?? '';
  }
}

function renderBulkCreateEventsSection(editor) {
  return `
    <details class="event-staffing-bulk-menu">
      <summary>Create events in bulk</summary>
      <div class="event-staffing-bulk-menu-body">
        <p class="muted-text">Create explicit events from a start date and end date. This helper writes concrete event rows into the domain project.</p>
        <div class="form-grid four-columns compact-form-grid top-gap">
          <label>
            <span class="tooltip-label">Start date<button type="button" class="field-tooltip" aria-label="Start date help" title="The first day to generate an event for. Generation includes this date.">?</button></span>
            <input type="date" name="draftRangeStartDate" value="${escapeHtml(editor.draftRangeStartDate ?? '')}" />
          </label>
          <label>
            <span class="tooltip-label">End date<button type="button" class="field-tooltip" aria-label="End date help" title="The last day to generate an event for. Generation includes this date.">?</button></span>
            <input type="date" name="draftRangeEndDate" value="${escapeHtml(editor.draftRangeEndDate ?? '')}" />
          </label>
          <label>
            <span class="tooltip-label">Label template<button type="button" class="field-tooltip" aria-label="Label template help" title="Template used to build each generated event label. Supported placeholders: {weekday}, {day}, {monthShort}, {month}, {year}.">?</button></span>
            <input type="text" name="draftRangeLabelTemplate" value="${escapeHtml(editor.draftRangeLabelTemplate ?? '')}" placeholder="{weekday} {day} {monthShort} {year}" />
          </label>
          <label class="button-label">
            <span class="tooltip-label">Action<button type="button" class="field-tooltip" aria-label="Generate events help" title="Creates one event per day in the selected inclusive date range using the label template.">?</button></span>
            <button type="button" data-event-staffing-action="generate-events">Generate events</button>
          </label>
        </div>
      </div>
    </details>
  `;
}

function renderEventBrowserEmptyState(domainProject) {
  const hasGroupTypes = domainProject.groupTypes.length > 0;
  const hasPeople = domainProject.people.length > 0;

  return `
    <div class="empty-board event-staffing-empty-state top-gap">
      <h4>No events yet</h4>
      <p>Create your first event to start building an ordered staffing schedule.</p>
      <ul class="empty-state-checklist">
        <li>Use the bulk creator here to generate a date range when you already know the schedule window.</li>
        <li>Once an event exists, you can insert more before or after it and add staffing requirements in the detail panel.</li>
        <li>${escapeHtml(hasGroupTypes ? 'Group types are ready, so you can immediately attach requirements after creating an event.' : 'Define at least one group type so events can request staffing groups.')}</li>
        <li>${escapeHtml(hasPeople ? 'People are already defined, so the schedule will be solvable once events and requirements exist.' : 'Add people later so the planner has assignable staff when you run solve.')}</li>
      </ul>
    </div>
  `;
}

export function renderEventBrowser(domainProject, browserState, selection, editor) {
  const { groupTypeLabelsById, requirementsByEventId, filteredEvents, selectedEvent, selectedEventIds } = selection;

  const tableRows = filteredEvents.length
    ? filteredEvents.map((event) => {
      const requirements = requirementsByEventId.get(event.id) ?? [];
      const totals = summarizeRequirements(requirements);
      const summary = requirements.length
        ? requirements.map((requirement) => groupTypeLabelsById.get(requirement.groupTypeId) ?? requirement.groupTypeId).join(', ')
        : 'None';
      const isSelected = selectedEvent?.id === event.id;
      const isMultiSelected = selectedEventIds.includes(event.id);

      return `
        <tr class="${isSelected ? 'event-staffing-selected-row' : ''}${isMultiSelected ? ' event-staffing-multi-selected-row' : ''}">
          <td><input type="checkbox" data-event-staffing-action="toggle-event-multi-select" data-event-id="${escapeHtml(event.id)}"${isMultiSelected ? ' checked' : ''} aria-label="Select ${escapeHtml(event.label)}" /></td>
          <td>${escapeHtml(event.date || '—')}</td>
          <td><strong>${escapeHtml(event.label)}</strong><div class="muted-text">${escapeHtml(event.id)}</div></td>
          <td>${escapeHtml(String(event.orderIndex + 1))}</td>
          <td>${escapeHtml(String(requirements.length))}</td>
          <td>${escapeHtml(`${totals.totalMin}–${totals.totalMax}`)}</td>
          <td>${escapeHtml(summary)}</td>
          <td><button type="button" data-event-staffing-action="select-event" data-event-id="${escapeHtml(event.id)}">${isSelected ? 'Open' : 'Focus'}</button></td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="7">No events match the current filters.</td></tr>';

  return `
    <section class="workspace-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Event browser</p>
          <h3>📅 Events</h3>
          <p class="muted-text">Browse ordered events and open one event at a time for editing.</p>
        </div>
        <span class="panel-count">${escapeHtml(String(filteredEvents.length))} shown · ${escapeHtml(String(selectedEventIds.length))} selected</span>
      </div>

      <div class="form-grid three-columns compact-form-grid">
        <label>
          Search
          <input type="search" name="eventSearchText" value="${escapeHtml(browserState.searchText)}" placeholder="Search by date, label, id, or group type" />
        </label>
        <label>
          Group type
          <select name="selectedGroupTypeId">
            <option value="all">All group types</option>
            ${domainProject.groupTypes.map((groupType) => `<option value="${escapeHtml(groupType.id)}"${browserState.selectedGroupTypeId === groupType.id ? ' selected' : ''}>${escapeHtml(groupType.label)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Load filter</span>
          <div>
            <input type="checkbox" name="onlyHeavyEvents"${browserState.onlyHeavyEvents ? ' checked' : ''} />
            <span>Only show events with total min staffing ≥ 4</span>
          </div>
        </label>
      </div>

      <div class="event-staffing-expandable-row top-gap">
        ${renderBulkCreateEventsSection(editor)}

        <details class="event-staffing-bulk-menu" data-event-staffing-panel="bulk-actions"${browserState.bulkActionsExpanded ? ' open' : ''}>
        <summary>Bulk actions for selected events</summary>
        <div class="event-staffing-bulk-menu-body">
          <p class="muted-text">Use this separate section for multi-event creation and requirement actions without making the main command bar too large.</p>
          <div class="form-grid four-columns compact-form-grid top-gap">
            <label>
              Group type
              <select name="draftBulkRequirementGroupTypeId">
                <option value="">Select group type</option>
                ${domainProject.groupTypes.map((groupType) => `<option value="${escapeHtml(groupType.id)}"${browserState.draftBulkRequirementGroupTypeId === groupType.id ? ' selected' : ''}>${escapeHtml(groupType.label)}</option>`).join('')}
              </select>
              <span class="muted-text">Which staffing group to add, update, or remove across the selected events.</span>
            </label>
            <label>
              Min
              <input type="number" name="draftBulkRequirementMin" value="${escapeHtml(browserState.draftBulkRequirementMin ?? '')}" min="0" step="1" />
              <span class="muted-text">Minimum required people from that group on each selected event.</span>
            </label>
            <label>
              Max
              <input type="number" name="draftBulkRequirementMax" value="${escapeHtml(browserState.draftBulkRequirementMax ?? '')}" min="0" step="1" />
              <span class="muted-text">Maximum allowed people from that group on each selected event.</span>
            </label>
            <div class="event-staffing-bulk-action-stack">
              <button type="button" data-event-staffing-action="bulk-assign-group-to-selected-events"${selectedEventIds.length === 0 ? ' disabled' : ''}>Assign group</button>
              <button type="button" data-event-staffing-action="bulk-remove-group-from-selected-events"${selectedEventIds.length === 0 ? ' disabled' : ''}>Remove group</button>
              <button type="button" data-event-staffing-action="bulk-copy-requirements-from-focused-event"${selectedEventIds.length === 0 ? ' disabled' : ''}>Copy from focused</button>
              <button type="button" class="ghost-danger-button" data-event-staffing-action="bulk-remove-all-requirements-from-selected-events"${selectedEventIds.length === 0 ? ' disabled' : ''}>Remove all requirements</button>
              <button type="button" class="ghost-danger-button" data-event-staffing-action="delete-selected-events"${selectedEventIds.length === 0 ? ' disabled' : ''}>Delete selected events</button>
            </div>
          </div>
          <p class="muted-text top-gap">Assign group creates or updates the selected group requirement on every selected event. Remove group deletes only that group requirement from the selection. Copy from focused copies the full requirement pattern from the focused event to the rest of the selection.</p>
        </div>
      </details>
      </div>

      <div class="event-staffing-selection-toolbar top-gap">
        <div class="event-staffing-bulk-toolbar">
          <button type="button" data-event-staffing-action="select-all-visible-events"${filteredEvents.length === 0 ? ' disabled' : ''}>Select all visible</button>
          <button type="button" data-event-staffing-action="clear-event-multi-select"${selectedEventIds.length === 0 ? ' disabled' : ''}>Clear selection</button>
        </div>
      </div>

      ${domainProject.events.length === 0
      ? renderEventBrowserEmptyState(domainProject)
      : `
        <div class="table-wrap event-staffing-scroll-box top-gap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Date</th>
                <th>Event</th>
                <th>Order</th>
                <th>Reqs</th>
                <th>Total min-max</th>
                <th>Group types</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>

      <p class="muted-text top-gap">Use the checkboxes to build a selection, then open the separate bulk-actions section when needed. The event list is scrollable so large schedules stay manageable.</p>
      `}
    </section>
  `;
}
