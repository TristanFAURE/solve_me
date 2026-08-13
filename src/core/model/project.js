import { ASSIGNMENT_MODES, isAssignmentMode } from './assignmentModes.js';

export const MODEL_VERSION = '0.1.0';
export const VIEW_HINTS = {
  GENERIC: 'generic',
  WEDDING: 'wedding',
  SCHOOL: 'school',
};

export function createEmptyProject(overrides = {}) {
  return {
    projectId: null,
    title: 'Untitled project',
    description: '',
    viewHint: VIEW_HINTS.GENERIC,
    createdAt: null,
    updatedAt: null,
    modelVersion: MODEL_VERSION,
    assignmentMode: ASSIGNMENT_MODES.CONTAINER,
    items: [],
    groups: [],
    containers: [],
    positions: [],
    containments: [],
    topologies: [],
    constraints: [],
    preferences: [],
    assignmentExclusions: [],
    assignmentCountUpperBounds: [],
    fixedAssignments: [],
    forbiddenAssignments: [],
    softAssignmentScores: [],
    softItemCountTargets: [],
    assignmentMultiplicity: 'single',
    ...overrides,
  };
}

export function isViewHint(value) {
  return Object.values(VIEW_HINTS).includes(value);
}

export function isProject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    isAssignmentMode(value.assignmentMode) &&
    Array.isArray(value.items) &&
    Array.isArray(value.groups) &&
    Array.isArray(value.containers) &&
    Array.isArray(value.positions) &&
    Array.isArray(value.containments) &&
    Array.isArray(value.topologies) &&
    Array.isArray(value.constraints) &&
    Array.isArray(value.preferences) &&
    Array.isArray(value.assignmentExclusions) &&
    Array.isArray(value.assignmentCountUpperBounds) &&
    Array.isArray(value.fixedAssignments) &&
    Array.isArray(value.forbiddenAssignments) &&
    Array.isArray(value.softAssignmentScores) &&
    Array.isArray(value.softItemCountTargets) &&
    (value.assignmentMultiplicity === undefined || ['single', 'multiple'].includes(value.assignmentMultiplicity)),
  );
}
