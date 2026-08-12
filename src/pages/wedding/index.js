import { renderPageShell } from '../../components/common/pageShell.js';
import { renderSolutionPanel } from '../../components/solutions/solutionPanel.js';
import { renderValidationPanel } from '../../components/solutions/validationPanel.js';
import { ASSIGNMENT_MODES } from '../../core/model/assignmentModes.js';
import { CONSTRAINT_KINDS, createConstraint } from '../../core/model/constraints.js';
import { createId } from '../../core/model/ids.js';
import { createContainer, createGroup, createItem, createPosition } from '../../core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../core/model/project.js';
import { PREFERENCE_KINDS, createPreference } from '../../core/model/preferences.js';
import { createContainmentRelation, createEntityRef } from '../../core/model/relations.js';
import { normalizeProject } from '../../core/normalize/normalizeProject.js';
import { validateProject } from '../../core/validate/validateProject.js';
import { FirstSolverAdapter } from '../../solver/adapters/firstSolverAdapter.js';
import {
  WEDDING_TABLE_SHAPES,
  findGeneratedNeighbor,
  addAdjacencyBetween,
  generateSeatsForTable,
  getGeneratedSeatsForTable,
  getSeatTableId,
  getSeatsForTable,
  getTableGenerationMode,
  getWeddingTableShape,
  hasAdjacency,
  removeGeneratedSeatAdjacency,
  removeGeneratedSeatBothSides,
  setTableGenerationMode,
  setTableShape,
} from './tableTopology.js';
import { validateWeddingProject } from './validateWeddingProject.js';
import { exportWeddingSolutionWorkbook } from './exportWeddingSolution.js';
import { importWeddingWorkbook } from './importWeddingWorkbook.js';

function createWeddingEditorState() {
  return {
    draftGuestLabel: '',
    draftGroupLabel: '',
    draftTableLabel: '',
    draftTableMinCapacity: '0',
    draftTableMaxCapacity: '',
    draftTableShape: WEDDING_TABLE_SHAPES.ROUND,
    draftSeatLabel: '',
    draftSeatTableId: '',
    draftAdjacencyLeftSeatId: '',
    draftAdjacencyRightSeatId: '',
    draftConstraintKind: CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
    draftConstraintLeftKind: 'item',
    draftConstraintLeftId: '',
    draftConstraintRightKind: 'item',
    draftConstraintRightId: '',
    draftPreferenceKind: PREFERENCE_KINDS.PREFER_SHARE_CONTAINER,
    draftPreferenceLeftKind: 'item',
    draftPreferenceLeftId: '',
    draftPreferenceRightKind: 'item',
    draftPreferenceRightId: '',
    draftPreferenceWeight: '1',
    draftConstraintGroupId: '',
    draftPreferenceGroupId: '',
    activeSolutionIndex: 0,
  };
}

