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

function getEligibleEquityItemIds(model, options) {
  const configured = options.equityEligibleItemIds
    ?? model.metadata?.equityEligibleItemIds
    ?? null;
  return Array.isArray(configured) ? [...new Set(configured)].sort() : [];
}

export function evaluateObjectives(solution, model, options) {
  const assignments = buildAssignmentLookup(solution);
  const preferenceContribution = (model.softAssignmentScores ?? []).reduce((total, entry) => (
    total + ((assignments.get(entry.itemId) ?? []).filter((id) => id === entry.destinationId).length * entry.score)
  ), 0);
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

  return {
    ...details,
    total: details.assignmentScores + details.itemCountTargets + details.equity,
  };
}
