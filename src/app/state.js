import { createEmptyProject, isProject, VIEW_HINTS } from '../core/model/project.js';
import { createMockDomainProject } from '../pages/eventStaffing/mockDomainProject.js';
import {
  getBrowserDraftStorage,
  LEGACY_GENERIC_DRAFT_KEY,
  recoverPageDraft,
} from '../storage/localDrafts.js';
import { migrateProjectModel } from '../storage/modelVersioning.js';
import { createSolveExecutionState } from '../solver/solveExecution.js';
import { migrateEventStaffingProject } from '../pages/eventStaffing/migration.js';

function createGenericPageEditorState() {
  return {
    draftItemLabel: '',
    draftGroupLabel: '',
    draftContainerLabel: '',
    draftContainerMinCapacity: '0',
    draftContainerMaxCapacity: '',
    draftPositionLabel: '',
    draftContainmentFromKind: 'group',
    draftContainmentFromId: '',
    draftContainmentToKind: 'item',
    draftContainmentToId: '',
    draftTopologyFromId: '',
    draftTopologyToId: '',
    draftConstraintKind: 'mustShareContainer',
    draftConstraintMode: 'pair',
    draftConstraintLeftKind: 'item',
    draftConstraintLeftId: '',
    draftConstraintRightKind: 'item',
    draftConstraintRightId: '',
    draftConstraintGroupId: '',
    draftPreferenceKind: 'preferShareContainer',
    draftPreferenceMode: 'pair',
    draftPreferenceLeftKind: 'item',
    draftPreferenceLeftId: '',
    draftPreferenceRightKind: 'item',
    draftPreferenceRightId: '',
    draftPreferenceGroupId: '',
    draftPreferenceWeight: '1',
    activeSolutionIndex: 0,
  };
}

function createSchoolPageEditorState() {
  return {
    draftStudentLabel: '',
    draftTeacherLabel: '',
    draftLevelLabel: '',
    draftClassLabel: '',
    draftClassMinCapacity: '0',
    draftClassMaxCapacity: '',
    draftStudentLevelIds: {},
    draftTeacherLevelIds: {},
    draftClassAcceptedLevelIds: {},
    draftClassTeacherIds: {},
    draftRuleKind: 'mustNotShareContainer',
    draftRuleLeftId: '',
    draftRuleRightId: '',
    draftPreferenceKind: 'preferShareContainer',
    draftPreferenceLeftId: '',
    draftPreferenceRightId: '',
    draftPreferenceWeight: '1',
    activeSolutionIndex: 0,
    solveMode: 'topK',
    solveMaxSolutions: '10',
    solveTimeLimitMs: '5000',
    solveIncludeScoreDetails: true,
    dataSearch: '',
    bulkStudentLabels: '',
    bulkStudentLevelId: '',
  };
}

function createWeddingPageEditorState() {
  return {
    draftGuestLabel: '',
    draftGroupLabel: '',
    draftTableLabel: '',
    draftTableMinCapacity: '0',
    draftTableMaxCapacity: '',
    draftSeatLabel: '',
    draftSeatTableId: '',
    draftAdjacencyLeftSeatId: '',
    draftAdjacencyRightSeatId: '',
    draftConstraintKind: 'mustShareContainer',
    draftConstraintLeftKind: 'item',
    draftConstraintLeftId: '',
    draftConstraintRightKind: 'item',
    draftConstraintRightId: '',
    draftPreferenceKind: 'preferShareContainer',
    draftPreferenceLeftKind: 'item',
    draftPreferenceLeftId: '',
    draftPreferenceRightKind: 'item',
    draftPreferenceRightId: '',
    draftPreferenceWeight: '1',
    activeSolutionIndex: 0,
    solveMode: 'topK',
    solveMaxSolutions: '10',
    solveTimeLimitMs: '5000',
    solveIncludeScoreDetails: true,
    dataSearch: '',
    bulkGuestLabels: '',
    bulkGuestGroupId: '',
  };
}

function createEventStaffingPageEditorState() {
  return {
    eventSearchText: '',
    selectedGroupTypeId: 'all',
    onlyHeavyEvents: false,
    selectedEventId: '',
    selectedEventIds: [],
    draftSelectedEventLabel: '',
    draftSelectedEventDate: '',
    draftSelectedEventOrderIndex: '',
    draftInsertedEventLabel: '',
    draftInsertedEventDate: '',
    draftInsertedEventPosition: 'after',
    draftRangeStartDate: '',
    draftRangeEndDate: '',
    draftRangeWeekdays: {
      0: true,
      5: true,
      6: true,
    },
    draftRangeLabelTemplate: '{weekday} {day} {monthShort} {year}',
    draftRequirementGroupTypeId: '',
    draftRequirementMin: '0',
    draftRequirementMax: '1',
    draftBulkRequirementGroupTypeId: '',
    draftBulkRequirementMin: '0',
    draftBulkRequirementMax: '1',
    draftGroupTypeLabel: '',
    draftGroupTypeId: '',
    draftPersonName: '',
    draftPersonId: '',
    draftPersonEmail: '',
    draftPersonMaxAssignments: '',
    draftPersonTargetAssignments: '',
    draftPersonMaxAssignmentsPerGroupTypeRows: [],
    draftPersonTargetAssignmentsPerGroupTypeRows: [],
    draftPersonAllowedGroupTypeIds: [],
    draftPersonForbiddenGroupTypeIds: [],
    editingPersonIndex: null,
    draftAssignmentKind: 'forced',
    draftAssignmentPersonId: '',
    draftAssignmentSlotId: '',
    draftAssignmentGroupTypeId: '',
    draftCooldownTriggerGroupTypeId: 'ANY',
    draftCooldownBlockedGroupTypeId: 'ANY',
    draftCooldownCount: '1',
    preferenceMatrixPersonId: '',
    preferenceMatrixDayKey: '',
    preferenceMatrixPeopleFilter: 'all',
    draftGlobalMaxAssignmentsPerPerson: '',
    draftGlobalMaxAssignmentsPerGroupType: '',
    draftGlobalTargetAssignmentsPerGroupType: '',
    administratorRepair: { dateKey: '', selectedCandidateIds: [], selectedCandidateIdsByDate: {} },
  };
}

