import { renderPageShell } from '../../components/common/pageShell.js';
import { getGeneralPreferenceAuthoringPolicy } from '../../components/common/preferenceAuthoringPolicy.js';
import { renderSolutionPanel } from '../../components/solutions/solutionPanel.js';
import { renderSolutionNavigation } from '../../components/solutions/solutionNavigation.js';
import { renderSolveStatus, updateSolveStatus } from '../../components/solutions/solveStatus.js';
import { renderValidationPanel } from '../../components/solutions/validationPanel.js';
import { CONSTRAINT_KINDS, createConstraint } from '../../core/model/constraints.js';
import { createId } from '../../core/model/ids.js';
import { createContainer, createGroup, createItem } from '../../core/model/nodes.js';
import { createEmptyProject, isProject, VIEW_HINTS } from '../../core/model/project.js';
import { PREFERENCE_KINDS, createPreference } from '../../core/model/preferences.js';
import { createContainmentRelation, createEntityRef } from '../../core/model/relations.js';
import { normalizeProject } from '../../core/normalize/normalizeProject.js';
import { validateProject } from '../../core/validate/validateProject.js';
import {
  SCHOOL_ITEM_ROLES,
  buildSchoolClassroomIndex,
  buildSchoolParticipantIndex,
  deriveTeacherLinkedAssignmentHints,
  getAllowedContainerIdsForStudent,
  getContainedGroupIdsForItem,
  getContainerAcceptedLevelIds,
  getContainerTeacherIds,
} from '../../core/transform/domainMappings.js';
import { FirstSolverAdapter } from '../../solver/adapters/firstSolverAdapter.js';
import { cancelSolveExecution, createSolveExecutionState, discardSolveExecution, startSolveExecution } from '../../solver/solveExecution.js';
import { exportSchoolSolutionWorkbook } from './exportSchoolSolution.js';
import { exportSchoolConfigurationWorkbook, previewSchoolWorkbookFile } from './workbooks.js';
import { validateSchoolProject } from './validateSchoolProject.js';
import { confirmProjectReplacement } from '../../app/dataSafety.js';
import { bindPageDraftAutosave, persistPageDraft } from '../../storage/localDrafts.js';
import { bindWorkflowTabs, isWorkflowTab, renderWorkflowPanel, renderWorkflowTabs, WORKFLOW_TABS_WITH_DISPLAY } from '../../components/common/workflowTabs.js';
import { buildWorkflowSolveOptions, createWorkflowSolveDraft, renderAdvancedDiagnostics, renderShareEditSetup, renderSolveConfiguration, renderWorkbookSetup, solveOptionIssues } from '../../components/common/workflowSetup.js';
import { validateSolveOptions } from '../../solver/solveOptions.js';
import { parseBulkLabels } from '../../components/common/bulkEntry.js';
import { renderFieldLabel } from '../../components/common/fieldHelp.js';
import { bindJsonCopyButtons, renderJsonBlock } from '../../components/common/jsonBlock.js';
import { downloadJsonConfiguration, readJsonConfigurationFile, renderJsonConfigurationSetup } from '../../components/common/jsonConfiguration.js';
import { migrateProjectModel } from '../../storage/modelVersioning.js';
import { renderSchoolSolutionDisplay } from './schoolSolutionDisplay.js';
import { assignTeachersToSchoolResult } from './teacherAssignment.js';
import { applySchoolShareEditPreview, exportSchoolShareEditWorkbook, previewSchoolShareEditWorkbookFile } from './shareEditWorkbook.js';

const REPLACE_SCHOOL_MESSAGE = 'This will replace your current non-empty school scenario. Continue?';

function createSchoolEditorState() {
  return {
    ...createWorkflowSolveDraft(),
    dataSearch: '',
    bulkStudentLabels: '',
    bulkStudentLevelId: '',
    draftStudentLabel: '',
    draftTeacherLabel: '',
    schoolShareLanguage: 'en',
    schoolShareIdentity: 'fullName',
    draftLevelLabel: '',
    draftClassLabel: '',
    draftClassMinCapacity: '0',
    draftClassMaxCapacity: '',
    draftStudentLevelIds: {},
    draftTeacherLevelIds: {},
    draftClassAcceptedLevelIds: {},
    draftClassTeacherIds: {},
    draftRuleKind: CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
    draftRuleLeftId: '',
    draftRuleRightId: '',
    draftPreferenceKind: PREFERENCE_KINDS.PREFER_SHARE_CONTAINER,
    draftPreferenceLeftId: '',
    draftPreferenceRightId: '',
    draftPreferenceWeight: '1',
    activeSolutionIndex: 0,
  };
}

