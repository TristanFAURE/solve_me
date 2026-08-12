import { renderPageShell } from '../../components/common/pageShell.js';
import { renderSolutionPanel } from '../../components/solutions/solutionPanel.js';
import { renderValidationPanel } from '../../components/solutions/validationPanel.js';
import { ASSIGNMENT_MODES } from '../../core/model/assignmentModes.js';
import { CONSTRAINT_KINDS, createConstraint } from '../../core/model/constraints.js';
import { createId } from '../../core/model/ids.js';
import { NODE_KINDS, createContainer, createGroup, createItem, createPosition } from '../../core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../core/model/project.js';
import { PREFERENCE_KINDS, createPreference } from '../../core/model/preferences.js';
import { createAdjacencyRelation, createContainmentRelation, createEntityRef } from '../../core/model/relations.js';
import { normalizeProject } from '../../core/normalize/normalizeProject.js';
import { validateProject } from '../../core/validate/validateProject.js';
import { FirstSolverAdapter } from '../../solver/adapters/firstSolverAdapter.js';
import { exportProject, importProject } from '../../storage/importExport.js';
import { loadDraft, saveDraft } from '../../storage/localDrafts.js';
import { getProjectVersionInfo, migrateProjectModel } from '../../storage/modelVersioning.js';

const ENTITY_KIND_OPTIONS = [
  { value: NODE_KINDS.ITEM, label: 'Item' },
  { value: NODE_KINDS.GROUP, label: 'Group' },
  { value: NODE_KINDS.CONTAINER, label: 'Container' },
  { value: NODE_KINDS.POSITION, label: 'Position' },
];

const CONTAINMENT_SOURCE_OPTIONS = [
  { value: NODE_KINDS.GROUP, label: 'Group' },
  { value: NODE_KINDS.CONTAINER, label: 'Container' },
];

const CONTAINMENT_TARGET_OPTIONS = [
  { value: NODE_KINDS.ITEM, label: 'Item' },
  { value: NODE_KINDS.POSITION, label: 'Position' },
];

function createGenericPageState() {
  return {
    draftItemLabel: '',
    draftGroupLabel: '',
    draftContainerLabel: '',
    draftContainerMinCapacity: '0',
    draftContainerMaxCapacity: '',
    draftPositionLabel: '',
    draftContainmentFromKind: NODE_KINDS.GROUP,
    draftContainmentFromId: '',
    draftContainmentToKind: NODE_KINDS.ITEM,
    draftContainmentToId: '',
    draftTopologyFromId: '',
    draftTopologyToId: '',
    draftConstraintKind: CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
    draftConstraintMode: 'pair',
    draftConstraintLeftKind: NODE_KINDS.ITEM,
    draftConstraintLeftId: '',
    draftConstraintRightKind: NODE_KINDS.ITEM,
    draftConstraintRightId: '',
    draftConstraintGroupId: '',
    draftPreferenceKind: PREFERENCE_KINDS.PREFER_SHARE_CONTAINER,
    draftPreferenceMode: 'pair',
    draftPreferenceLeftKind: NODE_KINDS.ITEM,
    draftPreferenceLeftId: '',
    draftPreferenceRightKind: NODE_KINDS.ITEM,
    draftPreferenceRightId: '',
    draftPreferenceGroupId: '',
    draftPreferenceWeight: '1',
    activeSolutionIndex: 0,
    storageMessage: '',
    storageError: '',
    storageWarnings: [],
    storageDetails: null,
  };
}

function ensureProject(state) {
  if (!state.currentProject) {
    state.currentProject = createEmptyProject({ viewHint: VIEW_HINTS.GENERIC });
  }

  if (!state.genericPage) {
    state.genericPage = {
      editor: createGenericPageState(),
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    };
    return;
  }

  if (!state.genericPage.editor) {
    state.genericPage.editor = createGenericPageState();
  } else {
    state.genericPage.editor = {
      ...createGenericPageState(),
      ...state.genericPage.editor,
      storageWarnings: Array.isArray(state.genericPage.editor.storageWarnings) ? state.genericPage.editor.storageWarnings : [],
      storageDetails: state.genericPage.editor.storageDetails ?? null,
    };
  }

  if (typeof state.genericPage.validationPanelExpanded !== 'boolean') {
    state.genericPage.validationPanelExpanded = false;
  }
}

function renderOptions(options, selectedValue) {
  return options
    .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selectedValue ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');
}

function renderEntityOptions(project, kinds, selectedId) {
  const nodes = [project.items, project.groups, project.containers, project.positions].flat();
  const filtered = nodes.filter((node) => kinds.includes(node.kind));

  return [
    '<option value="">Select…</option>',
    ...filtered.map((node) => `<option value="${escapeHtml(node.id)}"${node.id === selectedId ? ' selected' : ''}>${escapeHtml(node.label)} (${escapeHtml(node.kind)})</option>`),
  ].join('');
}

