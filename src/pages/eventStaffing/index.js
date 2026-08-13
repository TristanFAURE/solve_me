import { renderPageShell } from '../../components/common/pageShell.js';
import { createMockDomainProject } from './mockDomainProject.js';
import {
  getEventBrowserState,
  renderEventBrowser,
  selectVisibleEvent,
  syncSelectedEventDrafts,
} from './eventBrowser.js';
import { renderSelectedEventEditor } from './selectedEventEditor.js';
import { renderSupportSections } from './summarySections.js';
import { createEventId, escapeHtml, normalizeEventOrderIndexes, slugifyLabel } from './utils.js';
import { validateEventStaffingProject } from './validateEventStaffingProject.js';
import { renderValidationPanel } from '../../components/solutions/validationPanel.js';
import { transformEventStaffingProject } from '../../core/transform/eventStaffingProject.js';
import { normalizeProject } from '../../core/normalize/normalizeProject.js';
import { validateProject } from '../../core/validate/validateProject.js';
import { FirstSolverAdapter } from '../../solver/adapters/firstSolverAdapter.js';
import { renderSolutionPanel } from '../../components/solutions/solutionPanel.js';

function getGroupTypeLabelMap(domainProject) {
  return new Map(domainProject.groupTypes.map((groupType) => [groupType.id, groupType.label]));
}

function getPersonLookup(domainProject) {
  return new Map(domainProject.people.map((person) => [person.id, person]));
}

function getEventLookup(domainProject) {
  return new Map(domainProject.events.map((event) => [event.id, event]));
}

function parseContainerAssignmentId(containerId) {
  if (typeof containerId !== 'string' || containerId.length === 0) {
    return null;
  }

  if (containerId.startsWith('event:')) {
    const trimmed = containerId.slice('event:'.length);
    const separator = '::group:';
    const separatorIndex = trimmed.indexOf(separator);
    if (separatorIndex < 0) {
      return null;
    }

    return {
      eventId: trimmed.slice(0, separatorIndex),
      groupTypeId: trimmed.slice(separatorIndex + separator.length),
    };
  }

  if (containerId.startsWith('event__')) {
    const trimmed = containerId.slice('event__'.length);
    const separator = '__group__';
    const separatorIndex = trimmed.indexOf(separator);
    if (separatorIndex < 0) {
      return null;
    }

    return {
      eventId: trimmed.slice(0, separatorIndex),
      groupTypeId: trimmed.slice(separatorIndex + separator.length),
    };
  }

  return null;
}

function buildScheduleSummary(domainProject, solverResult, activeSolutionIndex = 0) {
  if (!solverResult || solverResult.status !== 'solved' || (solverResult.solutions?.length ?? 0) === 0) {
    return null;
  }

  const solutionCount = solverResult.solutions?.length ?? 0;
  const clampedSolutionIndex = solutionCount === 0
    ? 0
    : Math.min(Math.max(activeSolutionIndex, 0), solutionCount - 1);
  const solution = solverResult.solutions[clampedSolutionIndex];
  const groupTypeLabels = getGroupTypeLabelMap(domainProject);
  const peopleById = getPersonLookup(domainProject);
  const eventsById = getEventLookup(domainProject);
  const eventAssignments = new Map(domainProject.events.map((event) => [event.id, new Map()]));
  const personAssignments = new Map(domainProject.people.map((person) => [person.id, []]));

  solution.assignments.forEach((assignment) => {
    const personId = assignment.itemRef?.id;
    const destination = parseContainerAssignmentId(assignment.containerRef?.id ?? '');
    if (!personId || !destination) {
      return;
    }

    const eventGroupAssignments = eventAssignments.get(destination.eventId);
    if (!eventGroupAssignments) {
      return;
    }

    const assignedPeople = eventGroupAssignments.get(destination.groupTypeId) ?? [];
    assignedPeople.push(peopleById.get(personId)?.name ?? personId);
    assignedPeople.sort((left, right) => left.localeCompare(right));
    eventGroupAssignments.set(destination.groupTypeId, assignedPeople);

    const personEventAssignments = personAssignments.get(personId) ?? [];
    personEventAssignments.push({
      eventId: destination.eventId,
      groupTypeId: destination.groupTypeId,
      eventLabel: eventsById.get(destination.eventId)?.label ?? destination.eventId,
      groupTypeLabel: groupTypeLabels.get(destination.groupTypeId) ?? destination.groupTypeId,
      orderIndex: eventsById.get(destination.eventId)?.orderIndex ?? Number.MAX_SAFE_INTEGER,
    });
    personAssignments.set(personId, personEventAssignments);
  });

  personAssignments.forEach((assignments) => {
    assignments.sort((left, right) => left.orderIndex - right.orderIndex);
  });

  return {
    eventAssignments,
    personAssignments,
    groupTypeLabels,
    clampedSolutionIndex,
    solutionCount,
  };
}

function buildSolutionOptionSummary(domainProject, solverResult, solutionIndex) {
  const summary = buildScheduleSummary(domainProject, solverResult, solutionIndex);
  if (!summary) {
    return null;
  }

  const totalAssignments = [...summary.personAssignments.values()]
    .reduce((total, assignments) => total + assignments.length, 0);
  const staffedEventCount = [...summary.eventAssignments.values()]
    .reduce((total, assignmentMap) => {
      const hasAssignments = [...assignmentMap.values()].some((assignedPeople) => assignedPeople.length > 0);
      return total + (hasAssignments ? 1 : 0);
    }, 0);

  return {
    solutionNumber: summary.clampedSolutionIndex + 1,
    totalAssignments,
    staffedEventCount,
  };
}

export function renderStaffingScheduleView(domainProject, solverResult, activeSolutionIndex = 0) {
  const scheduleSummary = buildScheduleSummary(domainProject, solverResult, activeSolutionIndex);
  if (!scheduleSummary) {
    return renderSolutionPanel(
      null,
      solverResult,
      0,
      {
        panelTitle: 'Staffing schedule',
        panelEyebrow: 'Planner-facing schedule view',
        emptyResultMessage: 'Run transform + solve to see a staffing schedule.',
        unsatMessage: 'No valid staffing plan was found for the current hard constraints.',
        noWarningsMessage: 'No solver warnings for the staffing solve.',
        rawJsonSummaryLabel: 'View raw staffing solver result JSON',
      },
    );
  }

  const eventRows = domainProject.events
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((event) => {
      const requirements = domainProject.requirements.filter((requirement) => requirement.eventId === event.id);
      const assignmentMap = scheduleSummary.eventAssignments.get(event.id) ?? new Map();
      const requirementRows = requirements.length > 0
        ? requirements.map((requirement) => {
          const assignedPeople = assignmentMap.get(requirement.groupTypeId) ?? [];
          return `
            <tr>
              <td>${escapeHtml(scheduleSummary.groupTypeLabels.get(requirement.groupTypeId) ?? requirement.groupTypeId)}</td>
              <td>${escapeHtml(String(requirement.min))}</td>
              <td>${escapeHtml(String(requirement.max))}</td>
              <td>${escapeHtml(String(assignedPeople.length))}</td>
              <td>${assignedPeople.length > 0 ? escapeHtml(assignedPeople.join(', ')) : '<span class="muted-text">Unassigned</span>'}</td>
            </tr>
          `;
        }).join('')
        : '<tr><td colspan="5" class="muted-text">No active group requirements for this event.</td></tr>';

      return `
        <section class="workspace-panel top-gap">
          <h3>${escapeHtml(event.label)}</h3>
          <p class="muted-text">${escapeHtml(event.date || 'No date')} · ${escapeHtml(String(requirements.length))} active requirement(s)</p>
          <table class="data-table top-gap">
            <thead>
              <tr>
                <th>Group</th>
                <th>Min</th>
                <th>Max</th>
                <th>Assigned</th>
                <th>People</th>
              </tr>
            </thead>
            <tbody>${requirementRows}</tbody>
          </table>
        </section>
      `;
    }).join('');

  const personRows = domainProject.people
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((person) => {
      const assignments = scheduleSummary.personAssignments.get(person.id) ?? [];
      const perGroupCounts = new Map();
      assignments.forEach((assignment) => {
        perGroupCounts.set(assignment.groupTypeId, (perGroupCounts.get(assignment.groupTypeId) ?? 0) + 1);
      });
      const perGroupSummary = [...perGroupCounts.entries()]
        .map(([groupTypeId, count]) => `${scheduleSummary.groupTypeLabels.get(groupTypeId) ?? groupTypeId}: ${count}`)
        .join(', ');
      const assignmentSummary = assignments.length > 0
        ? assignments.map((assignment) => `${assignment.eventLabel} (${assignment.groupTypeLabel})`).join(', ')
        : 'No assignments';

      return `
        <tr>
          <td>${escapeHtml(person.name)}</td>
          <td>${escapeHtml(String(assignments.length))}</td>
          <td>${escapeHtml(String(person.maxAssignments ?? domainProject.globalLimits?.maxAssignmentsPerPerson ?? '—'))}</td>
          <td>${escapeHtml(String(person.targetAssignments ?? '—'))}</td>
          <td>${perGroupSummary ? escapeHtml(perGroupSummary) : '<span class="muted-text">No group usage</span>'}</td>
          <td>${assignments.length > 0 ? escapeHtml(assignmentSummary) : '<span class="muted-text">No assignments</span>'}</td>
        </tr>
      `;
    }).join('');

  const warnings = solverResult.warnings ?? [];
  const solutionOptions = Array.from({ length: scheduleSummary.solutionCount }, (_, solutionIndex) => buildSolutionOptionSummary(
    domainProject,
    solverResult,
    solutionIndex,
  ));

  return `
    <section class="panel">
      <h2>🗓️ Staffing schedule</h2>
      <p class="muted-text">Planner-facing event and person summaries for the selected returned solution.</p>
      <dl class="summary-grid compact-summary-grid top-gap">
        <div><dt>Status</dt><dd>${escapeHtml(solverResult.status)}</dd></div>
        <div><dt>Solutions</dt><dd>${escapeHtml(String(solverResult.solutions?.length ?? 0))}</dd></div>
        <div><dt>Showing</dt><dd>Solution ${escapeHtml(String(scheduleSummary.clampedSolutionIndex + 1))}</dd></div>
        <div><dt>Warnings</dt><dd>${escapeHtml(String(warnings.length))}</dd></div>
        <div><dt>Runtime</dt><dd>${escapeHtml(String(solverResult.runtimeMs))} ms</dd></div>
      </dl>
      ${(solverResult.solutions?.length ?? 0) > 1 ? `
        <section class="workspace-panel top-gap">
          <h3>Returned solutions</h3>
          <p class="muted-text">Use previous/next for quick browsing or jump directly to a returned solution from the picker.</p>
          <div class="event-staffing-inline-actions top-gap">
            <button type="button" data-event-staffing-action="show-previous-solution"${scheduleSummary.clampedSolutionIndex <= 0 ? ' disabled' : ''}>Previous solution</button>
            <button type="button" data-event-staffing-action="show-next-solution"${scheduleSummary.clampedSolutionIndex >= (solverResult.solutions.length - 1) ? ' disabled' : ''}>Next solution</button>
            <label>
              <span class="muted-text">Jump to solution</span>
              <select name="activeStaffingSolutionIndex">
                ${solutionOptions.map((option, index) => option ? `<option value="${escapeHtml(String(index))}"${index === scheduleSummary.clampedSolutionIndex ? ' selected' : ''}>Solution ${escapeHtml(String(option.solutionNumber))} · ${escapeHtml(String(option.totalAssignments))} assignment(s) · ${escapeHtml(String(option.staffedEventCount))} staffed event(s)</option>` : '').join('')}
              </select>
            </label>
          </div>
        </section>
      ` : ''}
      ${warnings.length > 0 ? `<ul class="issue-list compact-issue-list top-gap">${warnings.map((warning) => `<li class="issue-list-item warning"><div>${escapeHtml(warning)}</div></li>`).join('')}</ul>` : '<p class="muted-text top-gap">No solver warnings for the staffing solve.</p>'}
      <div class="workspace-layout top-gap">
        <section class="workspace-panel">
          <h3>Event-centric view</h3>
          <div class="event-staffing-scroll-box top-gap">
            ${eventRows}
          </div>
        </section>
        <section class="workspace-panel">
          <h3>Person-centric view</h3>
          <div class="table-wrap event-staffing-scroll-box top-gap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Total</th>
                  <th>Hard max</th>
                  <th>Soft target</th>
                  <th>Per-group usage</th>
                  <th>Assignments</th>
                </tr>
              </thead>
              <tbody>${personRows}</tbody>
            </table>
          </div>
        </section>
      </div>
      <details class="details-panel top-gap">
        <summary>View raw staffing solver result JSON</summary>
        <pre class="json-block">${escapeHtml(JSON.stringify(solverResult, null, 2))}</pre>
      </details>
    </section>
  `;
}