function ensureSchoolProject(state) {
  if (!state.schoolPage.project) {
    state.schoolPage.project = createEmptyProject({ viewHint: VIEW_HINTS.SCHOOL, title: 'School scenario' });
  }

  state.schoolPage.project.viewHint = VIEW_HINTS.SCHOOL;

  if (!state.schoolPage) {
    state.schoolPage = {
      editor: createSchoolEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
      commandBarExpanded: true,
    };
    return;
  }

  if (!state.schoolPage.editor) {
    state.schoolPage.editor = createSchoolEditorState();
    return;
  }

  state.schoolPage.editor = {
    ...createSchoolEditorState(),
    ...state.schoolPage.editor,
    draftStudentLevelIds: state.schoolPage.editor.draftStudentLevelIds ?? {},
    draftTeacherLevelIds: state.schoolPage.editor.draftTeacherLevelIds ?? {},
    draftClassAcceptedLevelIds: state.schoolPage.editor.draftClassAcceptedLevelIds ?? {},
    draftClassTeacherIds: state.schoolPage.editor.draftClassTeacherIds ?? {},
  };

  if (typeof state.schoolPage.commandBarExpanded !== 'boolean') {
    state.schoolPage.commandBarExpanded = true;
  }

  if (typeof state.schoolPage.validationPanelExpanded !== 'boolean') {
    state.schoolPage.validationPanelExpanded = false;
  }
  state.schoolPage.solveExecution ??= createSolveExecutionState();
  state.schoolPage.workbookImport ??= { status: 'idle', error: '', preview: null };
  state.schoolPage.shareEditImport ??= { status: 'idle', error: '', preview: null };
  if (!isWorkflowTab(state.schoolPage.activeWorkflowTab, WORKFLOW_TABS_WITH_DISPLAY)) state.schoolPage.activeWorkflowTab = 'setup';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getItems(project) {
  return Array.isArray(project.items) ? project.items : [];
}

function getGroups(project) {
  return Array.isArray(project.groups) ? project.groups : [];
}

function getContainers(project) {
  return Array.isArray(project.containers) ? project.containers : [];
}

function getStudents(project) {
  return buildSchoolParticipantIndex(project).students;
}

function getTeachers(project) {
  return buildSchoolParticipantIndex(project).teachers;
}

function getLevels(project) {
  return getGroups(project);
}

function getClasses(project) {
  return getContainers(project);
}

function findNodeLabel(list, id) {
  return list.find((entry) => entry.id === id)?.label || id;
}

function findContainerById(project, containerId) {
  return getClasses(project).find((container) => container.id === containerId) ?? null;
}

function matchesSearch(entry, editor) {
  return !editor.dataSearch.trim() || `${entry.label} ${entry.id}`.toLocaleLowerCase().includes(editor.dataSearch.trim().toLocaleLowerCase());
}

function renderSchoolDataTools(project, editor) {
  return `<section class="card data-tools">
    <h2>Find or add students in bulk</h2>
    <div class="form-grid three-columns compact-form-grid">
      <label><span>Search students, teachers, levels, and classes</span><input type="search" name="dataSearch" value="${escapeHtml(editor.dataSearch)}" /></label>
      <label><span>Student names, one per line or comma-separated</span><textarea name="bulkStudentLabels" rows="4">${escapeHtml(editor.bulkStudentLabels)}</textarea></label>
      <label><span>Assign new students to level</span><select name="bulkStudentLevelId">${renderSelectOptions(getLevels(project), editor.bulkStudentLevelId, 'No level assignment')}</select></label>
    </div>
    <div class="button-row top-gap"><button type="button" data-action="bulk-add-students">Add students</button></div>
  </section>`;
}

function getAssignedStudentIds(solution, containerId) {
  return (solution?.assignments ?? [])
    .filter((assignment) => assignment.containerRef?.id === containerId && assignment.metadata?.schoolRole !== 'teacher')
    .map((assignment) => assignment.itemRef?.id)
    .filter(Boolean);
}

function renderMembershipList(labels, emptyLabel) {
  if (!labels.length) {
    return `<span class="muted-text">${escapeHtml(emptyLabel)}</span>`;
  }

  return `<ul class="solution-item-list">${labels.map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`;
}

function renderSelectOptions(entries, selectedValue, placeholder = 'Select…') {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...entries.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === selectedValue ? ' selected' : ''}>${escapeHtml(entry.label)}</option>`),
  ].join('');
}

function renderSummary(project) {
  const students = getStudents(project);
  const teachers = getTeachers(project);
  const levels = getLevels(project);
  const classes = buildSchoolClassroomIndex(project);
  const hasUnlimitedCapacity = classes.some((classroom) => classroom.capacity == null);
  const totalCapacity = classes.reduce((sum, classroom) => sum + (Number.isFinite(classroom.capacity) ? classroom.capacity : 0), 0);

  return `
    <section class="hero-card school-hero-card">
      <div>
        <p class="eyebrow">🏫 School planning panel</p>
        <h2>${escapeHtml(project.title || 'School scenario')}</h2>
        <p class="hero-description">Build students, teachers, levels, and classes using school language while still writing into the shared generic model.</p>
      </div>
      <dl class="summary-grid compact-summary-grid">
        <div><dt>Students</dt><dd>${students.length}</dd></div>
        <div><dt>Teachers</dt><dd>${teachers.length}</dd></div>
        <div><dt>Levels</dt><dd>${levels.length}</dd></div>
        <div><dt>Classes</dt><dd>${classes.length}</dd></div>
        <div><dt>Total capacity</dt><dd>${hasUnlimitedCapacity ? `${totalCapacity} finite + unlimited` : totalCapacity}</dd></div>
        <div><dt>Rules</dt><dd>${project.constraints.length + project.preferences.length}</dd></div>
      </dl>
    </section>
  `;
}

function renderSchoolCommandBar(result, expanded = true) {
  return `
    <section class="command-bar-card${expanded ? '' : ' is-collapsed'}">
      <div class="command-bar-header">
        <div class="command-bar-copy">
          <p class="eyebrow">🏫 School workflow</p>
          <h2>Validate, solve, and export</h2>
          <p class="muted-text">Check the authored school scenario, derive a solver-ready model, run the current container-mode solver, and export the selected solution as an Excel workbook.</p>
        </div>
        <button type="button" class="command-bar-button command-bar-toggle" data-action="toggle-school-command-bar" aria-expanded="${expanded ? 'true' : 'false'}">
          <span class="command-bar-icon" aria-hidden="true">${expanded ? '▴' : '▾'}</span>
          <span>${expanded ? 'Reduce' : 'Expand'}</span>
        </button>
      </div>
      <div class="command-bar-actions">
        <button type="button" class="command-bar-button" data-action="validate-school">
          <span class="command-bar-icon" aria-hidden="true">✓</span>
          <span>Validate</span>
        </button>
        <button type="button" class="command-bar-button command-bar-button-primary" data-action="solve-school">
          <span class="command-bar-icon" aria-hidden="true">▶</span>
          <span>Validate + normalize + solve</span>
        </button>
      </div>
    </section>
  `;
}

function renderCreateCards(project, editor) {
  return `
    <section class="card workspace-toolbar school-create-toolbar">
      <div class="toolbar-head">
        <div>
          <p class="eyebrow">✏️ Create school data</p>
          <h2>Author your scenario</h2>
          <p class="muted-text">Add students, teachers, levels, and classes first. Then connect them with level membership, accepted levels, and school rules.</p>
        </div>
      </div>
      <div class="creation-grid">
        <article class="creation-card accent-item">
          <h3>👩‍🎓 Add student</h3>
          <label>
            <span>Name</span>
            <input type="text" name="draftStudentLabel" value="${escapeHtml(editor.draftStudentLabel)}" />
          </label>
          <button type="button" data-action="add-student">Add student</button>
        </article>

        <article class="creation-card accent-group">
          <h3>👩‍🏫 Add teacher</h3>
          <label>
            <span>Name</span>
            <input type="text" name="draftTeacherLabel" value="${escapeHtml(editor.draftTeacherLabel)}" />
          </label>
          <button type="button" data-action="add-teacher">Add teacher</button>
        </article>

        <article class="creation-card accent-position">
          <h3>📚 Add level</h3>
          <label>
            <span>Name</span>
            <input type="text" name="draftLevelLabel" value="${escapeHtml(editor.draftLevelLabel)}" />
          </label>
          <button type="button" data-action="add-level">Add level</button>
        </article>

        <article class="creation-card accent-container">
          <h3>🏷️ Add class</h3>
          <label>
            <span>Name</span>
            <input type="text" name="draftClassLabel" value="${escapeHtml(editor.draftClassLabel)}" />
          </label>
          <div class="inline-field-grid">
            <label>
              ${renderFieldLabel('Min', 'Minimum required class size. For example, 0 allows an empty class; 20 requires at least twenty assigned students.')}
              <input type="number" min="0" name="draftClassMinCapacity" value="${escapeHtml(editor.draftClassMinCapacity)}" />
            </label>
            <label>
              ${renderFieldLabel('Max', 'Maximum class size. For example, 10 creates a small class cap; 30 allows a larger class. Leave blank for unlimited capacity.')}
              <input type="number" min="0" name="draftClassMaxCapacity" value="${escapeHtml(editor.draftClassMaxCapacity)}" />
            </label>
          </div>
          <button type="button" data-action="add-class">Add class</button>
        </article>
      </div>
    </section>
  `;
}

function renderMembershipChips(labels, emptyText) {
  if (!labels.length) {
    return `<span class="muted-text">${escapeHtml(emptyText)}</span>`;
  }

  return `<span class="chip-row">${labels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join('')}</span>`;
}

function renderStudentsPanel(project, editor) {
  const students = getStudents(project).filter((entry) => matchesSearch(entry, editor));
  const levels = getLevels(project);

  return `
    <section class="workspace-panel school-panel">
      <div class="panel-header">
        <h3>👩‍🎓 Students</h3>
        <span class="panel-count">${students.length}</span>
      </div>
      <div class="entity-board">
        ${students.length === 0 ? '<div class="empty-board">No students match this search, or none have been added yet.</div>' : students.map((student) => {
    const index = getItems(project).findIndex((entry) => entry.id === student.id);
    const selectedLevelIds = getContainedGroupIdsForItem(project, student.id);
    const levelLabels = selectedLevelIds.map((levelId) => findNodeLabel(levels, levelId));

    return `
            <article class="entity-card school-entity-card">
              <div class="entity-card-header">
                <div>
                  <p class="entity-kind">Student</p>
                  <input type="text" class="entity-inline-input" data-action="edit-school-label" data-kind="item" data-index="${index}" value="${escapeHtml(student.label)}" />
                </div>
                <button type="button" class="ghost-danger-button" data-action="remove-student" data-index="${index}" aria-label="Remove student ${escapeHtml(student.label)}">Remove</button>
              </div>
              <p class="entity-id">${escapeHtml(student.id)}</p>
              <div class="entity-meta-grid">
                <div class="entity-meta-item">
                  <dt>Levels</dt>
                  <dd>${renderMembershipChips(levelLabels, 'No level assigned yet')}</dd>
                </div>
                <div class="entity-meta-item school-checkbox-list">
                  <dt>Assign levels</dt>
                  <dd>
                    ${levels.length === 0 ? '<span class="muted-text">Create levels first.</span>' : levels.map((level) => `
                      <label class="checkbox-chip">
                        <input type="checkbox" data-action="toggle-student-level" data-student-id="${escapeHtml(student.id)}" data-level-id="${escapeHtml(level.id)}"${selectedLevelIds.includes(level.id) ? ' checked' : ''} />
                        <span>${escapeHtml(level.label)}</span>
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

function renderTeachersPanel(project, editor) {
  const teachers = getTeachers(project).filter((entry) => matchesSearch(entry, editor));
  const levels = getLevels(project);
  const classes = getClasses(project);

  return `
    <section class="workspace-panel school-panel">
      <div class="panel-header">
        <h3>👩‍🏫 Teachers</h3>
        <span class="panel-count">${teachers.length}</span>
      </div>
      <div class="entity-board">
        ${teachers.length === 0 ? '<div class="empty-board">Add teachers to model class-linked school rules.</div>' : teachers.map((teacher) => {
    const teacherIndex = getItems(project).findIndex((entry) => entry.id === teacher.id);
    const selectedLevelIds = getContainedGroupIdsForItem(project, teacher.id);
    const levelLabels = selectedLevelIds.map((levelId) => findNodeLabel(levels, levelId));
    const linkedClassLabels = classes
      .filter((classroom) => getContainerTeacherIds(classroom).includes(teacher.id))
      .map((classroom) => classroom.label);
    const classPreferences = teacher.metadata?.classPreferences ?? {};

    return `
            <article class="entity-card school-entity-card">
              <div class="entity-card-header">
                <div>
                  <p class="entity-kind">Teacher</p>
                  <input type="text" class="entity-inline-input" data-action="edit-school-label" data-kind="item" data-index="${teacherIndex}" value="${escapeHtml(teacher.label)}" />
                </div>
                <button type="button" class="ghost-danger-button" data-action="remove-teacher" data-index="${teacherIndex}" aria-label="Remove teacher ${escapeHtml(teacher.label)}">Remove</button>
              </div>
              <p class="entity-id">${escapeHtml(teacher.id)}</p>
              <div class="entity-meta-grid">
                <div class="entity-meta-item">
                  <dt>Teaching levels</dt>
                  <dd>${renderMembershipChips(levelLabels, 'No teacher level set')}</dd>
                </div>
                <div class="entity-meta-item">
                  <dt>Linked classes</dt>
                  <dd>${renderMembershipChips(linkedClassLabels, 'Not linked to a class yet')}</dd>
                </div>
                <div class="entity-meta-item school-checkbox-list">
                  <dt>Optional level eligibility</dt>
                  <dd>
                    ${levels.length === 0 ? '<span class="muted-text">Create levels first.</span>' : levels.map((level) => `
                      <label class="checkbox-chip">
                        <input type="checkbox" data-action="toggle-teacher-level" data-teacher-id="${escapeHtml(teacher.id)}" data-level-id="${escapeHtml(level.id)}"${selectedLevelIds.includes(level.id) ? ' checked' : ''} />
                        <span>${escapeHtml(level.label)}</span>
                      </label>
                    `).join('')}
                  </dd>
                </div>
                <div class="entity-meta-item full-width">
                  <dt>Class preferences</dt>
                  <dd class="school-teacher-preference-grid">
                    <p class="muted-text full-width">Fixed class links are hard. Otherwise Prefer and Prefer not affect teacher matching, Neutral has no direct score, and Unavailable is a hard exclusion. Teacher/student relationship preferences are also considered after student placement.</p>
                    ${classes.length === 0 ? '<span class="muted-text">Create classes first.</span>' : classes.map((classroom) => `<label><span>${escapeHtml(classroom.label)}</span><select data-action="teacher-class-preference" data-teacher-id="${escapeHtml(teacher.id)}" data-class-id="${escapeHtml(classroom.id)}"><option value="neutral"${(classPreferences[classroom.id] ?? 'neutral') === 'neutral' ? ' selected' : ''}>Neutral</option><option value="prefer"${classPreferences[classroom.id] === 'prefer' ? ' selected' : ''}>Prefer</option><option value="preferNot"${classPreferences[classroom.id] === 'preferNot' ? ' selected' : ''}>Prefer not</option><option value="unavailable"${classPreferences[classroom.id] === 'unavailable' ? ' selected' : ''}>Unavailable</option></select></label>`).join('')}
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

function renderLevelsPanel(project, editor) {
  const levels = getLevels(project).filter((entry) => matchesSearch(entry, editor));
  const students = getStudents(project);
  const teachers = getTeachers(project);

  return `
    <section class="workspace-panel school-panel">
      <div class="panel-header">
        <h3>📚 Levels</h3>
        <span class="panel-count">${levels.length}</span>
      </div>
      <div class="entity-board">
        ${levels.length === 0 ? '<div class="empty-board">No levels match this search, or none have been created yet.</div>' : levels.map((level) => {
    const index = getGroups(project).findIndex((entry) => entry.id === level.id);
    const memberLabels = [...students, ...teachers]
      .filter((item) => getContainedGroupIdsForItem(project, item.id).includes(level.id))
      .map((item) => item.label);

    return `
            <article class="entity-card school-entity-card">
              <div class="entity-card-header">
                <div>
                  <p class="entity-kind">Level</p>
                  <input type="text" class="entity-inline-input" data-action="edit-school-label" data-kind="group" data-index="${index}" value="${escapeHtml(level.label)}" />
                </div>
                <button type="button" class="ghost-danger-button" data-action="remove-level" data-index="${index}" aria-label="Remove level ${escapeHtml(level.label)}">Remove</button>
              </div>
              <p class="entity-id">${escapeHtml(level.id)}</p>
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

function renderClassesPanel(project, editor) {
  const classes = getClasses(project).filter((entry) => matchesSearch(entry, editor));
  const levels = getLevels(project);
  const teachers = getTeachers(project);

  return `
    <section class="workspace-panel school-panel">
      <div class="panel-header">
        <h3>🏷️ Classes</h3>
        <span class="panel-count">${classes.length}</span>
      </div>
      <div class="entity-board">
        ${classes.length === 0 ? '<div class="empty-board">No classes match this search, or none have been added yet.</div>' : classes.map((classroom) => {
    const index = getClasses(project).findIndex((entry) => entry.id === classroom.id);
    const acceptedLevelIds = getContainerAcceptedLevelIds(classroom);
    const teacherIds = getContainerTeacherIds(classroom);
    const acceptedLabels = acceptedLevelIds.map((levelId) => findNodeLabel(levels, levelId));
    const teacherLabels = teacherIds.map((teacherId) => findNodeLabel(teachers, teacherId));
    const minCapacity = classroom.metadata?.minCapacity ?? 0;
    const maxCapacity = classroom.metadata?.maxCapacity ?? '';

    return `
            <article class="entity-card school-entity-card">
              <div class="entity-card-header">
                <div>
                  <p class="entity-kind">Class</p>
                  <input type="text" class="entity-inline-input" data-action="edit-school-label" data-kind="container" data-index="${index}" value="${escapeHtml(classroom.label)}" />
                </div>
                <button type="button" class="ghost-danger-button" data-action="remove-class" data-index="${index}" aria-label="Remove class ${escapeHtml(classroom.label)}">Remove</button>
              </div>
              <p class="entity-id">${escapeHtml(classroom.id)}</p>
              <div class="entity-meta-grid">
                <div class="entity-meta-item">
                  <dt>Capacity</dt>
                  <dd>${escapeHtml(minCapacity)} → ${escapeHtml(maxCapacity || '∞')}</dd>
                </div>
                <div class="entity-meta-item entity-meta-form-row">
                  <label>
                    <span>Min capacity</span>
                    <input type="number" min="0" data-action="edit-class-min" data-index="${index}" value="${escapeHtml(minCapacity)}" />
                  </label>
                  <label>
                    <span>Max capacity</span>
                    <input type="number" min="0" data-action="edit-class-max" data-index="${index}" value="${escapeHtml(maxCapacity)}" />
                  </label>
                </div>
                <div class="entity-meta-item">
                  <dt>Accepted levels</dt>
                  <dd>${renderMembershipChips(acceptedLabels, 'All levels are allowed')}</dd>
                </div>
                <div class="entity-meta-item school-checkbox-list">
                  <dt>Allow levels</dt>
                  <dd>
                    ${levels.length === 0 ? '<span class="muted-text">Create levels first.</span>' : levels.map((level) => `
                      <label class="checkbox-chip">
                        <input type="checkbox" data-action="toggle-class-level" data-class-id="${escapeHtml(classroom.id)}" data-level-id="${escapeHtml(level.id)}"${acceptedLevelIds.includes(level.id) ? ' checked' : ''} />
                        <span>${escapeHtml(level.label)}</span>
                      </label>
                    `).join('')}
                    <span class="muted-text">If no level is selected, this class accepts all levels.</span>
                  </dd>
                </div>
                <div class="entity-meta-item">
                  <dt>Linked teachers</dt>
                  <dd>${renderMembershipChips(teacherLabels, 'No teacher linked')}</dd>
                </div>
                <div class="entity-meta-item school-checkbox-list">
                  <dt>Assign teachers</dt>
                  <dd>
                    ${teachers.length === 0 ? '<span class="muted-text">Create teachers first.</span>' : teachers.map((teacher) => `
                      <label class="checkbox-chip">
                        <input type="checkbox" data-action="toggle-class-teacher" data-class-id="${escapeHtml(classroom.id)}" data-teacher-id="${escapeHtml(teacher.id)}"${teacherIds.includes(teacher.id) ? ' checked' : ''} />
                        <span>${escapeHtml(teacher.label)}</span>
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

function getSchoolRuleLabel(kind) {
  if (kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) {
    return 'Must be in the same class';
  }

  if (kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER) {
    return 'Must not be in the same class';
  }

  return kind;
}

function getSchoolPreferenceLabel(kind) {
  if (kind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER) {
    return 'Prefer to be in the same class';
  }

  if (kind === PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS) {
    return 'Prefer to be in different classes';
  }

  return kind;
}

function renderSchoolParticipant(participants, participantId) {
  return escapeHtml(findNodeLabel(participants, participantId));
}

function renderRulePanels(project, editor, preferencePolicy) {
  const participants = [...getStudents(project), ...getTeachers(project)];
  const hardRuleRows = project.constraints.length === 0
    ? '<tr><td colspan="4" class="muted-text">No school hard rules yet.</td></tr>'
    : project.constraints.map((constraint, index) => `
        <tr>
          <td colspan="3">${renderSchoolParticipant(participants, constraint.leftRef.id)} ${escapeHtml(getSchoolRuleLabel(constraint.kind).toLowerCase())} ${renderSchoolParticipant(participants, constraint.rightRef.id)}.</td>
          <td><button type="button" data-action="remove-school-constraint" data-index="${index}" aria-label="Remove hard rule ${index + 1}">Remove</button></td>
        </tr>
      `).join('');

  const preferenceRows = project.preferences.length === 0
    ? '<tr><td colspan="5" class="muted-text">No school preferences yet.</td></tr>'
    : project.preferences.map((preference, index) => `
        <tr>
          <td>${escapeHtml(getSchoolPreferenceLabel(preference.kind))}</td>
          <td>${renderSchoolParticipant(participants, preference.leftRef.id)}</td>
          <td>${renderSchoolParticipant(participants, preference.rightRef.id)}</td>
          <td>${escapeHtml(preference.weight)}</td>
          <td><button type="button" data-action="remove-school-preference" data-index="${index}" aria-label="Remove audited preference ${index + 1}">Remove</button></td>
        </tr>
      `).join('');

  return `
    <section class="audit-section-grid school-rule-grid">
      <section class="card audit-card">
        <div class="audit-card-header">
          <div>
            <p class="eyebrow">🧩 School hard rules</p>
            <h2>Together or separate</h2>
          </div>
        </div>
        <div class="school-rule-form-stack compact-form-grid">
          <div class="form-grid compact-form-grid school-rule-top-row">
            <label>
              <span>Rule</span>
              <select name="draftRuleKind">
                <option value="${CONSTRAINT_KINDS.MUST_SHARE_CONTAINER}"${editor.draftRuleKind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER ? ' selected' : ''}>Must be together</option>
                <option value="${CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER}"${editor.draftRuleKind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER ? ' selected' : ''}>Must not be together</option>
              </select>
            </label>
          </div>
          <div class="form-grid compact-form-grid school-rule-participants-row">
            <label>
              <span>Left participant</span>
              <select name="draftRuleLeftId">${renderSelectOptions(participants, editor.draftRuleLeftId)}</select>
            </label>
            <label>
              <span>Right participant</span>
              <select name="draftRuleRightId">${renderSelectOptions(participants, editor.draftRuleRightId)}</select>
            </label>
          </div>
        </div>
        <div class="button-row top-gap">
          <button type="button" data-action="add-school-constraint">Add hard rule</button>
        </div>
        <div class="table-wrap audit-table-wrap top-gap">
          <table class="data-table">
            <caption>Supported hard class placement rules</caption>
            <thead>
              <tr><th>Rule</th><th>Left participant</th><th>Right participant</th><th>Actions</th></tr>
            </thead>
            <tbody>${hardRuleRows}</tbody>
          </table>
        </div>
      </section>

      <section class="card audit-card">
        <div class="audit-card-header">
          <div>
            <p class="eyebrow">✨ School preferences</p>
            <h2>Preferred class composition</h2>
          </div>
        </div>
        <div class="school-rule-form-stack compact-form-grid">
          ${preferencePolicy.message ? `<p class="muted-text">${escapeHtml(preferencePolicy.message)}</p>` : ''}
          <div class="form-grid compact-form-grid school-rule-top-row school-preference-top-row">
            <label>
              <span>Preference</span>
              <select name="draftPreferenceKind"${preferencePolicy.disabled ? ' disabled' : ''}>
                <option value="${PREFERENCE_KINDS.PREFER_SHARE_CONTAINER}"${editor.draftPreferenceKind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER ? ' selected' : ''}>Prefers to be together</option>
                <option value="${PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS}"${editor.draftPreferenceKind === PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS ? ' selected' : ''}>Prefers not to be together</option>
              </select>
            </label>
            <label>
              <span>Weight</span>
              <input type="number" min="0" step="1" name="draftPreferenceWeight" value="${escapeHtml(editor.draftPreferenceWeight)}"${preferencePolicy.disabled ? ' disabled' : ''} />
            </label>
          </div>
          <div class="form-grid compact-form-grid school-rule-participants-row">
            <label>
              <span>Left participant</span>
              <select name="draftPreferenceLeftId"${preferencePolicy.disabled ? ' disabled' : ''}>${renderSelectOptions(participants, editor.draftPreferenceLeftId)}</select>
            </label>
            <label>
              <span>Right participant</span>
              <select name="draftPreferenceRightId"${preferencePolicy.disabled ? ' disabled' : ''}>${renderSelectOptions(participants, editor.draftPreferenceRightId)}</select>
            </label>
          </div>
        </div>
        <div class="button-row top-gap">
          <button type="button" data-action="add-school-preference"${preferencePolicy.disabled ? ' disabled' : ''}>Add preference</button>
        </div>
        <div class="table-wrap audit-table-wrap top-gap">
          <table class="data-table">
            <caption>Unsupported preferences retained for audit and removal</caption>
            <thead>
              <tr><th>Preference</th><th>Left participant</th><th>Right participant</th><th>Weight</th><th>Actions</th></tr>
            </thead>
            <tbody>${preferenceRows}</tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function cloneProject(project) {
  return structuredClone(project);
}

function intersectIds(leftIds, rightIds) {
  const rightSet = new Set(rightIds);
  return leftIds.filter((id) => rightSet.has(id));
}

function buildSchoolSolveProject(project) {
  const transformedProject = cloneProject(project);
  const students = getStudents(transformedProject);
  const studentIds = new Set(students.map((student) => student.id));
  const teacherHints = deriveTeacherLinkedAssignmentHints(transformedProject);

  transformedProject.items = students.map((student) => {
    const levelAllowedIds = getAllowedContainerIdsForStudent(transformedProject, student.id);
    const requiredIds = teacherHints.requiredByStudentId[student.id] ?? [];
    const forbiddenIds = teacherHints.forbiddenByStudentId[student.id] ?? [];
    const allowedContainerIds = requiredIds.length > 0
      ? intersectIds(levelAllowedIds, requiredIds)
      : levelAllowedIds;

    return {
      ...student,
      metadata: {
        ...student.metadata,
        allowedContainerIds,
        forbiddenContainerIds: forbiddenIds,
      },
    };
  });

  transformedProject.containments = transformedProject.containments.filter((relation) => studentIds.has(relation.to.id));

  transformedProject.constraints = transformedProject.constraints.filter((constraint) => {
    const leftParticipant = transformedProject.items.find((item) => item.id === constraint.leftRef.id);
    const rightParticipant = transformedProject.items.find((item) => item.id === constraint.rightRef.id);
    return leftParticipant && rightParticipant;
  });

  transformedProject.preferences = transformedProject.preferences.filter((preference) => {
    const leftParticipant = transformedProject.items.find((item) => item.id === preference.leftRef.id);
    const rightParticipant = transformedProject.items.find((item) => item.id === preference.rightRef.id);
    return leftParticipant && rightParticipant;
  });

  return transformedProject;
}

function renderSchoolSolutionPanelOptions(project, normalizedProject) {
  return {
    panelTitle: 'Class placement result',
    panelEyebrow: 'School solver output',
    emptyResultMessage: 'Run solve after school validation to see proposed class placements.',
    unsatMessage: 'The solver completed but could not place students into classes while satisfying the current school rules.',
    noWarningsMessage: 'No school solver warnings.',
    rawJsonSummaryLabel: 'View raw school solver result JSON',
    containerKindLabel: 'Class',
    assignmentCountLabel: 'Assigned students',
    emptyAssignmentsLabel: 'No assigned students',
    sectionSummaryLabel: 'Students grouped by class, with class-facing school details.',
    solutionPrefixLabel: 'Placement',
    capacityLabel: 'Capacity',
    displayProject: project,
    getAssignmentCount: (assignments) => assignments.filter((assignment) => assignment.metadata?.schoolRole !== 'teacher').length,
    searchHintVocabulary: {
      'use-first-mode': 'Find the first class placement',
      'tighten-eligibility-bounds': 'Tighten class eligibility and capacities',
      'add-fixed-assignments': 'Pre-place students with known classes',
      'split-problem': 'Split independent levels or cohorts',
    },
    renderContainerMeta: ({ container, assignments, defaultItemList }) => {
      const sourceContainer = findContainerById(project, container.id) ?? container;
      const acceptedLevelLabels = getContainerAcceptedLevelIds(sourceContainer)
        .map((levelId) => findNodeLabel(getLevels(project), levelId));
      const teacherLabels = getContainerTeacherIds(sourceContainer)
        .map((teacherId) => findNodeLabel(getTeachers(project), teacherId));
      const assignedStudentIds = getAssignedStudentIds({ assignments }, container.id);
      const assignedLevels = [...new Set(
        assignedStudentIds
          .flatMap((studentId) => getContainedGroupIdsForItem(project, studentId))
          .map((levelId) => findNodeLabel(getLevels(project), levelId)),
      )];
      const normalizedSourceContainer = normalizedProject?.containers?.find((entry) => entry.id === container.id) ?? container;
      const studentAssignments = assignments.filter((assignment) => assignment.metadata?.schoolRole !== 'teacher');
      const teacherAssignments = assignments.filter((assignment) => assignment.metadata?.schoolRole === 'teacher');
      const studentList = studentAssignments.length
        ? studentAssignments.map((assignment) => `<li>${escapeHtml(findNodeLabel(getStudents(project), assignment.itemRef?.id))}</li>`).join('')
        : '<li class="muted-text">No assigned students</li>';
      const assignedTeacherList = teacherAssignments.length
        ? teacherAssignments.map((assignment) => `<li>${escapeHtml(findNodeLabel(getTeachers(project), assignment.itemRef?.id))}</li>`).join('')
        : '<li class="muted-text">No assigned teacher</li>';

      return `
        <div class="entity-meta-item"><dt>Capacity</dt><dd>${escapeHtml(normalizedSourceContainer.metadata?.minCapacity ?? normalizedSourceContainer.minCapacity ?? 0)} → ${escapeHtml(normalizedSourceContainer.metadata?.maxCapacity ?? normalizedSourceContainer.maxCapacity ?? '∞')}</dd></div>
        <div class="entity-meta-item"><dt>Accepted levels</dt><dd>${renderMembershipList(acceptedLevelLabels, 'All levels are allowed')}</dd></div>
        <div class="entity-meta-item"><dt>Fixed teacher links</dt><dd>${renderMembershipList(teacherLabels, 'No fixed teacher link')}</dd></div>
        <div class="entity-meta-item"><dt>Assigned teacher</dt><dd><ul class="solution-item-list">${assignedTeacherList}</ul></dd></div>
        <div class="entity-meta-item"><dt>Levels present in this class</dt><dd>${renderMembershipList(assignedLevels, 'No assigned student level yet')}</dd></div>
        <div class="entity-meta-item"><dt>Assigned students</dt><dd><ul class="solution-item-list">${studentList}</ul></dd></div>
      `;
    },
  };
}

function renderNormalizationSummary(normalizedProject) {
  if (!normalizedProject) {
    return `
      <section class="card audit-card">
        <div class="audit-card-header">
          <div>
            <p class="eyebrow">🧮 Derived model</p>
            <h2>Normalization</h2>
          </div>
        </div>
        <p class="muted-text">Run school validation or solve to inspect the normalized project prepared for the solver.</p>
      </section>
    `;
  }

  return `
    <section class="card audit-card">
      <div class="audit-card-header">
        <div>
          <p class="eyebrow">🧮 Derived model</p>
          <h2>Normalization</h2>
        </div>
      </div>
      <dl class="summary-grid audit-summary-grid">
        <div><dt>Items sent to solver</dt><dd>${normalizedProject.items.length}</dd></div>
        <div><dt>Constraints</dt><dd>${normalizedProject.constraints.length}</dd></div>
        <div><dt>Preferences</dt><dd>${normalizedProject.preferences.length}</dd></div>
        <div><dt>Must-share groups</dt><dd>${normalizedProject.derived?.mustShareComponents?.length ?? 0}</dd></div>
      </dl>
      <details class="details-panel top-gap">
        <summary>View normalized project JSON</summary>
        ${renderJsonBlock(normalizedProject, 'normalized school project JSON')}
      </details>
    </section>
  `;
}

function resetSchoolDerivedState(state) {
  discardSolveExecution(state.schoolPage.solveExecution);
  state.schoolPage.lastValidation = null;
  state.schoolPage.lastNormalizedProject = null;
  state.schoolPage.lastSolverResult = null;
  state.schoolPage.validationPanelExpanded = false;
  state.schoolPage.editor.activeSolutionIndex = 0;
}

function mergeValidationResults(primary, secondary) {
  return {
    valid: Boolean(primary?.valid) && Boolean(secondary?.valid),
    errors: [...(primary?.errors ?? []), ...(secondary?.errors ?? [])],
    warnings: [...(primary?.warnings ?? []), ...(secondary?.warnings ?? [])],
  };
}

function runSchoolValidationFlow(state) {
  const adapter = new FirstSolverAdapter();
  const schoolValidation = validateSchoolProject(state.schoolPage.project);
  const schoolProject = buildSchoolSolveProject(state.schoolPage.project);
  const genericValidation = validateProject(schoolProject, adapter.getCapabilities());
  const validation = mergeValidationResults(schoolValidation, genericValidation);

  state.schoolPage.lastValidation = validation;
  state.schoolPage.validationPanelExpanded = !validation.valid;
  state.schoolPage.activeWorkflowTab = 'review';

  if (!validation.valid) {
    state.schoolPage.lastNormalizedProject = null;
    state.schoolPage.lastSolverResult = null;
    return;
  }

  state.schoolPage.lastNormalizedProject = normalizeProject(schoolProject);
  state.schoolPage.lastSolverResult = null;
}

function runSchoolSolveFlow(state, root) {
  const adapter = new FirstSolverAdapter();
  const schoolValidation = validateSchoolProject(state.schoolPage.project);
  const schoolProject = buildSchoolSolveProject(state.schoolPage.project);
  const genericValidation = validateProject(schoolProject, adapter.getCapabilities());
  const optionsValidation = validateSolveOptions(buildWorkflowSolveOptions(state.schoolPage.editor), adapter.getCapabilities());
  const validation = mergeValidationResults(mergeValidationResults(schoolValidation, genericValidation), {
    valid: optionsValidation.valid,
    errors: solveOptionIssues(optionsValidation.errors),
    warnings: [],
  });

  state.schoolPage.lastValidation = validation;
  state.schoolPage.validationPanelExpanded = true;

  if (!validation.valid) {
    state.schoolPage.lastNormalizedProject = null;
    state.schoolPage.lastSolverResult = null;
    state.schoolPage.activeWorkflowTab = 'review';
    return;
  }

  const normalizedProject = normalizeProject(schoolProject);
  state.schoolPage.lastNormalizedProject = normalizedProject;

  const adapterValidation = adapter.validateModel(normalizedProject);
  if (!adapterValidation.valid) {
    state.schoolPage.lastValidation = mergeValidationResults(validation, adapterValidation);
    state.schoolPage.lastSolverResult = null;
    state.schoolPage.activeWorkflowTab = 'review';
    return;
  }
  state.schoolPage.editor.activeSolutionIndex = 0;
  state.schoolPage.activeWorkflowTab = 'review';
  startSolveExecution({
    execution: state.schoolPage.solveExecution,
    model: normalizedProject,
    options: optionsValidation.options,
    onResult(solverResult) {
      solverResult = assignTeachersToSchoolResult(state.schoolPage.project, solverResult);
      state.schoolPage.lastSolverResult = {
        ...solverResult,
        warnings: [...(adapterValidation.warnings ?? []), ...(solverResult.warnings ?? [])],
      };
      state.schoolPage.message = solverResult.status === 'solved'
        ? 'School solve completed. A valid class distribution was found.'
        : 'School solve stopped without a complete result.';
      state.schoolPage.activeWorkflowTab = solverResult.status === 'solved' ? 'results' : 'review';
    },
    onProgressChange: () => updateSolveStatus(root, state.schoolPage.solveExecution),
    onChange: () => renderSchoolPage(root, state),
  });
}

function renderProjectDebug(project) {
  return `
    <section class="card audit-card">
      <div class="audit-card-header">
        <div>
          <p class="eyebrow">🛠 Shared model preview</p>
          <h2>Generic project data written by the school panel</h2>
        </div>
      </div>
      <p class="muted-text">This school page still writes directly into the shared generic project shape so it can later plug into the common validate → normalize → solve flow.</p>
      <details class="details-panel">
        <summary>View project JSON</summary>
        ${renderJsonBlock(project, 'school project JSON')}
      </details>
    </section>
  `;
}

function clearSchoolMessage(state) {
  state.schoolPage.message = '';
}

function addStudent(state) {
  const label = state.schoolPage.editor.draftStudentLabel.trim();
  if (!label) {
    return;
  }

  state.schoolPage.project.items.push(createItem({
    id: createId('item'),
    label,
    metadata: { schoolRole: SCHOOL_ITEM_ROLES.STUDENT },
  }));
  state.schoolPage.editor.draftStudentLabel = '';
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

function bulkAddStudents(state) {
  const editor = state.schoolPage.editor;
  const labels = parseBulkLabels(editor.bulkStudentLabels);
  labels.forEach((label) => {
    const student = createItem({ id: createId('item'), label, metadata: { schoolRole: SCHOOL_ITEM_ROLES.STUDENT } });
    state.schoolPage.project.items.push(student);
    if (editor.bulkStudentLevelId) toggleMembership(state.schoolPage.project, editor.bulkStudentLevelId, student.id, true);
  });
  if (labels.length) {
    editor.bulkStudentLabels = '';
    clearSchoolMessage(state);
    resetSchoolDerivedState(state);
    state.schoolPage.message = `Added ${labels.length} student${labels.length === 1 ? '' : 's'}${editor.bulkStudentLevelId ? ' and assigned the selected level' : ''}.`;
  }
}

function addTeacher(state) {
  const label = state.schoolPage.editor.draftTeacherLabel.trim();
  if (!label) {
    return;
  }

  state.schoolPage.project.items.push(createItem({
    id: createId('item'),
    label,
    metadata: { schoolRole: SCHOOL_ITEM_ROLES.TEACHER },
  }));
  state.schoolPage.editor.draftTeacherLabel = '';
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

function addLevel(state) {
  const label = state.schoolPage.editor.draftLevelLabel.trim();
  if (!label) {
    return;
  }

  state.schoolPage.project.groups.push(createGroup({ id: createId('group'), label }));
  state.schoolPage.editor.draftLevelLabel = '';
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

function addClassroom(state) {
  const editor = state.schoolPage.editor;
  const label = editor.draftClassLabel.trim();
  if (!label) {
    return;
  }

  const minCapacity = Number.parseInt(editor.draftClassMinCapacity || '0', 10);
  const maxCapacity = editor.draftClassMaxCapacity === '' ? null : Number.parseInt(editor.draftClassMaxCapacity, 10);

  state.schoolPage.project.containers.push(createContainer({
    id: createId('container'),
    label,
    minCapacity: Number.isNaN(minCapacity) ? 0 : minCapacity,
    maxCapacity: Number.isNaN(maxCapacity) ? null : maxCapacity,
    metadata: {
      acceptedLevelIds: [],
      teacherIds: [],
    },
  }));

  editor.draftClassLabel = '';
  editor.draftClassMinCapacity = '0';
  editor.draftClassMaxCapacity = '';
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

function toggleMembership(project, groupId, itemId, checked) {
  const existingIndex = project.containments.findIndex((relation) => relation.from.kind === 'group' && relation.from.id === groupId && relation.to.kind === 'item' && relation.to.id === itemId);

  if (checked && existingIndex === -1) {
    project.containments.push(createContainmentRelation(createEntityRef('group', groupId), createEntityRef('item', itemId)));
  }

  if (!checked && existingIndex >= 0) {
    project.containments.splice(existingIndex, 1);
  }
}

function toggleContainerMetadataId(project, classId, key, value, checked) {
  const classroom = project.containers.find((entry) => entry.id === classId);
  if (!classroom) {
    return;
  }

  if (!classroom.metadata) {
    classroom.metadata = {};
  }

  const currentIds = Array.isArray(classroom.metadata[key]) ? [...classroom.metadata[key]] : [];
  const hasValue = currentIds.includes(value);

  if (checked && !hasValue) {
    currentIds.push(value);
  }

  if (!checked && hasValue) {
    classroom.metadata[key] = currentIds.filter((entry) => entry !== value);
    return;
  }

  classroom.metadata[key] = currentIds;
}

function addSchoolConstraint(state) {
  const editor = state.schoolPage.editor;
  if (!editor.draftRuleLeftId || !editor.draftRuleRightId) {
    return;
  }

  state.schoolPage.project.constraints.push(createConstraint({
    kind: editor.draftRuleKind,
    leftRef: createEntityRef('item', editor.draftRuleLeftId),
    rightRef: createEntityRef('item', editor.draftRuleRightId),
  }));

  editor.draftRuleLeftId = '';
  editor.draftRuleRightId = '';
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

export function addSchoolPreference(state) {
  if (!new FirstSolverAdapter().getCapabilities().softPreferences) {
    return;
  }

  const editor = state.schoolPage.editor;
  if (!editor.draftPreferenceLeftId || !editor.draftPreferenceRightId) {
    return;
  }

  const weight = Number.parseInt(editor.draftPreferenceWeight || '1', 10);

  state.schoolPage.project.preferences.push(createPreference({
    kind: editor.draftPreferenceKind,
    leftRef: createEntityRef('item', editor.draftPreferenceLeftId),
    rightRef: createEntityRef('item', editor.draftPreferenceRightId),
    weight: Number.isNaN(weight) ? 1 : weight,
  }));

  editor.draftPreferenceLeftId = '';
  editor.draftPreferenceRightId = '';
  editor.draftPreferenceWeight = '1';
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

function removeAt(list, index) {
  list.splice(index, 1);
}

function removeNodeAndReferences(project, collectionName, index) {
  const removed = project[collectionName]?.[index];
  if (!removed) {
    return;
  }

  project[collectionName].splice(index, 1);
  const matchesRef = (ref) => ref.id === removed.id && ref.kind === removed.kind;

  project.containments = project.containments.filter((relation) => !matchesRef(relation.from) && !matchesRef(relation.to));
  project.constraints = project.constraints.filter((entry) => !matchesRef(entry.leftRef) && !matchesRef(entry.rightRef));
  project.preferences = project.preferences.filter((entry) => !matchesRef(entry.leftRef) && !matchesRef(entry.rightRef));

  if (removed.kind === 'item') {
    project.containers.forEach((container) => {
      if (Array.isArray(container.metadata?.teacherIds)) {
        container.metadata.teacherIds = container.metadata.teacherIds.filter((teacherId) => teacherId !== removed.id);
      }
    });
  }

  if (removed.kind === 'group') {
    project.containers.forEach((container) => {
      if (Array.isArray(container.metadata?.acceptedLevelIds)) {
        container.metadata.acceptedLevelIds = container.metadata.acceptedLevelIds.filter((levelId) => levelId !== removed.id);
      }
    });
  }
}

function updateSchoolLabel(state, kind, index, value) {
  const collection = kind === 'item'
    ? state.schoolPage.project.items
    : kind === 'group'
      ? state.schoolPage.project.groups
      : state.schoolPage.project.containers;

  if (!collection?.[index]) {
    return;
  }

  collection[index].label = value;
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

function updateClassCapacity(state, index, field, value) {
  const classroom = state.schoolPage.project.containers[index];
  if (!classroom) {
    return;
  }

  if (!classroom.metadata) {
    classroom.metadata = {};
  }

  if (field === 'maxCapacity' && value === '') {
    classroom.metadata.maxCapacity = null;
    return;
  }

  const parsed = Number.parseInt(value || '0', 10);
  classroom.metadata[field] = Number.isNaN(parsed) ? (field === 'maxCapacity' ? null : 0) : parsed;
  clearSchoolMessage(state);
  resetSchoolDerivedState(state);
}

function bindInputs(root, state) {
  root.querySelectorAll('input[name], textarea[name], select[name]').forEach((element) => {
    const eventName = element.tagName === 'SELECT' ? 'change' : 'input';
    element.addEventListener(eventName, (event) => {
      const { name, value } = event.target;

      if (name === 'schoolTitle') {
        state.schoolPage.project.title = value;
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        return;
      }

      if (name === 'schoolDescription') {
        state.schoolPage.project.description = value;
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        return;
      }

      if (name === 'dataSearch') {
        state.schoolPage.editor.dataSearch = value;
        renderSchoolPage(root, state);
        const search = root.querySelector('input[name="dataSearch"]');
        search?.focus();
        search?.setSelectionRange?.(value.length, value.length);
        return;
      }

      state.schoolPage.editor[name] = event.target.type === 'checkbox' ? event.target.checked : value;
      clearSchoolMessage(state);
    });
  });

  root.querySelectorAll('[data-action="edit-school-label"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateSchoolLabel(state, event.target.dataset.kind, Number.parseInt(event.target.dataset.index, 10), event.target.value);
    });
  });

  root.querySelectorAll('[data-action="edit-class-min"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateClassCapacity(state, Number.parseInt(event.target.dataset.index, 10), 'minCapacity', event.target.value);
    });
  });

  root.querySelectorAll('[data-action="edit-class-max"]').forEach((element) => {
    element.addEventListener('input', (event) => {
      updateClassCapacity(state, Number.parseInt(event.target.dataset.index, 10), 'maxCapacity', event.target.value);
    });
  });
}

function bindActions(root, state) {
  root.querySelector('.validation-panel-details')?.addEventListener('toggle', (event) => {
    state.schoolPage.validationPanelExpanded = event.target.open;
  });

  bindWorkflowTabs(root, (tabId) => {
    state.schoolPage.activeWorkflowTab = tabId;
    renderSchoolPage(root, state);
  });

  root.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.dataset.action;

    if (action === 'add-student') {
      element.addEventListener('click', () => {
        addStudent(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'bulk-add-students') {
      element.addEventListener('click', () => {
        bulkAddStudents(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'add-teacher') {
      element.addEventListener('click', () => {
        addTeacher(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'add-level') {
      element.addEventListener('click', () => {
        addLevel(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'add-class') {
      element.addEventListener('click', () => {
        addClassroom(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'add-school-constraint') {
      element.addEventListener('click', () => {
        addSchoolConstraint(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'add-school-preference') {
      element.addEventListener('click', () => {
        addSchoolPreference(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'remove-student') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state.schoolPage.project, 'items', Number.parseInt(element.dataset.index, 10));
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'remove-teacher') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state.schoolPage.project, 'items', Number.parseInt(element.dataset.index, 10));
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'remove-level') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state.schoolPage.project, 'groups', Number.parseInt(element.dataset.index, 10));
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'remove-class') {
      element.addEventListener('click', () => {
        removeNodeAndReferences(state.schoolPage.project, 'containers', Number.parseInt(element.dataset.index, 10));
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'remove-school-constraint') {
      element.addEventListener('click', () => {
        removeAt(state.schoolPage.project.constraints, Number.parseInt(element.dataset.index, 10));
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'remove-school-preference') {
      element.addEventListener('click', () => {
        removeAt(state.schoolPage.project.preferences, Number.parseInt(element.dataset.index, 10));
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'toggle-student-level') {
      element.addEventListener('change', (event) => {
        toggleMembership(state.schoolPage.project, event.target.dataset.levelId, event.target.dataset.studentId, event.target.checked);
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'toggle-teacher-level') {
      element.addEventListener('change', (event) => {
        toggleMembership(state.schoolPage.project, event.target.dataset.levelId, event.target.dataset.teacherId, event.target.checked);
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'toggle-class-level') {
      element.addEventListener('change', (event) => {
        toggleContainerMetadataId(state.schoolPage.project, event.target.dataset.classId, 'acceptedLevelIds', event.target.dataset.levelId, event.target.checked);
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'toggle-class-teacher') {
      element.addEventListener('change', (event) => {
        toggleContainerMetadataId(state.schoolPage.project, event.target.dataset.classId, 'teacherIds', event.target.dataset.teacherId, event.target.checked);
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'teacher-class-preference') {
      element.addEventListener('change', (event) => {
        const teacher = getItems(state.schoolPage.project).find((item) => item.id === event.target.dataset.teacherId);
        if (!teacher) return;
        teacher.metadata = teacher.metadata ?? {};
        teacher.metadata.classPreferences = { ...(teacher.metadata.classPreferences ?? {}) };
        if (event.target.value === 'neutral') delete teacher.metadata.classPreferences[event.target.dataset.classId];
        else teacher.metadata.classPreferences[event.target.dataset.classId] = event.target.value;
        clearSchoolMessage(state);
        resetSchoolDerivedState(state);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'toggle-school-command-bar') {
      element.addEventListener('click', () => {
        state.schoolPage.commandBarExpanded = !state.schoolPage.commandBarExpanded;
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'validate-school') {
      element.addEventListener('click', () => {
        runSchoolValidationFlow(state);
        const errorCount = state.schoolPage.lastValidation?.errors?.length ?? 0;
        const warningCount = state.schoolPage.lastValidation?.warnings?.length ?? 0;
        state.schoolPage.message = state.schoolPage.lastValidation?.valid
          ? `School validation passed with ${warningCount} warning${warningCount === 1 ? '' : 's'}. ✅`
          : `School validation found ${errorCount} problem${errorCount === 1 ? '' : 's'} and ${warningCount} warning${warningCount === 1 ? '' : 's'}. Please review the messages below. ⚠️`;
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'solve-school') {
      element.addEventListener('click', () => {
        runSchoolSolveFlow(state, root);
        state.schoolPage.message = !state.schoolPage.lastValidation?.valid
          ? 'The class distribution was not attempted because the school scenario still has problems to fix. ⚠️'
          : state.schoolPage.lastSolverResult?.status === 'solved'
          ? 'School solve completed. A valid class distribution was found. 🎉'
          : state.schoolPage.lastSolverResult?.status === 'unsat'
            ? 'No valid class distribution was found with the current rules and capacities. 🧠'
            : 'School solve could not complete successfully.';
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'cancel-solve') {
      element.addEventListener('click', () => cancelSolveExecution(state.schoolPage.solveExecution));
      return;
    }

    if (action === 'import-school-workbook') {
      element.addEventListener('change', async (event) => {
        const [file] = Array.from(event.target.files ?? []);
        if (!file) {
          return;
        }

        try {
          const preview = await previewSchoolWorkbookFile(file);
          state.schoolPage.workbookImport = { status: 'ready', error: '', preview: { ...preview, fileName: file.name } };
        } catch (error) {
          state.schoolPage.workbookImport = { status: 'idle', preview: null, error: error instanceof Error ? error.message : 'Excel import failed.' };
        }

        event.target.value = '';
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'export-school-share-edit') {
      element.addEventListener('click', () => {
        try {
          exportSchoolShareEditWorkbook(state.schoolPage.project, { language: state.schoolPage.editor.schoolShareLanguage, identityType: state.schoolPage.editor.schoolShareIdentity, filename: 'school-share-edit.xlsx' });
          state.schoolPage.message = 'School Share & Edit workbook downloaded.';
        } catch (error) {
          state.schoolPage.message = error instanceof Error ? `Share & Edit export failed: ${error.message}` : 'Share & Edit export failed.';
        }
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'import-school-share-edit') {
      element.addEventListener('change', async (event) => {
        const [file] = Array.from(event.target.files ?? []);
        if (!file) return;
        state.schoolPage.shareEditImport = { status: 'busy', error: '', preview: null, fileName: file.name };
        renderSchoolPage(root, state);
        try {
          const preview = await previewSchoolShareEditWorkbookFile(file, state.schoolPage.project);
          state.schoolPage.shareEditImport = { status: 'ready', error: '', preview, fileName: file.name };
        } catch (error) {
          state.schoolPage.shareEditImport = { status: 'error', error: error instanceof Error ? error.message : 'Stakeholder workbook import failed.', preview: null, fileName: file.name };
        }
        event.target.value = '';
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'apply-school-share-edit') {
      element.addEventListener('click', () => {
        const preview = state.schoolPage.shareEditImport.preview;
        if (!preview?.canApply || !globalThis.confirm?.('Apply the previewed School stakeholder changes?')) return;
        try {
          state.schoolPage.project = applySchoolShareEditPreview(state.schoolPage.project, preview);
          state.schoolPage.shareEditImport = { status: 'idle', error: '', preview: null };
          resetSchoolDerivedState(state);
          state.schoolPage.message = 'School stakeholder changes applied.';
        } catch (error) {
          state.schoolPage.shareEditImport.error = error instanceof Error ? error.message : 'Stakeholder changes could not be applied.';
        }
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'cancel-school-share-edit') {
      element.addEventListener('click', () => {
        state.schoolPage.shareEditImport = { status: 'idle', error: '', preview: null };
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'import-school-json') {
      element.addEventListener('change', async (event) => {
        const [file] = Array.from(event.target.files ?? []);
        if (!file) return;
        try {
          const imported = migrateProjectModel(await readJsonConfigurationFile(file));
          if (!isProject(imported) || imported.viewHint !== VIEW_HINTS.SCHOOL) throw new Error('The file does not contain a School project.');
          if (!confirmProjectReplacement(state.schoolPage.project, 'Replace the current School configuration with this JSON file?')) return;
          state.schoolPage.project = imported;
          resetSchoolDerivedState(state);
          state.schoolPage.message = `JSON configuration imported from ${file.name}. Review it before solving.`;
        } catch (error) {
          state.schoolPage.message = error instanceof Error ? `JSON import failed: ${error.message}` : 'JSON import failed.';
        }
        event.target.value = '';
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'export-school-json') {
      element.addEventListener('click', () => {
        downloadJsonConfiguration(state.schoolPage.project, 'school');
        state.schoolPage.message = 'School JSON configuration downloaded.';
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'confirm-school-workbook') {
      element.addEventListener('click', () => {
        const preview = state.schoolPage.workbookImport.preview;
        if (!preview) return;
        preview.project.viewHint = VIEW_HINTS.SCHOOL;
        state.schoolPage.project = preview.project;
        state.schoolPage.workbookImport = { status: 'idle', error: '', preview: null };
        resetSchoolDerivedState(state);
        state.schoolPage.message = `Workbook imported from ${preview.fileName}. Review the scenario before solving.`;
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'cancel-school-workbook') {
      element.addEventListener('click', () => {
        state.schoolPage.workbookImport = { status: 'idle', error: '', preview: null };
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'export-school-configuration') {
      element.addEventListener('click', () => {
        try {
          exportSchoolConfigurationWorkbook(state.schoolPage.project);
          state.schoolPage.message = 'School configuration workbook downloaded.';
        } catch (error) {
          state.schoolPage.message = error instanceof Error ? `Configuration export failed: ${error.message}` : 'Configuration export failed.';
        }
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'export-school-solution') {
      element.addEventListener('click', () => {
        try {
          exportSchoolSolutionWorkbook(state.schoolPage.project, state.schoolPage.lastSolverResult, state.schoolPage.editor.activeSolutionIndex);
          state.schoolPage.message = `Excel export downloaded for solution ${state.schoolPage.editor.activeSolutionIndex + 1}. 📘`;
        } catch (error) {
          state.schoolPage.message = error instanceof Error
            ? `Excel export failed: ${error.message}`
            : 'Excel export failed.';
        }
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'previous-solution') {
      element.addEventListener('click', () => {
        state.schoolPage.editor.activeSolutionIndex = Math.max(0, state.schoolPage.editor.activeSolutionIndex - 1);
        renderSchoolPage(root, state);
      });
      return;
    }

    if (action === 'next-solution') {
      element.addEventListener('click', () => {
        const solutionCount = state.schoolPage.lastSolverResult?.solutions?.length ?? 0;
        state.schoolPage.editor.activeSolutionIndex = Math.min(Math.max(solutionCount - 1, 0), state.schoolPage.editor.activeSolutionIndex + 1);
        renderSchoolPage(root, state);
      });
    }
  });
}

function bindEnterToCreate(root, state) {
  const actionMap = {
    draftStudentLabel: addStudent,
    draftTeacherLabel: addTeacher,
    draftLevelLabel: addLevel,
    draftClassLabel: addClassroom,
    draftClassMinCapacity: addClassroom,
    draftClassMaxCapacity: addClassroom,
    draftPreferenceWeight: addSchoolPreference,
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
      renderSchoolPage(root, state);
    });
  });

  root.querySelectorAll('select[name]').forEach((element) => {
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      const name = event.target.name;
      if (name === 'draftRuleRightId') {
        event.preventDefault();
        addSchoolConstraint(state);
        renderSchoolPage(root, state);
      }

      if (name === 'draftPreferenceRightId') {
        event.preventDefault();
        addSchoolPreference(state);
        renderSchoolPage(root, state);
      }
    });
  });
}

export function renderSchoolPage(root, state) {
  ensureSchoolProject(state);
  persistPageDraft(state.draftStorage, 'school', state.schoolPage.project, state.schoolPage.persistence);
  const preferencePolicy = getGeneralPreferenceAuthoringPolicy(new FirstSolverAdapter().getCapabilities());
  const activeTab = state.schoolPage.activeWorkflowTab;
  const setupContent = `
    <section class="card sticky-panel"><h2>School scenario</h2><div class="form-grid two-columns">
      <label>${renderFieldLabel('Scenario name', 'A descriptive name for this school class-allocation scenario.')}<input type="text" name="schoolTitle" value="${escapeHtml(state.schoolPage.project.title)}" /></label>
      <label class="full-width">${renderFieldLabel('Description', 'Optional planning notes, assumptions, or context for this scenario.')}<textarea name="schoolDescription" rows="3">${escapeHtml(state.schoolPage.project.description)}</textarea></label>
    </div></section>
    ${renderSolveConfiguration(state.schoolPage.editor, 'school')}
    ${renderJsonConfigurationSetup({ prefix: 'school', domainLabel: 'School' })}
    ${renderShareEditSetup(state.schoolPage.shareEditImport, 'school', 'School', { language: state.schoolPage.editor.schoolShareLanguage, identityType: state.schoolPage.editor.schoolShareIdentity })}
    ${renderWorkbookSetup(state.schoolPage.workbookImport, 'school', 'school scenario')}`;
  const dataContent = `${renderSchoolDataTools(state.schoolPage.project, state.schoolPage.editor)}${renderCreateCards(state.schoolPage.project, state.schoolPage.editor)}
    <section class="workspace-columns two-up">${renderStudentsPanel(state.schoolPage.project, state.schoolPage.editor)}${renderTeachersPanel(state.schoolPage.project, state.schoolPage.editor)}</section>
    <section class="workspace-columns two-up">${renderLevelsPanel(state.schoolPage.project, state.schoolPage.editor)}${renderClassesPanel(state.schoolPage.project, state.schoolPage.editor)}</section>`;
  const reviewContent = `${renderSchoolCommandBar(state.schoolPage.lastSolverResult, state.schoolPage.commandBarExpanded !== false)}${renderSolveStatus(state.schoolPage.solveExecution)}${renderValidationPanel(state.schoolPage.lastValidation, { hasComputedSolution: Boolean(state.schoolPage.lastSolverResult), expanded: state.schoolPage.validationPanelExpanded })}${renderAdvancedDiagnostics(state.schoolPage.project, state.schoolPage.lastNormalizedProject)}`;
  const resultsContent = `${renderSolutionPanel(state.schoolPage.lastNormalizedProject ?? state.schoolPage.project, state.schoolPage.lastSolverResult, state.schoolPage.editor.activeSolutionIndex, renderSchoolSolutionPanelOptions(state.schoolPage.project, state.schoolPage.lastNormalizedProject))}${state.schoolPage.lastSolverResult?.solutions?.length ? '<div class="button-row top-gap"><button type="button" data-action="export-school-solution">Export selected solved class distribution</button></div>' : ''}`;
  const displayContent = `${renderSolutionNavigation(state.schoolPage.editor.activeSolutionIndex, state.schoolPage.lastSolverResult?.solutions?.length ?? 0)}${renderSchoolSolutionDisplay({ project: state.schoolPage.project, normalizedProject: state.schoolPage.lastNormalizedProject, result: state.schoolPage.lastSolverResult, activeSolutionIndex: state.schoolPage.editor.activeSolutionIndex })}`;

  root.innerHTML = renderPageShell({
    activeRoute: '/school',
    title: 'School Class Creation',
    description: '🏫 Build school scenarios with students, teachers, levels, and classes while staying on the shared generic model.',
    persistence: state.schoolPage.persistence,
    body: `
      ${state.schoolPage.message ? `<section class="command-bar-feedback" role="status" aria-live="polite">${escapeHtml(state.schoolPage.message)}</section>` : ''}
      ${renderSummary(state.schoolPage.project)}
      ${renderWorkflowTabs(activeTab, WORKFLOW_TABS_WITH_DISPLAY)}
      ${renderWorkflowPanel('setup', activeTab, setupContent)}
      ${renderWorkflowPanel('data', activeTab, dataContent)}
      ${renderWorkflowPanel('rules', activeTab, renderRulePanels(state.schoolPage.project, state.schoolPage.editor, preferencePolicy))}
      ${renderWorkflowPanel('review', activeTab, reviewContent)}
      ${renderWorkflowPanel('results', activeTab, resultsContent)}
      ${renderWorkflowPanel('display', activeTab, displayContent)}
    `,
  });

  bindInputs(root, state);
  bindActions(root, state);
  bindEnterToCreate(root, state);
  bindJsonCopyButtons(root);
  bindPageDraftAutosave(root, state.draftStorage, 'school', () => state.schoolPage.project, state.schoolPage.persistence);
}
