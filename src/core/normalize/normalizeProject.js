import { buildTopology } from './buildTopology.js';
import { computeMustShareComponents } from './computeMustShareComponents.js';
import { expandGroupRelations } from './expandGroupRelations.js';

function dedupeBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createSymmetricKey(kind, leftId, rightId) {
  return [kind, leftId, rightId].sort().join('::');
}

function createDestinationPairKey(pair) {
  return [pair.firstDestinationId, pair.secondDestinationId].sort().join('::');
}

function normalizeDestinationIds(destinationIds = []) {
  return [...destinationIds].slice().sort().join('::');
}

export function normalizeProject(project) {
  const expandedProject = expandGroupRelations(project);
  const constraints = dedupeBy(
    expandedProject.constraints,
    (constraint) => createSymmetricKey(constraint.kind, constraint.leftRef.id, constraint.rightRef.id),
  );
  const preferences = dedupeBy(
    expandedProject.preferences,
    (preference) => `${createSymmetricKey(preference.kind, preference.leftRef.id, preference.rightRef.id)}::${preference.weight}`,
  );
  const assignmentExclusions = dedupeBy(
    expandedProject.assignmentExclusions ?? [],
    (exclusion) => `${exclusion.itemId}::${createDestinationPairKey(exclusion)}`,
  );
  const assignmentCountUpperBounds = dedupeBy(
    expandedProject.assignmentCountUpperBounds ?? [],
    (bound) => `${bound.itemId}::${normalizeDestinationIds(bound.destinationIds)}::${bound.maxCount}`,
  );
  const fixedAssignments = dedupeBy(
    expandedProject.fixedAssignments ?? [],
    (assignment) => `${assignment.itemId}::${assignment.destinationId}`,
  );
  const forbiddenAssignments = dedupeBy(
    expandedProject.forbiddenAssignments ?? [],
    (assignment) => `${assignment.itemId}::${assignment.destinationId}`,
  );
  const softAssignmentScores = dedupeBy(
    expandedProject.softAssignmentScores ?? [],
    (score) => `${score.itemId}::${score.destinationId}::${score.score}`,
  );
  const softItemCountTargets = dedupeBy(
    expandedProject.softItemCountTargets ?? [],
    (target) => `${target.itemId}::${normalizeDestinationIds(target.destinationIds)}::${target.targetCount}`,
  );
  const topology = buildTopology({
    ...expandedProject,
    constraints,
    preferences,
  });
  const mustShareComponents = computeMustShareComponents({
    ...expandedProject,
    constraints,
    preferences,
  });

  return {
    ...expandedProject,
    constraints,
    preferences,
    assignmentExclusions,
    assignmentCountUpperBounds,
    fixedAssignments,
    forbiddenAssignments,
    softAssignmentScores,
    softItemCountTargets,
    derived: {
      adjacencyMap: topology.adjacencyMap,
      mustShareComponents,
    },
  };
}