function describeDeleteImpact(domainProject, eventIdsToDelete) {
  const idsToDelete = new Set(eventIdsToDelete);
  const eventCount = domainProject.events.filter((event) => idsToDelete.has(event.id)).length;
  const requirementCount = domainProject.requirements.filter((requirement) => idsToDelete.has(requirement.eventId)).length;
  const forcedCount = domainProject.forcedAssignments.filter((assignment) => idsToDelete.has(assignment.eventId)).length;
  const forbiddenCount = domainProject.forbiddenAssignments.filter((assignment) => idsToDelete.has(assignment.eventId)).length;
  const preferenceCount = domainProject.preferences.reduce(
    (total, preference) => total + Object.keys(preference.eventPreferences ?? {}).filter((eventId) => idsToDelete.has(eventId)).length,
    0,
  );

  return {
    eventCount,
    requirementCount,
    forcedCount,
    forbiddenCount,
    preferenceCount,
  };
}

export function buildDeleteEventsConfirmationMessage(domainProject, eventIdsToDelete) {
  const impact = describeDeleteImpact(domainProject, eventIdsToDelete);
  if (impact.eventCount === 0) {
    return 'No matching events were found to delete.';
  }

  return impact.eventCount === 1
    ? `Delete 1 event and remove ${impact.requirementCount} requirement(s), ${impact.forcedCount} forced assignment(s), ${impact.forbiddenCount} forbidden assignment(s), and ${impact.preferenceCount} preference cell(s)?`
    : `Delete ${impact.eventCount} events and remove ${impact.requirementCount} requirement(s), ${impact.forcedCount} forced assignment(s), ${impact.forbiddenCount} forbidden assignment(s), and ${impact.preferenceCount} preference cell(s)?`;
}

export function buildRemoveAllRequirementsConfirmationMessage(domainProject, editor) {
  const eventIds = new Set(Array.isArray(editor.selectedEventIds) ? editor.selectedEventIds : []);
  const removedCount = domainProject.requirements.filter((requirement) => eventIds.has(requirement.eventId)).length;
  if (eventIds.size === 0) {
    return 'Select at least one event before removing all requirements.';
  }

  return `Remove all requirements from ${eventIds.size} selected event(s)? This will delete ${removedCount} requirement row(s).`;
}

function renderTransformedProjectSummary(project) {
  if (!project) {
    return '';
  }

  return `
    <section class="panel">
      <h2>🔁 Transformed project</h2>
      <dl class="summary-grid compact-summary-grid">
        <div><dt>Items</dt><dd>${escapeHtml(String(project.items.length))}</dd></div>
        <div><dt>Containers</dt><dd>${escapeHtml(String(project.containers.length))}</dd></div>
        <div><dt>Assignment exclusions</dt><dd>${escapeHtml(String(project.assignmentExclusions.length))}</dd></div>
        <div><dt>Assignment upper bounds</dt><dd>${escapeHtml(String(project.assignmentCountUpperBounds.length))}</dd></div>
        <div><dt>Fixed assignments</dt><dd>${escapeHtml(String(project.fixedAssignments.length))}</dd></div>
        <div><dt>Forbidden assignments</dt><dd>${escapeHtml(String(project.forbiddenAssignments.length))}</dd></div>
        <div><dt>Soft assignment scores</dt><dd>${escapeHtml(String(project.softAssignmentScores.length))}</dd></div>
        <div><dt>Soft count targets</dt><dd>${escapeHtml(String(project.softItemCountTargets.length))}</dd></div>
      </dl>
      <details class="details-panel top-gap">
        <summary>View transformed project JSON</summary>
        <pre class="json-block">${escapeHtml(JSON.stringify(project, null, 2))}</pre>
      </details>
    </section>
  `;
}

function renderWorkflowPanel(state) {
  const solverAdapter = new FirstSolverAdapter();
  const capabilities = solverAdapter.getCapabilities();
  const genericValidation = state.eventStaffingPage.lastGenericValidation;
  const normalizedProject = state.eventStaffingPage.lastNormalizedProject;
  const workflowExpanded = Boolean(state.eventStaffingPage.workflowCommandBarExpanded);

  return `
    <section class="command-bar-card ${workflowExpanded ? '' : 'is-collapsed'}">
      <div class="command-bar-header">
        <div class="command-bar-copy">
          <p class="eyebrow">Planner workflow</p>
          <h2>🧭 Validate, transform, and solve</h2>
          <p class="muted-text">${escapeHtml(state.eventStaffingPage.message || 'Use validate, transform, and solve to run the staffing planner workflow.')}</p>
        </div>
        <button type="button" class="command-bar-button command-bar-toggle" data-event-staffing-action="toggle-workflow-command-bar">${workflowExpanded ? 'Collapse' : 'Expand'}</button>
      </div>
      <div class="command-bar-actions">
        <button type="button" class="command-bar-button" data-event-staffing-action="validate-domain-project">Validate domain project</button>
        <button type="button" class="command-bar-button" data-event-staffing-action="transform-domain-project">Transform project</button>
        <button type="button" class="command-bar-button command-bar-button-primary" data-event-staffing-action="solve-domain-project">Transform + solve</button>
      </div>
      ${workflowExpanded ? `
        <div class="stacked-form-sections top-gap">
          <section class="workspace-panel">
            <h3>Solver support summary</h3>
            <p class="muted-text">Active solver: First solver adapter. Hard assignment-oriented staffing constraints are supported. Soft scores and soft targets are transformed but currently ignored by this solver.</p>
            <dl class="summary-grid compact-summary-grid top-gap">
              <div><dt>Hard constraints</dt><dd>${capabilities.hardConstraints ? 'Supported' : 'Unsupported'}</dd></div>
              <div><dt>Assignment exclusions</dt><dd>${capabilities.assignmentExclusions ? 'Supported' : 'Unsupported'}</dd></div>
              <div><dt>Upper bounds</dt><dd>${capabilities.scopedAssignmentUpperBounds ? 'Supported' : 'Unsupported'}</dd></div>
              <div><dt>Fixed / forbidden</dt><dd>${capabilities.fixedAssignments && capabilities.forbiddenAssignments ? 'Supported' : 'Partial'}</dd></div>
              <div><dt>Soft assignment scores</dt><dd>${capabilities.softAssignmentScores ? 'Supported' : 'Ignored by solver'}</dd></div>
              <div><dt>Soft count targets</dt><dd>${capabilities.softItemCountTargets ? 'Supported' : 'Ignored by solver'}</dd></div>
            </dl>
          </section>
        </div>
      ` : ''}
    </section>

    ${renderValidationPanel(state.eventStaffingPage.lastValidation, {
    expanded: state.eventStaffingPage.validationPanelExpanded,
    hasComputedSolution: Boolean(state.eventStaffingPage.lastSolverResult),
  })}

    ${genericValidation ? renderValidationPanel(genericValidation, {
    expanded: true,
    hasComputedSolution: Boolean(state.eventStaffingPage.lastSolverResult),
  }) : ''}

    ${renderTransformedProjectSummary(normalizedProject)}

    ${renderStaffingScheduleView(
    state.eventStaffingPage.domainProject,
    state.eventStaffingPage.lastSolverResult,
    state.eventStaffingPage.activeSolutionIndex ?? 0,
  )}
  `;
}