function renderStorageFeedback(editor) {
  const storageWarnings = Array.isArray(editor.storageWarnings) ? editor.storageWarnings : [];

  if (!editor.storageError && !editor.storageMessage && storageWarnings.length === 0 && !editor.storageDetails) {
    return '';
  }

  const warningList = storageWarnings.length > 0
    ? `<ul class="storage-feedback-list">${storageWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '';

  const details = editor.storageDetails
    ? `
      <details class="storage-feedback-details">
        <summary>View import and restore details</summary>
        ${editor.storageDetails.version ? `
          <div class="storage-feedback-section">
            <h3>Version compatibility</h3>
            <p class="muted-text">Source version: ${escapeHtml(editor.storageDetails.version.sourceVersion ?? 'missing')} · Current version: ${escapeHtml(editor.storageDetails.version.targetVersion)}</p>
          </div>
        ` : ''}
      ${editor.storageDetails.errors?.length ? `
          <div class="storage-feedback-section">
            <h3>Validation errors</h3>
            <ul class="issue-list compact-issue-list">${editor.storageDetails.errors.map((issue) => `<li class="issue-list-item error"><div>${escapeHtml(issue.message)}</div><div class="issue-path">${escapeHtml(issue.code)}${issue.path ? ` · ${issue.path}` : ''}</div></li>`).join('')}</ul>
          </div>
        ` : ''}
      ${editor.storageDetails.warnings?.length ? `
          <div class="storage-feedback-section">
            <h3>Validation warnings</h3>
            <ul class="issue-list compact-issue-list">${editor.storageDetails.warnings.map((warning) => `<li class="issue-list-item warning"><div>${escapeHtml(warning.message ?? warning)}</div>${warning.code || warning.path ? `<div class="issue-path">${escapeHtml(warning.code ?? 'warning')}${warning.path ? ` · ${warning.path}` : ''}</div>` : ''}</li>`).join('')}</ul>
          </div>
        ` : ''}
    </details>
    `
    : '';

  return `
    <div class="command-bar-feedback${editor.storageError ? ' command-bar-feedback-error' : ''}${storageWarnings.length > 0 && !editor.storageError ? ' command-bar-feedback-warning' : ''}">
      ${editor.storageError ? `<p class="storage-feedback-title">${escapeHtml(editor.storageError)}</p>` : ''}
      ${!editor.storageError && editor.storageMessage ? `<p class="storage-feedback-title">${escapeHtml(editor.storageMessage)}</p>` : ''}
      ${warningList}
      ${details}
    </div>
    `;
}

function renderCommandBar(editor) {
  return `
    <section class="command-bar-card">
      <div class="command-bar-copy">
        <p class="eyebrow">Command bar</p>
        <h2>Workflow actions</h2>
        <p class="muted-text">Keep validation and solve actions available while you move through the workspace.</p>
      </div>
      <div class="command-bar-actions">
        <button type="button" class="command-bar-button" data-action="validate" aria-label="Validate project">
          <span class="command-bar-icon" aria-hidden="true">✓</span>
          <span>Validate</span>
        </button>
        <button type="button" class="command-bar-button command-bar-button-primary" data-action="solve" aria-label="Validate, normalize, and solve">
          <span class="command-bar-icon" aria-hidden="true">▶</span>
          <span>Validate + normalize + solve</span>
        </button>
        <button type="button" class="command-bar-button" data-action="save-draft" aria-label="Save draft to browser storage">
          <span class="command-bar-icon" aria-hidden="true">💾</span>
          <span>Save draft</span>
        </button>
        <button type="button" class="command-bar-button" data-action="load-draft" aria-label="Load draft from browser storage">
          <span class="command-bar-icon" aria-hidden="true">⇩</span>
          <span>Load draft</span>
        </button>
        <label class="command-bar-button command-bar-button-file" aria-label="Import project JSON">
          <span class="command-bar-icon" aria-hidden="true">⤓</span>
          <span>Import JSON</span>
          <input type="file" accept="application/json,.json" data-action="import-project-file" hidden />
        </label>
        <button type="button" class="command-bar-button" data-action="export-project" aria-label="Export project JSON">
          <span class="command-bar-icon" aria-hidden="true">⤒</span>
          <span>Export JSON</span>
        </button>
        <button type="button" class="command-bar-button command-bar-button-danger" data-action="reset-project" aria-label="Reset project">
          <span class="command-bar-icon" aria-hidden="true">↺</span>
          <span>Reset project</span>
        </button>
      </div>
      ${renderStorageFeedback(editor)}
    </section>
    `;
}

function renderProjectSummary(project) {
  return `
    <section class="hero-card">
      <div>
        <p class="eyebrow">Generic constraint workspace</p>
        <h2>${escapeHtml(project.title || 'Untitled project')}</h2>
        <p class="hero-description">${escapeHtml(project.description || 'Model your entities and relations in a visual workspace with direct editing.')}</p>
      </div>
      <dl class="summary-grid compact-summary-grid">
        <div><dt>Mode</dt><dd>${escapeHtml(project.assignmentMode)}</dd></div>
        <div><dt>Items</dt><dd>${project.items.length}</dd></div>
        <div><dt>Groups</dt><dd>${project.groups.length}</dd></div>
        <div><dt>Containers</dt><dd>${project.containers.length}</dd></div>
        <div><dt>Positions</dt><dd>${project.positions.length}</dd></div>
        <div><dt>Relations</dt><dd>${project.containments.length + project.topologies.length + project.constraints.length + project.preferences.length}</dd></div>
      </dl>
    </section>
    `;
}

function renderEntityBoard(title, entities, config = {}) {
  const { removeAction, kindLabel, emptyMessage, extraFields = [] } = config;

  const cards = entities.length === 0
    ? `<div class="empty-board">${escapeHtml(emptyMessage || 'Nothing here yet.')}</div>`
    : entities.map((entity, index) => `
    <article class="entity-card">
      <div class="entity-card-header">
        <div>
          <p class="entity-kind">${escapeHtml(kindLabel)}</p>
          <input type="text" class="entity-inline-input" data-action="edit-entity-label" data-kind="${escapeHtml(entity.kind)}" data-index="${index}" value="${escapeHtml(entity.label)}" />
        </div>
        <button type="button" class="ghost-danger-button" data-action="${removeAction}" data-index="${index}">Remove</button>
      </div>
      <p class="entity-id">${escapeHtml(entity.id)}</p>
      <div class="entity-meta-grid">
        ${extraFields.map((field) => field(entity, index)).join('')}
      </div>
    </article>
    `).join('');

  return `
    <section class="workspace-panel">
      <div class="panel-header">
        <h3>${title}</h3>
        <span class="panel-count">${entities.length}</span>
      </div>
      <div class="entity-board">
        ${cards}
      </div>
    </section>
    `;
}

function getEntityLabel(project, kind, id) {
  const nodes = [project.items, project.groups, project.containers, project.positions].flat();
  const node = nodes.find((entry) => entry.kind === kind && entry.id === id);
  return node ? node.label : `${kind}:${id}`;
}

function getContainedIds(project, fromKind, fromId, toKind) {
  return project.containments
    .filter((relation) => relation.from.kind === fromKind && relation.from.id === fromId && relation.to.kind === toKind)
    .map((relation) => relation.to.id);
}

function renderMembershipSummary(project, groupId) {
  const memberIds = getContainedIds(project, NODE_KINDS.GROUP, groupId, NODE_KINDS.ITEM);
  if (memberIds.length === 0) {
    return '<div class="entity-meta-item"><dt>Members</dt><dd class="muted-text">No members yet</dd></div>';
  }

  const chips = memberIds
    .map((id) => `<span class="chip">${escapeHtml(getEntityLabel(project, NODE_KINDS.ITEM, id))}</span>`)
    .join('');

  return `<div class="entity-meta-item"><dt>Members</dt><dd class="chip-row">${chips}</dd></div>`;
}

function renderPositionSummary(project, containerId) {
  const positionIds = getContainedIds(project, NODE_KINDS.CONTAINER, containerId, NODE_KINDS.POSITION);
  if (positionIds.length === 0) {
    return '<div class="entity-meta-item"><dt>Positions</dt><dd class="muted-text">No positions yet</dd></div>';
  }

  const chips = positionIds
    .map((id) => `<span class="chip">${escapeHtml(getEntityLabel(project, NODE_KINDS.POSITION, id))}</span>`)
    .join('');

  return `<div class="entity-meta-item"><dt>Positions</dt><dd class="chip-row">${chips}</dd></div>`;
}

function renderWorkspace(project, editor) {
  return `
    <section class="workspace-layout">
      <div class="workspace-main">
        <section class="card workspace-toolbar">
          <div class="toolbar-head">
            <div>
              <p class="eyebrow">Workspace</p>
              <h2>Visual editor</h2>
              <p class="muted-text">Create and edit entities directly in boards so your existing model stays visible while you work.</p>
            </div>
          </div>

          <div class="creation-grid">
            <article class="creation-card accent-item">
              <h3>Add item</h3>
              <label>
                <span>Label</span>
                <input type="text" name="draftItemLabel" value="${escapeHtml(editor.draftItemLabel)}" />
              </label>
              <button type="button" data-action="add-item">Add item</button>
            </article>

            <article class="creation-card accent-group">
              <h3>Add group</h3>
              <label>
                <span>Label</span>
                <input type="text" name="draftGroupLabel" value="${escapeHtml(editor.draftGroupLabel)}" />
              </label>
              <button type="button" data-action="add-group">Add group</button>
            </article>

            <article class="creation-card accent-container">
              <h3>Add container</h3>
              <label>
                <span>Label</span>
                <input type="text" name="draftContainerLabel" value="${escapeHtml(editor.draftContainerLabel)}" />
              </label>
              <div class="inline-field-grid">
                <label>
                  <span>Min</span>
                  <input type="number" name="draftContainerMinCapacity" value="${escapeHtml(editor.draftContainerMinCapacity)}" min="0" />
                </label>
                <label>
                  <span>Max</span>
                  <input type="number" name="draftContainerMaxCapacity" value="${escapeHtml(editor.draftContainerMaxCapacity)}" min="0" />
                </label>
              </div>
              <button type="button" data-action="add-container">Add container</button>
            </article>

            <article class="creation-card accent-position">
              <h3>Add position</h3>
              <label>
                <span>Label</span>
                <input type="text" name="draftPositionLabel" value="${escapeHtml(editor.draftPositionLabel)}" />
              </label>
              <button type="button" data-action="add-position">Add position</button>
            </article>
          </div>
        </section>

        <section class="workspace-columns two-up">
          ${renderEntityBoard('Items', project.items, {
    removeAction: 'remove-item',
    kindLabel: 'Item',
    emptyMessage: 'Add items to begin building your model.',
  })}
          ${renderEntityBoard('Groups', project.groups, {
    removeAction: 'remove-group',
    kindLabel: 'Group',
    emptyMessage: 'Groups will help organize membership.',
    extraFields: [
      (entity) => renderMembershipSummary(project, entity.id),
    ],
  })}
        </section>

        <section class="workspace-columns two-up">
          ${renderEntityBoard('Containers', project.containers, {
    removeAction: 'remove-container',
    kindLabel: 'Container',
    emptyMessage: 'Containers are your assignment destinations.',
    extraFields: [
      (entity) => `<div class="entity-meta-item"><dt>Capacity</dt><dd>${escapeHtml(entity.metadata?.minCapacity ?? 0)} → ${escapeHtml(entity.metadata?.maxCapacity ?? '∞')}</dd></div>`,
      (entity, index) => `
                <div class="entity-meta-item entity-meta-form-row">
                  <label>
                    <span>Min capacity</span>
                    <input type="number" min="0" class="entity-small-input" data-action="edit-container-min" data-index="${index}" value="${escapeHtml(entity.metadata?.minCapacity ?? 0)}" />
                  </label>
                  <label>
                    <span>Max capacity</span>
                    <input type="number" min="0" class="entity-small-input" data-action="edit-container-max" data-index="${index}" value="${escapeHtml(entity.metadata?.maxCapacity ?? '')}" />
                  </label>
                </div>
              `,
      (entity) => renderPositionSummary(project, entity.id),
    ],
  })}
          ${renderEntityBoard('Positions', project.positions, {
    removeAction: 'remove-position',
    kindLabel: 'Position',
    emptyMessage: 'Use positions when you need adjacency-aware models.',
  })}
        </section>
      </div>

      <aside class="workspace-sidebar">
        <section class="card sticky-panel">
          <h2>Project metadata</h2>
          <div class="form-grid two-columns">
            <label>
              <span>Title</span>
              <input type="text" name="projectTitle" value="${escapeHtml(project.title)}" />
            </label>
            <label>
              <span>Assignment mode</span>
              <select name="assignmentMode">
                ${renderOptions([
    { value: ASSIGNMENT_MODES.CONTAINER, label: 'Container' },
    { value: ASSIGNMENT_MODES.POSITION, label: 'Position' },
  ], project.assignmentMode)}
              </select>
            </label>
            <label class="full-width">
              <span>Description</span>
              <textarea name="projectDescription" rows="4">${escapeHtml(project.description)}</textarea>
            </label>
          </div>
        </section>

        <section class="card sticky-panel">
          <h2>Relations and rules</h2>
          <div class="stacked-form-sections">
            <div>
              <h3>Containment</h3>
              <div class="form-grid two-columns compact-form-grid">
                <label>
                  <span>From kind</span>
                  <select name="draftContainmentFromKind">${renderOptions(CONTAINMENT_SOURCE_OPTIONS, editor.draftContainmentFromKind)}</select>
                </label>
                <label>
                  <span>From entity</span>
                  <select name="draftContainmentFromId">${renderEntityOptions(project, [editor.draftContainmentFromKind], editor.draftContainmentFromId)}</select>
                </label>
                <label>
                  <span>To kind</span>
                  <select name="draftContainmentToKind">${renderOptions(CONTAINMENT_TARGET_OPTIONS, editor.draftContainmentToKind)}</select>
                </label>
                <label>
                  <span>To entity</span>
                  <select name="draftContainmentToId">${renderEntityOptions(project, [editor.draftContainmentToKind], editor.draftContainmentToId)}</select>
                </label>
              </div>
              <div class="button-row top-gap">
                <button type="button" data-action="add-containment">Add containment</button>
              </div>
            </div>

            <div>
              <h3>Adjacency</h3>
              <div class="form-grid two-columns compact-form-grid">
                <label>
                  <span>From position</span>
                  <select name="draftTopologyFromId">${renderEntityOptions(project, [NODE_KINDS.POSITION], editor.draftTopologyFromId)}</select>
                </label>
                <label>
                  <span>To position</span>
                  <select name="draftTopologyToId">${renderEntityOptions(project, [NODE_KINDS.POSITION], editor.draftTopologyToId)}</select>
                </label>
              </div>
              <div class="button-row top-gap">
                <button type="button" data-action="add-topology">Add adjacency</button>
              </div>
            </div>

            <div>
              <h3>Hard constraint</h3>
              <div class="form-grid two-columns compact-form-grid">
                <label>
                  <span>Constraint kind</span>
                  <select name="draftConstraintKind">${renderOptions(Object.values(CONSTRAINT_KINDS).map((kind) => ({ value: kind, label: kind })), editor.draftConstraintKind)}</select>
                </label>
                <label>
                  <span>Authoring mode</span>
                  <select name="draftConstraintMode">
                    <option value="pair"${editor.draftConstraintMode === 'pair' ? ' selected' : ''}>Left + right operands</option>
                    <option value="group"${editor.draftConstraintMode === 'group' ? ' selected' : ''}${editor.draftConstraintKind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER ? '' : ' disabled'}>All members of one group together</option>
                  </select>
                </label>
                ${editor.draftConstraintMode === 'group' ? `
                  <label class="full-width">
                    <span>Group</span>
                    <select name="draftConstraintGroupId">${renderEntityOptions(project, [NODE_KINDS.GROUP], editor.draftConstraintGroupId)}</select>
                  </label>
                ` : `
                  <label>
                    <span>Left kind</span>
                    <select name="draftConstraintLeftKind">${renderOptions(ENTITY_KIND_OPTIONS, editor.draftConstraintLeftKind)}</select>
                  </label>
                  <label>
                    <span>Left entity</span>
                    <select name="draftConstraintLeftId">${renderEntityOptions(project, [editor.draftConstraintLeftKind], editor.draftConstraintLeftId)}</select>
                  </label>
                  <label>
                    <span>Right kind</span>
                    <select name="draftConstraintRightKind">${renderOptions(ENTITY_KIND_OPTIONS, editor.draftConstraintRightKind)}</select>
                  </label>
                  <label class="full-width">
                    <span>Right entity</span>
                    <select name="draftConstraintRightId">${renderEntityOptions(project, [editor.draftConstraintRightKind], editor.draftConstraintRightId)}</select>
                  </label>
                `}
              </div>
              <div class="button-row top-gap">
                <button type="button" data-action="add-constraint">Add hard constraint</button>
              </div>
            </div>

            <div>
              <h3>Soft preference</h3>
              <div class="form-grid two-columns compact-form-grid">
                <label>
                  <span>Preference kind</span>
                  <select name="draftPreferenceKind">${renderOptions(Object.values(PREFERENCE_KINDS).map((kind) => ({ value: kind, label: kind })), editor.draftPreferenceKind)}</select>
                </label>
                <label>
                  <span>Authoring mode</span>
                  <select name="draftPreferenceMode">
                    <option value="pair"${editor.draftPreferenceMode === 'pair' ? ' selected' : ''}>Left + right operands</option>
                    <option value="group"${editor.draftPreferenceMode === 'group' ? ' selected' : ''}${editor.draftPreferenceKind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER ? '' : ' disabled'}>All members of one group together</option>
                  </select>
                </label>
                <label>
                  <span>Weight</span>
                  <input type="number" name="draftPreferenceWeight" value="${escapeHtml(editor.draftPreferenceWeight)}" min="0" step="1" />
                </label>
                ${editor.draftPreferenceMode === 'group' ? `
                  <label>
                    <span>Group</span>
                    <select name="draftPreferenceGroupId">${renderEntityOptions(project, [NODE_KINDS.GROUP], editor.draftPreferenceGroupId)}</select>
                  </label>
                ` : `
                  <label>
                    <span>Left kind</span>
                    <select name="draftPreferenceLeftKind">${renderOptions(ENTITY_KIND_OPTIONS, editor.draftPreferenceLeftKind)}</select>
                  </label>
                  <label>
                    <span>Left entity</span>
                    <select name="draftPreferenceLeftId">${renderEntityOptions(project, [editor.draftPreferenceLeftKind], editor.draftPreferenceLeftId)}</select>
                  </label>
                  <label>
                    <span>Right kind</span>
                    <select name="draftPreferenceRightKind">${renderOptions(ENTITY_KIND_OPTIONS, editor.draftPreferenceRightKind)}</select>
                  </label>
                  <label>
                    <span>Right entity</span>
                    <select name="draftPreferenceRightId">${renderEntityOptions(project, [editor.draftPreferenceRightKind], editor.draftPreferenceRightId)}</select>
                  </label>
                `}
              </div>
              <div class="button-row top-gap">
                <button type="button" data-action="add-preference">Add soft preference</button>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </section>
    `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAuditSection(title, eyebrow, content) {
  return `
    <section class="card audit-card">
      <div class="audit-card-header">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${title}</h2>
        </div>
      </div>
      ${content}
    </section>
    `;
}

function renderEntityRefLabel(project, ref) {
  return `${getEntityLabel(project, ref.kind, ref.id)} (${ref.kind}:${ref.id})`;
}

function renderRelationList(project, title, relations, removeAction) {
  const rows = relations.length === 0
    ? '<tr><td colspan="4" class="muted-text">None yet.</td></tr>'
    : relations.map((relation, index) => `
    <tr>
      <td><span class="table-kind-badge">${escapeHtml(relation.kind)}</span></td>
      <td>${escapeHtml(renderEntityRefLabel(project, relation.from))}</td>
      <td>${escapeHtml(renderEntityRefLabel(project, relation.to))}</td>
      <td><button type="button" data-action="${removeAction}" data-index="${index}">Remove</button></td>
    </tr>
    `).join('');

  const content = `
    <div class="section-summary-row">
      <span class="section-count-pill">${relations.length} entries</span>
      <span class="muted-text">Review authored structural relations below.</span>
    </div>
    <div class="table-wrap audit-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>From</th>
            <th>To</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    `;

  return renderAuditSection(title, 'Authored relations', content);
}

function renderConstraintTargetLabel(project, entry, side) {
  if (entry?.metadata?.groupInternalTogether) {
    if (side === 'right') {
      return 'same group members';
    }
    return `All members of ${getEntityLabel(project, entry.leftRef.kind, entry.leftRef.id)} (${entry.leftRef.kind}:${entry.leftRef.id})`;
  }

  return renderEntityRefLabel(project, side === 'left' ? entry.leftRef : entry.rightRef);
}

function renderConstraintList(project, title, entries, removeAction, showWeight = false) {
  const rows = entries.length === 0
    ? `<tr><td colspan="${showWeight ? 5 : 4}" class="muted-text">None yet.</td></tr>`
    : entries.map((entry, index) => `
    <tr>
      <td><span class="table-kind-badge">${escapeHtml(entry.kind)}</span></td>
      <td>${escapeHtml(renderConstraintTargetLabel(project, entry, 'left'))}</td>
      <td>${escapeHtml(renderConstraintTargetLabel(project, entry, 'right'))}</td>
      ${showWeight ? `<td>${escapeHtml(entry.weight)}</td>` : ''}
      <td><button type="button" data-action="${removeAction}" data-index="${index}">Remove</button></td>
    </tr>
    `).join('');

  const content = `
    <div class="section-summary-row">
      <span class="section-count-pill">${entries.length} entries</span>
      <span class="muted-text">Review authored rule pairs and remove any obsolete ones.</span>
    </div>
    <div class="table-wrap audit-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Left</th>
            <th>Right</th>
            ${showWeight ? '<th>Weight</th>' : ''}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    `;

  return renderAuditSection(title, showWeight ? 'Soft rule set' : 'Hard rule set', content);
}

function renderNormalizationSummary(normalizedProject) {
  if (!normalizedProject) {
    return renderAuditSection('Normalization', 'Derived model', '<p class="muted-text">Run validation first. If validation succeeds, normalization output will appear here.</p>');
  }

  const adjacencyEntries = Object.entries(normalizedProject.derived?.adjacencyMap ?? {});
  const componentCount = normalizedProject.derived?.mustShareComponents?.length ?? 0;

  const content = `
    <p class="muted-text">Expanded and deduplicated model ready for solver handoff.</p>
    <dl class="summary-grid audit-summary-grid">
      <div><dt>Normalized constraints</dt><dd>${normalizedProject.constraints.length}</dd></div>
      <div><dt>Normalized preferences</dt><dd>${normalizedProject.preferences.length}</dd></div>
      <div><dt>Adjacency nodes</dt><dd>${adjacencyEntries.length}</dd></div>
      <div><dt>Must-share components</dt><dd>${componentCount}</dd></div>
    </dl>
    <details class="details-panel">
      <summary>View normalized project JSON</summary>
      <pre class="json-block">${escapeHtml(JSON.stringify(normalizedProject, null, 2))}</pre>
    </details>
    `;

  return renderAuditSection('Normalization', 'Derived model', content);
}

function setStorageMessage(state, message, options = {}) {
  state.genericPage.editor.storageMessage = message;
  state.genericPage.editor.storageError = '';
  state.genericPage.editor.storageWarnings = options.warnings ?? [];
  state.genericPage.editor.storageDetails = options.details ?? null;
}

function setStorageError(state, message, options = {}) {
  state.genericPage.editor.storageError = message;
  state.genericPage.editor.storageMessage = '';
  state.genericPage.editor.storageWarnings = options.warnings ?? [];
  state.genericPage.editor.storageDetails = options.details ?? null;
}

function clearStorageFeedback(state) {
  state.genericPage.editor.storageMessage = '';
  state.genericPage.editor.storageError = '';
  state.genericPage.editor.storageWarnings = [];
  state.genericPage.editor.storageDetails = null;
}

function formatValidationIssues(issues) {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join(' | ');
}

function createStorageDetails({ validation = null, versionInfo = null } = {}) {
  return {
    version: versionInfo,
    errors: validation?.errors ?? [],
    warnings: validation?.warnings ?? [],
  };
}

function validateImportedProject(project) {
  const adapter = new FirstSolverAdapter();
  const capabilities = adapter.getCapabilities();
  return validateProject(project, capabilities);
}

function applyImportedProject(state, project, successMessage = 'Project loaded successfully.', options = {}) {
  state.currentProject = project;
  resetDerivedState(state);
  setStorageMessage(state, successMessage, options);
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createExportFilename(project) {
  const baseName = (project.title || 'constraint-project')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'constraint-project';

  return `${baseName}.json`;
}

function resetDerivedState(state) {
  state.genericPage.lastValidation = null;
  state.genericPage.lastNormalizedProject = null;
  state.genericPage.lastSolverResult = null;
  state.genericPage.editor.activeSolutionIndex = 0;
}

function saveDraftFlow(state) {
  try {
    saveDraft(state.currentProject);
    setStorageMessage(state, 'Draft saved to browser storage.');
  } catch (error) {
    setStorageError(state, `Draft save failed: ${error.message}`);
  }
}

function loadDraftFlow(state) {
  try {
    const draft = loadDraft();
    if (!draft) {
      setStorageError(state, 'No saved draft was found in browser storage.');
      return;
    }

    const versionInfo = getProjectVersionInfo(draft);
    if (versionInfo.incompatible) {
      setStorageError(state, `Draft load blocked: ${versionInfo.errors[0]}`, {
        details: createStorageDetails({ versionInfo }),
      });
      return;
    }

    const migratedProject = migrateProjectModel(draft);
    const validation = validateImportedProject(migratedProject);
    const storageDetails = createStorageDetails({ validation, versionInfo });

    if (!validation.valid) {
      setStorageError(state, `Draft load failed validation: ${formatValidationIssues(validation.errors)}`, {
        warnings: versionInfo.warnings,
        details: storageDetails,
      });
      return;
    }

    applyImportedProject(state, migratedProject, 'Draft loaded successfully.', {
      warnings: [...versionInfo.warnings, ...validation.warnings.map((warning) => warning.message ?? warning)],
      details: storageDetails,
    });
  } catch (error) {
    setStorageError(state, `Draft load failed: ${error.message}`);
  }
}

function exportProjectFlow(state) {
  try {
    const exportedJson = exportProject(state.currentProject);
    triggerDownload(createExportFilename(state.currentProject), exportedJson);
    setStorageMessage(state, 'Project exported as JSON.');
  } catch (error) {
    setStorageError(state, `Export failed: ${error.message}`);
  }
}

function importProjectFlow(state, jsonText) {
  try {
    const imported = importProject(jsonText);
    const versionInfo = getProjectVersionInfo(imported);
    if (versionInfo.incompatible) {
      setStorageError(state, `Import blocked: ${versionInfo.errors[0]}`, {
        details: createStorageDetails({ versionInfo }),
      });
      return;
    }

    const migratedProject = migrateProjectModel(imported);
    const validation = validateImportedProject(migratedProject);
    const storageDetails = createStorageDetails({ validation, versionInfo });

    if (!validation.valid) {
      setStorageError(state, `Import failed validation: ${formatValidationIssues(validation.errors)}`, {
        warnings: versionInfo.warnings,
        details: storageDetails,
      });
      return;
    }

    applyImportedProject(state, migratedProject, 'Project imported successfully.', {
      warnings: [...versionInfo.warnings, ...validation.warnings.map((warning) => warning.message ?? warning)],
      details: storageDetails,
    });
  } catch (error) {
    setStorageError(state, `Import failed: ${error.message}`);
  }
}

function updateProjectField(state, field, value) {
  state.currentProject = {
    ...state.currentProject,
    [field]: value,
  };
  resetDerivedState(state);
}

function updateEditorField(state, field, value) {
  state.genericPage.editor[field] = value;
}

function findCollectionByKind(project, kind) {
  if (kind === NODE_KINDS.ITEM) {
    return project.items;
  }
  if (kind === NODE_KINDS.GROUP) {
    return project.groups;
  }
  if (kind === NODE_KINDS.CONTAINER) {
    return project.containers;
  }
  if (kind === NODE_KINDS.POSITION) {
    return project.positions;
  }
  return null;
}

function addItem(state) {
  const label = state.genericPage.editor.draftItemLabel.trim();
  if (!label) {
    return;
  }

  state.currentProject.items.push(createItem({ id: createId('item'), label }));
  state.genericPage.editor.draftItemLabel = '';
  resetDerivedState(state);
}

function addGroup(state) {
  const label = state.genericPage.editor.draftGroupLabel.trim();
  if (!label) {
    return;
  }

  state.currentProject.groups.push(createGroup({ id: createId('group'), label }));
  state.genericPage.editor.draftGroupLabel = '';
  resetDerivedState(state);
}

function addContainer(state) {
  const editor = state.genericPage.editor;
  const label = editor.draftContainerLabel.trim();
  if (!label) {
    return;
  }

  const minCapacity = Number.parseInt(editor.draftContainerMinCapacity || '0', 10);
  const maxCapacity = editor.draftContainerMaxCapacity === '' ? null : Number.parseInt(editor.draftContainerMaxCapacity, 10);

  state.currentProject.containers.push(createContainer({
    id: createId('container'),
    label,
    minCapacity: Number.isNaN(minCapacity) ? 0 : minCapacity,
    maxCapacity: Number.isNaN(maxCapacity) ? null : maxCapacity,
  }));

  editor.draftContainerLabel = '';
  editor.draftContainerMinCapacity = '0';
  editor.draftContainerMaxCapacity = '';
  resetDerivedState(state);
}

function addPosition(state) {
  const label = state.genericPage.editor.draftPositionLabel.trim();
  if (!label) {
    return;
  }

  state.currentProject.positions.push(createPosition({ id: createId('position'), label }));
  state.genericPage.editor.draftPositionLabel = '';
  resetDerivedState(state);
}

function addContainment(state) {
  const editor = state.genericPage.editor;
  if (!editor.draftContainmentFromId || !editor.draftContainmentToId) {
    return;
  }

  state.currentProject.containments.push(createContainmentRelation(
    createEntityRef(editor.draftContainmentFromKind, editor.draftContainmentFromId),
    createEntityRef(editor.draftContainmentToKind, editor.draftContainmentToId),
  ));

  editor.draftContainmentFromId = '';
  editor.draftContainmentToId = '';
  resetDerivedState(state);
}

function addTopology(state) {
  const editor = state.genericPage.editor;
  if (!editor.draftTopologyFromId || !editor.draftTopologyToId) {
    return;
  }

  state.currentProject.topologies.push(createAdjacencyRelation(
    createEntityRef(NODE_KINDS.POSITION, editor.draftTopologyFromId),
    createEntityRef(NODE_KINDS.POSITION, editor.draftTopologyToId),
  ));

  editor.draftTopologyFromId = '';
  editor.draftTopologyToId = '';
  resetDerivedState(state);
}

function addConstraintEntry(state) {
  const editor = state.genericPage.editor;

  if (editor.draftConstraintMode === 'group') {
    if (!editor.draftConstraintGroupId || editor.draftConstraintKind !== CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) {
      return;
    }

    state.currentProject.constraints.push(createConstraint({
      kind: editor.draftConstraintKind,
      leftRef: createEntityRef(NODE_KINDS.GROUP, editor.draftConstraintGroupId),
      rightRef: createEntityRef(NODE_KINDS.GROUP, editor.draftConstraintGroupId),
      metadata: { groupInternalTogether: true },
    }));

    editor.draftConstraintGroupId = '';
    resetDerivedState(state);
    return;
  }

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
  resetDerivedState(state);
}

function addPreferenceEntry(state) {
  const editor = state.genericPage.editor;
  const weight = Number.parseInt(editor.draftPreferenceWeight || '1', 10);

  if (editor.draftPreferenceMode === 'group') {
    if (!editor.draftPreferenceGroupId || editor.draftPreferenceKind !== PREFERENCE_KINDS.PREFER_SHARE_CONTAINER) {
      return;
    }

    state.currentProject.preferences.push(createPreference({
      kind: editor.draftPreferenceKind,
      leftRef: createEntityRef(NODE_KINDS.GROUP, editor.draftPreferenceGroupId),
      rightRef: createEntityRef(NODE_KINDS.GROUP, editor.draftPreferenceGroupId),
      weight: Number.isNaN(weight) ? 1 : weight,
      metadata: { groupInternalTogether: true },
    }));

    editor.draftPreferenceGroupId = '';
    editor.draftPreferenceWeight = '1';
    resetDerivedState(state);
    return;
  }

  if (!editor.draftPreferenceLeftId || !editor.draftPreferenceRightId) {
    return;
  }

  state.currentProject.preferences.push(createPreference({
    kind: editor.draftPreferenceKind,
    leftRef: createEntityRef(editor.draftPreferenceLeftKind, editor.draftPreferenceLeftId),
    rightRef: createEntityRef(editor.draftPreferenceRightKind, editor.draftPreferenceRightId),
    weight: Number.isNaN(weight) ? 1 : weight,
  }));

  editor.draftPreferenceLeftId = '';
  editor.draftPreferenceRightId = '';
  editor.draftPreferenceWeight = '1';
  resetDerivedState(state);
}

function bindEnterToAction(root, state) {
  const enterActionMap = {
    draftItemLabel: addItem,
    draftGroupLabel: addGroup,
    draftContainerLabel: addContainer,
    draftContainerMinCapacity: addContainer,
    draftContainerMaxCapacity: addContainer,
    draftPositionLabel: addPosition,
    draftPreferenceWeight: addPreferenceEntry,
  };

  root.querySelectorAll('input[type="text"][name], input[type="number"][name]').forEach((element) => {
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      const action = enterActionMap[event.target.name];
      if (!action) {
        return;
      }

      event.preventDefault();
      action(state);
      renderGenericPage(root, state);
    });
  });

  root.querySelectorAll('select[name]').forEach((element) => {
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      const { name } = event.target;
      if (name === 'draftContainmentFromId' || name === 'draftContainmentToId') {
        event.preventDefault();
        addContainment(state);
        renderGenericPage(root, state);
        return;
      }

      if (name === 'draftTopologyFromId' || name === 'draftTopologyToId') {
        event.preventDefault();
        addTopology(state);
        renderGenericPage(root, state);
        return;
      }

      if (name === 'draftConstraintLeftId' || name === 'draftConstraintRightId' || name === 'draftConstraintGroupId') {
        event.preventDefault();
        addConstraintEntry(state);
        renderGenericPage(root, state);
        return;
      }

      if (name === 'draftPreferenceLeftId' || name === 'draftPreferenceRightId' || name === 'draftPreferenceGroupId') {
        event.preventDefault();
        addPreferenceEntry(state);
        renderGenericPage(root, state);
      }
    });
  });
}

function removeAt(list, index) {
  list.splice(index, 1);
}

function removeNodeAndReferences(state, collectionName, index) {
  const [removed] = state.currentProject[collectionName].splice(index, 1);
  if (!removed) {
    return;
  }

  const matchesRef = (ref) => ref.id === removed.id && ref.kind === removed.kind;
  state.currentProject.containments = state.currentProject.containments.filter((relation) => !matchesRef(relation.from) && !matchesRef(relation.to));
  state.currentProject.topologies = state.currentProject.topologies.filter((relation) => !matchesRef(relation.from) && !matchesRef(relation.to));
  state.currentProject.constraints = state.currentProject.constraints.filter((entry) => !matchesRef(entry.leftRef) && !matchesRef(entry.rightRef));
  state.currentProject.preferences = state.currentProject.preferences.filter((entry) => !matchesRef(entry.leftRef) && !matchesRef(entry.rightRef));
  resetDerivedState(state);
}

function updateEntityLabel(state, kind, index, value) {
  const collection = findCollectionByKind(state.currentProject, kind);
  if (!collection || !collection[index]) {
    return;
  }

  collection[index].label = value;
  resetDerivedState(state);
}

function updateContainerCapacity(state, index, field, value) {
  const container = state.currentProject.containers[index];
  if (!container) {
    return;
  }

  if (!container.metadata) {
    container.metadata = {};
  }

  if (field === 'maxCapacity' && value === '') {
    container.metadata.maxCapacity = null;
  } else {
    const parsed = Number.parseInt(value || '0', 10);
    container.metadata[field] = Number.isNaN(parsed) ? (field === 'maxCapacity' ? null : 0) : parsed;
  }

  resetDerivedState(state);
}

function runValidationFlow(state) {
  const adapter = new FirstSolverAdapter();
  const capabilities = adapter.getCapabilities();
  const validation = validateProject(state.currentProject, capabilities);

  state.genericPage.lastValidation = validation;
  state.genericPage.lastSolverResult = null;
  state.genericPage.validationPanelExpanded = false;

  if (validation.valid) {
    state.genericPage.lastNormalizedProject = normalizeProject(state.currentProject);
    return;
  }

  state.genericPage.lastNormalizedProject = null;
}

function runSolveFlow(state) {
  const adapter = new FirstSolverAdapter();
  const capabilities = adapter.getCapabilities();
  const validation = validateProject(state.currentProject, capabilities);

  state.genericPage.lastValidation = validation;
  state.genericPage.validationPanelExpanded = true;

  if (!validation.valid) {
    state.genericPage.lastNormalizedProject = null;
    state.genericPage.lastSolverResult = {
      status: 'validation-failed',
      solutions: [],
      warnings: ['Solve was not attempted because validation failed.'],
      runtimeMs: 0,
      truncatedByLimit: false,
      interrupted: false,
      timeoutReached: false,
    };
    return;
  }

  const normalizedProject = normalizeProject(state.currentProject);
  state.genericPage.lastNormalizedProject = normalizedProject;

  const adapterValidation = adapter.validateModel(normalizedProject);
  const solverResult = adapter.solve(normalizedProject);

  state.genericPage.lastSolverResult = {
    ...solverResult,
    warnings: [...(adapterValidation.warnings ?? []), ...(solverResult.warnings ?? [])],
  };
  state.genericPage.editor.activeSolutionIndex = 0;
}

function bindFileInputs(root, state) {
  root.querySelector('[data-action="import-project-file"]')?.addEventListener('change', async (event) => {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      importProjectFlow(state, text);
      renderGenericPage(root, state);
    } finally {
      event.target.value = '';
    }
  });
}

function bindInputs(root, state) {
  root.querySelectorAll('select[name]').forEach((element) => {
    element.addEventListener('change', (event) => {
      const { name, value } = event.target;

      if (name === 'assignmentMode') {
        updateProjectField(state, 'assignmentMode', value);
      } else {
        updateEditorField(state, name, value);
      }

      renderGenericPage(root, state);
    });
  });

  root.querySelectorAll('input[name], textarea[name]').forEach((element) => {
    element.addEventListener('input', (event) => {
      const { name, value } = event.target;

      if (name === 'projectTitle') {
        updateProjectField(state, 'title', value);
      } else if (name === 'projectDescription') {
        updateProjectField(state, 'description', value);
      } else {
        updateEditorField(state, name, value);
      }
    });
  });

  root.querySelectorAll('[data-action="edit-entity-label"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateEntityLabel(state, event.target.dataset.kind, Number.parseInt(event.target.dataset.index, 10), event.target.value);
    });
  });

  root.querySelectorAll('[data-action="edit-container-min"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateContainerCapacity(state, Number.parseInt(event.target.dataset.index, 10), 'minCapacity', event.target.value);
    });
  });

  root.querySelectorAll('[data-action="edit-container-max"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateContainerCapacity(state, Number.parseInt(event.target.dataset.index, 10), 'maxCapacity', event.target.value);
    });
  });
}

function bindActions(root, state) {
  root.querySelector('.validation-panel-details')?.addEventListener('toggle', (event) => {
    state.genericPage.validationPanelExpanded = event.target.open;
  });

  const actionMap = {
    'add-item': addItem,
    'add-group': addGroup,
    'add-container': addContainer,
    'add-position': addPosition,
    'add-containment': addContainment,
    'add-topology': addTopology,
    'add-constraint': addConstraintEntry,
    'add-preference': addPreferenceEntry,
  };

  root.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.dataset.action;
    if (action === 'validate') {
      element.addEventListener('click', () => {
        runValidationFlow(state);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'solve') {
      element.addEventListener('click', () => {
        runSolveFlow(state);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'save-draft') {
      element.addEventListener('click', () => {
        saveDraftFlow(state);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'load-draft') {
      element.addEventListener('click', () => {
        loadDraftFlow(state);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'export-project') {
      element.addEventListener('click', () => {
        exportProjectFlow(state);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'reset-project') {
      element.addEventListener('click', () => {
        state.currentProject = createEmptyProject({ viewHint: VIEW_HINTS.GENERIC });
        state.genericPage.editor = createGenericPageState();
        clearStorageFeedback(state);
        resetDerivedState(state);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'previous-solution') {
      element.addEventListener('click', () => {
        state.genericPage.editor.activeSolutionIndex = Math.max(0, state.genericPage.editor.activeSolutionIndex - 1);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'next-solution') {
      element.addEventListener('click', () => {
        const solutionCount = state.genericPage.lastSolverResult?.solutions?.length ?? 0;
        state.genericPage.editor.activeSolutionIndex = Math.min(
          Math.max(solutionCount - 1, 0),
          state.genericPage.editor.activeSolutionIndex + 1,
        );
        renderGenericPage(root, state);
      });
      return;
    }

    if (actionMap[action]) {
      element.addEventListener('click', () => {
        actionMap[action](state);
        renderGenericPage(root, state);
      });
      return;
    }

    if (action === 'remove-item') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state, 'items', Number.parseInt(element.dataset.index, 10));
        renderGenericPage(root, state);
      });
    }

    if (action === 'remove-group') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state, 'groups', Number.parseInt(element.dataset.index, 10));
        renderGenericPage(root, state);
      });
    }

    if (action === 'remove-container') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state, 'containers', Number.parseInt(element.dataset.index, 10));
        renderGenericPage(root, state);
      });
    }

    if (action === 'remove-position') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state, 'positions', Number.parseInt(element.dataset.index, 10));
        renderGenericPage(root, state);
      });
    }

    if (action === 'remove-containment') {
      element.addEventListener('click', () => {
        removeAt(state.currentProject.containments, Number.parseInt(element.dataset.index, 10));
        resetDerivedState(state);
        renderGenericPage(root, state);
      });
    }

    if (action === 'remove-topology') {
      element.addEventListener('click', () => {
        removeAt(state.currentProject.topologies, Number.parseInt(element.dataset.index, 10));
        resetDerivedState(state);
        renderGenericPage(root, state);
      });
    }

    if (action === 'remove-constraint') {
      element.addEventListener('click', () => {
        removeAt(state.currentProject.constraints, Number.parseInt(element.dataset.index, 10));
        resetDerivedState(state);
        renderGenericPage(root, state);
      });
    }

    if (action === 'remove-preference') {
      element.addEventListener('click', () => {
        removeAt(state.currentProject.preferences, Number.parseInt(element.dataset.index, 10));
        resetDerivedState(state);
        renderGenericPage(root, state);
      });
    }
  });
}

export function renderGenericPage(root, state) {
  ensureProject(state);

  const validation = state.genericPage.lastValidation;
  const editor = state.genericPage.editor;

  root.innerHTML = renderPageShell({
    title: 'Generic Constraint Page',
    description: 'Create and edit a generic project, then run validation, normalization, and the solver adapter workflow.',
    body: `
    ${renderCommandBar(editor)}
    ${renderProjectSummary(state.currentProject)}
    ${renderWorkspace(state.currentProject, editor)}
    <section class="audit-section-grid">
      ${renderRelationList(state.currentProject, 'Containments', state.currentProject.containments, 'remove-containment')}
      ${renderRelationList(state.currentProject, 'Topologies', state.currentProject.topologies, 'remove-topology')}
    </section>
    <section class="audit-section-grid">
      ${renderConstraintList(state.currentProject, 'Hard constraints', state.currentProject.constraints, 'remove-constraint')}
      ${renderConstraintList(state.currentProject, 'Soft preferences', state.currentProject.preferences, 'remove-preference', true)}
    </section>
    ${renderValidationPanel(validation, {
      hasComputedSolution: Boolean(state.genericPage.lastSolverResult),
      expanded: state.genericPage.validationPanelExpanded,
    })}
    <section class="audit-section-grid">
      ${renderNormalizationSummary(state.genericPage.lastNormalizedProject)}
      ${renderSolutionPanel(state.currentProject, state.genericPage.lastSolverResult, editor.activeSolutionIndex)}
    </section>
    `,
  });

  bindInputs(root, state);
  bindFileInputs(root, state);
  bindActions(root, state);
  bindEnterToAction(root, state);
}

