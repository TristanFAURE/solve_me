function destinationIdOf(assignment) {
  return assignment?.positionRef?.id ?? assignment?.containerRef?.id ?? null;
}

function buildAssignmentLookup(solution) {
  const lookup = new Map();
  solution.assignments.forEach((assignment) => {
    const destinations = lookup.get(assignment.itemRef.id) ?? [];
    destinations.push(destinationIdOf(assignment));
    lookup.set(assignment.itemRef.id, destinations);
  });
  return lookup;
}

function buildRelationAssignmentLookup(solution, model) {
  const positionContainer = new Map((model.containments ?? [])
    .filter((relation) => relation?.from?.kind === 'container' && relation?.to?.kind === 'position')
    .map((relation) => [relation.to.id, relation.from.id]));
  const lookup = new Map();
  (solution.assignments ?? []).forEach((assignment) => {
    const positionId = assignment.positionRef?.id ?? null;
    const containerId = assignment.containerRef?.id ?? positionContainer.get(positionId) ?? null;
    const values = lookup.get(assignment.itemRef?.id) ?? [];
    values.push({ containerId, positionId });
    lookup.set(assignment.itemRef?.id, values);
  });
  return lookup;
}

function evaluateRelationPreferences(solution, model) {
  const lookup = buildRelationAssignmentLookup(solution, model);
  const adjacencyMap = model.derived?.adjacencyMap ?? new Map();
  return (model.preferences ?? []).reduce((summary, preference) => {
    const left = lookup.get(preference.leftRef?.id) ?? [];
    const right = lookup.get(preference.rightRef?.id) ?? [];
    summary.totalCount += 1;
    summary.totalWeight += preference.weight;
    if (left.length === 0 || right.length === 0) return summary;
    const sharesContainer = left.some((leftAssignment) => right.some(
      (rightAssignment) => leftAssignment.containerId && leftAssignment.containerId === rightAssignment.containerId,
    ));
    const adjacent = left.some((leftAssignment) => right.some((rightAssignment) => (
      leftAssignment.positionId && rightAssignment.positionId
      && adjacencyMap.get(leftAssignment.positionId)?.has(rightAssignment.positionId)
    )));
    const satisfied = preference.kind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER ? sharesContainer
      : preference.kind === PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS ? !sharesContainer
        : preference.kind === PREFERENCE_KINDS.PREFER_ADJACENT ? adjacent
          : preference.kind === PREFERENCE_KINDS.PREFER_NON_ADJACENT ? !adjacent
            : false;
    if (satisfied) {
      summary.satisfiedCount += 1;
      summary.satisfiedWeight += preference.weight;
    }
    return summary;
  }, { satisfiedCount: 0, totalCount: 0, satisfiedWeight: 0, totalWeight: 0 });
}

function getEligibleEquityItemIds(model, options) {
  const configured = options.equityEligibleItemIds
    ?? model.metadata?.equityEligibleItemIds
    ?? null;
  return Array.isArray(configured) ? [...new Set(configured)].sort() : [];
}

export function evaluateObjectives(solution, model, options) {
  const assignments = buildAssignmentLookup(solution);
  const assignmentPreferenceContribution = (model.softAssignmentScores ?? []).reduce((total, entry) => (
    total + ((assignments.get(entry.itemId) ?? []).filter((id) => id === entry.destinationId).length * entry.score)
  ), 0);
  const relationPreferences = evaluateRelationPreferences(solution, model);
  const preferenceContribution = assignmentPreferenceContribution + relationPreferences.satisfiedWeight;
  const targetContribution = (model.softItemCountTargets ?? []).reduce((total, target) => {
    const actual = (assignments.get(target.itemId) ?? [])
      .filter((id) => target.destinationIds?.includes(id)).length;
    return total - Math.abs(actual - target.targetCount);
  }, 0);

  const eligibleItemIds = getEligibleEquityItemIds(model, options);
  let equityContribution = 0;
  for (let left = 0; left < eligibleItemIds.length; left += 1) {
    for (let right = left + 1; right < eligibleItemIds.length; right += 1) {
      equityContribution -= Math.abs(
        (assignments.get(eligibleItemIds[left])?.length ?? 0)
        - (assignments.get(eligibleItemIds[right])?.length ?? 0),
      );
    }
  }

  const weights = {
    preferences: options.scoreWeights.preferences ?? 1,
    targets: options.scoreWeights.targets ?? 1,
    equity: options.scoreWeights.equity ?? 0,
  };
  const details = {
    assignmentScores: preferenceContribution * weights.preferences,
    itemCountTargets: targetContribution * weights.targets,
    equity: equityContribution * weights.equity,
  };
  if (relationPreferences.totalCount > 0) {
    details.relationPreferences = {
      satisfied: relationPreferences.satisfiedCount,
      total: relationPreferences.totalCount,
      satisfiedWeight: relationPreferences.satisfiedWeight,
      totalWeight: relationPreferences.totalWeight,
    };
  }

  return {
    ...details,
    total: details.assignmentScores + details.itemCountTargets + details.equity,
  };
}
import { PREFERENCE_KINDS } from '../core/model/preferences.js';
