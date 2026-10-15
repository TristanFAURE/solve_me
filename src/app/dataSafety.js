const PROJECT_COLLECTION_KEYS = [
  'items',
  'groups',
  'containers',
  'positions',
  'containments',
  'topologies',
  'constraints',
  'preferences',
  'assignmentExclusions',
  'assignmentCountUpperBounds',
  'fixedAssignments',
  'forbiddenAssignments',
  'softAssignmentScores',
  'softItemCountTargets',
];

const EMPTY_PROJECT_TITLES = {
  generic: 'Untitled project',
  school: 'School scenario',
  wedding: 'Wedding plan',
};

export function hasProjectWork(project) {
  if (!project || typeof project !== 'object') {
    return false;
  }

  if (PROJECT_COLLECTION_KEYS.some((key) => Array.isArray(project[key]) && project[key].length > 0)) {
    return true;
  }

  const emptyTitle = EMPTY_PROJECT_TITLES[project.viewHint] ?? EMPTY_PROJECT_TITLES.generic;
  return Boolean(
    String(project.description ?? '').trim()
    || (String(project.title ?? '').trim() && project.title !== emptyTitle)
    || project.assignmentMode === 'position',
  );
}

export function confirmProjectReplacement(project, message, confirmFn) {
  if (!hasProjectWork(project)) {
    return true;
  }

  const browserConfirm = confirmFn ?? globalThis.confirm;
  return typeof browserConfirm === 'function' && browserConfirm.call(globalThis, message) === true;
}
