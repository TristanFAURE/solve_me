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
    derived: {
      adjacencyMap: topology.adjacencyMap,
      mustShareComponents,
    },
  };
}
