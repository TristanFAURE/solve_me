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
import { renderSearchHints, renderSolutionPanel } from '../../components/solutions/solutionPanel.js';
import { renderSolveStatus, updateSolveStatus } from '../../components/solutions/solveStatus.js';
import { cancelSolveExecution, createSolveExecutionState, discardSolveExecution, startSolveExecution } from '../../solver/solveExecution.js';
import { bindPageDraftAutosave, persistPageDraft } from '../../storage/localDrafts.js';
import { bindWorkflowTabs, isWorkflowTab, renderWorkflowPanel as renderTabPanel, renderWorkflowTabs } from '../../components/common/workflowTabs.js';
import { getDayGroupPreferenceMap, getDayPreferenceMap, getEffectiveAssignmentPreference, getSlotDayKey, getSlotGroupPreferenceMap, migrateEventStaffingProject, moveSlotDayPreferences, getPreferenceMap, normalizePreferenceState, PREFERENCE_STATES } from './migration.js';
import { renderFieldLabel } from '../../components/common/fieldHelp.js';
import { bindJsonCopyButtons, renderJsonBlock } from '../../components/common/jsonBlock.js';
import { downloadJsonConfiguration, readJsonConfigurationFile, renderJsonConfigurationSetup } from '../../components/common/jsonConfiguration.js';
import { confirmProjectReplacement } from '../../app/dataSafety.js';
import { renderShareEditSetup } from '../../components/common/workflowSetup.js';
import { applyEventStaffingShareEditPreview, exportEventStaffingPersonalWorkbook, exportEventStaffingShareEditWorkbook, previewEventStaffingShareEditWorkbookFile } from './shareEditWorkbook.js';
import { bindCollaborationAdminPanel, renderCollaborationAdminPanel } from './collaboration/adminPanel.js';
import { movePreferenceMatrixDay, movePreferenceMatrixPerson, renderPreferenceMatrix, setDayAvailability, setDayGroupPreference, setSlotGroupPreference, setSlotPreference } from './preferenceMatrix.js';
import { addAssignmentRule, addCooldownRule, renderRuleEditors } from './ruleEditors.js';
import {
  applyEventStaffingPreferencePreview,
  exportEventStaffingConfigurationWorkbook,
  exportEventStaffingSolutionWorkbook,
  getEventStaffingReplacementFromPreview,
  previewEventStaffingWorkbookFile,
} from './workbooks.js';

const REPAIRABLE_VALIDATION_CODES = new Set([
  'event-staffing-forced-forbidden-conflict',
  'event-staffing-forced-unavailable-conflict',
  'event-staffing-insufficient-slot-coverage',
  'event-staffing-insufficient-group-coverage',
]);

function hasOnlyRepairableValidationErrors(validation) {
  return (validation?.errors?.length ?? 0) > 0
    && validation.errors.every((issue) => REPAIRABLE_VALIDATION_CODES.has(issue.code));
}
import {
  annotateAdministratorRepairResult,
  buildAdministratorRepairCandidates,
  createAdministratorRepairModel,
  getAdministratorRepairDates,
  selectAllRepairCandidates,
  toggleRepairCandidate,
} from './administratorRepair.js';

function getGroupTypeLabelMap(domainProject) {
  return new Map(domainProject.groupTypes.map((groupType) => [groupType.id, groupType.label]));
}

function getPersonLookup(domainProject) {
  return new Map(domainProject.people.map((person) => [person.id, person]));
}

function getEventLookup(domainProject) {
  return new Map(domainProject.events.map((event) => [event.id, event]));
}

function workloadDifference(solution, people) {
  const counts = new Map(people.map((person) => [person.id, 0]));
  (solution?.assignments ?? []).forEach((assignment) => {
    const itemId = assignment.itemRef?.id;
    if (counts.has(itemId)) counts.set(itemId, counts.get(itemId) + 1);
  });
  const values = [...counts.values()];
  let difference = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      difference += Math.abs(values[left] - values[right]);
    }
  }
  return difference;
}

export function rankStaffingSolutionsByEquity(domainProject, solverResult) {
  if (!Array.isArray(solverResult?.solutions) || solverResult.solutions.length < 2) return solverResult;
  return {
    ...solverResult,
    canonicalRankingComplete: false,
    solutionSelection: 'equity-first',
    solutions: [...solverResult.solutions].sort((left, right) => (
      workloadDifference(left, domainProject.people) - workloadDifference(right, domainProject.people)
      || (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY)
      || String(left.fingerprint ?? '').localeCompare(String(right.fingerprint ?? ''))
    )),
  };
}