function renderBody(domainProject, state) {
  const editor = state.eventStaffingPage.editor;
  const browserState = getEventBrowserState(state);
  const selection = selectVisibleEvent(domainProject, browserState);

  syncSelectedEventDrafts(editor, selection.selectedEvent, selection.selectedRequirements);

  const validation = state.eventStaffingPage.lastValidation ?? validateEventStaffingProject(domainProject);
  state.eventStaffingPage.lastValidation = validation;

  return `
    ${renderWorkflowPanel(state)}

    <section class="panel">
      <h2>📅 Events</h2>
      <p>Use the event browser for focused editing, bulk requirement actions, and schedule generation.</p>
      <div class="workspace-layout">
        ${renderEventBrowser(domainProject, browserState, selection, editor)}
        ${renderSelectedEventEditor(
    selection.selectedEvent,
    selection.selectedRequirements,
    domainProject,
    editor,
    selection.groupTypeLabelsById,
  )}
      </div>
    </section>

    ${renderSupportSections(domainProject, selection.groupTypeLabelsById, editor)}
  `;
}

export function parseNonNegativeInteger(value, fallbackValue) {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : fallbackValue;
}

export function insertEventNearSelection(domainProject, editor, selectedEvent) {
  if (!selectedEvent) {
    return 'Select an event before inserting a new one.';
  }

  const label = String(editor.draftInsertedEventLabel ?? '').trim();
  if (!label) {
    return 'Enter a label before inserting an event.';
  }

  const normalizedEvents = domainProject.events
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex);
  const selectedIndex = normalizedEvents.findIndex((event) => event.id === selectedEvent.id);
  const insertOffset = editor.draftInsertedEventPosition === 'before' ? 0 : 1;
  const insertIndex = selectedIndex >= 0 ? selectedIndex + insertOffset : normalizedEvents.length;
  const existingIds = new Set(domainProject.events.map((event) => event.id));

  normalizedEvents.splice(insertIndex, 0, {
    id: createEventId(label, editor.draftInsertedEventDate, existingIds),
    label,
    date: String(editor.draftInsertedEventDate ?? '').trim(),
    orderIndex: insertIndex,
  });

  domainProject.events = normalizeEventOrderIndexes(normalizedEvents);
  const insertedEvent = domainProject.events[insertIndex];
  editor.selectedEventId = insertedEvent?.id ?? selectedEvent.id;
  editor.selectedEventIds = insertedEvent ? [insertedEvent.id] : [];
  editor.lastSyncedSelectedEventId = '';
  editor.draftInsertedEventLabel = '';
  editor.draftInsertedEventDate = '';

  return `Inserted event "${label}" ${editor.draftInsertedEventPosition} "${selectedEvent.label}".`;
}

export function addOrUpdateRequirementForEvent(domainProject, eventId, groupTypeId, min, max) {
  const existingRequirement = domainProject.requirements.find(
    (requirement) => requirement.eventId === eventId && requirement.groupTypeId === groupTypeId,
  );

  if (existingRequirement) {
    existingRequirement.min = min;
    existingRequirement.max = max;
    return 'updated';
  }

  domainProject.requirements.push({ eventId, groupTypeId, min, max });
  return 'created';
}

export function addRequirementToSelectedEvent(domainProject, editor) {
  const eventId = editor.selectedEventId;
  const groupTypeId = String(editor.draftRequirementGroupTypeId ?? '').trim();
  if (!eventId) {
    return 'Select an event before adding a requirement.';
  }
  if (!groupTypeId) {
    return 'Select a group type before adding a requirement.';
  }

  const min = parseNonNegativeInteger(editor.draftRequirementMin, 0);
  const max = parseNonNegativeInteger(editor.draftRequirementMax, min);
  if (min > max) {
    return 'Requirement min cannot be greater than max.';
  }

  const result = addOrUpdateRequirementForEvent(domainProject, eventId, groupTypeId, min, max);
  return result === 'created'
    ? 'Added requirement to the selected event.'
    : 'Updated the existing requirement on the selected event.';
}

export function removeRequirementFromSelectedEvent(domainProject, editor, requirementIndex) {
  const eventId = editor.selectedEventId;
  const eventRequirements = domainProject.requirements
    .map((requirement, index) => ({ requirement, index }))
    .filter((entry) => entry.requirement.eventId === eventId);
  const matchedEntry = eventRequirements[requirementIndex];

  if (!matchedEntry) {
    return 'No matching requirement was found to remove.';
  }

  domainProject.requirements.splice(matchedEntry.index, 1);
  return 'Removed requirement from the selected event.';
}

export function bulkAssignGroupToSelectedEvents(domainProject, editor) {
  const eventIds = Array.isArray(editor.selectedEventIds) ? editor.selectedEventIds : [];
  const groupTypeId = String(editor.draftBulkRequirementGroupTypeId ?? '').trim();
  if (eventIds.length === 0) {
    return 'Select at least one event before applying a bulk group action.';
  }
  if (!groupTypeId) {
    return 'Select a group type before applying a bulk group action.';
  }

  const min = parseNonNegativeInteger(editor.draftBulkRequirementMin, 0);
  const max = parseNonNegativeInteger(editor.draftBulkRequirementMax, min);
  if (min > max) {
    return 'Bulk requirement min cannot be greater than max.';
  }

  let createdCount = 0;
  let updatedCount = 0;
  eventIds.forEach((eventId) => {
    const result = addOrUpdateRequirementForEvent(domainProject, eventId, groupTypeId, min, max);
    if (result === 'created') {
      createdCount += 1;
    } else {
      updatedCount += 1;
    }
  });

  return `Bulk assigned group to ${eventIds.length} selected events (${createdCount} created, ${updatedCount} updated).`;
}

export function bulkRemoveGroupFromSelectedEvents(domainProject, editor) {
  const eventIds = new Set(Array.isArray(editor.selectedEventIds) ? editor.selectedEventIds : []);
  const groupTypeId = String(editor.draftBulkRequirementGroupTypeId ?? '').trim();
  if (eventIds.size === 0) {
    return 'Select at least one event before removing a bulk group.';
  }
  if (!groupTypeId) {
    return 'Select a group type before removing it from selected events.';
  }

  const previousCount = domainProject.requirements.length;
  domainProject.requirements = domainProject.requirements.filter(
    (requirement) => !(eventIds.has(requirement.eventId) && requirement.groupTypeId === groupTypeId),
  );
  const removedCount = previousCount - domainProject.requirements.length;

  return removedCount === 0
    ? 'No matching group requirements were found on the selected events.'
    : `Removed ${removedCount} group requirement(s) from the selected events.`;
}

export function bulkCopyRequirementsFromFocusedEvent(domainProject, editor) {
  const sourceEventId = editor.selectedEventId;
  const targetEventIds = (Array.isArray(editor.selectedEventIds) ? editor.selectedEventIds : []).filter((eventId) => eventId !== sourceEventId);
  if (!sourceEventId) {
    return 'Focus an event before copying requirements.';
  }
  if (targetEventIds.length === 0) {
    return 'Select at least one other event before copying requirements.';
  }

  const sourceRequirements = domainProject.requirements.filter((requirement) => requirement.eventId === sourceEventId);
  if (sourceRequirements.length === 0) {
    return 'The focused event has no requirements to copy.';
  }

  let updatedCount = 0;
  targetEventIds.forEach((targetEventId) => {
    sourceRequirements.forEach((requirement) => {
      const result = addOrUpdateRequirementForEvent(
        domainProject,
        targetEventId,
        requirement.groupTypeId,
        requirement.min,
        requirement.max,
      );
      if (result === 'updated') {
        updatedCount += 1;
      }
    });
  });

  return `Copied ${sourceRequirements.length} requirement pattern(s) from the focused event to ${targetEventIds.length} selected event(s). ${updatedCount} existing requirement(s) were updated.`;
}

export function bulkRemoveAllRequirementsFromSelectedEvents(domainProject, editor) {
  const eventIds = new Set(Array.isArray(editor.selectedEventIds) ? editor.selectedEventIds : []);
  if (eventIds.size === 0) {
    return 'Select at least one event before removing all requirements.';
  }

  const previousCount = domainProject.requirements.length;
  domainProject.requirements = domainProject.requirements.filter((requirement) => !eventIds.has(requirement.eventId));
  const removedCount = previousCount - domainProject.requirements.length;

  return removedCount === 0
    ? 'No requirements were found on the selected events.'
    : `Removed ${removedCount} requirement(s) from the selected events.`;
}