function ensureWeddingProject(state) {
  if (!state.currentProject) {
    state.currentProject = createEmptyProject({ viewHint: VIEW_HINTS.WEDDING, title: 'Wedding plan' });
  }

  state.currentProject.viewHint = VIEW_HINTS.WEDDING;
  state.currentProject.assignmentMode = state.currentProject.assignmentMode || ASSIGNMENT_MODES.CONTAINER;

  if (!state.weddingPage) {
    state.weddingPage = {
      editor: createWeddingEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    };
    return;
  }

  state.weddingPage.editor = {
    ...createWeddingEditorState(),
    ...state.weddingPage.editor,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getGuests(project) {
  return Array.isArray(project?.items) ? project.items : [];
}

function getGroups(project) {
  return Array.isArray(project?.groups) ? project.groups : [];
}

function getTables(project) {
  return Array.isArray(project?.containers) ? project.containers : [];
}

function getSeats(project) {
  return Array.isArray(project?.positions) ? project.positions : [];
}

function getSeatModeEnabled(project) {
  return project?.assignmentMode === ASSIGNMENT_MODES.POSITION;
}

function getGuestGroupIds(project, guestId) {
  return (project.containments ?? [])
    .filter((relation) => relation?.from?.kind === 'group' && relation?.to?.kind === 'item' && relation.to.id === guestId)
    .map((relation) => relation.from.id);
}

function getTableCapacity(table) {
  const minCapacity = table?.metadata?.minCapacity ?? 0;
  const maxCapacity = table?.metadata?.maxCapacity ?? null;
  return {
    minCapacity: Number.isFinite(minCapacity) ? minCapacity : 0,
    maxCapacity: Number.isFinite(maxCapacity) ? maxCapacity : null,
  };
}

function findLabelById(entries, id) {
  return entries.find((entry) => entry.id === id)?.label || id;
}

function createOperandOptions(project) {
  return [
    ...getGuests(project).map((guest) => ({ id: guest.id, label: `🧑 ${guest.label}`, kind: 'item' })),
    ...getGroups(project).map((group) => ({ id: group.id, label: `👪 ${group.label}`, kind: 'group' })),
  ];
}

function renderSimpleOptions(entries, selectedId, placeholder = 'Select…') {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...entries.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === selectedId ? ' selected' : ''}>${escapeHtml(entry.label)}</option>`),
  ].join('');
}

function renderRefSelect(nameKind, nameId, options, selectedKind, selectedId, placeholder) {
  return `
    <div class="split-select-row">
      <select name="${escapeHtml(nameKind)}">
        <option value="item"${selectedKind === 'item' ? ' selected' : ''}>Guest</option>
        <option value="group"${selectedKind === 'group' ? ' selected' : ''}>Group</option>
      </select>
      <select name="${escapeHtml(nameId)}">
        <option value="">${escapeHtml(placeholder)}</option>
        ${options
      .filter((option) => option.kind === selectedKind)
      .map((option) => `<option value="${escapeHtml(option.id)}"${option.id === selectedId ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
      .join('')}
      </select>
    </div>
  `;
}

function renderMembershipChips(labels, emptyText) {
  if (!labels.length) {
    return `<span class="muted-text">${escapeHtml(emptyText)}</span>`;
  }

  return `<span class="chip-row">${labels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join('')}</span>`;
}

function resetWeddingDerivedState(state) {
  state.weddingPage.lastValidation = null;
  state.weddingPage.lastNormalizedProject = null;
  state.weddingPage.lastSolverResult = null;
  state.weddingPage.editor.activeSolutionIndex = 0;
}

function clearWeddingMessage(state) {
  state.weddingPage.message = '';
}

function mergeValidationResults(primary, secondary) {
  return {
    valid: Boolean(primary?.valid) && Boolean(secondary?.valid),
    errors: [...(primary?.errors ?? []), ...(secondary?.errors ?? [])],
    warnings: [...(primary?.warnings ?? []), ...(secondary?.warnings ?? [])],
  };
}

function runWeddingValidationFlow(state) {
  const adapter = new FirstSolverAdapter();
  const weddingValidation = validateWeddingProject(state.currentProject);
  const genericValidation = validateProject(state.currentProject, adapter.getCapabilities());
  const validation = mergeValidationResults(weddingValidation, genericValidation);

  state.weddingPage.lastValidation = validation;
  state.weddingPage.validationPanelExpanded = false;

  if (!validation.valid) {
    state.weddingPage.lastNormalizedProject = null;
    state.weddingPage.lastSolverResult = null;
    return;
  }

  state.weddingPage.lastNormalizedProject = normalizeProject(state.currentProject);
  state.weddingPage.lastSolverResult = null;
}

function runWeddingSolveFlow(state) {
  const adapter = new FirstSolverAdapter();
  const weddingValidation = validateWeddingProject(state.currentProject);
  const genericValidation = validateProject(state.currentProject, adapter.getCapabilities());
  const validation = mergeValidationResults(weddingValidation, genericValidation);

  state.weddingPage.lastValidation = validation;
  state.weddingPage.validationPanelExpanded = true;

  if (!validation.valid) {
    state.weddingPage.lastNormalizedProject = null;
    state.weddingPage.lastSolverResult = {
      status: 'validation-failed',
      solutions: [],
      warnings: ['Solve was not attempted because the wedding plan still has problems to fix.'],
      runtimeMs: 0,
      truncatedByLimit: false,
      interrupted: false,
      timeoutReached: false,
    };
    return;
  }

  const normalizedProject = normalizeProject(state.currentProject);
  state.weddingPage.lastNormalizedProject = normalizedProject;

  const adapterValidation = adapter.validateModel(normalizedProject);
  const solverResult = adapter.solve(normalizedProject);

  state.weddingPage.lastSolverResult = {
    ...solverResult,
    warnings: [...(adapterValidation.warnings ?? []), ...(solverResult.warnings ?? [])],
  };
  state.weddingPage.editor.activeSolutionIndex = 0;
}

function renderSummary(project) {
  const totalCapacity = getTables(project).reduce((sum, table) => sum + (getTableCapacity(table).maxCapacity ?? 0), 0);

  return `
    <section class="hero-card wedding-hero-card">
      <div>
        <p class="eyebrow">💍 Wedding planner panel</p>
        <h2>${escapeHtml(project.title || 'Wedding plan')}</h2>
        <p class="hero-description">Guests can belong to several groups at once, for example a family and a friends-of-the-groom group, so planners can express layered seating logic naturally. ✨</p>
      </div>
      <dl class="summary-grid compact-summary-grid">
        <div><dt>Guests</dt><dd>${getGuests(project).length}</dd></div>
        <div><dt>Groups</dt><dd>${getGroups(project).length}</dd></div>
        <div><dt>Tables</dt><dd>${getTables(project).length}</dd></div>
        <div><dt>Seats</dt><dd>${getSeats(project).length}</dd></div>
        <div><dt>Total capacity</dt><dd>${totalCapacity}</dd></div>
        <div><dt>Mode</dt><dd>${getSeatModeEnabled(project) ? 'Seat-aware 🪑' : 'Table only 🍽️'}</dd></div>
      </dl>
    </section>
  `;
}

function renderCommandBar(result) {
  const canExport = result?.status === 'solved' && (result?.solutions?.length ?? 0) > 0;

  return `
    <section class="command-bar-card wedding-command-bar">
      <div class="command-bar-copy">
        <p class="eyebrow">💒 Wedding workflow</p>
        <h2>Validate, solve, import, and export</h2>
        <p class="muted-text">Use groups for families, friend circles, wedding party clusters, or any other planner-friendly layer of seating logic.</p>
      </div>
      <div class="command-bar-actions">
        <button type="button" class="command-bar-button" data-action="validate-wedding">
          <span class="command-bar-icon" aria-hidden="true">✓</span>
          <span>Validate</span>
        </button>
        <label class="command-bar-button command-bar-file-button">
          <span class="command-bar-icon" aria-hidden="true">⤴</span>
          <span>Import Excel</span>
          <input type="file" data-action="import-wedding-workbook" accept=".xlsx,.xls" hidden />
        </label>
        <button type="button" class="command-bar-button command-bar-button-primary" data-action="solve-wedding">
          <span class="command-bar-icon" aria-hidden="true">▶</span>
          <span>Validate + normalize + solve</span>
        </button>
        <button type="button" class="command-bar-button" data-action="export-wedding-solution"${canExport ? '' : ' disabled'}>
          <span class="command-bar-icon" aria-hidden="true">⬇</span>
          <span>Export Excel</span>
        </button>
        <button type="button" class="command-bar-button" data-action="toggle-wedding-mode">
          <span class="command-bar-icon" aria-hidden="true">🪑</span>
          <span>Toggle table / seat mode</span>
        </button>
      </div>
    </section>
  `;
}

function renderMetadataPanel(project) {
  return `
    <section class="card sticky-panel wedding-meta-card">
      <h2>💌 Wedding metadata</h2>
      <div class="form-grid two-columns">
        <label>
          <span>Event name</span>
          <input type="text" name="weddingTitle" value="${escapeHtml(project.title)}" />
        </label>
        <label>
          <span>Seating mode</span>
          <select name="weddingAssignmentMode">
            <option value="${ASSIGNMENT_MODES.CONTAINER}"${project.assignmentMode === ASSIGNMENT_MODES.CONTAINER ? ' selected' : ''}>Table only 🍽️</option>
            <option value="${ASSIGNMENT_MODES.POSITION}"${project.assignmentMode === ASSIGNMENT_MODES.POSITION ? ' selected' : ''}>Seat-aware 🪑</option>
          </select>
        </label>
        <label class="full-width">
          <span>Planner notes</span>
          <textarea name="weddingDescription" rows="3">${escapeHtml(project.description)}</textarea>
        </label>
      </div>
    </section>
  `;
}

function renderCreateCards(project, editor) {
  return `
    <section class="card workspace-toolbar wedding-create-toolbar">
      <div class="toolbar-head">
        <div>
          <p class="eyebrow">🎉 Quick setup</p>
          <h2>Create the guest list and structure</h2>
          <p class="muted-text">A group is not only a family: it can also be “Groom bachelors”, “Bride colleagues”, “College friends”, or any planner-defined overlap.</p>
        </div>
      </div>
      <div class="creation-grid">
        <article class="creation-card accent-item wedding-card-accent-guest">
          <h3>🧑 Add guest</h3>
          <label>
            <span>Name</span>
            <input type="text" name="draftGuestLabel" value="${escapeHtml(editor.draftGuestLabel)}" />
          </label>
          <button type="button" data-action="add-wedding-guest">Add guest</button>
        </article>
        <article class="creation-card accent-group wedding-card-accent-group">
          <h3>👪 Add group</h3>
          <label>
            <span>Group name</span>
            <input type="text" name="draftGroupLabel" value="${escapeHtml(editor.draftGroupLabel)}" />
          </label>
          <p class="muted-text">Examples: Family A, Groom bachelors, Bride cousins, Work friends.</p>
          <button type="button" data-action="add-wedding-group">Add group</button>
        </article>
        <article class="creation-card accent-container wedding-card-accent-table">
          <h3>🍽️ Add table</h3>
          <label>
            <span>Name</span>
            <input type="text" name="draftTableLabel" value="${escapeHtml(editor.draftTableLabel)}" />
          </label>
          <div class="inline-field-grid">
            <label>
              <span>Min</span>
              <input type="number" min="0" name="draftTableMinCapacity" value="${escapeHtml(editor.draftTableMinCapacity)}" />
            </label>
            <label>
              <span>Max</span>
              <input type="number" min="0" name="draftTableMaxCapacity" value="${escapeHtml(editor.draftTableMaxCapacity)}" />
            </label>
          </div>
          <label>
            <span>Shape</span>
            <select name="draftTableShape">
              <option value="${WEDDING_TABLE_SHAPES.ROUND}"${editor.draftTableShape === WEDDING_TABLE_SHAPES.ROUND ? ' selected' : ''}>Round</option>
              <option value="${WEDDING_TABLE_SHAPES.SQUARE}"${editor.draftTableShape === WEDDING_TABLE_SHAPES.SQUARE ? ' selected' : ''}>Square</option>
              <option value="${WEDDING_TABLE_SHAPES.RECTANGLE}"${editor.draftTableShape === WEDDING_TABLE_SHAPES.RECTANGLE ? ' selected' : ''}>Rectangle</option>
            </select>
          </label>
          <button type="button" data-action="add-wedding-table">Add table</button>
        </article>
        <article class="creation-card accent-position wedding-card-accent-seat${getSeatModeEnabled(project) ? '' : ' is-disabled-card'}">
          <h3>🪑 Add seat</h3>
          <label>
            <span>Seat label</span>
            <input type="text" name="draftSeatLabel" value="${escapeHtml(editor.draftSeatLabel)}" ${getSeatModeEnabled(project) ? '' : 'disabled'} />
          </label>
          <label>
            <span>Table</span>
            <select name="draftSeatTableId" ${getSeatModeEnabled(project) ? '' : 'disabled'}>
              ${renderSimpleOptions(getTables(project), editor.draftSeatTableId, 'Select table…')}
            </select>
          </label>
          <div class="button-row compact-button-row">
            <button type="button" data-action="add-wedding-seat"${getSeatModeEnabled(project) ? '' : ' disabled'}>Add seat</button>
            <button type="button" data-action="generate-wedding-seats"${getSeatModeEnabled(project) ? '' : ' disabled'}>Generate seats for all tables</button>
          </div>
          <p class="muted-text">Warning: generating seats deletes all existing seats first, then recreates them using each table name and seat index.</p>
        </article>
      </div>
    </section>
  `;
}

function renderGuestsPanel(project) {
  const guests = getGuests(project);
  const groups = getGroups(project);

  return `
    <section class="workspace-panel wedding-panel">
      <div class="panel-header">
        <h3>🧑 Guests</h3>
        <span class="panel-count">${guests.length}</span>
      </div>
      <div class="entity-board">
        ${guests.length === 0 ? '<div class="empty-board">Add the guest list first. 🎊</div>' : guests.map((guest, index) => {
    const guestGroupIds = getGuestGroupIds(project, guest.id);
    const groupLabels = guestGroupIds.map((groupId) => findLabelById(groups, groupId));
    return `
            <article class="entity-card wedding-entity-card">
              <div class="entity-card-header">
                <div>
                  <p class="entity-kind">Guest</p>
                  <input type="text" class="entity-inline-input" data-action="edit-wedding-label" data-kind="item" data-index="${index}" value="${escapeHtml(guest.label)}" />
                </div>
                <button type="button" class="ghost-danger-button" data-action="remove-wedding-guest" data-index="${index}">Remove</button>
              </div>
              <p class="entity-id">${escapeHtml(guest.id)}</p>
              <div class="entity-meta-grid">
                <div class="entity-meta-item">
                  <dt>Groups</dt>
                  <dd>${renderMembershipChips(groupLabels, 'No group yet')}</dd>
                </div>
                <div class="entity-meta-item wedding-checkbox-list">
                  <dt>Assign groups</dt>
                  <dd>
                    ${groups.length === 0 ? '<span class="muted-text">Create groups first.</span>' : groups.map((group) => `
                      <label class="checkbox-chip">
                        <input type="checkbox" data-action="toggle-wedding-membership" data-group-id="${escapeHtml(group.id)}" data-guest-id="${escapeHtml(guest.id)}"${guestGroupIds.includes(group.id) ? ' checked' : ''} />
                        <span>${escapeHtml(group.label)}</span>
                      </label>
                    `).join('')}
                  </dd>
                </div>
              </div>
            </article>
          `;
  }).join('')}
      </div>
    </section>
  `;
}

function getGroupInternalConstraint(project, groupId) {
  return (project.constraints ?? []).find((constraint) =>
    constraint?.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER
    && constraint?.metadata?.groupInternalTogether === true
    && constraint?.leftRef?.kind === 'group'
    && constraint?.rightRef?.kind === 'group'
    && constraint.leftRef.id === groupId
    && constraint.rightRef.id === groupId,
  ) ?? null;
}

function getGroupInternalPreference(project, groupId) {
  return (project.preferences ?? []).find((preference) =>
    preference?.kind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER
    && preference?.metadata?.groupInternalTogether === true
    && preference?.leftRef?.kind === 'group'
    && preference?.rightRef?.kind === 'group'
    && preference.leftRef.id === groupId
    && preference.rightRef.id === groupId,
  ) ?? null;
}

function setGroupTogetherShortcut(project, groupId, enabled) {
  const existingIndex = (project.constraints ?? []).findIndex((constraint) =>
    constraint?.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER
    && constraint?.metadata?.groupInternalTogether === true
    && constraint?.leftRef?.kind === 'group'
    && constraint?.rightRef?.kind === 'group'
    && constraint.leftRef.id === groupId
    && constraint.rightRef.id === groupId,
  );

  if (enabled && existingIndex === -1) {
    project.constraints.push(createConstraint({
      kind: CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
      leftRef: createEntityRef('group', groupId),
      rightRef: createEntityRef('group', groupId),
      metadata: { groupInternalTogether: true },
    }));
  }

  if (!enabled && existingIndex >= 0) {
    project.constraints.splice(existingIndex, 1);
  }
}

function setGroupPreferTogetherShortcut(project, groupId, weight) {
  const existingIndex = (project.preferences ?? []).findIndex((preference) =>
    preference?.kind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER
    && preference?.metadata?.groupInternalTogether === true
    && preference?.leftRef?.kind === 'group'
    && preference?.rightRef?.kind === 'group'
    && preference.leftRef.id === groupId
    && preference.rightRef.id === groupId,
  );

  if (weight === '' || Number.parseInt(weight, 10) <= 0) {
    if (existingIndex >= 0) {
      project.preferences.splice(existingIndex, 1);
    }
    return;
  }

  const parsedWeight = Number.parseInt(weight, 10);
  const entry = createPreference({
    kind: PREFERENCE_KINDS.PREFER_SHARE_CONTAINER,
    leftRef: createEntityRef('group', groupId),
    rightRef: createEntityRef('group', groupId),
    weight: Number.isNaN(parsedWeight) ? 1 : parsedWeight,
    metadata: { groupInternalTogether: true },
  });

  if (existingIndex >= 0) {
    project.preferences.splice(existingIndex, 1, entry);
    return;
  }

  project.preferences.push(entry);
}

function renderGroupsPanel(project, editor) {
  const groups = getGroups(project);
  const guests = getGuests(project);

  return `
    <section class="workspace-panel wedding-panel">
      <div class="panel-header">
        <h3>👪 Groups</h3>
        <span class="panel-count">${groups.length}</span>
      </div>
      <div class="entity-board">
        ${groups.length === 0 ? '<div class="empty-board">Create families, friends circles, wedding party groups, or any other custom grouping. 🥂</div>' : groups.map((group, index) => {
    const memberLabels = guests.filter((guest) => getGuestGroupIds(project, guest.id).includes(group.id)).map((guest) => guest.label);
    return `
            <article class="entity-card wedding-entity-card">
              <div class="entity-card-header">
                <div>
                  <p class="entity-kind">Group</p>
                  <input type="text" class="entity-inline-input" data-action="edit-wedding-label" data-kind="group" data-index="${index}" value="${escapeHtml(group.label)}" />
                </div>
                <button type="button" class="ghost-danger-button" data-action="remove-wedding-group" data-index="${index}">Remove</button>
              </div>
              <p class="entity-id">${escapeHtml(group.id)}</p>
              <div class="entity-meta-grid">
                <div class="entity-meta-item">
                  <dt>Members</dt>
                  <dd>${renderMembershipChips(memberLabels, 'No members yet')}</dd>
                </div>
              </div>
            </article>
          `;
  }).join('')}
      </div>
    </section>
  `;
}

function renderTablesPanel(project) {
  const tables = getTables(project);

  return `
    <section class="workspace-panel wedding-panel">
      <div class="panel-header">
        <h3>🍽️ Tables</h3>
        <span class="panel-count">${tables.length}</span>
      </div>
      <div class="entity-board">
        ${tables.length === 0 ? '<div class="empty-board">Add tables with capacities before solving. 🍽️</div>' : tables.map((table, index) => {
    const capacity = getTableCapacity(table);
    const seats = getSeatsForTable(project, table.id);
    const shape = getWeddingTableShape(table);
    const generationMode = getTableGenerationMode(table);
    return `
            <article class="entity-card wedding-entity-card">
              <div class="entity-card-header">
                <div>
                  <p class="entity-kind">Table</p>
                  <input type="text" class="entity-inline-input" data-action="edit-wedding-label" data-kind="container" data-index="${index}" value="${escapeHtml(table.label)}" />
                </div>
                <button type="button" class="ghost-danger-button" data-action="remove-wedding-table" data-index="${index}">Remove</button>
              </div>
              <p class="entity-id">${escapeHtml(table.id)}</p>
              <div class="entity-meta-grid">
                <div class="entity-meta-item wedding-table-meta-grid">
                  <div>
                    <dt>Capacity</dt>
                    <dd>${escapeHtml(capacity.minCapacity)} → ${escapeHtml(capacity.maxCapacity ?? '∞')}</dd>
                  </div>
                  <div>
                    <dt>Shape</dt>
                    <dd><span class="table-kind-badge">${escapeHtml(shape)}</span></dd>
                  </div>
                  <div>
                    <dt>Topology</dt>
                    <dd>${generationMode === 'manual-adjusted' ? 'Generated then adjusted manually' : 'Generated perimeter ring'}</dd>
                  </div>
                </div>
                <div class="entity-meta-item entity-meta-form-row entity-meta-form-row-three">
                  <label>
                    <span>Min capacity</span>
                    <input type="number" min="0" data-action="edit-wedding-table-min" data-index="${index}" value="${escapeHtml(capacity.minCapacity)}" />
                  </label>
                  <label>
                    <span>Max capacity</span>
                    <input type="number" min="0" data-action="edit-wedding-table-max" data-index="${index}" value="${escapeHtml(capacity.maxCapacity ?? '')}" />
                  </label>
                  <label>
                    <span>Shape</span>
                    <select data-action="edit-wedding-table-shape" data-index="${index}">
                      <option value="${WEDDING_TABLE_SHAPES.ROUND}"${shape === WEDDING_TABLE_SHAPES.ROUND ? ' selected' : ''}>Round</option>
                      <option value="${WEDDING_TABLE_SHAPES.SQUARE}"${shape === WEDDING_TABLE_SHAPES.SQUARE ? ' selected' : ''}>Square</option>
                      <option value="${WEDDING_TABLE_SHAPES.RECTANGLE}"${shape === WEDDING_TABLE_SHAPES.RECTANGLE ? ' selected' : ''}>Rectangle</option>
                    </select>
                  </label>
                </div>
                <div class="entity-meta-item">
                  <dt>Seats</dt>
                  <dd>${renderMembershipChips(seats.map((seat) => seat.label), getSeatModeEnabled(project) ? 'No seats at this table yet' : 'Seat-aware mode is off')}</dd>
                </div>
                <div class="entity-meta-item wedding-seat-tools">
                  <dt>Generate topology</dt>
                  <dd>
                    <div class="button-row compact-button-row">
                      <button type="button" data-action="generate-wedding-table-seats" data-index="${index}"${getSeatModeEnabled(project) ? '' : ' disabled'}>Generate seats + topology</button>
                    </div>
                    <p class="muted-text top-gap">Round, square, and rectangle currently generate a perimeter order with left/right neighbors. You can then remove left, right, or both adjacencies per seat without regenerating.</p>
                  </dd>
                </div>
              </div>
            </article>
          `;
  }).join('')}
      </div>
    </section>
  `;
}

function renderSeatsPanel(project, editor) {
  const seats = getSeats(project);
  const tables = getTables(project);
  const adjacencies = project.topologies ?? [];
  const selectedLeftSeat = seats.find((seat) => seat.id === editor.draftAdjacencyLeftSeatId) ?? null;
  const leftSeatTableId = selectedLeftSeat ? getSeatTableId(project, selectedLeftSeat.id) : '';
  const availableRightSeats = leftSeatTableId
    ? getSeatsForTable(project, leftSeatTableId).filter((seat) => seat.id !== selectedLeftSeat?.id)
    : [];

  let seatContent = '';
  if (!getSeatModeEnabled(project)) {
    seatContent = '<div class="empty-board">Turn on seat-aware mode to manage seats and “next to” rules. 🪑</div>';
  } else if (seats.length === 0) {
    seatContent = '<div class="empty-board">Add seats to tables to unlock adjacency-based rules.</div>';
  } else {
    const customAdjacencyCard = `
      <article class="entity-card wedding-entity-card">
        <div class="entity-card-header">
          <div>
            <p class="entity-kind">Custom adjacency</p>
            <h4 class="wedding-inline-heading">Link any two seats at the same table</h4>
          </div>
        </div>
        <div class="entity-meta-grid">
          <div class="entity-meta-item wedding-custom-adjacency-grid">
            <label>
              <span>Seat A</span>
              <select name="draftAdjacencyLeftSeatId">
                ${renderSimpleOptions(seats, editor.draftAdjacencyLeftSeatId, 'Select first seat…')}
              </select>
            </label>
            <label>
              <span>Seat B</span>
              <select name="draftAdjacencyRightSeatId" ${leftSeatTableId ? '' : 'disabled'}>
                ${renderSimpleOptions(availableRightSeats, editor.draftAdjacencyRightSeatId, leftSeatTableId ? 'Select second seat…' : 'Choose Seat A first…')}
              </select>
            </label>
          </div>
          <div class="entity-meta-item">
            <dt>Scope</dt>
            <dd>${leftSeatTableId
        ? `Custom links are limited to ${escapeHtml(findLabelById(tables, leftSeatTableId))} so planners only create same-table seat adjacency.`
        : '<span class="muted-text">Select a first seat to narrow the second selector to the same table.</span>'}
            </dd>
          </div>
          <div class="entity-meta-item wedding-seat-tools">
            <dt>Actions</dt>
            <dd>
              <div class="button-row compact-button-row">
                <button type="button" data-action="add-wedding-seat-adjacency"${editor.draftAdjacencyLeftSeatId && editor.draftAdjacencyRightSeatId ? '' : ' disabled'}>Add custom adjacency</button>
              </div>
              <p class="muted-text top-gap">Use this after generation to bridge a gap or create a manual same-table neighbor link without regenerating seats.</p>
            </dd>
          </div>
        </div>
      </article>
    `;

    const seatCards = seats.map((seat, index) => {
      const tableId = getSeatTableId(project, seat.id);
      const table = tables.find((entry) => entry.id === tableId);
      const tableLabel = tableId ? findLabelById(tables, tableId) : 'Unlinked table';
      const adjacentSeatLabels = adjacencies
        .filter((relation) => relation?.from?.kind === 'position' && relation?.from?.id === seat.id && relation?.to?.kind === 'position')
        .map((relation) => findLabelById(seats, relation.to.id));
      const leftNeighbor = table ? findGeneratedNeighbor(project, table.id, seat.id, 'left') : null;
      const rightNeighbor = table ? findGeneratedNeighbor(project, table.id, seat.id, 'right') : null;
      const leftConnected = leftNeighbor ? hasAdjacency(project, seat.id, leftNeighbor.id) : false;
      const rightConnected = rightNeighbor ? hasAdjacency(project, seat.id, rightNeighbor.id) : false;

      return `
        <article class="entity-card wedding-entity-card">
          <div class="entity-card-header">
            <div>
              <p class="entity-kind">Seat</p>
              <input type="text" class="entity-inline-input" data-action="edit-wedding-label" data-kind="position" data-index="${index}" value="${escapeHtml(seat.label)}" />
            </div>
            <button type="button" class="ghost-danger-button" data-action="remove-wedding-seat" data-index="${index}">Remove</button>
          </div>
          <p class="entity-id">${escapeHtml(seat.id)}</p>
          <div class="entity-meta-grid">
            <div class="entity-meta-item wedding-seat-meta-grid compact-seat-meta-grid">
              <div>
                <dt>Table</dt>
                <dd>${escapeHtml(tableLabel)}</dd>
              </div>
              <div>
                <dt>#</dt>
                <dd>${escapeHtml(seat?.metadata?.seatIndex ?? 'Manual')}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>${seat?.metadata?.generated ? 'Generated' : 'Manual'}</dd>
              </div>
            </div>
            <div class="entity-meta-item">
              <dt>Adjacent seats</dt>
              <dd>${renderMembershipChips(adjacentSeatLabels, 'No adjacent seat linked yet')}</dd>
            </div>
            <div class="entity-meta-item wedding-neighbor-grid">
              <div class="wedding-neighbor-card${leftConnected ? '' : ' is-open-gap'}">
                <dt>Left neighbor</dt>
                <dd>${leftNeighbor ? `${escapeHtml(leftNeighbor.label)} ${leftConnected ? '• connected' : '• removed'}` : '<span class="muted-text">No generated left neighbor</span>'}</dd>
                <button type="button" data-action="remove-wedding-seat-left" data-seat-id="${escapeHtml(seat.id)}"${leftNeighbor && leftConnected ? '' : ' disabled'}>Remove left</button>
              </div>
              <div class="wedding-neighbor-card${rightConnected ? '' : ' is-open-gap'}">
                <dt>Right neighbor</dt>
                <dd>${rightNeighbor ? `${escapeHtml(rightNeighbor.label)} ${rightConnected ? '• connected' : '• removed'}` : '<span class="muted-text">No generated right neighbor</span>'}</dd>
                <button type="button" data-action="remove-wedding-seat-right" data-seat-id="${escapeHtml(seat.id)}"${rightNeighbor && rightConnected ? '' : ' disabled'}>Remove right</button>
              </div>
            </div>
            <div class="entity-meta-item wedding-seat-tools">
              <dt>Generated topology actions</dt>
              <dd>
                <div class="button-row compact-button-row">
                  <button type="button" data-action="remove-wedding-seat-both" data-seat-id="${escapeHtml(seat.id)}"${(leftNeighbor && leftConnected) || (rightNeighbor && rightConnected) ? '' : ' disabled'}>Remove both sides</button>
                </div>
                <p class="muted-text top-gap">Removing left or right keeps the seat but opens a gap in the generated perimeter. Removing the seat itself deletes the seat and all its adjacency links without reconnecting neighbors automatically.</p>
              </dd>
            </div>
          </div>
        </article>
      `;
    }).join('');

    seatContent = `${customAdjacencyCard}${seatCards}`;
  }

  return `
    <section class="workspace-panel wedding-panel">
      <div class="panel-header">
        <h3>🪑 Seats and adjacency</h3>
        <span class="panel-count">${seats.length}</span>
      </div>
      <div class="entity-board">${seatContent}</div>
    </section>
  `;
}

function getWeddingRuleLabel(kind) {
  if (kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) {
    return 'Must sit at the same table';
  }

  if (kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER) {
    return 'Must not sit at the same table';
  }

  if (kind === CONSTRAINT_KINDS.MUST_BE_ADJACENT) {
    return 'Must sit next to each other';
  }

  if (kind === CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT) {
    return 'Must not sit next to each other';
  }

  return kind;
}

function getWeddingPreferenceLabel(kind) {
  if (kind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER) {
    return 'Prefer the same table';
  }

  if (kind === PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS) {
    return 'Prefer different tables';
  }

  if (kind === PREFERENCE_KINDS.PREFER_ADJACENT) {
    return 'Prefer seats next to each other';
  }

  if (kind === PREFERENCE_KINDS.PREFER_NON_ADJACENT) {
    return 'Prefer not to sit next to each other';
  }

  return kind;
}

function renderWeddingOperand(project, ref, entry = null, side = 'left') {
  if (entry?.metadata?.groupInternalTogether) {
    if (side === 'right') {
      return '<span class="muted-text">same group</span>';
    }
    return `All members of ${escapeHtml(findLabelById(getGroups(project), ref.id))}`;
  }

  const entries = ref.kind === 'item' ? getGuests(project) : getGroups(project);
  return escapeHtml(findLabelById(entries, ref.id));
}

function renderRulesPanel(project, editor) {
  const operandOptions = createOperandOptions(project);
  const groupOptions = getGroups(project);
  const hardRuleRows = project.constraints.length === 0
    ? '<tr><td colspan="4" class="muted-text">No hard seating rules yet.</td></tr>'
    : project.constraints.map((constraint, index) => `
        <tr>
          <td>${escapeHtml(getWeddingRuleLabel(constraint.kind))}</td>
          <td>${renderWeddingOperand(project, constraint.leftRef, constraint, 'left')}</td>
          <td>${renderWeddingOperand(project, constraint.rightRef, constraint, 'right')}</td>
          <td><button type="button" data-action="remove-wedding-constraint" data-index="${index}">Remove</button></td>
        </tr>
      `).join('');

  const preferenceRows = project.preferences.length === 0
    ? '<tr><td colspan="5" class="muted-text">No seating preferences yet.</td></tr>'
    : project.preferences.map((preference, index) => `
        <tr>
          <td>${escapeHtml(getWeddingPreferenceLabel(preference.kind))}</td>
          <td>${renderWeddingOperand(project, preference.leftRef, preference, 'left')}</td>
          <td>${renderWeddingOperand(project, preference.rightRef, preference, 'right')}</td>
          <td>${escapeHtml(preference.weight)}</td>
          <td><button type="button" data-action="remove-wedding-preference" data-index="${index}">Remove</button></td>
        </tr>
      `).join('');

  return `
    <section class="audit-section-grid wedding-rule-grid">
      <section class="card audit-card">
        <div class="audit-card-header">
          <div>
            <p class="eyebrow">💍 Hard seating rules</p>
            <h2>Must work this way</h2>
          </div>
        </div>
        <div class="wedding-rule-form-stack">
          <div class="form-grid compact-form-grid">
            <label>
              <span>Rule</span>
              <select name="draftConstraintKind">
                <option value="groupTogether"${editor.draftConstraintKind === 'groupTogether' ? ' selected' : ''}>Keep this group together</option>
                <option value="${CONSTRAINT_KINDS.MUST_SHARE_CONTAINER}"${editor.draftConstraintKind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER ? ' selected' : ''}>must sit together at the same table</option>
                <option value="${CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER}"${editor.draftConstraintKind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER ? ' selected' : ''}>Must not sit at the same table</option>
                <option value="${CONSTRAINT_KINDS.MUST_BE_ADJACENT}"${editor.draftConstraintKind === CONSTRAINT_KINDS.MUST_BE_ADJACENT ? ' selected' : ''}>Must sit next to each other</option>
                <option value="${CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT}"${editor.draftConstraintKind === CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT ? ' selected' : ''}>Must not sit next to each other</option>
              </select>
            </label>
          </div>
          <div class="form-grid two-columns compact-form-grid wedding-rule-options-row">
            <label>
              <span>Options</span>
              ${editor.draftConstraintKind === 'groupTogether'
      ? `<select name="draftConstraintGroupId">${renderSimpleOptions(groupOptions, editor.draftConstraintGroupId, 'Select group…')}</select>`
      : `<div class="wedding-group-selection-row">
                ${renderRefSelect('draftConstraintLeftKind', 'draftConstraintLeftId', operandOptions, editor.draftConstraintLeftKind, editor.draftConstraintLeftId, 'Select guest or group…')}
                ${renderRefSelect('draftConstraintRightKind', 'draftConstraintRightId', operandOptions, editor.draftConstraintRightKind, editor.draftConstraintRightId, 'Select guest or group…')}
              </div>`}
            </label>
          </div>
        </div>
        <div class="button-row top-gap">
          <button type="button" data-action="add-wedding-constraint">Add hard rule</button>
        </div>
        <p class="muted-text top-gap">Example: Pierre can belong to both “Family A” and “Groom bachelors”, so you can put Groom bachelors at one table while keeping Family A close together elsewhere.</p>
        <div class="table-wrap audit-table-wrap top-gap">
          <table class="data-table">
            <thead>
              <tr><th>Rule</th><th>Left</th><th>Right</th><th>Actions</th></tr>
            </thead>
            <tbody>${hardRuleRows}</tbody>
          </table>
        </div>
      </section>

      <section class="card audit-card">
        <div class="audit-card-header">
          <div>
            <p class="eyebrow">✨ Seating preferences</p>
            <h2>Prefer if possible</h2>
          </div>
        </div>
        <div class="wedding-rule-form-stack">
          <div class="form-grid compact-form-grid">
            <label>
              <span>Preference</span>
              <select name="draftPreferenceKind">
                <option value="groupTogether"${editor.draftPreferenceKind === 'groupTogether' ? ' selected' : ''}>Keep this group together</option>
                <option value="${PREFERENCE_KINDS.PREFER_SHARE_CONTAINER}"${editor.draftPreferenceKind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER ? ' selected' : ''}>Prefer same table</option>
                <option value="${PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS}"${editor.draftPreferenceKind === PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS ? ' selected' : ''}>Prefer different tables</option>
                <option value="${PREFERENCE_KINDS.PREFER_ADJACENT}"${editor.draftPreferenceKind === PREFERENCE_KINDS.PREFER_ADJACENT ? ' selected' : ''}>Prefer next to each other</option>
                <option value="${PREFERENCE_KINDS.PREFER_NON_ADJACENT}"${editor.draftPreferenceKind === PREFERENCE_KINDS.PREFER_NON_ADJACENT ? ' selected' : ''}>Prefer not next to each other</option>
              </select>
            </label>
          </div>
          <div class="form-grid compact-form-grid wedding-rule-options-with-weight-row">
            <label>
              <span>Options</span>
              ${editor.draftPreferenceKind === 'groupTogether'
      ? `<select name="draftPreferenceGroupId">${renderSimpleOptions(groupOptions, editor.draftPreferenceGroupId, 'Select group…')}</select>`
      : `<div class="wedding-group-selection-row">
                ${renderRefSelect('draftPreferenceLeftKind', 'draftPreferenceLeftId', operandOptions, editor.draftPreferenceLeftKind, editor.draftPreferenceLeftId, 'Select guest or group…')}
                ${renderRefSelect('draftPreferenceRightKind', 'draftPreferenceRightId', operandOptions, editor.draftPreferenceRightKind, editor.draftPreferenceRightId, 'Select guest or group…')}
              </div>`}
            </label>
            <label>
              <span>Soft / hard strength</span>
              <input type="number" min="0" step="1" name="draftPreferenceWeight" value="${escapeHtml(editor.draftPreferenceWeight)}" ${editor.draftPreferenceKind === 'groupTogether' ? '' : ''} />
            </label>
          </div>
        </div>
        <div class="button-row top-gap">
          <button type="button" data-action="add-wedding-preference">Add preference</button>
        </div>
        <div class="table-wrap audit-table-wrap top-gap">
          <table class="data-table">
            <thead>
              <tr><th>Preference</th><th>Left</th><th>Right</th><th>Weight</th><th>Actions</th></tr>
            </thead>
            <tbody>${preferenceRows}</tbody>
          </table>
        </div>
      </section>
    </section >
      `;
}

function removeNodeAndReferences(project, collectionName, index) {
  const removed = project[collectionName]?.[index];
  if (!removed) {
    return;
  }

  project[collectionName].splice(index, 1);
  const matchesRef = (ref) => ref.id === removed.id && ref.kind === removed.kind;

  project.containments = (project.containments ?? []).filter((relation) => !matchesRef(relation.from) && !matchesRef(relation.to));
  project.constraints = (project.constraints ?? []).filter((entry) => !matchesRef(entry.leftRef) && !matchesRef(entry.rightRef));
  project.preferences = (project.preferences ?? []).filter((entry) => !matchesRef(entry.leftRef) && !matchesRef(entry.rightRef));
  project.topologies = (project.topologies ?? []).filter((entry) => !matchesRef(entry.from) && !matchesRef(entry.to));
}

function addWeddingGuest(state) {
  const label = state.weddingPage.editor.draftGuestLabel.trim();
  if (!label) {
    return;
  }

  state.currentProject.items.push(createItem({ id: createId('item'), label }));
  state.weddingPage.editor.draftGuestLabel = '';
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function addWeddingGroup(state) {
  const label = state.weddingPage.editor.draftGroupLabel.trim();
  if (!label) {
    return;
  }

  state.currentProject.groups.push(createGroup({ id: createId('group'), label }));
  state.weddingPage.editor.draftGroupLabel = '';
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function addWeddingTable(state) {
  const editor = state.weddingPage.editor;
  const label = editor.draftTableLabel.trim();
  if (!label) {
    return;
  }

  const minCapacity = Number.parseInt(editor.draftTableMinCapacity || '0', 10);
  const maxCapacity = editor.draftTableMaxCapacity === '' ? null : Number.parseInt(editor.draftTableMaxCapacity, 10);

  const table = createContainer({
    id: createId('container'),
    label,
    minCapacity: Number.isNaN(minCapacity) ? 0 : minCapacity,
    maxCapacity: Number.isNaN(maxCapacity) ? null : maxCapacity,
    metadata: {
      shape: editor.draftTableShape || WEDDING_TABLE_SHAPES.ROUND,
      generationMode: 'auto',
    },
  });

  state.currentProject.containers.push(table);

  editor.draftTableLabel = '';
  editor.draftTableMinCapacity = '0';
  editor.draftTableMaxCapacity = '';
  editor.draftTableShape = WEDDING_TABLE_SHAPES.ROUND;
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function addWeddingSeat(state) {
  const editor = state.weddingPage.editor;
  const label = editor.draftSeatLabel.trim();
  if (!label || !editor.draftSeatTableId || !getSeatModeEnabled(state.currentProject)) {
    return;
  }

  const seatId = createId('position');
  state.currentProject.positions.push(createPosition({ id: seatId, label, metadata: { generated: false } }));
  state.currentProject.containments.push(createContainmentRelation(createEntityRef('container', editor.draftSeatTableId), createEntityRef('position', seatId)));
  const table = getTables(state.currentProject).find((entry) => entry.id === editor.draftSeatTableId);
  if (table) {
    setTableGenerationMode(table, 'manual-adjusted');
  }
  editor.draftSeatLabel = '';
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function addWeddingSeatAdjacency(state) {
  const editor = state.weddingPage.editor;
  const leftSeatId = editor.draftAdjacencyLeftSeatId;
  const rightSeatId = editor.draftAdjacencyRightSeatId;
  if (!leftSeatId || !rightSeatId || leftSeatId === rightSeatId || !getSeatModeEnabled(state.currentProject)) {
    return false;
  }

  const leftTableId = getSeatTableId(state.currentProject, leftSeatId);
  const rightTableId = getSeatTableId(state.currentProject, rightSeatId);
  if (!leftTableId || leftTableId !== rightTableId) {
    state.weddingPage.message = 'Custom seat adjacency currently links seats within the same table only. Choose two seats from one table. ⚠️';
    return false;
  }

  const table = getTables(state.currentProject).find((entry) => entry.id === leftTableId);
  const added = addAdjacencyBetween(state.currentProject, leftSeatId, rightSeatId);
  if (!added) {
    state.weddingPage.message = 'That seat link already exists, is invalid, or uses the same seat twice.';
    return false;
  }

  if (table) {
    setTableGenerationMode(table, 'manual-adjusted');
  }

  editor.draftAdjacencyLeftSeatId = '';
  editor.draftAdjacencyRightSeatId = '';
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
  state.weddingPage.message = 'Custom seat adjacency added. You can now use the updated neighbor graph in seat-aware planning. 🔗';
  return true;
}

function removeAllWeddingSeats(project) {
  const seatIds = new Set(getSeats(project).map((seat) => seat.id));
  project.positions = [];
  project.containments = (project.containments ?? []).filter((relation) => !(relation?.to?.kind === 'position' && seatIds.has(relation.to.id)));
  project.topologies = (project.topologies ?? []).filter((relation) => !seatIds.has(relation?.from?.id) && !seatIds.has(relation?.to?.id));
}

function generateWeddingSeatsForTables(state) {
  if (!getSeatModeEnabled(state.currentProject)) {
    state.weddingPage.message = 'Turn on seat-aware mode before generating seats. 🪑';
    return false;
  }

  const tables = getTables(state.currentProject);
  if (tables.length === 0) {
    state.weddingPage.message = 'Add at least one table before generating seats. 🍽️';
    return false;
  }

  const tablesWithCapacity = tables.filter((table) => {
    const { maxCapacity } = getTableCapacity(table);
    return Number.isInteger(maxCapacity) && maxCapacity > 0;
  });

  if (tablesWithCapacity.length !== tables.length) {
    state.weddingPage.message = 'Each table needs a positive maximum capacity before seats can be generated automatically. ⚠️';
    return false;
  }

  const existingSeatCount = getSeats(state.currentProject).length;
  const warningMessage = existingSeatCount > 0
    ? `This will delete ${existingSeatCount} existing seat${existingSeatCount === 1 ? '' : 's'} and recreate generated seats and perimeter topology for every table. Continue?`
    : 'This will create generated seats and perimeter topology for every table based on each table maximum capacity. Continue?';

  if (!window.confirm(warningMessage)) {
    state.weddingPage.message = 'Seat generation cancelled. Existing seats were kept. 🙂';
    return false;
  }

  removeAllWeddingSeats(state.currentProject);

  let createdSeatCount = 0;
  tablesWithCapacity.forEach((table) => {
    const result = generateSeatsForTable(state.currentProject, table);
    createdSeatCount += result.createdSeatCount;
  });

  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
  state.weddingPage.message = `${createdSeatCount} seat${createdSeatCount === 1 ? '' : 's'} generated from table capacities with perimeter topology. Existing seats were replaced. 🪑`;
  return true;
}


function toggleWeddingMembership(project, groupId, guestId, checked) {
  const existingIndex = (project.containments ?? []).findIndex((relation) => relation?.from?.kind === 'group' && relation?.from?.id === groupId && relation?.to?.kind === 'item' && relation?.to?.id === guestId);

  if (checked && existingIndex === -1) {
    project.containments.push(createContainmentRelation(createEntityRef('group', groupId), createEntityRef('item', guestId)));
  }

  if (!checked && existingIndex >= 0) {
    project.containments.splice(existingIndex, 1);
  }
}

function addWeddingConstraint(state) {
  const editor = state.weddingPage.editor;
  if (!editor.draftConstraintLeftId || !editor.draftConstraintRightId) {
    return;
  }

  state.currentProject.constraints.push(createConstraint({
    kind: editor.draftConstraintKind,
    leftRef: createEntityRef(editor.draftConstraintLeftKind, editor.draftConstraintLeftId),
    rightRef: createEntityRef(editor.draftConstraintRightKind, editor.draftConstraintRightId),
  }));

  editor.draftConstraintLeftId = '';
  editor.draftConstraintRightId = '';
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function addWeddingPreference(state) {
  const editor = state.weddingPage.editor;
  if (!editor.draftPreferenceLeftId || !editor.draftPreferenceRightId) {
    return;
  }

  const weight = Number.parseInt(editor.draftPreferenceWeight || '1', 10);
  state.currentProject.preferences.push(createPreference({
    kind: editor.draftPreferenceKind,
    leftRef: createEntityRef(editor.draftPreferenceLeftKind, editor.draftPreferenceLeftId),
    rightRef: createEntityRef(editor.draftPreferenceRightKind, editor.draftPreferenceRightId),
    weight: Number.isNaN(weight) ? 1 : weight,
  }));

  editor.draftPreferenceLeftId = '';
  editor.draftPreferenceRightId = '';
  editor.draftPreferenceWeight = '1';
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function updateWeddingLabel(state, kind, index, value) {
  const collection = kind === 'item'
    ? state.currentProject.items
    : kind === 'group'
      ? state.currentProject.groups
      : kind === 'position'
        ? state.currentProject.positions
        : state.currentProject.containers;

  if (!collection?.[index]) {
    return;
  }

  collection[index].label = value;
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function updateWeddingTableCapacity(state, index, field, value) {
  const table = state.currentProject.containers[index];
  if (!table) {
    return;
  }

  if (!table.metadata) {
    table.metadata = {};
  }

  if (field === 'maxCapacity' && value === '') {
    table.metadata.maxCapacity = null;
    clearWeddingMessage(state);
    resetWeddingDerivedState(state);
    return;
  }

  const parsed = Number.parseInt(value || '0', 10);
  table.metadata[field] = Number.isNaN(parsed) ? (field === 'maxCapacity' ? null : 0) : parsed;
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function updateWeddingTableShape(state, index, value) {
  const table = state.currentProject.containers[index];
  if (!table) {
    return;
  }

  setTableShape(table, value);
  clearWeddingMessage(state);
  resetWeddingDerivedState(state);
}

function bindInputs(root, state) {
  root.querySelectorAll('input[name], textarea[name], select[name]').forEach((element) => {
    const eventName = element.tagName === 'SELECT' ? 'change' : 'input';
    element.addEventListener(eventName, (event) => {
      const { name, value } = event.target;

      if (name === 'weddingTitle') {
        state.currentProject.title = value;
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        return;
      }

      if (name === 'weddingDescription') {
        state.currentProject.description = value;
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        return;
      }

      if (name === 'weddingAssignmentMode') {
        state.currentProject.assignmentMode = value;
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
        return;
      }

      state.weddingPage.editor[name] = value;

      if (name === 'draftConstraintKind') {
        if (value === 'groupTogether') {
          state.weddingPage.editor.draftConstraintGroupId = '';
        }
        clearWeddingMessage(state);
        renderWeddingPage(root, state);
        return;
      }

      if (name === 'draftPreferenceKind') {
        if (value === 'groupTogether') {
          state.weddingPage.editor.draftPreferenceGroupId = '';
        }
        clearWeddingMessage(state);
        renderWeddingPage(root, state);
        return;
      }

      if (name === 'draftConstraintLeftKind') {
        state.weddingPage.editor.draftConstraintLeftId = '';
        clearWeddingMessage(state);
        renderWeddingPage(root, state);
        return;
      }

      if (name === 'draftConstraintRightKind') {
        state.weddingPage.editor.draftConstraintRightId = '';
        clearWeddingMessage(state);
        renderWeddingPage(root, state);
        return;
      }

      if (name === 'draftPreferenceLeftKind') {
        state.weddingPage.editor.draftPreferenceLeftId = '';
        clearWeddingMessage(state);
        renderWeddingPage(root, state);
        return;
      }

      if (name === 'draftPreferenceRightKind') {
        state.weddingPage.editor.draftPreferenceRightId = '';
        clearWeddingMessage(state);
        renderWeddingPage(root, state);
        return;
      }

      if (name === 'draftAdjacencyLeftSeatId') {
        const selectedTableId = value ? getSeatTableId(state.currentProject, value) : '';
        const currentRightSeatId = state.weddingPage.editor.draftAdjacencyRightSeatId;
        const currentRightTableId = currentRightSeatId ? getSeatTableId(state.currentProject, currentRightSeatId) : '';
        if (!selectedTableId || currentRightTableId !== selectedTableId || currentRightSeatId === value) {
          state.weddingPage.editor.draftAdjacencyRightSeatId = '';
        }
        clearWeddingMessage(state);
        renderWeddingPage(root, state);
        return;
      }

      clearWeddingMessage(state);
    });
  });

  root.querySelectorAll('[data-action="edit-wedding-label"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateWeddingLabel(state, event.target.dataset.kind, Number.parseInt(event.target.dataset.index, 10), event.target.value);
    });
  });

  root.querySelectorAll('[data-action="edit-wedding-table-min"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateWeddingTableCapacity(state, Number.parseInt(event.target.dataset.index, 10), 'minCapacity', event.target.value);
    });
  });

  root.querySelectorAll('[data-action="edit-wedding-table-max"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateWeddingTableCapacity(state, Number.parseInt(event.target.dataset.index, 10), 'maxCapacity', event.target.value);
    });
  });

  root.querySelectorAll('[data-action="edit-wedding-table-shape"]').forEach((element) => {
    element.addEventListener('change', (event) => {
      updateWeddingTableShape(state, Number.parseInt(event.target.dataset.index, 10), event.target.value);
      renderWeddingPage(root, state);
    });
  });

}

function bindActions(root, state) {
  root.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.dataset.action;

    if (action === 'add-wedding-guest') {
      element.addEventListener('click', () => {
        addWeddingGuest(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'add-wedding-group') {
      element.addEventListener('click', () => {
        addWeddingGroup(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'add-wedding-table') {
      element.addEventListener('click', () => {
        addWeddingTable(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'add-wedding-seat') {
      element.addEventListener('click', () => {
        addWeddingSeat(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'generate-wedding-seats') {
      element.addEventListener('click', () => {
        generateWeddingSeatsForTables(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'add-wedding-seat-adjacency') {
      element.addEventListener('click', () => {
        addWeddingSeatAdjacency(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'generate-wedding-table-seats') {
      element.addEventListener('click', () => {
        const table = state.currentProject.containers[Number.parseInt(element.dataset.index, 10)];
        if (!getSeatModeEnabled(state.currentProject)) {
          state.weddingPage.message = 'Turn on seat-aware mode before generating seats. 🪑';
          renderWeddingPage(root, state);
          return;
        }

        if (!table) {
          return;
        }

        const { maxCapacity } = getTableCapacity(table);
        if (!Number.isInteger(maxCapacity) || maxCapacity <= 0) {
          state.weddingPage.message = `${table.label} needs a positive maximum capacity before seats can be generated automatically. ⚠️`;
          renderWeddingPage(root, state);
          return;
        }

        const existingSeatCount = getSeatsForTable(state.currentProject, table.id).length;
        const warningMessage = existingSeatCount > 0
          ? `This will replace ${existingSeatCount} existing seat${existingSeatCount === 1 ? '' : 's'} for ${table.label}. Continue?`
          : `Generate seats and perimeter topology for ${table.label}?`;

        if (!window.confirm(warningMessage)) {
          state.weddingPage.message = 'Table generation cancelled. Existing seats were kept. 🙂';
          renderWeddingPage(root, state);
          return;
        }

        const result = generateSeatsForTable(state.currentProject, table);
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        state.weddingPage.message = `${table.label} generated ${result.createdSeatCount} seat${result.createdSeatCount === 1 ? '' : 's'} with a ${result.shape} perimeter topology. 🪑`;
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'add-wedding-constraint') {
      element.addEventListener('click', () => {
        if (state.weddingPage.editor.draftConstraintKind === 'groupTogether') {
          const groupId = state.weddingPage.editor.draftConstraintGroupId;
          if (!groupId) {
            state.weddingPage.message = 'Select a group to keep together.';
            renderWeddingPage(root, state);
            return;
          }
          setGroupTogetherShortcut(state.currentProject, groupId, true);
          clearWeddingMessage(state);
          resetWeddingDerivedState(state);
          state.weddingPage.message = 'Group together rule added.';
          renderWeddingPage(root, state);
          return;
        }

        addWeddingConstraint(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'add-wedding-preference') {
      element.addEventListener('click', () => {
        if (state.weddingPage.editor.draftPreferenceKind === 'groupTogether') {
          const groupId = state.weddingPage.editor.draftPreferenceGroupId;
          if (!groupId) {
            state.weddingPage.message = 'Select a group to prefer together.';
            renderWeddingPage(root, state);
            return;
          }
          setGroupPreferTogetherShortcut(state.currentProject, groupId, state.weddingPage.editor.draftPreferenceWeight);
          clearWeddingMessage(state);
          resetWeddingDerivedState(state);
          state.weddingPage.message = 'Group together preference added.';
          renderWeddingPage(root, state);
          return;
        }

        addWeddingPreference(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-guest') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state.currentProject, 'items', Number.parseInt(element.dataset.index, 10));
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-group') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state.currentProject, 'groups', Number.parseInt(element.dataset.index, 10));
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-table') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state.currentProject, 'containers', Number.parseInt(element.dataset.index, 10));
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-seat') {
      element.addEventListener('click', () => {
        const seat = state.currentProject.positions[Number.parseInt(element.dataset.index, 10)];
        const tableId = seat ? getSeatTableId(state.currentProject, seat.id) : null;
        const table = tableId ? getTables(state.currentProject).find((entry) => entry.id === tableId) : null;
        removeNodeAndReferences(state.currentProject, 'positions', Number.parseInt(element.dataset.index, 10));
        if (table) {
          setTableGenerationMode(table, 'manual-adjusted');
        }
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-seat-left') {
      element.addEventListener('click', () => {
        const seatId = element.dataset.seatId;
        const tableId = getSeatTableId(state.currentProject, seatId);
        const table = tableId ? getTables(state.currentProject).find((entry) => entry.id === tableId) : null;
        if (!table) {
          return;
        }

        const removed = removeGeneratedSeatAdjacency(state.currentProject, table, seatId, 'left');
        state.weddingPage.message = removed
          ? 'Left-side adjacency removed. The seat stays in place and the generated ring now has a gap on that side. ↩️'
          : 'No generated left adjacency was available to remove.';
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-seat-right') {
      element.addEventListener('click', () => {
        const seatId = element.dataset.seatId;
        const tableId = getSeatTableId(state.currentProject, seatId);
        const table = tableId ? getTables(state.currentProject).find((entry) => entry.id === tableId) : null;
        if (!table) {
          return;
        }

        const removed = removeGeneratedSeatAdjacency(state.currentProject, table, seatId, 'right');
        state.weddingPage.message = removed
          ? 'Right-side adjacency removed. The seat stays in place and the generated ring now has a gap on that side. ↪️'
          : 'No generated right adjacency was available to remove.';
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-seat-both') {
      element.addEventListener('click', () => {
        const seatId = element.dataset.seatId;
        const tableId = getSeatTableId(state.currentProject, seatId);
        const table = tableId ? getTables(state.currentProject).find((entry) => entry.id === tableId) : null;
        if (!table) {
          return;
        }

        const removed = removeGeneratedSeatBothSides(state.currentProject, table, seatId);
        state.weddingPage.message = removed
          ? 'Both generated adjacencies were removed for that seat. The seat remains, but it now has open gaps on each generated side. ⛔'
          : 'No generated left/right adjacency was available to remove.';
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-constraint') {
      element.addEventListener('click', () => {
        state.currentProject.constraints.splice(Number.parseInt(element.dataset.index, 10), 1);
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'remove-wedding-preference') {
      element.addEventListener('click', () => {
        state.currentProject.preferences.splice(Number.parseInt(element.dataset.index, 10), 1);
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'toggle-wedding-membership') {
      element.addEventListener('change', (event) => {
        toggleWeddingMembership(state.currentProject, event.target.dataset.groupId, event.target.dataset.guestId, event.target.checked);
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'validate-wedding') {
      element.addEventListener('click', () => {
        runWeddingValidationFlow(state);
        const errorCount = state.weddingPage.lastValidation?.errors?.length ?? 0;
        const warningCount = state.weddingPage.lastValidation?.warnings?.length ?? 0;
        state.weddingPage.message = state.weddingPage.lastValidation?.valid
          ? `Wedding validation passed with ${warningCount} warning${warningCount === 1 ? '' : 's'}. 💐`
          : `Wedding validation found ${errorCount} problem${errorCount === 1 ? '' : 's'} and ${warningCount} warning${warningCount === 1 ? '' : 's'}. Please review the messages below. ⚠️`;
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'solve-wedding') {
      element.addEventListener('click', () => {
        runWeddingSolveFlow(state);
        state.weddingPage.message = state.weddingPage.lastSolverResult?.status === 'solved'
          ? 'Wedding solve completed. A seating plan was found. 💖'
          : state.weddingPage.lastSolverResult?.status === 'unsat'
            ? 'No valid seating plan was found with the current rules and capacities. 🧠'
            : state.weddingPage.lastSolverResult?.status === 'validation-failed'
              ? 'The seating plan was not attempted because the wedding setup still has problems to fix. ⚠️'
              : 'Wedding solve could not complete successfully.';
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'import-wedding-workbook') {
      element.addEventListener('change', async (event) => {
        const [file] = Array.from(event.target.files ?? []);
        if (!file) {
          return;
        }

        try {
          state.currentProject = await importWeddingWorkbook(file);
          state.currentProject.viewHint = VIEW_HINTS.WEDDING;
          clearWeddingMessage(state);
          resetWeddingDerivedState(state);
          state.weddingPage.message = `Excel workbook imported from ${file.name}. Please validate the imported wedding plan. 💌`;
        } catch (error) {
          state.weddingPage.message = error instanceof Error
            ? `Excel import failed: ${error.message}`
            : 'Excel import failed.';
        }

        event.target.value = '';
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'export-wedding-solution') {
      element.addEventListener('click', () => {
        try {
          exportWeddingSolutionWorkbook(state.currentProject, state.weddingPage.lastSolverResult, state.weddingPage.editor.activeSolutionIndex);
          state.weddingPage.message = `Excel export downloaded for solution ${state.weddingPage.editor.activeSolutionIndex + 1}. 📘`;
        } catch (error) {
          state.weddingPage.message = error instanceof Error
            ? `Excel export failed: ${error.message}`
            : 'Excel export failed.';
        }
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'toggle-wedding-mode') {
      element.addEventListener('click', () => {
        state.currentProject.assignmentMode = getSeatModeEnabled(state.currentProject)
          ? ASSIGNMENT_MODES.CONTAINER
          : ASSIGNMENT_MODES.POSITION;
        clearWeddingMessage(state);
        resetWeddingDerivedState(state);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'previous-solution') {
      element.addEventListener('click', () => {
        state.weddingPage.editor.activeSolutionIndex = Math.max(0, state.weddingPage.editor.activeSolutionIndex - 1);
        renderWeddingPage(root, state);
      });
      return;
    }

    if (action === 'next-solution') {
      element.addEventListener('click', () => {
        const solutionCount = state.weddingPage.lastSolverResult?.solutions?.length ?? 0;
        state.weddingPage.editor.activeSolutionIndex = Math.min(Math.max(solutionCount - 1, 0), state.weddingPage.editor.activeSolutionIndex + 1);
        renderWeddingPage(root, state);
      });
    }
  });
}

function bindEnterToCreate(root, state) {
  const actionMap = {
    draftGuestLabel: addWeddingGuest,
    draftGroupLabel: addWeddingGroup,
    draftTableLabel: addWeddingTable,
    draftTableMinCapacity: addWeddingTable,
    draftTableMaxCapacity: addWeddingTable,
    draftSeatLabel: addWeddingSeat,
    draftPreferenceWeight: addWeddingPreference,
  };

  root.querySelectorAll('input[name]').forEach((element) => {
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      const action = actionMap[event.target.name];
      if (!action) {
        return;
      }

      event.preventDefault();
      action(state);
      renderWeddingPage(root, state);
    });
  });

  root.querySelectorAll('select[name]').forEach((element) => {
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      if (event.target.name === 'draftConstraintRightId') {
        event.preventDefault();
        addWeddingConstraint(state);
        renderWeddingPage(root, state);
      }

      if (event.target.name === 'draftPreferenceRightId') {
        event.preventDefault();
        addWeddingPreference(state);
        renderWeddingPage(root, state);
      }
    });
  });
}

export function renderWeddingPage(root, state) {
  ensureWeddingProject(state);

  root.innerHTML = renderPageShell({
    title: 'Wedding Table Plan',
    description: '💍 Build a wedding seating plan with guests, overlapping groups, tables, optional seats, and planner-friendly rules.',
    body: `
      ${renderCommandBar(state.weddingPage.lastSolverResult)}
      ${state.weddingPage.message ? `<section class="command-bar-feedback">${escapeHtml(state.weddingPage.message)}</section>` : ''}
      ${renderSummary(state.currentProject)}
      ${renderMetadataPanel(state.currentProject)}
      ${renderCreateCards(state.currentProject, state.weddingPage.editor)}
      <section class="workspace-columns two-up">
        ${renderGuestsPanel(state.currentProject)}
        ${renderGroupsPanel(state.currentProject, state.weddingPage.editor)}
      </section>
      <section class="workspace-columns two-up">
        ${renderTablesPanel(state.currentProject)}
      </section>
      ${renderRulesPanel(state.currentProject, state.weddingPage.editor)}
      ${renderValidationPanel(state.weddingPage.lastValidation, {
      hasComputedSolution: Boolean(state.weddingPage.lastSolverResult),
      expanded: state.weddingPage.validationPanelExpanded,
    })
      }
    <section class="audit-section-grid">
      <section class="card audit-card">
        <div class="audit-card-header">
          <div>
            <p class="eyebrow">🧮 Derived model</p>
            <h2>Normalization</h2>
          </div>
        </div>
        ${state.weddingPage.lastNormalizedProject ? `
            <dl class="summary-grid audit-summary-grid">
              <div><dt>Items sent to solver</dt><dd>${state.weddingPage.lastNormalizedProject.items.length}</dd></div>
              <div><dt>Constraints</dt><dd>${state.weddingPage.lastNormalizedProject.constraints.length}</dd></div>
              <div><dt>Preferences</dt><dd>${state.weddingPage.lastNormalizedProject.preferences.length}</dd></div>
              <div><dt>Must-share groups</dt><dd>${state.weddingPage.lastNormalizedProject.derived?.mustShareComponents?.length ?? 0}</dd></div>
            </dl>
            <details class="details-panel top-gap">
              <summary>View normalized project JSON</summary>
              <pre class="json-block">${escapeHtml(JSON.stringify(state.weddingPage.lastNormalizedProject, null, 2))}</pre>
            </details>
          ` : '<p class="muted-text">Validate or solve the wedding plan to inspect the normalized project.</p>'}
      </section>
      ${renderSolutionPanel(state.weddingPage.lastNormalizedProject ?? state.currentProject, state.weddingPage.lastSolverResult, state.weddingPage.editor.activeSolutionIndex)}
      ${renderSeatsPanel(state.currentProject, state.weddingPage.editor)}
    </section>
    `,
  });

  bindInputs(root, state);
  bindActions(root, state);
  bindEnterToCreate(root, state);
}

