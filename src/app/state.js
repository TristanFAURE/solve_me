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
    currentProject: createEmptyProject({ viewHint: VIEW_HINTS.GENERIC }),
    currentView: 'generic',
    solverAdapterId: 'firstSolverAdapter',
    genericPage: {
      editor: createGenericPageEditorState(),
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    },
    schoolPage: {
      editor: createSchoolPageEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    },
    weddingPage: {
      editor: createWeddingPageEditorState(),
      message: '',
      lastValidation: null,
      lastNormalizedProject: null,
      lastSolverResult: null,
      validationPanelExpanded: false,
    },
  };
}