export function buildAdministratorRepairSolveOptions(solveOptions, people) {
  return {
    ...solveOptions,
    scoreWeights: {
      ...solveOptions.scoreWeights,
      preferences: Math.max(1, solveOptions.scoreWeights?.preferences ?? 1),
      equity: Math.max(100, solveOptions.scoreWeights?.equity ?? 0),
    },
    equityEligibleItemIds: people.map((person) => person.id),
  };
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
  if (!solverResult || !['solved', 'partial', 'timeout', 'cancelled'].includes(solverResult.status) || (solverResult.solutions?.length ?? 0) === 0) {
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

export function buildStaffingSolutionTradeoffs(domainProject, solution) {
  const assignmentsByPersonAndSlot = new Map();
  (solution?.assignments ?? []).forEach((assignment) => {
    const destination = parseContainerAssignmentId(assignment.containerRef?.id);
    if (!destination) return;
    const key = `${assignment.itemRef?.id}\u0000${destination.eventId}`;
    const groups = assignmentsByPersonAndSlot.get(key) ?? new Set();
    groups.add(destination.groupTypeId);
    assignmentsByPersonAndSlot.set(key, groups);
  });
  const preferencesByPersonId = new Map((domainProject.preferences ?? []).map((entry) => [entry.personId, entry]));
  const requirementsByEventId = new Map();
  (domainProject.requirements ?? []).forEach((requirement) => {
    const entries = requirementsByEventId.get(requirement.eventId) ?? [];
    entries.push(requirement);
    requirementsByEventId.set(requirement.eventId, entries);
  });
  const issues = [];
  const counts = [];
  const groupLabels = getGroupTypeLabelMap(domainProject);

  domainProject.people.forEach((person) => {
    const preference = preferencesByPersonId.get(person.id);
    let total = 0;
    const perGroup = new Map();
    (solution?.assignments ?? []).forEach((assignment) => {
      if (assignment.itemRef?.id !== person.id) return;
      const destination = parseContainerAssignmentId(assignment.containerRef?.id);
      if (!destination) return;
      total += 1;
      perGroup.set(destination.groupTypeId, (perGroup.get(destination.groupTypeId) ?? 0) + 1);
    });
    counts.push(total);

    domainProject.events.forEach((slot) => {
      const assignedGroups = assignmentsByPersonAndSlot.get(`${person.id}\u0000${slot.id}`) ?? new Set();
      const dayKey = String(slot.dateKey ?? slot.date ?? '').trim() || `undated:${slot.id}`;
      const slotLabel = slot.slotLabel ?? slot.label ?? slot.id;
      const preferenceStates = (requirementsByEventId.get(slot.id) ?? []).map((requirement) => ({
        groupTypeId: requirement.groupTypeId,
        state: getEffectiveAssignmentPreference(preference, slot, requirement.groupTypeId),
      }));
      const preferredGroups = preferenceStates.filter(({ state }) => state === PREFERENCE_STATES.PREFER);
      if (preferredGroups.length > 0 && !preferredGroups.some(({ groupTypeId }) => assignedGroups.has(groupTypeId))) {
        issues.push(`${person.name} preferred ${preferredGroups.map(({ groupTypeId }) => groupLabels.get(groupTypeId) ?? groupTypeId).join(' or ')} on ${slot.date || dayKey} / ${slotLabel}, but received no preferred assignment.`);
      }
      preferenceStates.filter(({ state, groupTypeId }) => (
        state === PREFERENCE_STATES.PREFER_NOT && assignedGroups.has(groupTypeId)
      )).forEach(({ groupTypeId }) => {
        issues.push(`${person.name} preferred not to work ${groupLabels.get(groupTypeId) ?? groupTypeId} on ${slot.date || dayKey} / ${slotLabel}, but was assigned to it.`);
      });
    });

    if (Number.isInteger(person.targetAssignments) && total !== person.targetAssignments) {
      issues.push(`${person.name} has ${total} assignment(s), target ${person.targetAssignments}.`);
    }
    domainProject.groupTypes.forEach(({ id: groupTypeId }) => {
      const target = person.targetAssignmentsPerGroupType?.[groupTypeId]
        ?? domainProject.globalLimits?.targetAssignmentsPerGroupType;
      const actual = perGroup.get(groupTypeId) ?? 0;
      if (Number.isInteger(target) && actual !== target) {
        issues.push(`${person.name} has ${actual} ${groupLabels.get(groupTypeId) ?? groupTypeId} assignment(s), target ${target}.`);
      }
    });
  });

  const minimum = counts.length > 0 ? Math.min(...counts) : 0;
  const maximum = counts.length > 0 ? Math.max(...counts) : 0;
  return { issues, minimum, maximum, spread: maximum - minimum };
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
  const selectedSolution = solverResult.solutions[scheduleSummary.clampedSolutionIndex];
  const tradeoffs = buildStaffingSolutionTradeoffs(domainProject, selectedSolution);
  const exceptionsUsed = selectedSolution.administratorExceptionsUsed ?? [];
  const previousSolution = scheduleSummary.clampedSolutionIndex > 0 ? solverResult.solutions[scheduleSummary.clampedSolutionIndex - 1] : null;
  const assignmentKey = (assignment) => `${assignment.itemRef?.id ?? ''}::${assignment.containerRef?.id ?? ''}`;
  const changedAssignments = previousSolution
    ? new Set([
      ...selectedSolution.assignments.map(assignmentKey).filter((key) => !new Set(previousSolution.assignments.map(assignmentKey)).has(key)),
      ...previousSolution.assignments.map(assignmentKey).filter((key) => !new Set(selectedSolution.assignments.map(assignmentKey)).has(key)),
    ]).size
    : 0;
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
        <div><dt>Score</dt><dd>${escapeHtml(String(selectedSolution.score ?? 'Not scored'))}</dd></div>
        <div><dt>Preference contribution</dt><dd>${escapeHtml(String(selectedSolution.scoreDetails?.assignmentScores ?? '—'))}</dd></div>
        <div><dt>Target contribution</dt><dd>${escapeHtml(String(selectedSolution.scoreDetails?.itemCountTargets ?? '—'))}</dd></div>
        <div><dt>Equity contribution</dt><dd>${escapeHtml(String(selectedSolution.scoreDetails?.equity ?? '—'))}</dd></div>
        <div><dt>Search complete</dt><dd>${solverResult.searchComplete ? 'Yes' : 'No'}</dd></div>
        <div><dt>Optimality proven</dt><dd>${solverResult.optimalityProven ? 'Yes' : 'No'}</dd></div>
        <div><dt>Engine</dt><dd>${escapeHtml(solverResult.solverEngine ?? 'Not reported')}</dd></div>
        <div><dt>Selection</dt><dd>${solverResult.solutionSelection === 'canonical' ? 'Canonical ranking proven' : solverResult.solutionSelection === 'equity-first' ? 'Equity first' : 'Best found'}</dd></div>
        <div><dt>Timeout reached</dt><dd>${solverResult.timeoutReached ? 'Yes' : 'No'}</dd></div>
        <div><dt>Changed assignments</dt><dd>${escapeHtml(String(changedAssignments))}${previousSolution ? ' vs previous solution' : ''}</dd></div>
      </dl>
      ${(solverResult.solutions?.length ?? 0) > 1 ? `
        <section class="workspace-panel top-gap">
          <h3>Returned solutions</h3>
          <p class="muted-text">Use previous/next for quick browsing or jump directly to a returned solution from the picker.</p>
          <div class="event-staffing-inline-actions top-gap">
            <button type="button" class="command-bar-button" data-event-staffing-action="show-previous-solution"${scheduleSummary.clampedSolutionIndex <= 0 ? ' disabled' : ''}>Previous solution</button>
            <button type="button" class="command-bar-button" data-event-staffing-action="show-next-solution"${scheduleSummary.clampedSolutionIndex >= (solverResult.solutions.length - 1) ? ' disabled' : ''}>Next solution</button>
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
      <section class="workspace-panel top-gap">
        <h3>Constraints and soft-goal trade-offs</h3>
        ${solverResult.repairedModel
    ? '<p><strong>Repaired model:</strong> satisfied. The original hard model was not satisfied; only the selected temporary person restrictions were relaxed. Coverage min/max and cooldown/rest rules remained hard.</p>'
    : '<p><strong>Hard constraints:</strong> satisfied. Required coverage, unavailability, cooldowns, assignment limits, and forced/forbidden assignments were not relaxed.</p>'}
        ${solverResult.repairedModel ? `<h4>Administrator exceptions used</h4>${exceptionsUsed.length > 0
    ? `<ul class="issue-list compact-issue-list">${exceptionsUsed.map((exception) => `<li class="issue-list-item warning"><div>${escapeHtml(exception.label)}</div></li>`).join('')}</ul>`
    : '<p class="muted-text">None of the selected temporary exceptions were used by this solution.</p>'}` : ''}
        <p><strong>Workload range:</strong> ${escapeHtml(String(tradeoffs.minimum))} to ${escapeHtml(String(tradeoffs.maximum))} assignments per person (spread ${escapeHtml(String(tradeoffs.spread))}).</p>
        ${tradeoffs.issues.length > 0
    ? `<p><strong>Unmet soft goals (${tradeoffs.issues.length}):</strong></p><ul class="issue-list compact-issue-list">${tradeoffs.issues.slice(0, 50).map((issue) => `<li class="issue-list-item warning"><div>${escapeHtml(issue)}</div></li>`).join('')}</ul>${tradeoffs.issues.length > 50 ? `<p class="muted-text">Showing the first 50 of ${tradeoffs.issues.length} trade-offs.</p>` : ''}`
    : '<p><strong>Unmet soft goals:</strong> none.</p>'}
      </section>
      ${renderSearchHints(solverResult, {
    'use-first-mode': 'Find the first staffing schedule',
    'tighten-eligibility-bounds': 'Tighten person eligibility and staffing bounds',
    'add-fixed-assignments': 'Fix known person-event assignments',
    'split-problem': 'Split independent event periods',
  })}
      <div class="stacked-form-sections top-gap">
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
        ${renderJsonBlock(solverResult, 'staffing solver result JSON')}
      </details>
    </section>
  `;
}

export function getVisibleAdministratorRepairDates(domainProject, validationErrors = []) {
  const blockingEventIds = new Set(validationErrors
    .map((issue) => issue.eventId ?? (String(issue.path ?? '').startsWith('events.') ? String(issue.path).slice('events.'.length) : null))
    .filter(Boolean));
  const allDates = getAdministratorRepairDates(domainProject);
  const blockingDayKeys = new Set((domainProject.events ?? [])
    .filter((event) => blockingEventIds.has(event.id))
    .map(getSlotDayKey));
  return {
    dates: allDates.filter((date) => blockingDayKeys.has(date.dateKey)),
    filteredToBlockingDates: blockingDayKeys.size > 0,
  };
}

export function moveAdministratorRepairDate(dates, currentDateKey, offset) {
  if (dates.length === 0) return '';
  const currentIndex = Math.max(0, dates.findIndex((date) => date.dateKey === currentDateKey));
  return dates[Math.min(Math.max(currentIndex + offset, 0), dates.length - 1)].dateKey;
}

export function getAdministratorRepairSelectedIds(repairState, dateKey) {
  return repairState?.selectedCandidateIdsByDate?.[dateKey]
    ?? (repairState?.dateKey === dateKey ? repairState?.selectedCandidateIds : [])
    ?? [];
}

export function updateAdministratorRepairState(repairState, dateKey, selectedCandidateIds = null) {
  const selectedCandidateIdsByDate = { ...(repairState?.selectedCandidateIdsByDate ?? {}) };
  const nextSelection = selectedCandidateIds ?? getAdministratorRepairSelectedIds(repairState, dateKey);
  selectedCandidateIdsByDate[dateKey] = [...nextSelection];
  return {
    dateKey,
    selectedCandidateIds: [...nextSelection],
    selectedCandidateIdsByDate,
  };
}

export function getAdministratorRepairSelection(domainProject, normalizedProject, dates, repairState = {}) {
  const candidates = dates.flatMap(({ dateKey }) => buildAdministratorRepairCandidates(
    domainProject,
    normalizedProject,
    dateKey,
    repairState.validationErrors ?? [],
  ));
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const selectedIds = dates.flatMap(({ dateKey }) => getAdministratorRepairSelectedIds(repairState, dateKey))
    .filter((id, index, ids) => candidateIds.has(id) && ids.indexOf(id) === index);
  return { candidates, selectedIds };
}

export function renderAdministratorRepairPanel(domainProject, normalizedProject, solverResult, repairState = {}) {
  const hasRepairableValidationConflict = hasOnlyRepairableValidationErrors({ errors: repairState.validationErrors ?? [] });
  if ((solverResult?.status !== 'unsat' && !hasRepairableValidationConflict) || !normalizedProject) return '';
  const validationErrors = repairState.validationErrors ?? validateEventStaffingProject(domainProject).errors;
  const { dates, filteredToBlockingDates } = getVisibleAdministratorRepairDates(domainProject, validationErrors);
  if (dates.length === 0) {
    return `
      <section class="panel administrator-repair-panel">
        <p class="eyebrow">Unsatisfiable hard model</p>
        <h2>Temporary administrator repair</h2>
        <p>No date-local blocking constraint was identified. Review global workload limits and the non-relaxable coverage and cooldown rules.</p>
      </section>`;
  }
  const dateKey = dates.some((date) => date.dateKey === repairState.dateKey)
    ? repairState.dateKey
    : (dates[0]?.dateKey ?? '');
  const candidates = buildAdministratorRepairCandidates(domainProject, normalizedProject, dateKey, validationErrors);
  const selected = new Set(getAdministratorRepairSelectedIds(repairState, dateKey));
  const allSelected = getAdministratorRepairSelection(domainProject, normalizedProject, dates, repairState).selectedIds;
  const dateEventIds = new Set((domainProject.events ?? []).filter((event) => getSlotDayKey(event) === dateKey).map((event) => event.id));
  const dateIssues = validationErrors.filter((issue) => {
    const eventId = issue.eventId ?? (String(issue.path ?? '').startsWith('events.') ? String(issue.path).slice('events.'.length) : null);
    return dateEventIds.has(eventId);
  });
  return `
    <section class="panel administrator-repair-panel">
      <p class="eyebrow">${solverResult?.status === 'unsat' ? 'Unsatisfiable hard model' : 'Repairable hard-constraint conflict'}</p>
      <h2>Temporary administrator repair</h2>
      <p>Select narrowly scoped person restrictions on each blocking date. When validation identifies a slot or category shortage, only restrictions intersecting that exact conflict are listed; unrelated workload or category maxima are hidden. The repair solve uses selections from all dates, not only the date currently shown. The original project rules are unchanged; exceptions apply only to this repair solve. Coverage min/max and cooldown/rest rules always remain hard and are never available here.</p>
      <div class="event-staffing-inline-actions">
        <button type="button" class="navigation-arrow" data-event-staffing-action="previous-repair-date"${dates.findIndex((date) => date.dateKey === dateKey) <= 0 ? ' disabled' : ''} aria-label="Previous blocking date"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m12.5 4-6 6 6 6" /></svg></button>
        <label>${filteredToBlockingDates ? 'Blocking date' : 'Date to inspect'}
          <select name="administratorRepairDate">
          ${dates.map((date) => `<option value="${escapeHtml(date.dateKey)}"${date.dateKey === dateKey ? ' selected' : ''}>${escapeHtml(date.label)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="navigation-arrow" data-event-staffing-action="next-repair-date"${dates.findIndex((date) => date.dateKey === dateKey) >= dates.length - 1 ? ' disabled' : ''} aria-label="Next blocking date"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 4 6 6-6 6" /></svg></button>
      </div>
      ${dateIssues.length ? `<h3 class="top-gap">Identified conflicts</h3><ul class="issue-list compact-issue-list">${dateIssues.map((issue) => `<li class="issue-list-item error"><strong>${escapeHtml(issue.code)}</strong><div>${escapeHtml(issue.message)}</div></li>`).join('')}</ul><h3>Relaxable constraints involved</h3>` : ''}
      <div class="event-staffing-inline-actions top-gap">
        <button type="button" class="command-bar-button" data-event-staffing-action="select-all-repair-candidates"${candidates.length ? '' : ' disabled'}>Select all</button>
        <button type="button" class="command-bar-button" data-event-staffing-action="clear-repair-candidates"${selected.size ? '' : ' disabled'}>Clear all</button>
      </div>
      ${candidates.length ? `<div class="event-staffing-checkbox-grid top-gap">${candidates.map((candidate) => `
        <label class="event-staffing-checkbox-option">
          <input type="checkbox" data-repair-candidate-id="${escapeHtml(candidate.id)}"${selected.has(candidate.id) ? ' checked' : ''} />
          <span>${escapeHtml(candidate.label)}</span>
        </label>`).join('')}</div>` : '<p class="muted-text top-gap">No relaxable person restrictions apply to this date. Check another date or revise hard coverage/cooldown rules directly.</p>'}
      <button type="button" class="command-bar-button command-bar-button-primary top-gap" data-event-staffing-action="solve-administrator-repair"${allSelected.length ? '' : ' disabled'}>Try with all selected temporary exceptions (${allSelected.length})</button>
    </section>`;
}

function describeDeleteImpact(domainProject, eventIdsToDelete) {
  const idsToDelete = new Set(eventIdsToDelete);
  const eventCount = domainProject.events.filter((event) => idsToDelete.has(event.id)).length;
  const requirementCount = domainProject.requirements.filter((requirement) => idsToDelete.has(requirement.eventId)).length;
  const forcedCount = domainProject.forcedAssignments.filter((assignment) => idsToDelete.has(assignment.eventId)).length;
  const forbiddenCount = domainProject.forbiddenAssignments.filter((assignment) => idsToDelete.has(assignment.eventId)).length;
  const preferenceCount = domainProject.preferences.reduce(
    (total, preference) => total
      + Object.keys(getPreferenceMap(preference)).filter((eventId) => idsToDelete.has(eventId)).length
      + Object.entries(getSlotGroupPreferenceMap(preference))
        .filter(([eventId]) => idsToDelete.has(eventId))
        .reduce((count, [, valuesByGroup]) => count + Object.keys(valuesByGroup ?? {}).length, 0),
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
        ${renderJsonBlock(project, 'transformed staffing project JSON')}
      </details>
    </section>
  `;
}

function renderReviewPanel(state) {
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
        <button type="button" class="command-bar-button command-bar-toggle" data-event-staffing-action="toggle-workflow-command-bar" aria-expanded="${workflowExpanded ? 'true' : 'false'}">${workflowExpanded ? 'Collapse' : 'Expand'}</button>
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
    ${renderSolveStatus(state.eventStaffingPage.solveExecution, 'data-event-staffing-action="cancel-solve"')}

    ${renderValidationPanel(state.eventStaffingPage.lastValidation, {
    expanded: state.eventStaffingPage.validationPanelExpanded,
    hasComputedSolution: Boolean(state.eventStaffingPage.lastSolverResult),
    eyebrow: 'Staffing validation',
    title: 'Domain rules',
  })}

    ${genericValidation ? renderValidationPanel(genericValidation, {
    expanded: true,
    hasComputedSolution: Boolean(state.eventStaffingPage.lastSolverResult),
    eyebrow: 'Solver validation',
    title: 'Transformed model',
  }) : ''}

    ${renderTransformedProjectSummary(normalizedProject)}

  `;
}

function renderSetupPanel(domainProject, state) {
  const options = state.eventStaffingPage.solveOptions;
  const workbookImport = state.eventStaffingPage.workbookImport;
  const report = workbookImport?.preview?.report;
  return `
    <section class="panel">
      <p class="eyebrow">Planner setup</p>
      <h2>Event Staffing setup</h2>
      <div class="form-grid two-columns">
        <label>${renderFieldLabel('Project title', 'A descriptive name for this staffing schedule.')}<input type="text" name="eventStaffingTitle" value="${escapeHtml(domainProject.title)}" /></label>
      </div>
      <h3>Solver configuration</h3>
      <div class="form-grid four-columns compact-form-grid">
        <label>${renderFieldLabel('Timeout (ms)', 'Maximum search time. For example, 1000 gives a fast one-second search that may be partial; 30000 allows up to 30 seconds to improve or prove the schedule.')}<input type="number" min="1" name="staffingTimeLimitMs" value="${escapeHtml(options.timeLimitMs)}" /></label>
        <label>${renderFieldLabel('Maximum solutions', 'Maximum ranked schedules to return. For example, 1 gives one plan; 20 gives more choices but can require more search time.')}<input type="number" min="1" max="1000" name="staffingMaxSolutions" value="${escapeHtml(options.maxSolutions)}" /></label>
        <label>${renderFieldLabel('Equity weight', 'Relative influence of balanced workloads. For example, 0 does not reward balance; 100 strongly favors similar assignment totals across people.')}<input type="number" name="staffingEquityWeight" value="${escapeHtml(options.scoreWeights.equity)}" /></label>
        <label>${renderFieldLabel('Preference weight', 'Relative influence of availability preferences. For example, 0 ignores prefer and prefer-not choices; 100 makes them strongly affect ranking.')}<input type="number" name="staffingPreferenceWeight" value="${escapeHtml(options.scoreWeights.preferences)}" /></label>
        <label>${renderFieldLabel('Target weight', 'Relative influence of workload targets. For example, 0 ignores target gaps; 100 strongly favors schedules close to each target.')}<input type="number" name="staffingTargetWeight" value="${escapeHtml(options.scoreWeights.targets)}" /></label>
        <label>${renderFieldLabel('Minimum changed assignments', 'Required differences between alternatives. For example, 1 permits nearly identical schedules; 10 requires at least ten changed assignments and may return fewer schedules.')}<input type="number" min="0" name="staffingDiversityDistance" value="${escapeHtml(options.diversity.minimumAssignmentDistance)}" /></label>
        <label class="checkbox-chip"><input type="checkbox" name="staffingDiversityEnabled"${options.diversity.enabled ? ' checked' : ''} />${renderFieldLabel('Diverse alternatives', 'Require returned schedules to differ by at least the configured number of assignments.')}</label>
      </div>
    </section>
    ${renderJsonConfigurationSetup({ prefix: 'event-staffing', domainLabel: 'Event Staffing' })}
    ${renderShareEditSetup(state.eventStaffingPage.shareEditImport, 'event-staffing', 'Event Staffing', { language: state.eventStaffingPage.editor.eventStaffingShareLanguage, identityType: state.eventStaffingPage.editor.eventStaffingShareIdentity, personalized: true, participants: domainProject.people, personId: state.eventStaffingPage.editor.eventStaffingSharePersonId })}
    <section class="panel">
      <h2>Configuration workbook</h2>
      <p class="muted-text">Export the complete editable setup at any time. Import previews either a full configuration replacement or a compatible preferences-only merge.</p>
      <div class="button-row">
        <button type="button" class="command-bar-button" data-event-staffing-action="export-configuration-workbook">Export configuration workbook</button>
        <label class="command-bar-button command-bar-file-button">Preview workbook<input type="file" name="eventStaffingWorkbookFile" accept=".xlsx" hidden /></label>
      </div>
      ${workbookImport?.status === 'busy' ? '<p role="status">Reading workbook…</p>' : ''}
      ${workbookImport?.error ? `<p role="alert" class="command-bar-feedback-error">${escapeHtml(workbookImport.error)}</p>` : ''}
      ${report ? `${workbookImport.preview.kind === 'configuration' ? '<p><strong>Complete Event Staffing configuration found.</strong> Replacing it changes slots, categories, requirements, people, rules, preferences, and limits, and clears solved results.</p>' : '<p><strong>Preferences-only workbook found.</strong> Applying it does not replace other setup.</p>'}<dl class="summary-grid compact-summary-grid"><div><dt>Matched rows</dt><dd>${report.matchedRows}</dd></div><div><dt>Unknown rows</dt><dd>${report.unknownRows}</dd></div><div><dt>Duplicate rows</dt><dd>${report.duplicateRows}</dd></div><div><dt>Ambiguous rows</dt><dd>${report.ambiguousRows}</dd></div><div><dt>Invalid rows</dt><dd>${report.invalidRows}</dd></div><div><dt>Invalid cells</dt><dd>${report.invalidCells}</dd></div><div><dt>Unknown slot mappings</dt><dd>${report.unknownSlotMappings}</dd></div><div><dt>Preference cells</dt><dd>${report.preferenceCells}</dd></div></dl>${report.issues.length ? `<ul class="issue-list compact-issue-list">${report.issues.map((issue) => `<li class="issue-list-item warning"><div>${escapeHtml(issue)}</div></li>`).join('')}</ul>` : ''}<div class="button-row">${workbookImport.preview.kind === 'configuration' ? '<button type="button" class="command-bar-button command-bar-button-danger" data-event-staffing-action="replace-configuration-preview">Replace full configuration</button>' : ''}<button type="button" class="command-bar-button command-bar-button-primary" data-event-staffing-action="apply-preference-preview"${workbookImport.preview.canApply ? '' : ' disabled'}>Apply preferences only</button></div>` : ''}
    </section>`;
}

function renderBody(domainProject, state) {
  const editor = state.eventStaffingPage.editor;
  const browserState = getEventBrowserState(state);
  const selection = selectVisibleEvent(domainProject, browserState);

  syncSelectedEventDrafts(editor, selection.selectedEvent, selection.selectedRequirements);

  const activeTab = state.eventStaffingPage.activeWorkflowTab;
  const dataContent = `<section class="panel">
      <h2>📅 Events</h2>
      <p>Use dates to group independently staffed slots. Each slot can carry several category coverage requirements.</p>
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
    </section>${renderSupportSections(domainProject, selection.groupTypeLabelsById, editor, { peopleReadOnly: Boolean(state.eventStaffingPage.collaboration?.mode?.enabled && !state.eventStaffingPage.collaboration.mode.userMode) })}`;
  return `
    ${renderCollaborationAdminPanel(state)}
    <section class="hero-card event-staffing-hero-card">
      <div>
        <p class="eyebrow">Event staffing planner</p>
        <h2>${escapeHtml(domainProject.title || 'Staffing schedule')}</h2>
        <p class="hero-description">Build dated staffing slots, coverage requirements, availability, workload rules, and ranked schedules in one guided workflow.</p>
      </div>
      <dl class="summary-grid compact-summary-grid">
        <div><dt>Dates</dt><dd>${new Set(domainProject.events.map(getSlotDayKey)).size}</dd></div>
        <div><dt>Slots</dt><dd>${domainProject.events.length}</dd></div>
        <div><dt>Categories</dt><dd>${domainProject.groupTypes.length}</dd></div>
        <div><dt>People</dt><dd>${domainProject.people.length}</dd></div>
        <div><dt>Requirements</dt><dd>${domainProject.requirements.length}</dd></div>
      </dl>
    </section>
    ${renderWorkflowTabs(activeTab)}
    ${renderTabPanel('setup', activeTab, renderSetupPanel(domainProject, state))}
    ${renderTabPanel('data', activeTab, dataContent)}
    ${renderTabPanel('rules', activeTab, `${renderPreferenceMatrix(domainProject, editor)}${renderRuleEditors(domainProject, editor)}`)}
    ${renderTabPanel('review', activeTab, renderReviewPanel(state))}
    ${renderTabPanel('results', activeTab, `${renderSolveStatus(state.eventStaffingPage.solveExecution, 'data-event-staffing-action="cancel-solve"')}${renderAdministratorRepairPanel(domainProject, state.eventStaffingPage.lastNormalizedProject, state.eventStaffingPage.lastSolverResult, { ...editor.administratorRepair, validationErrors: state.eventStaffingPage.lastValidation?.errors ?? [] })}${renderStaffingScheduleView(domainProject, state.eventStaffingPage.lastSolverResult, state.eventStaffingPage.activeSolutionIndex ?? 0)}${state.eventStaffingPage.lastSolverResult?.solutions?.length ? '<div class="button-row"><button type="button" class="command-bar-button command-bar-button-primary" data-event-staffing-action="export-solution-workbook">Export selected schedule workbook</button></div>' : ''}`)}
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
    slotLabel: label,
    dateKey: String(editor.draftInsertedEventDate ?? '').trim() || `undated:${slugifyLabel(label) || 'slot'}`,
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

export function syncRequirementDraftFromControls(root, editor) {
  const groupType = root.querySelector('select[name="draftRequirementGroupTypeId"]');
  const minimum = root.querySelector('input[name="draftRequirementMin"]');
  const maximum = root.querySelector('input[name="draftRequirementMax"]');
  if (groupType) editor.draftRequirementGroupTypeId = groupType.value;
  if (minimum) editor.draftRequirementMin = minimum.value;
  if (maximum) editor.draftRequirementMax = maximum.value;
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
    const state = normalizePreferenceState(value);
    if (state === PREFERENCE_STATES.PREFER) sanitized[eventId] = 'Y';
    if (state === PREFERENCE_STATES.PREFER_NOT) sanitized[eventId] = 'N';
    if (state === PREFERENCE_STATES.UNAVAILABLE) sanitized[eventId] = 'U';
    if (state === PREFERENCE_STATES.NEUTRAL) sanitized[eventId] = PREFERENCE_STATES.NEUTRAL;
  });

  return sanitized;
}

function resetPersonEditor(editor) {
  editor.draftPersonName = '';
  editor.draftPersonId = '';
  editor.draftPersonEmail = '';
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
  editor.draftPersonEmail = person.email ?? '';
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
  editor.draftPersonEventPreferences = { ...getPreferenceMap(existingPreferenceEntry) };

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
    maxAssignmentsPerGroupType: Object.fromEntries(
      Object.entries(person.maxAssignmentsPerGroupType ?? {}).filter(([groupTypeId]) => groupTypeId !== groupType.id),
    ),
    targetAssignmentsPerGroupType: Object.fromEntries(
      Object.entries(person.targetAssignmentsPerGroupType ?? {}).filter(([groupTypeId]) => groupTypeId !== groupType.id),
    ),
    allowedGroupTypeIds: Array.isArray(person.allowedGroupTypeIds)
      ? person.allowedGroupTypeIds.filter((groupTypeId) => groupTypeId !== groupType.id)
      : [],
    forbiddenGroupTypeIds: Array.isArray(person.forbiddenGroupTypeIds)
      ? person.forbiddenGroupTypeIds.filter((groupTypeId) => groupTypeId !== groupType.id)
      : [],
  }));
  domainProject.preferences = domainProject.preferences.map((preference) => ({
    ...preference,
    dayGroupPreferences: Object.fromEntries(Object.entries(getDayGroupPreferenceMap(preference)).map(([dayKey, valuesByGroup]) => [
      dayKey,
      Object.fromEntries(Object.entries(valuesByGroup).filter(([groupTypeId]) => groupTypeId !== groupType.id)),
    ]).filter(([, valuesByGroup]) => Object.keys(valuesByGroup).length > 0)),
    slotGroupPreferences: Object.fromEntries(Object.entries(getSlotGroupPreferenceMap(preference)).map(([slotId, valuesByGroup]) => [
      slotId,
      Object.fromEntries(Object.entries(valuesByGroup).filter(([groupTypeId]) => groupTypeId !== groupType.id)),
    ]).filter(([, valuesByGroup]) => Object.keys(valuesByGroup).length > 0)),
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
    email: String(editor.draftPersonEmail ?? '').trim(),
    maxAssignments: parseOptionalNonNegativeInteger(editor.draftPersonMaxAssignments),
    targetAssignments: parseOptionalNonNegativeInteger(editor.draftPersonTargetAssignments),
    maxAssignmentsPerGroupType: maxByGroupResult.value,
    targetAssignmentsPerGroupType: targetByGroupResult.value,
    allowedGroupTypeIds,
    forbiddenGroupTypeIds,
  };
  const sanitizedEventPreferences = sanitizePersonEventPreferences(editor.draftPersonEventPreferences);
  const existingPreferenceEntry = domainProject.preferences.find((preference) => preference.personId === id);
  const dayPreferences = { ...getDayPreferenceMap(existingPreferenceEntry) };
  const dayGroupPreferences = structuredClone(getDayGroupPreferenceMap(existingPreferenceEntry));
  const slotGroupPreferences = structuredClone(getSlotGroupPreferenceMap(existingPreferenceEntry));

  if (editingPersonIndex !== null && currentPerson) {
    domainProject.people[editingPersonIndex] = nextPerson;
    domainProject.preferences = domainProject.preferences.filter((preference) => preference.personId !== id);
    if (Object.keys(sanitizedEventPreferences).length > 0 || Object.keys(dayPreferences).length > 0 || Object.keys(dayGroupPreferences).length > 0 || Object.keys(slotGroupPreferences).length > 0) {
      domainProject.preferences.push({
        personId: id,
        eventPreferences: sanitizedEventPreferences,
        ...(Object.keys(dayPreferences).length > 0 ? { dayPreferences } : {}),
        ...(Object.keys(dayGroupPreferences).length > 0 ? { dayGroupPreferences } : {}),
        ...(Object.keys(slotGroupPreferences).length > 0 ? { slotGroupPreferences } : {}),
      });
    }
    resetPersonEditor(editor);
    return `Saved person "${name}".`;
  }

  domainProject.people.push(nextPerson);
  if (Object.keys(sanitizedEventPreferences).length > 0 || Object.keys(dayPreferences).length > 0 || Object.keys(dayGroupPreferences).length > 0 || Object.keys(slotGroupPreferences).length > 0) {
    domainProject.preferences = domainProject.preferences.filter((preference) => preference.personId !== id);
    domainProject.preferences.push({
      personId: id,
      eventPreferences: sanitizedEventPreferences,
      ...(Object.keys(dayPreferences).length > 0 ? { dayPreferences } : {}),
      ...(Object.keys(dayGroupPreferences).length > 0 ? { dayGroupPreferences } : {}),
      ...(Object.keys(slotGroupPreferences).length > 0 ? { slotGroupPreferences } : {}),
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
      slotLabel: label,
      dateKey: dateText,
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
  const canPrepareRepair = hasOnlyRepairableValidationErrors(domainValidation);
  if (!domainValidation.valid && !canPrepareRepair) {
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
    message: canPrepareRepair
      ? 'The staffing project has repairable hard-constraint conflicts. Review temporary administrator repair options.'
      : genericValidation.valid
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
  const remainingDayKeys = new Set(domainProject.events.map((event) => String(event.dateKey ?? event.date ?? '').trim() || `undated:${event.id}`));
  domainProject.requirements = domainProject.requirements.filter((requirement) => !idsToDelete.has(requirement.eventId));
  domainProject.forcedAssignments = domainProject.forcedAssignments.filter((assignment) => !idsToDelete.has(assignment.eventId));
  domainProject.forbiddenAssignments = domainProject.forbiddenAssignments.filter((assignment) => !idsToDelete.has(assignment.eventId));
  domainProject.preferences = domainProject.preferences.map((preference) => ({
    ...preference,
    eventPreferences: preference.eventPreferences ? Object.fromEntries(
      Object.entries(preference.eventPreferences).filter(([eventId]) => !idsToDelete.has(eventId)),
    ) : preference.eventPreferences,
    slotPreferences: Object.fromEntries(
      Object.entries(getPreferenceMap(preference)).filter(([eventId]) => !idsToDelete.has(eventId)),
    ),
    slotGroupPreferences: Object.fromEntries(
      Object.entries(getSlotGroupPreferenceMap(preference)).filter(([eventId]) => !idsToDelete.has(eventId)),
    ),
    dayPreferences: Object.fromEntries(
      Object.entries(getDayPreferenceMap(preference)).filter(([dayKey]) => remainingDayKeys.has(dayKey)),
    ),
    dayGroupPreferences: Object.fromEntries(
      Object.entries(getDayGroupPreferenceMap(preference)).filter(([dayKey]) => remainingDayKeys.has(dayKey)),
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
  discardSolveExecution(state.eventStaffingPage.solveExecution);
  state.eventStaffingPage.lastTransformedProject = null;
  state.eventStaffingPage.lastNormalizedProject = null;
  state.eventStaffingPage.lastGenericValidation = null;
  state.eventStaffingPage.lastSolverResult = null;
  state.eventStaffingPage.activeSolutionIndex = 0;
  state.eventStaffingPage.editor.administratorRepair = { dateKey: '', selectedCandidateIds: [] };
}

function refreshValidation(state) {
  state.eventStaffingPage.lastValidation = null;
  state.eventStaffingPage.validationPanelExpanded = false;
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
  const peopleLocked = Boolean(state.eventStaffingPage.collaboration?.mode?.enabled && !state.eventStaffingPage.collaboration.mode.userMode);

  bindWorkflowTabs(root, (tabId) => {
    if (!isWorkflowTab(tabId)) return;
    state.eventStaffingPage.activeWorkflowTab = tabId;
    rerender();
  });

  const bindValue = (name, target, parser = (value) => value) => {
    root.querySelector(`[name="${name}"]`)?.addEventListener('input', (event) => { target(parser(event.target.value, event.target)); });
  };
  bindValue('eventStaffingTitle', (value) => { domainProject.title = value; });
  bindValue('staffingTimeLimitMs', (value) => { state.eventStaffingPage.solveOptions.timeLimitMs = parseNonNegativeInteger(value, 5000); });
  bindValue('staffingMaxSolutions', (value) => { state.eventStaffingPage.solveOptions.maxSolutions = parseNonNegativeInteger(value, 10); });
  bindValue('staffingEquityWeight', (value) => { state.eventStaffingPage.solveOptions.scoreWeights.equity = Number.parseInt(value, 10) || 0; });
  bindValue('staffingPreferenceWeight', (value) => { state.eventStaffingPage.solveOptions.scoreWeights.preferences = Number.parseInt(value, 10) || 0; });
  bindValue('staffingTargetWeight', (value) => { state.eventStaffingPage.solveOptions.scoreWeights.targets = Number.parseInt(value, 10) || 0; });
  bindValue('staffingDiversityDistance', (value) => { state.eventStaffingPage.solveOptions.diversity.minimumAssignmentDistance = parseNonNegativeInteger(value, 2); });
  root.querySelector('[name="staffingDiversityEnabled"]')?.addEventListener('change', (event) => {
    state.eventStaffingPage.solveOptions.diversity.enabled = event.target.checked;
  });

  root.querySelector('[data-event-staffing-action="export-configuration-workbook"]')?.addEventListener('click', () => {
    exportEventStaffingConfigurationWorkbook(domainProject);
  });
  root.querySelector('[data-action="export-event-staffing-json"]')?.addEventListener('click', () => {
    downloadJsonConfiguration(domainProject, 'event-staffing');
    state.eventStaffingPage.message = 'Event Staffing JSON configuration downloaded.';
    rerender();
  });
  root.querySelector('[data-action="import-event-staffing-json"]')?.addEventListener('change', async (event) => {
    if (peopleLocked) { state.eventStaffingPage.message = 'Configuration replacement is disabled while collaborative people are authoritative.'; event.target.value = ''; rerender(); return; }
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await readJsonConfigurationFile(file);
      if (!Array.isArray(raw.events) || !Array.isArray(raw.groupTypes) || !Array.isArray(raw.requirements) || !Array.isArray(raw.people)) {
        throw new Error('The file does not contain an Event Staffing project.');
      }
      const imported = migrateEventStaffingProject(raw);
      if (!confirmProjectReplacement(domainProject, 'Replace the current Event Staffing configuration with this JSON file?')) return;
      state.eventStaffingPage.domainProject = imported;
      state.eventStaffingPage.editor.selectedEventId = '';
      state.eventStaffingPage.editor.selectedEventIds = [];
      state.eventStaffingPage.editor.lastSyncedSelectedEventId = '';
      state.eventStaffingPage.message = `JSON configuration imported from ${file.name}. Review it before solving.`;
      refreshValidation(state);
    } catch (error) {
      state.eventStaffingPage.message = error instanceof Error ? `JSON import failed: ${error.message}` : 'JSON import failed.';
    }
    event.target.value = '';
    rerender();
  });
  root.querySelector('[name="event-staffingShareLanguage"]')?.addEventListener('change', (event) => { editor.eventStaffingShareLanguage = event.target.value; rerender(); });
  root.querySelector('[name="event-staffingShareIdentity"]')?.addEventListener('change', (event) => { editor.eventStaffingShareIdentity = event.target.value; rerender(); });
  root.querySelector('[name="event-staffingSharePersonId"]')?.addEventListener('change', (event) => {
    editor.eventStaffingSharePersonId = event.target.value;
    rerender();
  });
  root.querySelector('[data-action="export-event-staffing-share-edit"]')?.addEventListener('click', () => {
    try {
      exportEventStaffingShareEditWorkbook(domainProject, { language: editor.eventStaffingShareLanguage, identityType: editor.eventStaffingShareIdentity, filename: 'event-staffing-share-edit.xlsx' });
      state.eventStaffingPage.message = 'Event Staffing Share & Edit workbook downloaded.';
    } catch (error) {
      state.eventStaffingPage.message = error instanceof Error ? `Share & Edit export failed: ${error.message} Use personalized files for oversized projects.` : 'Share & Edit export failed.';
    }
    rerender();
  });
  root.querySelector('[data-action="export-event-staffing-personalized"]')?.addEventListener('click', () => {
    try {
      exportEventStaffingPersonalWorkbook(domainProject, editor.eventStaffingSharePersonId, { language: editor.eventStaffingShareLanguage, identityType: editor.eventStaffingShareIdentity });
      state.eventStaffingPage.message = 'Personalized Event Staffing workbook downloaded.';
    } catch (error) {
      state.eventStaffingPage.message = error instanceof Error ? `Personalized export failed: ${error.message}` : 'Personalized export failed.';
    }
    rerender();
  });
  root.querySelector('[data-action="import-event-staffing-share-edit"]')?.addEventListener('change', async (event) => {
    if (peopleLocked) { state.eventStaffingPage.message = 'Stakeholder workbook import is disabled in GitHub collaborative mode.'; event.target.value = ''; rerender(); return; }
    const file = event.target.files?.[0];
    if (!file) return;
    state.eventStaffingPage.shareEditImport = { status: 'busy', error: '', preview: null, fileName: file.name };
    rerender();
    try {
      const preview = await previewEventStaffingShareEditWorkbookFile(file, state.eventStaffingPage.domainProject);
      state.eventStaffingPage.shareEditImport = { status: 'ready', error: '', preview, fileName: file.name };
    } catch (error) {
      state.eventStaffingPage.shareEditImport = { status: 'error', error: error instanceof Error ? error.message : 'Stakeholder workbook import failed.', preview: null, fileName: file.name };
    }
    event.target.value = '';
    rerender();
  });
  root.querySelector('[data-action="apply-event-staffing-share-edit"]')?.addEventListener('click', () => {
    if (peopleLocked) return;
    const preview = state.eventStaffingPage.shareEditImport.preview;
    if (!preview?.canApply || !globalThis.confirm?.('Apply the previewed Event Staffing stakeholder changes?')) return;
    try {
      state.eventStaffingPage.domainProject = applyEventStaffingShareEditPreview(state.eventStaffingPage.domainProject, preview);
      state.eventStaffingPage.shareEditImport = { status: 'idle', error: '', preview: null };
      state.eventStaffingPage.message = 'Event Staffing stakeholder changes applied.';
      refreshValidation(state);
    } catch (error) {
      state.eventStaffingPage.shareEditImport.error = error instanceof Error ? error.message : 'Stakeholder changes could not be applied.';
    }
    rerender();
  });
  root.querySelector('[data-action="cancel-event-staffing-share-edit"]')?.addEventListener('click', () => {
    state.eventStaffingPage.shareEditImport = { status: 'idle', error: '', preview: null };
    rerender();
  });
  root.querySelector('[name="eventStaffingWorkbookFile"]')?.addEventListener('change', async (event) => {
    if (peopleLocked) { state.eventStaffingPage.message = 'Configuration workbook import is disabled while collaborative people are authoritative.'; event.target.value = ''; rerender(); return; }
    const file = event.target.files?.[0];
    if (!file) return;
    state.eventStaffingPage.workbookImport = { status: 'busy', error: '', preview: null };
    rerender();
    try {
      const preview = await previewEventStaffingWorkbookFile(file, domainProject);
      state.eventStaffingPage.workbookImport = { status: 'preview', error: '', preview };
    } catch (error) {
      state.eventStaffingPage.workbookImport = { status: 'error', error: error instanceof Error ? error.message : 'The workbook could not be read.', preview: null };
    }
    rerender();
  });
  root.querySelector('[data-event-staffing-action="replace-configuration-preview"]')?.addEventListener('click', () => {
    if (peopleLocked) return;
    const confirmFn = globalThis.confirm;
    const confirmed = typeof confirmFn === 'function' && confirmFn.call(globalThis, 'Replace the full Event Staffing configuration? All current slots, categories, requirements, people, preferences, cooldowns, forced/forbidden assignments, limits, and solved results will be replaced.');
    if (!confirmed) return;
    try {
      state.eventStaffingPage.domainProject = getEventStaffingReplacementFromPreview(state.eventStaffingPage.workbookImport.preview);
      state.eventStaffingPage.editor.selectedEventId = '';
      state.eventStaffingPage.editor.selectedEventIds = [];
      state.eventStaffingPage.editor.lastSyncedSelectedEventId = '';
      state.eventStaffingPage.workbookImport = { status: 'idle', error: '', preview: null };
      state.eventStaffingPage.message = 'Replaced the full Event Staffing configuration. Review and validate it before solving.';
      refreshValidation(state);
    } catch (error) {
      state.eventStaffingPage.workbookImport.error = error instanceof Error ? error.message : 'The configuration could not be replaced.';
    }
    rerender();
  });
  root.querySelector('[data-event-staffing-action="apply-preference-preview"]')?.addEventListener('click', () => {
    try {
      const count = applyEventStaffingPreferencePreview(domainProject, state.eventStaffingPage.workbookImport.preview);
      state.eventStaffingPage.message = `Applied ${count} preference cell(s).`;
      state.eventStaffingPage.workbookImport = { status: 'idle', error: '', preview: null };
      refreshValidation(state);
    } catch (error) {
      state.eventStaffingPage.workbookImport.error = error instanceof Error ? error.message : 'Preferences could not be applied.';
    }
    rerender();
  });
  root.querySelector('[data-event-staffing-action="export-solution-workbook"]')?.addEventListener('click', () => {
    exportEventStaffingSolutionWorkbook(domainProject, state.eventStaffingPage.lastSolverResult, state.eventStaffingPage.activeSolutionIndex);
  });

  root.querySelectorAll('[data-slot-preference]').forEach((select) => {
    select.addEventListener('change', () => {
      setSlotPreference(domainProject, select.dataset.personId, select.dataset.slotId, select.value);
      refreshValidation(state);
    });
  });
  root.querySelector('[name="preferenceMatrixPersonId"]')?.addEventListener('change', (event) => {
    editor.preferenceMatrixPersonId = event.target.value;
    rerender();
  });
  root.querySelector('[data-event-staffing-action="previous-preference-person"]')?.addEventListener('click', () => {
    editor.preferenceMatrixPersonId = movePreferenceMatrixPerson(domainProject, editor.preferenceMatrixPersonId, -1);
    rerender();
  });
  root.querySelector('[data-event-staffing-action="next-preference-person"]')?.addEventListener('click', () => {
    editor.preferenceMatrixPersonId = movePreferenceMatrixPerson(domainProject, editor.preferenceMatrixPersonId, 1);
    rerender();
  });
  root.querySelector('[name="preferenceMatrixDayKey"]')?.addEventListener('change', (event) => {
    editor.preferenceMatrixDayKey = event.target.value;
    rerender();
  });
  root.querySelector('[name="preferenceMatrixPeopleFilter"]')?.addEventListener('change', (event) => {
    editor.preferenceMatrixPeopleFilter = event.target.value;
    rerender();
  });
  root.querySelector('[data-event-staffing-action="previous-preference-day"]')?.addEventListener('click', () => {
    editor.preferenceMatrixDayKey = movePreferenceMatrixDay(domainProject, editor.preferenceMatrixDayKey, -1);
    rerender();
  });
  root.querySelector('[data-event-staffing-action="next-preference-day"]')?.addEventListener('click', () => {
    editor.preferenceMatrixDayKey = movePreferenceMatrixDay(domainProject, editor.preferenceMatrixDayKey, 1);
    rerender();
  });
  root.querySelectorAll('[data-day-availability]').forEach((select) => {
    select.addEventListener('change', () => {
      setDayAvailability(domainProject, select.dataset.personId, select.dataset.dayKey, select.value);
      refreshValidation(state);
      rerender();
    });
  });
  root.querySelectorAll('[data-day-group-preference]').forEach((select) => {
    select.addEventListener('change', () => {
      setDayGroupPreference(
        domainProject,
        select.dataset.personId,
        select.dataset.dayKey,
        select.dataset.groupTypeId,
        select.value,
      );
      refreshValidation(state);
      rerender();
    });
  });
  root.querySelectorAll('[data-slot-group-preference]').forEach((select) => {
    select.addEventListener('change', () => {
      setSlotGroupPreference(domainProject, select.dataset.personId, select.dataset.slotId, select.dataset.groupTypeId, select.value);
      refreshValidation(state);
      rerender();
    });
  });

  root.querySelector('.validation-panel-details')?.addEventListener('toggle', (event) => {
    state.eventStaffingPage.validationPanelExpanded = event.target.open;
  });

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
      selectedEvent.slotLabel = selectedEvent.label;
      const oldDayKey = getSlotDayKey(selectedEvent);
      selectedEvent.date = String(editor.draftSelectedEventDate ?? '').trim();
      selectedEvent.dateKey = selectedEvent.date || `undated:${selectedEvent.id}`;
      moveSlotDayPreferences(domainProject, selectedEvent.id, oldDayKey, selectedEvent.dateKey);
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

  const draftPersonEmailInput = root.querySelector('input[name="draftPersonEmail"]');
  if (draftPersonEmailInput) {
    draftPersonEmailInput.addEventListener('input', (event) => { editor.draftPersonEmail = event.target.value; });
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
      state.eventStaffingPage.validationPanelExpanded = !state.eventStaffingPage.lastValidation.valid;
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
      state.eventStaffingPage.validationPanelExpanded = !workflow.domainValidation.valid;
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
      state.eventStaffingPage.validationPanelExpanded = !workflow.domainValidation.valid;

      if (!workflow.genericValidation?.valid || !workflow.normalizedProject) {
        state.eventStaffingPage.lastSolverResult = null;
        state.eventStaffingPage.message = workflow.message;
        rerender();
        return;
      }

      state.eventStaffingPage.activeSolutionIndex = 0;
      editor.administratorRepair = { dateKey: '', selectedCandidateIds: [], selectedCandidateIdsByDate: {} };
      startSolveExecution({
        execution: state.eventStaffingPage.solveExecution,
        model: workflow.normalizedProject,
        options: {
          ...state.eventStaffingPage.solveOptions,
          equityEligibleItemIds: domainProject.people.map((person) => person.id),
        },
        onResult(solverResult) {
          solverResult = rankStaffingSolutionsByEquity(domainProject, solverResult);
          state.eventStaffingPage.lastSolverResult = solverResult;
          state.eventStaffingPage.message = solverResult.status === 'solved'
            ? `Solved staffing plan with ${solverResult.solutions.length} solution(s).`
            : 'The staffing solve stopped without a complete result.';
          state.eventStaffingPage.activeWorkflowTab = 'results';
        },
        onProgressChange: () => updateSolveStatus(root, state.eventStaffingPage.solveExecution),
        onChange: rerender,
      });
    });
  }

  root.querySelectorAll('[name="administratorRepairDate"]').forEach((repairDateSelect) => {
    repairDateSelect.addEventListener('change', (event) => {
      editor.administratorRepair = updateAdministratorRepairState(editor.administratorRepair, event.target.value);
      rerender();
    });
  });

  const currentRepairDates = getVisibleAdministratorRepairDates(
    domainProject,
    state.eventStaffingPage.lastValidation?.errors ?? [],
  ).dates;
  const currentRepairDateKey = currentRepairDates.some((date) => date.dateKey === editor.administratorRepair?.dateKey)
    ? editor.administratorRepair.dateKey
    : (currentRepairDates[0]?.dateKey ?? '');
  const currentRepairCandidates = state.eventStaffingPage.lastNormalizedProject
    ? buildAdministratorRepairCandidates(domainProject, state.eventStaffingPage.lastNormalizedProject, currentRepairDateKey, state.eventStaffingPage.lastValidation?.errors ?? [])
    : [];
  root.querySelectorAll('[data-repair-candidate-id]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      editor.administratorRepair = updateAdministratorRepairState(
        editor.administratorRepair,
        currentRepairDateKey,
        toggleRepairCandidate(
          getAdministratorRepairSelectedIds(editor.administratorRepair, currentRepairDateKey),
          checkbox.dataset.repairCandidateId,
          checkbox.checked,
        ),
      );
      rerender();
    });
  });
  root.querySelectorAll('[data-event-staffing-action="previous-repair-date"]').forEach((button) => {
    button.addEventListener('click', () => {
      editor.administratorRepair = updateAdministratorRepairState(
        editor.administratorRepair,
        moveAdministratorRepairDate(currentRepairDates, currentRepairDateKey, -1),
      );
      rerender();
    });
  });
  root.querySelectorAll('[data-event-staffing-action="next-repair-date"]').forEach((button) => {
    button.addEventListener('click', () => {
      editor.administratorRepair = updateAdministratorRepairState(
        editor.administratorRepair,
        moveAdministratorRepairDate(currentRepairDates, currentRepairDateKey, 1),
      );
      rerender();
    });
  });
  root.querySelectorAll('[data-event-staffing-action="select-all-repair-candidates"]').forEach((button) => {
    button.addEventListener('click', () => {
      editor.administratorRepair = updateAdministratorRepairState(
        editor.administratorRepair,
        currentRepairDateKey,
        selectAllRepairCandidates(currentRepairCandidates),
      );
      rerender();
    });
  });
  root.querySelectorAll('[data-event-staffing-action="clear-repair-candidates"]').forEach((button) => {
    button.addEventListener('click', () => {
      editor.administratorRepair = updateAdministratorRepairState(editor.administratorRepair, currentRepairDateKey, []);
      rerender();
    });
  });
  root.querySelectorAll('[data-event-staffing-action="solve-administrator-repair"]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.eventStaffingPage.lastSolverResult?.status !== 'unsat'
        && !hasOnlyRepairableValidationErrors(state.eventStaffingPage.lastValidation)) return;
      const repairSelection = getAdministratorRepairSelection(
        domainProject,
        state.eventStaffingPage.lastNormalizedProject,
        currentRepairDates,
        { ...editor.administratorRepair, validationErrors: state.eventStaffingPage.lastValidation?.errors ?? [] },
      );
      const { candidates, selectedIds } = repairSelection;
      if (selectedIds.length === 0) return;
      const selectedDateKeys = currentRepairDates
        .filter(({ dateKey }) => getAdministratorRepairSelectedIds(editor.administratorRepair, dateKey).length > 0)
        .map(({ dateKey }) => dateKey);
      const repairModel = createAdministratorRepairModel(
        state.eventStaffingPage.lastNormalizedProject,
        candidates,
        selectedIds,
      );
      state.eventStaffingPage.activeSolutionIndex = 0;
      startSolveExecution({
        execution: state.eventStaffingPage.solveExecution,
        model: repairModel,
        options: buildAdministratorRepairSolveOptions(state.eventStaffingPage.solveOptions, domainProject.people),
        onResult(solverResult) {
          solverResult = annotateAdministratorRepairResult(
            solverResult,
            candidates,
            selectedIds,
            selectedDateKeys,
          );
          solverResult = rankStaffingSolutionsByEquity(domainProject, solverResult);
          state.eventStaffingPage.lastSolverResult = solverResult;
          state.eventStaffingPage.message = solverResult.solutions?.length
            ? `The repaired model returned ${solverResult.solutions.length} solution(s). Original project rules remain unchanged.`
            : 'The selected temporary exceptions did not produce a staffing plan.';
          state.eventStaffingPage.activeWorkflowTab = 'results';
        },
        onProgressChange: () => updateSolveStatus(root, state.eventStaffingPage.solveExecution),
        onChange: rerender,
      });
    });
  });

  root.querySelectorAll('[data-event-staffing-action="cancel-solve"]').forEach((button) => {
    button.addEventListener('click', () => cancelSolveExecution(state.eventStaffingPage.solveExecution));
  });

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
      syncRequirementDraftFromControls(root, editor);
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

  ['draftAssignmentKind', 'draftAssignmentPersonId', 'draftAssignmentSlotId', 'draftAssignmentGroupTypeId', 'draftCooldownTriggerGroupTypeId', 'draftCooldownBlockedGroupTypeId', 'draftCooldownCount'].forEach((name) => {
    root.querySelector(`[name="${name}"]`)?.addEventListener('change', (event) => { editor[name] = event.target.value; });
  });
  root.querySelector('[data-event-staffing-action="add-assignment-rule"]')?.addEventListener('click', () => {
    state.eventStaffingPage.message = addAssignmentRule(domainProject, editor);
    refreshValidation(state);
    rerender();
  });
  root.querySelectorAll('[data-remove-assignment-rule]').forEach((button) => {
    button.addEventListener('click', () => {
      const collection = button.dataset.removeAssignmentRule === 'forced' ? domainProject.forcedAssignments : domainProject.forbiddenAssignments;
      collection.splice(Number.parseInt(button.dataset.ruleIndex, 10), 1);
      refreshValidation(state);
      rerender();
    });
  });
  root.querySelector('[data-event-staffing-action="add-cooldown-rule"]')?.addEventListener('click', () => {
    state.eventStaffingPage.message = addCooldownRule(domainProject, editor);
    refreshValidation(state);
    rerender();
  });
  root.querySelectorAll('[data-remove-cooldown-rule]').forEach((button) => {
    button.addEventListener('click', () => {
      domainProject.cooldownRules.splice(Number.parseInt(button.dataset.ruleIndex, 10), 1);
      refreshValidation(state);
      rerender();
    });
  });
}