function isEventStaffingDraft(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.title === 'string'
    && Array.isArray(value.events)
    && Array.isArray(value.groupTypes)
    && Array.isArray(value.requirements)
    && Array.isArray(value.people)
    && value.globalLimits
    && typeof value.globalLimits === 'object'
    && Array.isArray(value.cooldownRules)
    && Array.isArray(value.forcedAssignments)
    && Array.isArray(value.forbiddenAssignments)
    && Array.isArray(value.preferences)
  );
}

function resolveStorage(options) {
  if (options && typeof options.getItem === 'function') {
    return options;
  }
  if (options && Object.hasOwn(options, 'storage')) {
    return options.storage;
  }
  return getBrowserDraftStorage();
}

export function createAppState(options = {}) {
  const draftsEnabled = options?.draftsEnabled !== false;
  const draftStorage = draftsEnabled ? resolveStorage(options) : null;
  const recoverDraft = draftsEnabled
    ? recoverPageDraft
    : ({ fallback }) => ({ data: fallback, persistence: { status: 'idle', message: '' } });
  const generic = recoverDraft({
    storage: draftStorage,
    pageId: 'generic',
    fallback: createEmptyProject({ viewHint: VIEW_HINTS.GENERIC }),
    validate: isProject,
    migrate: migrateProjectModel,
    legacyKey: LEGACY_GENERIC_DRAFT_KEY,
  });
  const school = recoverDraft({
    storage: draftStorage,
    pageId: 'school',
    fallback: createEmptyProject({ viewHint: VIEW_HINTS.SCHOOL, title: 'School scenario' }),
    validate: isProject,
    migrate: migrateProjectModel,
  });
  const wedding = recoverDraft({
    storage: draftStorage,
    pageId: 'wedding',
    fallback: createEmptyProject({ viewHint: VIEW_HINTS.WEDDING, title: 'Wedding plan' }),
    validate: isProject,
    migrate: migrateProjectModel,
  });
  const eventStaffing = recoverDraft({
    storage: draftStorage,
    pageId: 'event-staffing',
    fallback: createMockDomainProject(),
    validate: isEventStaffingDraft,
    migrate: migrateEventStaffingProject,
  });

  const state = {
    currentView: 'generic',
    solverAdapterId: 'firstSolverAdapter',
    genericPage: {
      project: generic.data,
      persistence: generic.persistence,
      editor: createGenericPageEditorState(),
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
      activeWorkflowTab: 'setup',
      solveExecution: createSolveExecutionState(),
    },
    schoolPage: {
      project: school.data,
      persistence: school.persistence,
      editor: createSchoolPageEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
      activeWorkflowTab: 'setup',
      workbookImport: { status: 'idle', error: '', preview: null },
      solveExecution: createSolveExecutionState(),
    },
    weddingPage: {
      project: wedding.data,
      persistence: wedding.persistence,
      editor: createWeddingPageEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
      activeWorkflowTab: 'setup',
      workbookImport: { status: 'idle', error: '', preview: null },
      solveExecution: createSolveExecutionState(),
    },
    eventStaffingPage: {
      domainProject: eventStaffing.data,
      persistence: eventStaffing.persistence,
      editor: createEventStaffingPageEditorState(),
      message: '',
      lastValidation: null,
      lastGenericValidation: null,
      lastTransformedProject: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      activeSolutionIndex: 0,
      activeWorkflowTab: 'setup',
      solveOptions: {
        mode: 'topK',
        maxSolutions: 10,
        timeLimitMs: 5000,
        includeScoreDetails: true,
        scoreWeights: { equity: 100, preferences: 10, targets: 20 },
        diversity: { enabled: true, minimumAssignmentDistance: 2 },
      },
      workbookImport: { status: 'idle', error: '', preview: null },
      validationPanelExpanded: false,
      workflowCommandBarExpanded: true,
      solveExecution: createSolveExecutionState(),
    },
  };

  Object.defineProperty(state, 'draftStorage', { value: draftStorage });
  Object.defineProperty(state, 'draftsEnabled', { value: draftsEnabled });
  return state;
}