function formatGeneratedEventLabel(date, template) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const monthShort = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const month = date.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  return String(template ?? '{weekday} {day} {monthShort} {year}')
    .replaceAll('{weekday}', weekday)
    .replaceAll('{day}', day)
    .replaceAll('{monthShort}', monthShort)
    .replaceAll('{month}', month)
    .replaceAll('{year}', year);
}

function parseOptionalNonNegativeInteger(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const parsedValue = Number.parseInt(text, 10);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

function parseGroupTypeSelectionRows(rows, domainProject) {
  const rowList = Array.isArray(rows) ? rows : [];
  const knownGroupTypeIds = new Set(domainProject.groupTypes.map((groupType) => groupType.id));
  const parsed = {};

  for (const row of rowList) {
    const groupTypeId = String(row?.groupTypeId ?? '').trim();
    const valueText = String(row?.value ?? '').trim();

    if (!groupTypeId && !valueText) {
      continue;
    }

    if (!groupTypeId) {
      return { value: {}, valid: false, error: 'Select a group type for each per-group limit row.' };
    }

    if (!knownGroupTypeIds.has(groupTypeId)) {
      return { value: {}, valid: false, error: `Unknown group type id "${groupTypeId}".` };
    }

    if (!valueText) {
      return { value: {}, valid: false, error: `Enter a non-negative integer limit for group type "${groupTypeId}".` };
    }

    const count = Number.parseInt(valueText, 10);
    if (!Number.isInteger(count) || count < 0) {
      return { value: {}, valid: false, error: `Use a non-negative integer limit for group type "${groupTypeId}".` };
    }

    parsed[groupTypeId] = count;
  }

  return { value: parsed, valid: true, error: null };
}

function sanitizePersonEventPreferences(eventPreferences = {}) {
  const sanitized = {};

  Object.entries(eventPreferences ?? {}).forEach(([eventId, value]) => {
    if (value === 'Y' || value === 'N') {
      sanitized[eventId] = value;
    }
  });

  return sanitized;
}

function resetPersonEditor(editor) {
  editor.draftPersonName = '';
  editor.draftPersonId = '';
  editor.draftPersonMaxAssignments = '';
  editor.draftPersonTargetAssignments = '';
  editor.draftPersonMaxAssignmentsPerGroupTypeRows = [];
  editor.draftPersonTargetAssignmentsPerGroupTypeRows = [];
  editor.draftPersonAllowedGroupTypeIds = [];
  editor.draftPersonForbiddenGroupTypeIds = [];
  editor.draftPersonEventPreferences = {};
  editor.editingPersonIndex = null;
}

export function beginEditPerson(domainProject, editor, personIndex) {
  const person = domainProject.people[personIndex];
  if (!person) {
    return 'No matching person was found to edit.';
  }

  editor.editingPersonIndex = personIndex;
  editor.draftPersonName = person.name ?? '';
  editor.draftPersonId = person.id ?? '';
  editor.draftPersonMaxAssignments = person.maxAssignments ?? '';
  editor.draftPersonTargetAssignments = person.targetAssignments ?? '';
  editor.draftPersonMaxAssignmentsPerGroupTypeRows = Object.entries(person.maxAssignmentsPerGroupType ?? {})
    .map(([groupTypeId, value]) => ({ groupTypeId, value: String(value) }));
  editor.draftPersonTargetAssignmentsPerGroupTypeRows = Object.entries(person.targetAssignmentsPerGroupType ?? {})
    .map(([groupTypeId, value]) => ({ groupTypeId, value: String(value) }));
  editor.draftPersonAllowedGroupTypeIds = Array.isArray(person.allowedGroupTypeIds) ? [...person.allowedGroupTypeIds] : [];
  editor.draftPersonForbiddenGroupTypeIds = Array.isArray(person.forbiddenGroupTypeIds) ? [...person.forbiddenGroupTypeIds] : [];
  const existingPreferenceEntry = Array.isArray(domainProject.preferences)
    ? domainProject.preferences.find((preference) => preference.personId === person.id)
    : null;
  editor.draftPersonEventPreferences = { ...(existingPreferenceEntry?.eventPreferences ?? {}) };

  return `Editing person "${person.name}".`;
}

export function cancelEditPerson(editor) {
  resetPersonEditor(editor);
  return 'Cancelled person editing.';
}

export function addGroupType(domainProject, editor) {
  const label = String(editor.draftGroupTypeLabel ?? '').trim();
  const requestedId = String(editor.draftGroupTypeId ?? '').trim();
  if (!label) {
    return 'Enter a group type label before adding it.';
  }

  const id = requestedId || slugifyLabel(label) || 'group-type';
  if (domainProject.groupTypes.some((groupType) => groupType.id === id)) {
    return `Group type id "${id}" already exists.`;
  }

  domainProject.groupTypes.push({ id, label });
  editor.draftGroupTypeLabel = '';
  editor.draftGroupTypeId = '';
  editor.draftRequirementGroupTypeId = editor.draftRequirementGroupTypeId || id;
  editor.draftBulkRequirementGroupTypeId = editor.draftBulkRequirementGroupTypeId || id;

  return `Added group type "${label}".`;
}

export function removeGroupType(domainProject, groupTypeIndex, editor) {
  const groupType = domainProject.groupTypes[groupTypeIndex];
  if (!groupType) {
    return 'No matching group type was found to remove.';
  }

  domainProject.groupTypes.splice(groupTypeIndex, 1);
  domainProject.requirements = domainProject.requirements.filter((requirement) => requirement.groupTypeId !== groupType.id);
  domainProject.forcedAssignments = domainProject.forcedAssignments.filter((assignment) => assignment.groupTypeId !== groupType.id);
  domainProject.forbiddenAssignments = domainProject.forbiddenAssignments.filter((assignment) => assignment.groupTypeId !== groupType.id);
  domainProject.cooldownRules = domainProject.cooldownRules.filter((rule) => {
    const triggerMatches = rule.triggerGroupTypes === 'ANY' || rule.triggerGroupTypes.includes(groupType.id);
    const blockedMatches = rule.blockedGroupTypes === 'ANY' || rule.blockedGroupTypes.includes(groupType.id);
    return !(triggerMatches || blockedMatches);
  });
  domainProject.people = domainProject.people.map((person) => ({
    ...person,
    allowedGroupTypeIds: Array.isArray(person.allowedGroupTypeIds)
      ? person.allowedGroupTypeIds.filter((groupTypeId) => groupTypeId !== groupType.id)
      : [],
    forbiddenGroupTypeIds: Array.isArray(person.forbiddenGroupTypeIds)
      ? person.forbiddenGroupTypeIds.filter((groupTypeId) => groupTypeId !== groupType.id)
      : [],
  }));

  if (editor.draftRequirementGroupTypeId === groupType.id) {
    editor.draftRequirementGroupTypeId = '';
  }
  if (editor.draftBulkRequirementGroupTypeId === groupType.id) {
    editor.draftBulkRequirementGroupTypeId = '';
  }

  return `Removed group type "${groupType.label}" and related references.`;
}

export function addPerson(domainProject, editor) {
  const name = String(editor.draftPersonName ?? '').trim();
  const requestedId = String(editor.draftPersonId ?? '').trim();
  if (!name) {
    return 'Enter a person name before adding them.';
  }

  const allowedGroupTypeIds = Array.isArray(editor.draftPersonAllowedGroupTypeIds)
    ? editor.draftPersonAllowedGroupTypeIds.filter((groupTypeId) => typeof groupTypeId === 'string' && groupTypeId.trim().length > 0)
    : [];
  const forbiddenGroupTypeIds = Array.isArray(editor.draftPersonForbiddenGroupTypeIds)
    ? editor.draftPersonForbiddenGroupTypeIds.filter((groupTypeId) => typeof groupTypeId === 'string' && groupTypeId.trim().length > 0)
    : [];
  const maxByGroupResult = parseGroupTypeSelectionRows(editor.draftPersonMaxAssignmentsPerGroupTypeRows, domainProject);
  if (!maxByGroupResult.valid) {
    return maxByGroupResult.error;
  }
  const targetByGroupResult = parseGroupTypeSelectionRows(editor.draftPersonTargetAssignmentsPerGroupTypeRows, domainProject);
  if (!targetByGroupResult.valid) {
    return targetByGroupResult.error;
  }

  const editingPersonIndex = Number.isInteger(editor.editingPersonIndex) ? editor.editingPersonIndex : null;
  const currentPerson = editingPersonIndex !== null ? domainProject.people[editingPersonIndex] : null;
  const id = currentPerson?.id || requestedId || slugifyLabel(name) || 'person';
  if (domainProject.people.some((person, index) => person.id === id && index !== editingPersonIndex)) {
    return `Person id "${id}" already exists.`;
  }

  const nextPerson = {
    id,
    name,
    maxAssignments: parseOptionalNonNegativeInteger(editor.draftPersonMaxAssignments),
    targetAssignments: parseOptionalNonNegativeInteger(editor.draftPersonTargetAssignments),
    maxAssignmentsPerGroupType: maxByGroupResult.value,
    targetAssignmentsPerGroupType: targetByGroupResult.value,
    allowedGroupTypeIds,
    forbiddenGroupTypeIds,
  };
  const sanitizedEventPreferences = sanitizePersonEventPreferences(editor.draftPersonEventPreferences);

  if (editingPersonIndex !== null && currentPerson) {
    domainProject.people[editingPersonIndex] = nextPerson;
    domainProject.preferences = domainProject.preferences.filter((preference) => preference.personId !== id);
    if (Object.keys(sanitizedEventPreferences).length > 0) {
      domainProject.preferences.push({
        personId: id,
        eventPreferences: sanitizedEventPreferences,
      });
    }
    resetPersonEditor(editor);
    return `Saved person "${name}".`;
  }

  domainProject.people.push(nextPerson);
  if (Object.keys(sanitizedEventPreferences).length > 0) {
    domainProject.preferences = domainProject.preferences.filter((preference) => preference.personId !== id);
    domainProject.preferences.push({
      personId: id,
      eventPreferences: sanitizedEventPreferences,
    });
  }
  resetPersonEditor(editor);
  return `Added person "${name}".`;
}

export function removePerson(domainProject, personIndex, editor = null) {
  const person = domainProject.people[personIndex];
  if (!person) {
    return 'No matching person was found to remove.';
  }

  domainProject.people.splice(personIndex, 1);
  domainProject.preferences = domainProject.preferences.filter((preference) => preference.personId !== person.id);
  domainProject.forcedAssignments = domainProject.forcedAssignments.filter((assignment) => assignment.personId !== person.id);
  domainProject.forbiddenAssignments = domainProject.forbiddenAssignments.filter((assignment) => assignment.personId !== person.id);

  if (editor && editor.editingPersonIndex === personIndex) {
    resetPersonEditor(editor);
  }

  return `Removed person "${person.name}" and related references.`;
}

export function saveGlobalLimits(domainProject, editor) {
  domainProject.globalLimits = domainProject.globalLimits ?? {};
  domainProject.globalLimits.maxAssignmentsPerPerson = parseOptionalNonNegativeInteger(editor.draftGlobalMaxAssignmentsPerPerson);
  domainProject.globalLimits.maxAssignmentsPerGroupType = parseOptionalNonNegativeInteger(editor.draftGlobalMaxAssignmentsPerGroupType);
  domainProject.globalLimits.targetAssignmentsPerGroupType = parseOptionalNonNegativeInteger(editor.draftGlobalTargetAssignmentsPerGroupType);

  return 'Saved global staffing limits.';
}

export function generateEventsFromDateRange(domainProject, editor) {
  const startDateText = String(editor.draftRangeStartDate ?? '').trim();
  const endDateText = String(editor.draftRangeEndDate ?? '').trim();

  if (!startDateText || !endDateText) {
    return 'Enter both a start date and an end date before generating events.';
  }

  const startDate = new Date(`${startDateText}T00:00:00Z`);
  const endDate = new Date(`${endDateText}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Use valid start and end dates before generating events.';
  }
  if (startDate > endDate) {
    return 'The start date must be on or before the end date.';
  }

  const existingIds = new Set(domainProject.events.map((event) => event.id));
  const generatedEvents = [];
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    const dateText = cursor.toISOString().slice(0, 10);
    const label = formatGeneratedEventLabel(cursor, editor.draftRangeLabelTemplate);
    generatedEvents.push({
      id: createEventId(label, dateText, existingIds),
      label,
      date: dateText,
      orderIndex: domainProject.events.length + generatedEvents.length,
    });
    existingIds.add(generatedEvents[generatedEvents.length - 1].id);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  domainProject.events = normalizeEventOrderIndexes([...domainProject.events, ...generatedEvents]);
  editor.selectedEventId = generatedEvents[0]?.id ?? editor.selectedEventId;
  editor.selectedEventIds = generatedEvents.map((event) => event.id);
  editor.lastSyncedSelectedEventId = '';

  return `Generated ${generatedEvents.length} event(s) from ${startDateText} to ${endDateText}.`;
}

export function runEventStaffingWorkflow(domainProject, capabilities = null) {
  const domainValidation = validateEventStaffingProject(domainProject);
  if (!domainValidation.valid) {
    return {
      domainValidation,
      transformedProject: null,
      normalizedProject: null,
      genericValidation: null,
      solverResult: null,
      message: 'Fix the staffing-domain validation errors before transforming or solving.',
    };
  }

  const transformedProject = transformEventStaffingProject(domainProject);
  const normalizedProject = normalizeProject(transformedProject);
  const genericValidation = validateProject(normalizedProject, capabilities);

  return {
    domainValidation,
    transformedProject,
    normalizedProject,
    genericValidation,
    solverResult: null,
    message: genericValidation.valid
      ? 'The staffing project is valid and ready to solve.'
      : 'The staffing project transformed successfully but failed generic validation.',
  };
}

export function deleteEvents(domainProject, eventIdsToDelete, editor) {
  const idsToDelete = new Set(eventIdsToDelete);
  if (idsToDelete.size === 0) {
    return 'Select at least one event to delete.';
  }

  const deletedEvents = domainProject.events.filter((event) => idsToDelete.has(event.id));
  if (deletedEvents.length === 0) {
    return 'No matching events were found to delete.';
  }

  domainProject.events = normalizeEventOrderIndexes(domainProject.events.filter((event) => !idsToDelete.has(event.id)));
  domainProject.requirements = domainProject.requirements.filter((requirement) => !idsToDelete.has(requirement.eventId));
  domainProject.forcedAssignments = domainProject.forcedAssignments.filter((assignment) => !idsToDelete.has(assignment.eventId));
  domainProject.forbiddenAssignments = domainProject.forbiddenAssignments.filter((assignment) => !idsToDelete.has(assignment.eventId));
  domainProject.preferences = domainProject.preferences.map((preference) => ({
    ...preference,
    eventPreferences: Object.fromEntries(
      Object.entries(preference.eventPreferences ?? {}).filter(([eventId]) => !idsToDelete.has(eventId)),
    ),
  }));

  editor.selectedEventIds = [];
  editor.selectedEventId = domainProject.events[0]?.id ?? '';
  editor.lastSyncedSelectedEventId = '';

  return deletedEvents.length === 1
    ? `Deleted event "${deletedEvents[0].label}".`
    : `Deleted ${deletedEvents.length} events.`;
}

function clearWorkflowOutputs(state) {
  state.eventStaffingPage.lastTransformedProject = null;
  state.eventStaffingPage.lastNormalizedProject = null;
  state.eventStaffingPage.lastGenericValidation = null;
  state.eventStaffingPage.lastSolverResult = null;
  state.eventStaffingPage.activeSolutionIndex = 0;
}

function refreshValidation(state) {
  state.eventStaffingPage.lastValidation = validateEventStaffingProject(state.eventStaffingPage.domainProject);
  clearWorkflowOutputs(state);
}

function rerenderWithPreservedInputFocus(root, state, selector, selectionStart = null, selectionEnd = null) {
  renderEventStaffingPage(root, state);

  const input = root.querySelector(selector);
  if (!input) {
    return;
  }

  input.focus();
  if (typeof selectionStart === 'number' && typeof selectionEnd === 'number' && typeof input.setSelectionRange === 'function') {
    input.setSelectionRange(selectionStart, selectionEnd);
  }
}

function bindInteractions(root, state) {
  const rerender = () => renderEventStaffingPage(root, state);
  const editor = state.eventStaffingPage.editor;
  const domainProject = state.eventStaffingPage.domainProject;
  const browserState = getEventBrowserState(state);
  const selection = selectVisibleEvent(domainProject, browserState);

  const searchInput = root.querySelector('input[name="eventSearchText"]');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.eventStaffingPage.editor.eventSearchText = event.target.value;
      rerenderWithPreservedInputFocus(
        root,
        state,
        'input[name="eventSearchText"]',
        event.target.selectionStart,
        event.target.selectionEnd,
      );
    });
  }

  const groupTypeSelect = root.querySelector('select[name="selectedGroupTypeId"]');
  if (groupTypeSelect) {
    groupTypeSelect.addEventListener('change', (event) => {
      state.eventStaffingPage.editor.selectedGroupTypeId = event.target.value;
      rerender();
    });
  }

  const heavyEventsCheckbox = root.querySelector('input[name="onlyHeavyEvents"]');
  if (heavyEventsCheckbox) {
    heavyEventsCheckbox.addEventListener('change', (event) => {
      state.eventStaffingPage.editor.onlyHeavyEvents = event.target.checked;
      rerender();
    });
  }

  root.querySelectorAll('[data-event-staffing-action="select-event"]').forEach((button) => {
    button.addEventListener('click', () => {
      editor.selectedEventId = button.dataset.eventId || '';
      rerender();
    });
  });

  root.querySelectorAll('[data-event-staffing-action="toggle-event-multi-select"]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const eventId = checkbox.dataset.eventId || '';
      const current = new Set(Array.isArray(editor.selectedEventIds) ? editor.selectedEventIds : []);
      if (checkbox.checked) {
        current.add(eventId);
      } else {
        current.delete(eventId);
      }
      editor.selectedEventIds = [...current];
      rerender();
    });
  });

  const saveSelectedEventButton = root.querySelector('[data-event-staffing-action="save-selected-event"]');
  if (saveSelectedEventButton) {
    saveSelectedEventButton.addEventListener('click', () => {
      const selectedEvent = domainProject.events.find((event) => event.id === editor.selectedEventId);
      if (!selectedEvent) {
        state.eventStaffingPage.message = 'Select an event before saving details.';
        refreshValidation(state);
        rerender();
        return;
      }

      selectedEvent.label = String(editor.draftSelectedEventLabel ?? '').trim() || selectedEvent.label;
      selectedEvent.date = String(editor.draftSelectedEventDate ?? '').trim();
      selectedEvent.orderIndex = parseNonNegativeInteger(editor.draftSelectedEventOrderIndex, selectedEvent.orderIndex);
      domainProject.events = normalizeEventOrderIndexes(domainProject.events);
      editor.lastSyncedSelectedEventId = '';
      state.eventStaffingPage.message = `Saved event details for "${selectedEvent.label}".`;
      refreshValidation(state);
      rerender();
    });
  }

  const rangeStartDateInput = root.querySelector('input[name="draftRangeStartDate"]');
  if (rangeStartDateInput) {
    rangeStartDateInput.addEventListener('input', (event) => {
      editor.draftRangeStartDate = event.target.value;
    });
  }

  const rangeEndDateInput = root.querySelector('input[name="draftRangeEndDate"]');
  if (rangeEndDateInput) {
    rangeEndDateInput.addEventListener('input', (event) => {
      editor.draftRangeEndDate = event.target.value;
    });
  }

  const rangeLabelTemplateInput = root.querySelector('input[name="draftRangeLabelTemplate"]');
  if (rangeLabelTemplateInput) {
    rangeLabelTemplateInput.addEventListener('input', (event) => {
      editor.draftRangeLabelTemplate = event.target.value;
    });
  }

  const insertedEventLabelInput = root.querySelector('input[name="draftInsertedEventLabel"]');
  if (insertedEventLabelInput) {
    insertedEventLabelInput.addEventListener('input', (event) => {
      editor.draftInsertedEventLabel = event.target.value;
    });
  }

  const insertedEventDateInput = root.querySelector('input[name="draftInsertedEventDate"]');
  if (insertedEventDateInput) {
    insertedEventDateInput.addEventListener('input', (event) => {
      editor.draftInsertedEventDate = event.target.value;
    });
  }

  const insertedEventPositionSelect = root.querySelector('select[name="draftInsertedEventPosition"]');
  if (insertedEventPositionSelect) {
    insertedEventPositionSelect.addEventListener('change', (event) => {
      editor.draftInsertedEventPosition = event.target.value;
    });
  }

  const selectedEventLabelInput = root.querySelector('input[name="draftSelectedEventLabel"]');
  if (selectedEventLabelInput) {
    selectedEventLabelInput.addEventListener('input', (event) => {
      editor.draftSelectedEventLabel = event.target.value;
    });
  }

  const selectedEventDateInput = root.querySelector('input[name="draftSelectedEventDate"]');
  if (selectedEventDateInput) {
    selectedEventDateInput.addEventListener('input', (event) => {
      editor.draftSelectedEventDate = event.target.value;
    });
  }

  const selectedEventOrderInput = root.querySelector('input[name="draftSelectedEventOrderIndex"]');
  if (selectedEventOrderInput) {
    selectedEventOrderInput.addEventListener('input', (event) => {
      editor.draftSelectedEventOrderIndex = event.target.value;
    });
  }

  const requirementGroupTypeSelect = root.querySelector('select[name="draftRequirementGroupTypeId"]');
  if (requirementGroupTypeSelect) {
    requirementGroupTypeSelect.addEventListener('change', (event) => {
      editor.draftRequirementGroupTypeId = event.target.value;
    });
  }

  const requirementMinInput = root.querySelector('input[name="draftRequirementMin"]');
  if (requirementMinInput) {
    requirementMinInput.addEventListener('input', (event) => {
      editor.draftRequirementMin = event.target.value;
    });
  }

  const requirementMaxInput = root.querySelector('input[name="draftRequirementMax"]');
  if (requirementMaxInput) {
    requirementMaxInput.addEventListener('input', (event) => {
      editor.draftRequirementMax = event.target.value;
    });
  }

  const bulkRequirementGroupTypeSelect = root.querySelector('select[name="draftBulkRequirementGroupTypeId"]');
  if (bulkRequirementGroupTypeSelect) {
    bulkRequirementGroupTypeSelect.addEventListener('change', (event) => {
      editor.draftBulkRequirementGroupTypeId = event.target.value;
    });
  }

  const bulkRequirementMinInput = root.querySelector('input[name="draftBulkRequirementMin"]');
  if (bulkRequirementMinInput) {
    bulkRequirementMinInput.addEventListener('input', (event) => {
      editor.draftBulkRequirementMin = event.target.value;
    });
  }

  const bulkRequirementMaxInput = root.querySelector('input[name="draftBulkRequirementMax"]');
  if (bulkRequirementMaxInput) {
    bulkRequirementMaxInput.addEventListener('input', (event) => {
      editor.draftBulkRequirementMax = event.target.value;
    });
  }

  const bulkMenu = root.querySelector('[data-event-staffing-panel="bulk-actions"]');
  if (bulkMenu) {
    bulkMenu.addEventListener('toggle', () => {
      editor.bulkActionsExpanded = bulkMenu.open;
    });
  }

  const draftGroupTypeLabelInput = root.querySelector('input[name="draftGroupTypeLabel"]');
  if (draftGroupTypeLabelInput) {
    draftGroupTypeLabelInput.addEventListener('input', (event) => {
      editor.draftGroupTypeLabel = event.target.value;
    });
  }

  const draftGroupTypeIdInput = root.querySelector('input[name="draftGroupTypeId"]');
  if (draftGroupTypeIdInput) {
    draftGroupTypeIdInput.addEventListener('input', (event) => {
      editor.draftGroupTypeId = event.target.value;
    });
  }

  const draftPersonNameInput = root.querySelector('input[name="draftPersonName"]');
  if (draftPersonNameInput) {
    draftPersonNameInput.addEventListener('input', (event) => {
      editor.draftPersonName = event.target.value;
    });
  }

  const draftPersonIdInput = root.querySelector('input[name="draftPersonId"]');
  if (draftPersonIdInput) {
    draftPersonIdInput.addEventListener('input', (event) => {
      editor.draftPersonId = event.target.value;
    });
  }

  const draftPersonMaxAssignmentsInput = root.querySelector('input[name="draftPersonMaxAssignments"]');
  if (draftPersonMaxAssignmentsInput) {
    draftPersonMaxAssignmentsInput.addEventListener('input', (event) => {
      editor.draftPersonMaxAssignments = event.target.value;
    });
  }

  const draftPersonTargetAssignmentsInput = root.querySelector('input[name="draftPersonTargetAssignments"]');
  if (draftPersonTargetAssignmentsInput) {
    draftPersonTargetAssignmentsInput.addEventListener('input', (event) => {
      editor.draftPersonTargetAssignments = event.target.value;
    });
  }

  root.querySelectorAll('select[name="draftPersonMaxAssignmentsPerGroupTypeRows"]').forEach((select) => {
    select.addEventListener('input', (event) => {
      const rowIndex = Number.parseInt(event.target.dataset.rowIndex || '', 10);
      if (!Number.isInteger(rowIndex)) {
        return;
      }
      editor.draftPersonMaxAssignmentsPerGroupTypeRows = Array.isArray(editor.draftPersonMaxAssignmentsPerGroupTypeRows)
        ? editor.draftPersonMaxAssignmentsPerGroupTypeRows
        : [];
      editor.draftPersonMaxAssignmentsPerGroupTypeRows[rowIndex] = {
        ...(editor.draftPersonMaxAssignmentsPerGroupTypeRows[rowIndex] ?? { value: '' }),
        groupTypeId: event.target.value,
      };
    });
  });

  root.querySelectorAll('input[name="draftPersonMaxAssignmentsPerGroupTypeRowValue"]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const rowIndex = Number.parseInt(event.target.dataset.rowIndex || '', 10);
      if (!Number.isInteger(rowIndex)) {
        return;
      }
      editor.draftPersonMaxAssignmentsPerGroupTypeRows = Array.isArray(editor.draftPersonMaxAssignmentsPerGroupTypeRows)
        ? editor.draftPersonMaxAssignmentsPerGroupTypeRows
        : [];
      editor.draftPersonMaxAssignmentsPerGroupTypeRows[rowIndex] = {
        ...(editor.draftPersonMaxAssignmentsPerGroupTypeRows[rowIndex] ?? { groupTypeId: '' }),
        value: event.target.value,
      };
    });
  });

  root.querySelectorAll('select[name="draftPersonTargetAssignmentsPerGroupTypeRows"]').forEach((select) => {
    select.addEventListener('input', (event) => {
      const rowIndex = Number.parseInt(event.target.dataset.rowIndex || '', 10);
      if (!Number.isInteger(rowIndex)) {
        return;
      }
      editor.draftPersonTargetAssignmentsPerGroupTypeRows = Array.isArray(editor.draftPersonTargetAssignmentsPerGroupTypeRows)
        ? editor.draftPersonTargetAssignmentsPerGroupTypeRows
        : [];
      editor.draftPersonTargetAssignmentsPerGroupTypeRows[rowIndex] = {
        ...(editor.draftPersonTargetAssignmentsPerGroupTypeRows[rowIndex] ?? { value: '' }),
        groupTypeId: event.target.value,
      };
    });
  });

  root.querySelectorAll('input[name="draftPersonTargetAssignmentsPerGroupTypeRowValue"]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const rowIndex = Number.parseInt(event.target.dataset.rowIndex || '', 10);
      if (!Number.isInteger(rowIndex)) {
        return;
      }
      editor.draftPersonTargetAssignmentsPerGroupTypeRows = Array.isArray(editor.draftPersonTargetAssignmentsPerGroupTypeRows)
        ? editor.draftPersonTargetAssignmentsPerGroupTypeRows
        : [];
      editor.draftPersonTargetAssignmentsPerGroupTypeRows[rowIndex] = {
        ...(editor.draftPersonTargetAssignmentsPerGroupTypeRows[rowIndex] ?? { groupTypeId: '' }),
        value: event.target.value,
      };
    });
  });

  root.querySelectorAll('input[name="groupTypeSelection"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      const { value, checked } = event.target;
      const sectionHeading = event.target.closest('section')?.querySelector('h3')?.textContent ?? '';
      const targetFieldName = sectionHeading.includes('Forbidden')
        ? 'draftPersonForbiddenGroupTypeIds'
        : 'draftPersonAllowedGroupTypeIds';
      const currentValues = new Set(Array.isArray(editor[targetFieldName]) ? editor[targetFieldName] : []);
      if (checked) {
        currentValues.add(value);
      } else {
        currentValues.delete(value);
      }
      editor[targetFieldName] = [...currentValues];
    });
  });

  root.querySelectorAll('select[name="draftPersonEventPreference"]').forEach((select) => {
    select.addEventListener('input', (event) => {
      const eventId = event.target.dataset.eventId;
      if (!eventId) {
        return;
      }
      editor.draftPersonEventPreferences = {
        ...(editor.draftPersonEventPreferences ?? {}),
        [eventId]: event.target.value,
      };
      if (!editor.draftPersonEventPreferences[eventId]) {
        delete editor.draftPersonEventPreferences[eventId];
      }
    });
  });

  const draftGlobalMaxAssignmentsPerPersonInput = root.querySelector('input[name="draftGlobalMaxAssignmentsPerPerson"]');
  if (draftGlobalMaxAssignmentsPerPersonInput) {
    draftGlobalMaxAssignmentsPerPersonInput.addEventListener('input', (event) => {
      editor.draftGlobalMaxAssignmentsPerPerson = event.target.value;
    });
  }

  const draftGlobalMaxAssignmentsPerGroupTypeInput = root.querySelector('input[name="draftGlobalMaxAssignmentsPerGroupType"]');
  if (draftGlobalMaxAssignmentsPerGroupTypeInput) {
    draftGlobalMaxAssignmentsPerGroupTypeInput.addEventListener('input', (event) => {
      editor.draftGlobalMaxAssignmentsPerGroupType = event.target.value;
    });
  }

  const draftGlobalTargetAssignmentsPerGroupTypeInput = root.querySelector('input[name="draftGlobalTargetAssignmentsPerGroupType"]');
  if (draftGlobalTargetAssignmentsPerGroupTypeInput) {
    draftGlobalTargetAssignmentsPerGroupTypeInput.addEventListener('input', (event) => {
      editor.draftGlobalTargetAssignmentsPerGroupType = event.target.value;
    });
  }

  const submitPersonFromKeyboard = () => {
    const message = addPerson(domainProject, editor);
    state.eventStaffingPage.message = message;
    refreshValidation(state);
    if (message.startsWith('Added person') || message.startsWith('Saved person')) {
      rerenderWithPreservedInputFocus(root, state, 'input[name="draftPersonName"]');
      return;
    }
    rerender();
  };

  const personEditorForm = root.querySelector('[data-event-staffing-form="person-editor"]');
  if (personEditorForm) {
    personEditorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitPersonFromKeyboard();
    });
  }

  const toggleWorkflowCommandBarButton = root.querySelector('[data-event-staffing-action="toggle-workflow-command-bar"]');
  if (toggleWorkflowCommandBarButton) {
    toggleWorkflowCommandBarButton.addEventListener('click', () => {
      state.eventStaffingPage.workflowCommandBarExpanded = !state.eventStaffingPage.workflowCommandBarExpanded;
      rerender();
    });
  }

  const addGroupTypeButton = root.querySelector('[data-event-staffing-action="add-group-type"]');
  if (addGroupTypeButton) {
    addGroupTypeButton.addEventListener('click', () => {
      state.eventStaffingPage.message = addGroupType(domainProject, editor);
      refreshValidation(state);
      rerender();
    });
  }

  root.querySelectorAll('[data-event-staffing-action="remove-group-type"]').forEach((button) => {
    button.addEventListener('click', () => {
      const groupTypeIndex = Number.parseInt(button.dataset.groupTypeIndex || '', 10);
      state.eventStaffingPage.message = removeGroupType(domainProject, groupTypeIndex, editor);
      refreshValidation(state);
      rerender();
    });
  });

  root.querySelector('[data-event-staffing-action="add-draftPersonMaxAssignmentsPerGroupTypeRows-row"]')?.addEventListener('click', () => {
    editor.draftPersonMaxAssignmentsPerGroupTypeRows = [
      ...(Array.isArray(editor.draftPersonMaxAssignmentsPerGroupTypeRows) ? editor.draftPersonMaxAssignmentsPerGroupTypeRows : []),
      { groupTypeId: '', value: '' },
    ];
    rerender();
  });

  root.querySelectorAll('[data-event-staffing-action="remove-draftPersonMaxAssignmentsPerGroupTypeRows-row"]').forEach((button) => {
    button.addEventListener('click', () => {
      const rowIndex = Number.parseInt(button.dataset.rowIndex || '', 10);
      if (!Number.isInteger(rowIndex)) {
        return;
      }
      editor.draftPersonMaxAssignmentsPerGroupTypeRows = (editor.draftPersonMaxAssignmentsPerGroupTypeRows ?? []).filter((_, index) => index !== rowIndex);
      rerender();
    });
  });

  root.querySelector('[data-event-staffing-action="add-draftPersonTargetAssignmentsPerGroupTypeRows-row"]')?.addEventListener('click', () => {
    editor.draftPersonTargetAssignmentsPerGroupTypeRows = [
      ...(Array.isArray(editor.draftPersonTargetAssignmentsPerGroupTypeRows) ? editor.draftPersonTargetAssignmentsPerGroupTypeRows : []),
      { groupTypeId: '', value: '' },
    ];
    rerender();
  });

  root.querySelectorAll('[data-event-staffing-action="remove-draftPersonTargetAssignmentsPerGroupTypeRows-row"]').forEach((button) => {
    button.addEventListener('click', () => {
      const rowIndex = Number.parseInt(button.dataset.rowIndex || '', 10);
      if (!Number.isInteger(rowIndex)) {
        return;
      }
      editor.draftPersonTargetAssignmentsPerGroupTypeRows = (editor.draftPersonTargetAssignmentsPerGroupTypeRows ?? []).filter((_, index) => index !== rowIndex);
      rerender();
    });
  });

  root.querySelectorAll('[data-event-staffing-action="edit-person"]').forEach((button) => {
    button.addEventListener('click', () => {
      const personIndex = Number.parseInt(button.dataset.personIndex || '', 10);
      state.eventStaffingPage.message = beginEditPerson(domainProject, editor, personIndex);
      rerender();
    });
  });

  root.querySelectorAll('[data-event-staffing-action="remove-person"]').forEach((button) => {
    button.addEventListener('click', () => {
      const personIndex = Number.parseInt(button.dataset.personIndex || '', 10);
      state.eventStaffingPage.message = removePerson(domainProject, personIndex, editor);
      refreshValidation(state);
      rerender();
    });
  });

  const cancelEditPersonButton = root.querySelector('[data-event-staffing-action="cancel-edit-person"]');
  if (cancelEditPersonButton) {
    cancelEditPersonButton.addEventListener('click', () => {
      state.eventStaffingPage.message = cancelEditPerson(editor);
      rerender();
    });
  }

  const saveGlobalLimitsButton = root.querySelector('[data-event-staffing-action="save-global-limits"]');
  if (saveGlobalLimitsButton) {
    saveGlobalLimitsButton.addEventListener('click', () => {
      state.eventStaffingPage.message = saveGlobalLimits(domainProject, editor);
      refreshValidation(state);
      rerender();
    });
  }

  const generateEventsButton = root.querySelector('[data-event-staffing-action="generate-events"]');
  if (generateEventsButton) {
    generateEventsButton.addEventListener('click', () => {
      state.eventStaffingPage.message = generateEventsFromDateRange(domainProject, editor);
      refreshValidation(state);
      rerender();
    });
  }

  const validateDomainProjectButton = root.querySelector('[data-event-staffing-action="validate-domain-project"]');
  if (validateDomainProjectButton) {
    validateDomainProjectButton.addEventListener('click', () => {
      state.eventStaffingPage.lastValidation = validateEventStaffingProject(domainProject);
      clearWorkflowOutputs(state);
      state.eventStaffingPage.message = state.eventStaffingPage.lastValidation.valid
        ? 'The staffing-domain project is valid.'
        : 'The staffing-domain project has validation errors.';
      rerender();
    });
  }

  const transformDomainProjectButton = root.querySelector('[data-event-staffing-action="transform-domain-project"]');
  if (transformDomainProjectButton) {
    transformDomainProjectButton.addEventListener('click', () => {
      const adapter = new FirstSolverAdapter();
      const workflow = runEventStaffingWorkflow(domainProject, adapter.getCapabilities());
      state.eventStaffingPage.lastValidation = workflow.domainValidation;
      state.eventStaffingPage.lastTransformedProject = workflow.transformedProject;
      state.eventStaffingPage.lastNormalizedProject = workflow.normalizedProject;
      state.eventStaffingPage.lastGenericValidation = workflow.genericValidation;
      state.eventStaffingPage.lastSolverResult = null;
      state.eventStaffingPage.activeSolutionIndex = 0;
      state.eventStaffingPage.message = workflow.message;
      rerender();
    });
  }

  const solveDomainProjectButton = root.querySelector('[data-event-staffing-action="solve-domain-project"]');
  if (solveDomainProjectButton) {
    solveDomainProjectButton.addEventListener('click', () => {
      const adapter = new FirstSolverAdapter();
      const workflow = runEventStaffingWorkflow(domainProject, adapter.getCapabilities());
      state.eventStaffingPage.lastValidation = workflow.domainValidation;
      state.eventStaffingPage.lastTransformedProject = workflow.transformedProject;
      state.eventStaffingPage.lastNormalizedProject = workflow.normalizedProject;
      state.eventStaffingPage.lastGenericValidation = workflow.genericValidation;

      if (!workflow.genericValidation?.valid || !workflow.normalizedProject) {
        state.eventStaffingPage.lastSolverResult = null;
        state.eventStaffingPage.message = workflow.message;
        rerender();
        return;
      }

      state.eventStaffingPage.lastSolverResult = adapter.solve(workflow.normalizedProject);
      state.eventStaffingPage.activeSolutionIndex = 0;
      state.eventStaffingPage.message = state.eventStaffingPage.lastSolverResult.status === 'solved'
        ? `Solved staffing plan with ${state.eventStaffingPage.lastSolverResult.solutions.length} solution(s).`
        : 'The staffing project ran through the solver but no valid plan was found.';
      rerender();
    });
  }

  const previousSolutionButton = root.querySelector('[data-event-staffing-action="show-previous-solution"]');
  if (previousSolutionButton) {
    previousSolutionButton.addEventListener('click', () => {
      state.eventStaffingPage.activeSolutionIndex = Math.max((state.eventStaffingPage.activeSolutionIndex ?? 0) - 1, 0);
      rerender();
    });
  }

  const activeSolutionSelect = root.querySelector('select[name="activeStaffingSolutionIndex"]');
  if (activeSolutionSelect) {
    activeSolutionSelect.addEventListener('change', (event) => {
      const solutionCount = state.eventStaffingPage.lastSolverResult?.solutions?.length ?? 0;
      const requestedIndex = Number.parseInt(event.target.value, 10);
      if (!Number.isInteger(requestedIndex)) {
        return;
      }
      state.eventStaffingPage.activeSolutionIndex = Math.min(
        Math.max(requestedIndex, 0),
        Math.max(solutionCount - 1, 0),
      );
      rerender();
    });
  }

  const nextSolutionButton = root.querySelector('[data-event-staffing-action="show-next-solution"]');
  if (nextSolutionButton) {
    nextSolutionButton.addEventListener('click', () => {
      const solutionCount = state.eventStaffingPage.lastSolverResult?.solutions?.length ?? 0;
      state.eventStaffingPage.activeSolutionIndex = Math.min(
        (state.eventStaffingPage.activeSolutionIndex ?? 0) + 1,
        Math.max(solutionCount - 1, 0),
      );
      rerender();
    });
  }

  const insertEventButton = root.querySelector('[data-event-staffing-action="insert-event-near-selection"]');
  if (insertEventButton) {
    insertEventButton.addEventListener('click', () => {
      state.eventStaffingPage.message = insertEventNearSelection(domainProject, editor, selection.selectedEvent);
      refreshValidation(state);
      rerender();
    });
  }

  const deleteFocusedEventButton = root.querySelector('[data-event-staffing-action="delete-focused-event"]');
  if (deleteFocusedEventButton) {
    deleteFocusedEventButton.addEventListener('click', () => {
      const confirmationMessage = buildDeleteEventsConfirmationMessage(domainProject, [editor.selectedEventId]);
      if (confirmationMessage === 'No matching events were found to delete.' || window.confirm(confirmationMessage)) {
        state.eventStaffingPage.message = deleteEvents(domainProject, [editor.selectedEventId], editor);
        refreshValidation(state);
        rerender();
      }
    });
  }

  const selectAllVisibleEventsButton = root.querySelector('[data-event-staffing-action="select-all-visible-events"]');
  if (selectAllVisibleEventsButton) {
    selectAllVisibleEventsButton.addEventListener('click', () => {
      editor.selectedEventIds = selection.filteredEvents.map((event) => event.id);
      rerender();
    });
  }

  const clearEventMultiSelectButton = root.querySelector('[data-event-staffing-action="clear-event-multi-select"]');
  if (clearEventMultiSelectButton) {
    clearEventMultiSelectButton.addEventListener('click', () => {
      editor.selectedEventIds = [];
      rerender();
    });
  }

  const deleteSelectedEventsButton = root.querySelector('[data-event-staffing-action="delete-selected-events"]');
  if (deleteSelectedEventsButton) {
    deleteSelectedEventsButton.addEventListener('click', () => {
      const confirmationMessage = buildDeleteEventsConfirmationMessage(domainProject, editor.selectedEventIds);
      if (confirmationMessage === 'No matching events were found to delete.' || window.confirm(confirmationMessage)) {
        state.eventStaffingPage.message = deleteEvents(domainProject, editor.selectedEventIds, editor);
        refreshValidation(state);
        rerender();
      }
    });
  }

  const addRequirementButton = root.querySelector('[data-event-staffing-action="add-requirement"]');
  if (addRequirementButton) {
    addRequirementButton.addEventListener('click', () => {
      state.eventStaffingPage.message = addRequirementToSelectedEvent(domainProject, editor);
      refreshValidation(state);
      rerender();
    });
  }

  root.querySelectorAll('[data-event-staffing-action="remove-requirement"]').forEach((button) => {
    button.addEventListener('click', () => {
      const requirementIndex = Number.parseInt(button.dataset.requirementIndex || '', 10);
      state.eventStaffingPage.message = removeRequirementFromSelectedEvent(domainProject, editor, requirementIndex);
      refreshValidation(state);
      rerender();
    });
  });

  const bulkAssignButton = root.querySelector('[data-event-staffing-action="bulk-assign-group-to-selected-events"]');
  if (bulkAssignButton) {
    bulkAssignButton.addEventListener('click', () => {
      state.eventStaffingPage.message = bulkAssignGroupToSelectedEvents(domainProject, editor);
      refreshValidation(state);
      rerender();
    });
  }

  const bulkRemoveButton = root.querySelector('[data-event-staffing-action="bulk-remove-group-from-selected-events"]');
  if (bulkRemoveButton) {
    bulkRemoveButton.addEventListener('click', () => {
      state.eventStaffingPage.message = bulkRemoveGroupFromSelectedEvents(domainProject, editor);
      refreshValidation(state);
      rerender();
    });
  }

  const bulkCopyButton = root.querySelector('[data-event-staffing-action="bulk-copy-requirements-from-focused-event"]');
  if (bulkCopyButton) {
    bulkCopyButton.addEventListener('click', () => {
      state.eventStaffingPage.message = bulkCopyRequirementsFromFocusedEvent(domainProject, editor);
      refreshValidation(state);
      rerender();
    });
  }

  const bulkRemoveAllButton = root.querySelector('[data-event-staffing-action="bulk-remove-all-requirements-from-selected-events"]');
  if (bulkRemoveAllButton) {
    bulkRemoveAllButton.addEventListener('click', () => {
      const confirmationMessage = buildRemoveAllRequirementsConfirmationMessage(domainProject, editor);
      if (confirmationMessage === 'Select at least one event before removing all requirements.' || window.confirm(confirmationMessage)) {
        state.eventStaffingPage.message = bulkRemoveAllRequirementsFromSelectedEvents(domainProject, editor);
        refreshValidation(state);
        rerender();
      }
    });
  }
}

export function renderEventStaffingPage(root, state) {
  state.eventStaffingPage = state.eventStaffingPage ?? {};
  state.eventStaffingPage.editor = state.eventStaffingPage.editor ?? {};

  const domainProject = state.eventStaffingPage.domainProject ?? createMockDomainProject();
  state.eventStaffingPage.domainProject = domainProject;
  state.eventStaffingPage.editor.lastSyncedSelectedEventId = typeof state.eventStaffingPage.editor.lastSyncedSelectedEventId === 'string'
    ? state.eventStaffingPage.editor.lastSyncedSelectedEventId
    : '';
  state.eventStaffingPage.validationPanelExpanded = Boolean(state.eventStaffingPage.validationPanelExpanded);
  state.eventStaffingPage.workflowCommandBarExpanded = Boolean(state.eventStaffingPage.workflowCommandBarExpanded);
  state.eventStaffingPage.activeSolutionIndex = Number.isInteger(state.eventStaffingPage.activeSolutionIndex)
    ? state.eventStaffingPage.activeSolutionIndex
    : 0;
  state.eventStaffingPage.lastValidation = state.eventStaffingPage.lastValidation ?? validateEventStaffingProject(domainProject);

  root.innerHTML = renderPageShell({
    title: 'Event staffing planner',
    description: 'Planner-facing editor for ordered events, reusable group types, staffing bounds, event generation, transform validation, and solving.',
    body: renderBody(domainProject, state),
  });

  bindInteractions(root, state);
}