export function renderEventStaffingPage(root, state) {
  state.eventStaffingPage = state.eventStaffingPage ?? {};
  state.eventStaffingPage.editor = state.eventStaffingPage.editor ?? {};
  state.eventStaffingPage.editor.eventStaffingShareLanguage ??= 'en';
  state.eventStaffingPage.editor.eventStaffingShareIdentity ??= 'fullName';
  state.eventStaffingPage.editor.eventStaffingSharePersonId ??= '';

  const domainProject = migrateEventStaffingProject(state.eventStaffingPage.domainProject ?? createMockDomainProject());
  state.eventStaffingPage.domainProject = domainProject;
  state.eventStaffingPage.editor.lastSyncedSelectedEventId = typeof state.eventStaffingPage.editor.lastSyncedSelectedEventId === 'string'
    ? state.eventStaffingPage.editor.lastSyncedSelectedEventId
    : '';
  state.eventStaffingPage.validationPanelExpanded = Boolean(state.eventStaffingPage.validationPanelExpanded);
  state.eventStaffingPage.workflowCommandBarExpanded = Boolean(state.eventStaffingPage.workflowCommandBarExpanded);
  state.eventStaffingPage.activeSolutionIndex = Number.isInteger(state.eventStaffingPage.activeSolutionIndex)
    ? state.eventStaffingPage.activeSolutionIndex
    : 0;
  state.eventStaffingPage.solveExecution ??= createSolveExecutionState();
  state.eventStaffingPage.activeWorkflowTab = isWorkflowTab(state.eventStaffingPage.activeWorkflowTab) ? state.eventStaffingPage.activeWorkflowTab : 'setup';
  state.eventStaffingPage.solveOptions ??= { mode: 'topK', maxSolutions: 10, timeLimitMs: 5000, includeScoreDetails: true, scoreWeights: { equity: 100, preferences: 10, targets: 20 }, diversity: { enabled: true, minimumAssignmentDistance: 2 } };
  state.eventStaffingPage.workbookImport ??= { status: 'idle', error: '', preview: null };
  state.eventStaffingPage.shareEditImport ??= { status: 'idle', error: '', preview: null };
  if (state.draftsEnabled !== false) {
    persistPageDraft(state.draftStorage, 'event-staffing', domainProject, state.eventStaffingPage.persistence);
  }
  root.innerHTML = renderPageShell({
    activeRoute: '/event-staffing',
    title: 'Event Staffing',
    description: 'Plan date-grouped slots, category coverage, people, preferences, rules, and ranked schedules.',
    persistence: state.eventStaffingPage.persistence,
    body: renderBody(domainProject, state),
  });

  bindInteractions(root, state);
  bindCollaborationAdminPanel(root, state, () => renderEventStaffingPage(root, state));
  bindJsonCopyButtons(root);
  if (state.draftsEnabled !== false) {
    bindPageDraftAutosave(root, state.draftStorage, 'event-staffing', () => state.eventStaffingPage.domainProject, state.eventStaffingPage.persistence);
  }
}
