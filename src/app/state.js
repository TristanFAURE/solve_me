import { createEmptyProject, VIEW_HINTS } from '../core/model/project.js';

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
  };
}

export function createAppState() {
  return {
    currentView: 'generic',
    solverAdapterId: 'firstSolverAdapter',
    genericPage: {
      project: createEmptyProject({ viewHint: VIEW_HINTS.GENERIC }),
      editor: createGenericPageEditorState(),
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    },
    schoolPage: {
      project: createEmptyProject({ viewHint: VIEW_HINTS.SCHOOL, title: 'School scenario' }),
      editor: createSchoolPageEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    },
    weddingPage: {
      project: createEmptyProject({ viewHint: VIEW_HINTS.WEDDING, title: 'Wedding plan' }),
      editor: createWeddingPageEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    },
    eventStaffingPage: {
      domainProject: null,
      editor: null,
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
      commandBarExpanded: true,
    },
  };
}
