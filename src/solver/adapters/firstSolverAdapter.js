import { CONSTRAINT_KINDS } from '../../core/model/constraints.js';
import { createAssignment, createSolution } from '../../core/model/solution.js';
import { ASSIGNMENT_MODES } from '../../core/model/assignmentModes.js';
import { NODE_KINDS } from '../../core/model/nodes.js';
import { SolverAdapter } from '../solverAdapter.js';
import { createDefaultCapabilities } from '../solverCapabilities.js';
import { createSolverResult } from '../solverResult.js';

function buildContainerLookup(containers) {
  return new Map(containers.map((container) => [container.id, container]));
}

function buildItemLookup(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function buildMustNotShareMap(constraints) {
  const map = new Map();

  constraints
    .filter((constraint) => constraint.kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER)
    .forEach((constraint) => {
      const left = map.get(constraint.leftRef.id) ?? new Set();
      left.add(constraint.rightRef.id);
      map.set(constraint.leftRef.id, left);

      const right = map.get(constraint.rightRef.id) ?? new Set();
      right.add(constraint.leftRef.id);
      map.set(constraint.rightRef.id, right);
    });

  return map;
}

function buildComponentLookup(components) {
  const lookup = new Map();
  components.forEach((component, index) => {
    component.forEach((itemId) => {
      lookup.set(itemId, index);
    });
  });
  return lookup;
}

function buildContainerAssignmentSolution(assignmentsByItemId, itemLookup, containerLookup) {
  const assignments = [...assignmentsByItemId.entries()].map(([itemId, containerId]) => createAssignment({
    itemRef: { kind: NODE_KINDS.ITEM, id: itemId },
    containerRef: { kind: NODE_KINDS.CONTAINER, id: containerId },
    positionRef: null,
    metadata: {
      itemLabel: itemLookup.get(itemId)?.label ?? itemId,
      containerLabel: containerLookup.get(containerId)?.label ?? containerId,
    },
  }));

  return createSolution({
    assignments,
    score: null,
    violations: [],
    metadata: {},
  });
}

function buildContainerMultiAssignmentSolution(assignments, itemLookup, containerLookup) {
  return createSolution({
    assignments: assignments.map(({ itemId, containerId }) => createAssignment({
      itemRef: { kind: NODE_KINDS.ITEM, id: itemId },
      containerRef: { kind: NODE_KINDS.CONTAINER, id: containerId },
      positionRef: null,
      metadata: {
        itemLabel: itemLookup.get(itemId)?.label ?? itemId,
        containerLabel: containerLookup.get(containerId)?.label ?? containerId,
      },
    })),
    score: null,
    violations: [],
    metadata: {},
  });
}

function buildAssignmentLookup(solution) {
  const map = new Map();
  solution.assignments.forEach((assignment) => {
    const assignments = map.get(assignment.itemRef.id) ?? [];
    assignments.push(assignment);
    map.set(assignment.itemRef.id, assignments);
  });
  return map;
}

function scoreSolution(solution, model) {
  const assignmentLookup = buildAssignmentLookup(solution);

  const assignmentScoreTotal = (model.softAssignmentScores ?? []).reduce((total, entry) => {
    const assignments = assignmentLookup.get(entry.itemId) ?? [];
    const matchCount = assignments.filter((assignment) => {
      const destinationId = assignment?.positionRef?.id ?? assignment?.containerRef?.id ?? null;
      return destinationId === entry.destinationId;
    }).length;
    return total + (matchCount * entry.score);
  }, 0);

  const itemCountTargetTotal = (model.softItemCountTargets ?? []).reduce((total, target) => {
    const assignments = assignmentLookup.get(target.itemId) ?? [];
    const actualCount = assignments.filter((assignment) => {
      const destinationId = assignment?.positionRef?.id ?? assignment?.containerRef?.id ?? null;
      return target.destinationIds?.includes(destinationId);
    }).length;
    return total - Math.abs(actualCount - target.targetCount);
  }, 0);

  return assignmentScoreTotal + itemCountTargetTotal;
}

function rankAndAnnotateSolutions(solutions, model) {
  if (solutions.length === 0) {
    return solutions;
  }

  return solutions
    .map((solution, index) => ({
      solution: createSolution({
        ...solution,
        score: scoreSolution(solution, model),
      }),
      index,
    }))
    .sort((left, right) => {
      if (right.solution.score !== left.solution.score) {
        return right.solution.score - left.solution.score;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.solution);
}

function pushRankedSolution(solutions, solution, model, maxSolutions) {
  const scoredSolution = createSolution({
    ...solution,
    score: scoreSolution(solution, model),
  });

  let insertIndex = solutions.findIndex((existingSolution) => scoredSolution.score > existingSolution.score);
  if (insertIndex === -1) {
    insertIndex = solutions.length;
  }

  solutions.splice(insertIndex, 0, scoredSolution);

  if (solutions.length > maxSolutions) {
    solutions.pop();
  }
}

function getCurrentScoreThreshold(solutions, maxSolutions) {
  if (solutions.length < maxSolutions) {
    return null;
  }

  return solutions[solutions.length - 1]?.score ?? null;
}

function getIncrementalAssignmentScoreMap(entries = []) {
  const map = new Map();

  entries.forEach((entry) => {
    const entryMap = map.get(entry.itemId) ?? new Map();
    entryMap.set(entry.destinationId, (entryMap.get(entry.destinationId) ?? 0) + entry.score);
    map.set(entry.itemId, entryMap);
  });

  return map;
}

function getIncrementalTargetScoreMap(targets = []) {
  const map = new Map();

  targets.forEach((target) => {
    const targetMap = map.get(target.itemId) ?? [];
    targetMap.push({
      destinationIds: new Set(target.destinationIds ?? []),
      scoreIfAssigned: -Math.abs(1 - target.targetCount),
      scoreIfUnassigned: -Math.abs(target.targetCount),
      bestPossibleScore: Math.max(-Math.abs(1 - target.targetCount), -Math.abs(target.targetCount)),
    });
    map.set(target.itemId, targetMap);
  });

  return map;
}

function getPerItemSoftScoreUpperBounds(items, assignmentScoreMap, targetScoreMap) {
  return new Map(items.map((item) => {
    const assignmentBound = [...(assignmentScoreMap.get(item.id)?.values() ?? [])]
      .reduce((best, score) => Math.max(best, score), 0);
    const targetBound = (targetScoreMap.get(item.id) ?? [])
      .reduce((total, target) => total + target.bestPossibleScore, 0);

    return [item.id, assignmentBound + targetBound];
  }));
}

function getIncrementalScoreForDestination(itemId, destinationId, assignmentScoreMap, targetScoreMap) {
  const assignmentScore = assignmentScoreMap.get(itemId)?.get(destinationId) ?? 0;
  const targetScore = (targetScoreMap.get(itemId) ?? []).reduce((total, target) => (
    total + (target.destinationIds.has(destinationId) ? target.scoreIfAssigned : target.scoreIfUnassigned)
  ), 0);

  return assignmentScore + targetScore;
}

function buildSuffixUpperBounds(itemIds, perItemSoftScoreUpperBounds) {
  const suffixUpperBounds = new Map();
  let runningTotal = 0;

  for (let index = itemIds.length - 1; index >= 0; index -= 1) {
    runningTotal += perItemSoftScoreUpperBounds.get(itemIds[index]) ?? 0;
    suffixUpperBounds.set(index, runningTotal);
  }

  suffixUpperBounds.set(itemIds.length, 0);
  return suffixUpperBounds;
}

function buildComponentSoftScoreOptions(components, containerIds, assignmentScoreMap, targetScoreMap) {
  return components.map((component) => containerIds.map((containerId) => ({
    containerId,
    score: component.reduce((total, itemId) => (
      total + getIncrementalScoreForDestination(itemId, containerId, assignmentScoreMap, targetScoreMap)
    ), 0),
  })));
}

function buildSingleAssignmentMapFromEntries(assignments) {
  const map = new Map();
  assignments.forEach(({ itemId, containerId }) => {
    map.set(itemId, containerId);
  });
  return map;
}

function getAssignedDestinationIds(assignmentsByItemId, itemId) {
  return assignmentsByItemId.get(itemId) ?? [];
}

function isDestinationAlreadyAssigned(assignmentsByItemId, itemId, destinationId) {
  return getAssignedDestinationIds(assignmentsByItemId, itemId).includes(destinationId);
}

function getCurrentContainerForSingleAssignment(itemId, assignmentsByItemId) {
  return assignmentsByItemId.get(itemId) ?? null;
}

function buildComponentSuffixUpperBounds(componentSoftScoreOptions) {
  const suffixUpperBounds = new Map();
  let runningTotal = 0;

  for (let index = componentSoftScoreOptions.length - 1; index >= 0; index -= 1) {
    const bestOptionScore = componentSoftScoreOptions[index]
      .reduce((best, option) => Math.max(best, option.score), Number.NEGATIVE_INFINITY);
    runningTotal += Number.isFinite(bestOptionScore) ? bestOptionScore : 0;
    suffixUpperBounds.set(index, runningTotal);
  }

  suffixUpperBounds.set(componentSoftScoreOptions.length, 0);
  return suffixUpperBounds;
}

function buildPositionLookup(positions) {
  return new Map(positions.map((position) => [position.id, position]));
}

function buildPositionToContainerMap(containments) {
  const map = new Map();

  containments
    .filter((relation) => relation?.from?.kind === NODE_KINDS.CONTAINER && relation?.to?.kind === NODE_KINDS.POSITION)
    .forEach((relation) => {
      map.set(relation.to.id, relation.from.id);
    });

  return map;
}

function buildContainerToPositionsMap(positions, positionToContainerMap) {
  const map = new Map();

  positions.forEach((position) => {
    const containerId = positionToContainerMap.get(position.id);
    if (!containerId) {
      return;
    }

    const entries = map.get(containerId) ?? [];
    entries.push(position.id);
    map.set(containerId, entries);
  });

  return map;
}

function buildConstraintPairMap(constraints, kind) {
  const map = new Map();

  constraints
    .filter((constraint) => constraint.kind === kind)
    .forEach((constraint) => {
      const left = map.get(constraint.leftRef.id) ?? new Set();
      left.add(constraint.rightRef.id);
      map.set(constraint.leftRef.id, left);

      const right = map.get(constraint.rightRef.id) ?? new Set();
      right.add(constraint.leftRef.id);
      map.set(constraint.rightRef.id, right);
    });

  return map;
}

function buildPositionAssignmentSolution(assignmentsByItemId, itemLookup, positionLookup, containerLookup, positionToContainerMap) {
  const assignments = [...assignmentsByItemId.entries()].map(([itemId, positionId]) => {
    const containerId = positionToContainerMap.get(positionId) ?? null;
    return createAssignment({
      itemRef: { kind: NODE_KINDS.ITEM, id: itemId },
      containerRef: containerId ? { kind: NODE_KINDS.CONTAINER, id: containerId } : null,
      positionRef: { kind: NODE_KINDS.POSITION, id: positionId },
      metadata: {
        itemLabel: itemLookup.get(itemId)?.label ?? itemId,
        positionLabel: positionLookup.get(positionId)?.label ?? positionId,
        containerLabel: containerId ? (containerLookup.get(containerId)?.label ?? containerId) : null,
      },
    });
  });

  return createSolution({
    assignments,
    score: null,
    violations: [],
    metadata: {},
  });
}

function normalizeComponents(model) {
  const mustShareComponents = model.derived?.mustShareComponents ?? [];
  const componentLookup = buildComponentLookup(mustShareComponents);
  const coveredItemIds = new Set(componentLookup.keys());
  const singletonComponents = model.items
    .filter((item) => !coveredItemIds.has(item.id))
    .map((item) => [item.id]);

  return [...mustShareComponents, ...singletonComponents];
}

function getComponentDemand(component) {
  return component.length;
}

function buildAllowedContainerMap(items) {
  return new Map(items.map((item) => [
    item.id,
    Array.isArray(item.metadata?.allowedContainerIds) ? item.metadata.allowedContainerIds : null,
  ]));
}

function buildForbiddenContainerMap(items) {
  return new Map(items.map((item) => [
    item.id,
    Array.isArray(item.metadata?.forbiddenContainerIds) ? item.metadata.forbiddenContainerIds : [],
  ]));
}

function buildFixedAssignmentMap(fixedAssignments = []) {
  const map = new Map();

  fixedAssignments.forEach((assignment) => {
    const destinations = map.get(assignment.itemId) ?? new Set();
    destinations.add(assignment.destinationId);
    map.set(assignment.itemId, destinations);
  });

  return map;
}

function buildForbiddenAssignmentMap(forbiddenAssignments = []) {
  const map = new Map();

  forbiddenAssignments.forEach((assignment) => {
    const destinations = map.get(assignment.itemId) ?? new Set();
    destinations.add(assignment.destinationId);
    map.set(assignment.itemId, destinations);
  });

  return map;
}

function buildAssignmentExclusionMap(assignmentExclusions = []) {
  const map = new Map();

  assignmentExclusions.forEach((exclusion) => {
    const destinationMap = map.get(exclusion.itemId) ?? new Map();

    const firstBlocked = destinationMap.get(exclusion.firstDestinationId) ?? new Set();
    firstBlocked.add(exclusion.secondDestinationId);
    destinationMap.set(exclusion.firstDestinationId, firstBlocked);

    const secondBlocked = destinationMap.get(exclusion.secondDestinationId) ?? new Set();
    secondBlocked.add(exclusion.firstDestinationId);
    destinationMap.set(exclusion.secondDestinationId, secondBlocked);

    map.set(exclusion.itemId, destinationMap);
  });

  return map;
}

function buildAssignmentCountUpperBoundMap(bounds = []) {
  const map = new Map();

  bounds.forEach((bound) => {
    const itemBounds = map.get(bound.itemId) ?? [];
    itemBounds.push({
      destinationIds: new Set(bound.destinationIds ?? []),
      maxCount: bound.maxCount,
    });
    map.set(bound.itemId, itemBounds);
  });

  return map;
}

function hasConflictingFixedAssignments(fixedAssignmentMap, assignmentMultiplicity = 'single') {
  if (assignmentMultiplicity === 'multiple') {
    return false;
  }

  return [...fixedAssignmentMap.values()].some((destinations) => destinations.size > 1);
}

function getSingleFixedDestinationId(fixedAssignmentMap, itemId) {
  const destinations = fixedAssignmentMap.get(itemId);
  if (!destinations || destinations.size === 0) {
    return null;
  }

  return [...destinations][0] ?? null;
}

function respectsAssignmentCountUpperBounds(assignmentsByItemId, itemId, destinationId, assignmentCountUpperBoundMap) {
  const bounds = assignmentCountUpperBoundMap.get(itemId) ?? [];
  const assignedDestinationIds = assignmentsByItemId.get(itemId) ?? [];

  return bounds.every((bound) => {
    const currentCount = assignedDestinationIds.filter((assignedDestinationId) => bound.destinationIds.has(assignedDestinationId)).length;
    const nextCount = currentCount + (bound.destinationIds.has(destinationId) ? 1 : 0);
    return nextCount <= bound.maxCount;
  });
}

function getContainerMinCapacity(container) {
  return container?.metadata?.minCapacity ?? 0;
}

function getContainerMaxCapacity(container) {
  return container?.metadata?.maxCapacity;
}

function canStillSatisfyRemainingMinCapacities(containerLoads, containerIds, containerLookup, remainingAssignmentCapacity) {
  let totalShortfall = 0;

  for (const containerId of containerIds) {
    const container = containerLookup.get(containerId);
    const minCapacity = getContainerMinCapacity(container);
    const currentLoad = containerLoads.get(containerId) ?? 0;
    totalShortfall += Math.max(0, minCapacity - currentLoad);
  }

  return totalShortfall <= remainingAssignmentCapacity;
}

function allContainerMinCapacitiesSatisfied(containerLoads, containerIds, containerLookup) {
  return containerIds.every((containerId) => {
    const container = containerLookup.get(containerId);
    const minCapacity = getContainerMinCapacity(container);
    const currentLoad = containerLoads.get(containerId) ?? 0;
    return currentLoad >= minCapacity;
  });
}

function canPlaceComponent(
  component,
  containerId,
  assignmentsByItemId,
  mustNotShareMap,
  containerLoads,
  containerLookup,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentCountUpperBoundMap,
) {
  const container = containerLookup.get(containerId);
  if (!container) {
    return false;
  }

  const maxCapacity = getContainerMaxCapacity(container);
  const nextLoad = (containerLoads.get(containerId) ?? 0) + getComponentDemand(component);
  if (maxCapacity !== null && maxCapacity !== undefined && nextLoad > maxCapacity) {
    return false;
  }

  for (const itemId of component) {
    const allowedContainerIds = allowedContainerMap.get(itemId);
    const forbiddenContainerIds = forbiddenContainerMap.get(itemId) ?? [];
    const fixedDestinationId = getSingleFixedDestinationId(fixedAssignmentMap, itemId);
    const forbiddenDestinationIds = forbiddenAssignmentMap.get(itemId) ?? new Set();

    if (Array.isArray(allowedContainerIds) && allowedContainerIds.length > 0 && !allowedContainerIds.includes(containerId)) {
      return false;
    }

    if (forbiddenContainerIds.includes(containerId)) {
      return false;
    }

    if (fixedDestinationId && fixedDestinationId !== containerId) {
      return false;
    }

    if (forbiddenDestinationIds.has(containerId)) {
      return false;
    }

    if (!respectsAssignmentCountUpperBounds(assignmentsByItemId, itemId, containerId, assignmentCountUpperBoundMap)) {
      return false;
    }

    for (const blockedId of mustNotShareMap.get(itemId) ?? []) {
      if (getCurrentContainerForSingleAssignment(blockedId, assignmentsByItemId) === containerId) {
        return false;
      }
    }
  }

  return true;
}

function placeComponent(component, containerId, assignmentsByItemId, containerLoads) {
  component.forEach((itemId) => {
    assignmentsByItemId.set(itemId, containerId);
  });
  containerLoads.set(containerId, (containerLoads.get(containerId) ?? 0) + getComponentDemand(component));
}

function unplaceComponent(component, containerId, assignmentsByItemId, containerLoads) {
  component.forEach((itemId) => {
    assignmentsByItemId.delete(itemId);
  });
  containerLoads.set(containerId, (containerLoads.get(containerId) ?? 0) - getComponentDemand(component));
}

function searchAssignments({
  components,
  componentIndex,
  containerIds,
  assignmentsByItemId,
  mustNotShareMap,
  containerLoads,
  containerLookup,
  solutions,
  maxSolutions,
  itemLookup,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentCountUpperBoundMap,
  model,
  componentSoftScoreOptions,
  componentSuffixUpperBounds,
  currentScore,
}) {
  const scoreThreshold = getCurrentScoreThreshold(solutions, maxSolutions);
  const optimisticRemainingScore = componentSuffixUpperBounds.get(componentIndex) ?? 0;
  if (scoreThreshold !== null && currentScore + optimisticRemainingScore < scoreThreshold) {
    return;
  }

  if (componentIndex >= components.length) {
    if (allContainerMinCapacitiesSatisfied(containerLoads, containerIds, containerLookup)) {
      pushRankedSolution(solutions, buildContainerAssignmentSolution(assignmentsByItemId, itemLookup, containerLookup), model, maxSolutions);
    }
    return;
  }

  const remainingDemand = components
    .slice(componentIndex)
    .reduce((total, component) => total + getComponentDemand(component), 0);

  if (!canStillSatisfyRemainingMinCapacities(containerLoads, containerIds, containerLookup, remainingDemand)) {
    return;
  }

  const component = components[componentIndex];
  const rankedOptions = (componentSoftScoreOptions[componentIndex] ?? [])
    .slice()
    .sort((left, right) => right.score - left.score);

  for (const { containerId, score } of rankedOptions) {
    if (!canPlaceComponent(
      component,
      containerId,
      assignmentsByItemId,
      mustNotShareMap,
      containerLoads,
      containerLookup,
      allowedContainerMap,
      forbiddenContainerMap,
      fixedAssignmentMap,
      forbiddenAssignmentMap,
      assignmentCountUpperBoundMap,
    )) {
      continue;
    }

    placeComponent(component, containerId, assignmentsByItemId, containerLoads);

    const remainingDemandAfterPlacement = components
      .slice(componentIndex + 1)
      .reduce((total, remainingComponent) => total + getComponentDemand(remainingComponent), 0);

    if (canStillSatisfyRemainingMinCapacities(containerLoads, containerIds, containerLookup, remainingDemandAfterPlacement)) {
      searchAssignments({
        components,
        componentIndex: componentIndex + 1,
        containerIds,
        assignmentsByItemId,
        mustNotShareMap,
        containerLoads,
        containerLookup,
        solutions,
        maxSolutions,
        itemLookup,
        allowedContainerMap,
        forbiddenContainerMap,
        fixedAssignmentMap,
        forbiddenAssignmentMap,
        assignmentCountUpperBoundMap,
        model,
        componentSoftScoreOptions,
        componentSuffixUpperBounds,
        currentScore: currentScore + score,
      });
    }
    unplaceComponent(component, containerId, assignmentsByItemId, containerLoads);
  }
}

function getAssignedContainerId(itemId, assignmentsByItemId, positionToContainerMap) {
  const positionId = assignmentsByItemId.get(itemId);
  return positionId ? (positionToContainerMap.get(positionId) ?? null) : null;
}

function canAddMultiAssignment({
  itemId,
  containerId,
  assignmentsByItemId,
  mustNotShareMap,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentExclusionMap,
  assignmentCountUpperBoundMap,
}) {
  const allowedContainerIds = allowedContainerMap.get(itemId);
  const forbiddenContainerIds = forbiddenContainerMap.get(itemId) ?? [];
  const fixedDestinationIds = fixedAssignmentMap.get(itemId) ?? new Set();
  const forbiddenDestinationIds = forbiddenAssignmentMap.get(itemId) ?? new Set();
  const assignedDestinationIds = getAssignedDestinationIds(assignmentsByItemId, itemId);

  if (Array.isArray(allowedContainerIds) && allowedContainerIds.length > 0 && !allowedContainerIds.includes(containerId)) {
    return false;
  }

  if (forbiddenContainerIds.includes(containerId)) {
    return false;
  }

  if (forbiddenDestinationIds.has(containerId)) {
    return false;
  }

  if (isDestinationAlreadyAssigned(assignmentsByItemId, itemId, containerId)) {
    return false;
  }

  if (!respectsAssignmentCountUpperBounds(assignmentsByItemId, itemId, containerId, assignmentCountUpperBoundMap)) {
    return false;
  }

  const blockedDestinationMap = assignmentExclusionMap.get(itemId) ?? new Map();
  if (assignedDestinationIds.some((assignedDestinationId) => (blockedDestinationMap.get(containerId) ?? new Set()).has(assignedDestinationId))) {
    return false;
  }

  if (fixedDestinationIds.size > 0) {
    const fixedDestinationsAlreadyAssigned = [...fixedDestinationIds].filter((destinationId) => assignedDestinationIds.includes(destinationId)).length;
    const fixedDestinationsRemaining = fixedDestinationIds.size - fixedDestinationsAlreadyAssigned;
    if (!fixedDestinationIds.has(containerId) && fixedDestinationsRemaining > 0) {
      return false;
    }
  }

  for (const blockedItemId of mustNotShareMap.get(itemId) ?? []) {
    if (isDestinationAlreadyAssigned(assignmentsByItemId, blockedItemId, containerId)) {
      return false;
    }
  }

  return true;
}

function getCandidateDestinationIdsForItem({
  itemId,
  destinationIds,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  containerLoads,
  containerLookup,
  assignmentScoreMap,
  targetScoreMap,
}) {
  return destinationIds
    .filter((destinationId) => {
      const forbiddenContainerIds = forbiddenContainerMap.get(itemId) ?? [];
      const forbiddenDestinationIds = forbiddenAssignmentMap.get(itemId) ?? new Set();
      const allowedContainerIds = allowedContainerMap.get(itemId);
      const fixedDestinationIds = fixedAssignmentMap.get(itemId) ?? new Set();

      if (forbiddenContainerIds.includes(destinationId) || forbiddenDestinationIds.has(destinationId)) {
        return false;
      }

      if (Array.isArray(allowedContainerIds) && allowedContainerIds.length > 0 && !allowedContainerIds.includes(destinationId)) {
        return false;
      }

      if (fixedDestinationIds.size > 0 && !fixedDestinationIds.has(destinationId)) {
        return false;
      }

      const nextLoad = (containerLoads.get(destinationId) ?? 0) + 1;
      const maxCapacity = getContainerMaxCapacity(containerLookup.get(destinationId));
      if (maxCapacity !== null && maxCapacity !== undefined && nextLoad > maxCapacity) {
        return false;
      }

      return true;
    })
    .slice()
    .sort((leftDestinationId, rightDestinationId) => {
      const leftScore = getIncrementalScoreForDestination(itemId, leftDestinationId, assignmentScoreMap, targetScoreMap);
      const rightScore = getIncrementalScoreForDestination(itemId, rightDestinationId, assignmentScoreMap, targetScoreMap);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      const leftLoad = containerLoads.get(leftDestinationId) ?? 0;
      const rightLoad = containerLoads.get(rightDestinationId) ?? 0;
      if (leftLoad !== rightLoad) {
        return leftLoad - rightLoad;
      }

      return String(leftDestinationId).localeCompare(String(rightDestinationId));
    });
}

function getMaxAdditionalAssignmentsForItem(itemId, destinationIds, assignmentsByItemId, assignmentCountUpperBoundMap) {
  const assignedDestinationIds = getAssignedDestinationIds(assignmentsByItemId, itemId);
  const bounds = assignmentCountUpperBoundMap.get(itemId) ?? [];
  let maxAdditionalAssignments = destinationIds.length;

  bounds.forEach((bound) => {
    const relevantDestinationIds = destinationIds.filter((destinationId) => bound.destinationIds.has(destinationId));
    if (relevantDestinationIds.length === 0) {
      return;
    }

    const currentCount = assignedDestinationIds.filter((assignedDestinationId) => bound.destinationIds.has(assignedDestinationId)).length;
    maxAdditionalAssignments = Math.min(maxAdditionalAssignments, Math.max(0, bound.maxCount - currentCount));
  });

  return maxAdditionalAssignments;
}

function getRequiredDestinationIdsForItem(itemId, candidateDestinationIds, containerLoads, containerLookup) {
  return candidateDestinationIds.filter((destinationId) => {
    const minCapacity = getContainerMinCapacity(containerLookup.get(destinationId));
    const currentLoad = containerLoads.get(destinationId) ?? 0;
    return currentLoad < minCapacity;
  });
}

function getGreedyAssignmentSubsetForItem({
  itemId,
  candidateDestinationIds,
  assignmentsByItemId,
  mustNotShareMap,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentExclusionMap,
  assignmentCountUpperBoundMap,
  assignmentScoreMap,
  targetScoreMap,
  containerLoads,
  containerLookup,
}) {
  const baseAssignedDestinationIds = getAssignedDestinationIds(assignmentsByItemId, itemId);
  const fixedDestinationIds = fixedAssignmentMap.get(itemId) ?? new Set();
  const candidateSet = new Set(candidateDestinationIds);
  const unassignedFixedDestinationIds = [...fixedDestinationIds]
    .filter((destinationId) => candidateSet.has(destinationId) && !baseAssignedDestinationIds.includes(destinationId));
  const maxAdditionalAssignments = getMaxAdditionalAssignmentsForItem(
    itemId,
    candidateDestinationIds,
    assignmentsByItemId,
    assignmentCountUpperBoundMap,
  );

  if (unassignedFixedDestinationIds.length > maxAdditionalAssignments) {
    return null;
  }

  const prioritizedDestinationIds = candidateDestinationIds
    .map((destinationId) => {
      const minCapacity = getContainerMinCapacity(containerLookup.get(destinationId));
      const currentLoad = containerLoads.get(destinationId) ?? 0;
      const remainingNeed = Math.max(0, minCapacity - currentLoad);
      return {
        destinationId,
        remainingNeed,
        score: getIncrementalScoreForDestination(itemId, destinationId, assignmentScoreMap, targetScoreMap),
      };
    })
    .sort((left, right) => {
      if (right.remainingNeed !== left.remainingNeed) {
        return right.remainingNeed - left.remainingNeed;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(left.destinationId).localeCompare(String(right.destinationId));
    })
    .map((entry) => entry.destinationId);

  const provisionalAssignmentsByItemId = new Map(assignmentsByItemId);
  const chosenDestinationIds = [];
  let score = 0;

  const tryAddDestination = (containerId) => {
    if (chosenDestinationIds.includes(containerId)) {
      return true;
    }

    if (!canAddMultiAssignment({
      itemId,
      containerId,
      assignmentsByItemId: provisionalAssignmentsByItemId,
      mustNotShareMap,
      allowedContainerMap,
      forbiddenContainerMap,
      fixedAssignmentMap,
      forbiddenAssignmentMap,
      assignmentExclusionMap,
      assignmentCountUpperBoundMap,
    })) {
      return false;
    }

    provisionalAssignmentsByItemId.set(itemId, [
      ...(provisionalAssignmentsByItemId.get(itemId) ?? []),
      containerId,
    ]);
    chosenDestinationIds.push(containerId);
    score += getIncrementalScoreForDestination(itemId, containerId, assignmentScoreMap, targetScoreMap);
    return true;
  };

  for (const containerId of unassignedFixedDestinationIds) {
    if (!tryAddDestination(containerId)) {
      return null;
    }
  }

  const requiredDestinationIds = getRequiredDestinationIdsForItem(
    itemId,
    prioritizedDestinationIds,
    containerLoads,
    containerLookup,
  );

  for (const containerId of requiredDestinationIds) {
    if (chosenDestinationIds.length >= maxAdditionalAssignments) {
      break;
    }
    if (!tryAddDestination(containerId)) {
      continue;
    }
  }

  for (const containerId of prioritizedDestinationIds) {
    if (chosenDestinationIds.length >= maxAdditionalAssignments) {
      break;
    }
    tryAddDestination(containerId);
  }

  return {
    destinationIds: chosenDestinationIds,
    score,
  };
}

function canStillCoverMinCapacitiesWithRemainingItems({
  containerLoads,
  destinationIds,
  containerLookup,
  remainingItemIds,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentCountUpperBoundMap,
}) {
  const coverableCounts = new Map(destinationIds.map((destinationId) => [destinationId, 0]));

  remainingItemIds.forEach((itemId) => {
    const allowedContainerIds = allowedContainerMap.get(itemId);
    const forbiddenContainerIds = forbiddenContainerMap.get(itemId) ?? [];
    const fixedDestinationIds = fixedAssignmentMap.get(itemId) ?? new Set();
    const forbiddenDestinationIds = forbiddenAssignmentMap.get(itemId) ?? new Set();
    let itemCanCoverCount = 0;

    destinationIds.forEach((destinationId) => {
      if (forbiddenContainerIds.includes(destinationId) || forbiddenDestinationIds.has(destinationId)) {
        return;
      }

      if (Array.isArray(allowedContainerIds) && allowedContainerIds.length > 0 && !allowedContainerIds.includes(destinationId)) {
        return;
      }

      if (fixedDestinationIds.size > 0 && !fixedDestinationIds.has(destinationId)) {
        return;
      }

      const maxCapacity = getContainerMaxCapacity(containerLookup.get(destinationId));
      const currentLoad = containerLoads.get(destinationId) ?? 0;
      if (maxCapacity !== null && maxCapacity !== undefined && currentLoad >= maxCapacity) {
        return;
      }

      coverableCounts.set(destinationId, (coverableCounts.get(destinationId) ?? 0) + 1);
      itemCanCoverCount += 1;
    });

    const bounds = assignmentCountUpperBoundMap.get(itemId) ?? [];
    const globalMaxAssignments = bounds
      .filter((bound) => bound.destinationIds.size === destinationIds.length)
      .reduce((best, bound) => Math.min(best, bound.maxCount), Number.POSITIVE_INFINITY);

    if (Number.isFinite(globalMaxAssignments) && itemCanCoverCount > globalMaxAssignments) {
      let removable = itemCanCoverCount - globalMaxAssignments;
      for (const destinationId of [...destinationIds].reverse()) {
        if (removable <= 0) {
          break;
        }
        const count = coverableCounts.get(destinationId) ?? 0;
        if (count > 0) {
          coverableCounts.set(destinationId, count - 1);
          removable -= 1;
        }
      }
    }
  });

  return destinationIds.every((destinationId) => {
    const minCapacity = getContainerMinCapacity(containerLookup.get(destinationId));
    const currentLoad = containerLoads.get(destinationId) ?? 0;
    const remainingNeed = Math.max(0, minCapacity - currentLoad);
    return (coverableCounts.get(destinationId) ?? 0) >= remainingNeed;
  });
}

function searchMultipleContainerAssignments({
  itemIds,
  destinationIds,
  itemIndex,
  assignmentsByItemId,
  assignmentEntries,
  containerLoads,
  containerLookup,
  mustNotShareMap,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentExclusionMap,
  assignmentCountUpperBoundMap,
  itemLookup,
  solutions,
  maxSolutions,
  model,
  currentScore,
  assignmentScoreMap,
  targetScoreMap,
}) {
  if (itemIndex >= itemIds.length) {
    const allFixedAssignmentsSatisfied = [...fixedAssignmentMap.entries()].every(([itemId, requiredDestinationIds]) => {
      const assignedDestinationIds = new Set(getAssignedDestinationIds(assignmentsByItemId, itemId));
      return [...requiredDestinationIds].every((destinationId) => assignedDestinationIds.has(destinationId));
    });

    if (!allFixedAssignmentsSatisfied) {
      return;
    }

    if (allContainerMinCapacitiesSatisfied(containerLoads, destinationIds, containerLookup)) {
      pushRankedSolution(
        solutions,
        buildContainerMultiAssignmentSolution(assignmentEntries, itemLookup, containerLookup),
        model,
        maxSolutions,
      );
    }
    return;
  }

  const remainingItemIds = itemIds.slice(itemIndex);
  if (!canStillCoverMinCapacitiesWithRemainingItems({
    containerLoads,
    destinationIds,
    containerLookup,
    remainingItemIds,
    allowedContainerMap,
    forbiddenContainerMap,
    fixedAssignmentMap,
    forbiddenAssignmentMap,
    assignmentCountUpperBoundMap,
  })) {
    return;
  }

  const itemId = itemIds[itemIndex];
  const candidateDestinationIds = getCandidateDestinationIdsForItem({
    itemId,
    destinationIds,
    allowedContainerMap,
    forbiddenContainerMap,
    fixedAssignmentMap,
    forbiddenAssignmentMap,
    containerLoads,
    containerLookup,
    assignmentScoreMap,
    targetScoreMap,
  });

  const subset = getGreedyAssignmentSubsetForItem({
    itemId,
    candidateDestinationIds,
    assignmentsByItemId,
    mustNotShareMap,
    allowedContainerMap,
    forbiddenContainerMap,
    fixedAssignmentMap,
    forbiddenAssignmentMap,
    assignmentExclusionMap,
    assignmentCountUpperBoundMap,
    assignmentScoreMap,
    targetScoreMap,
    containerLoads,
    containerLookup,
  });

  if (!subset) {
    return;
  }

  subset.destinationIds.forEach((containerId) => {
    const nextAssignedDestinationIds = getAssignedDestinationIds(assignmentsByItemId, itemId);
    assignmentsByItemId.set(itemId, [...nextAssignedDestinationIds, containerId]);
    assignmentEntries.push({ itemId, containerId });
    containerLoads.set(containerId, (containerLoads.get(containerId) ?? 0) + 1);
  });

  const nextRemainingItemIds = itemIds.slice(itemIndex + 1);
  const canCoverRemainingDemand = canStillCoverMinCapacitiesWithRemainingItems({
    containerLoads,
    destinationIds,
    containerLookup,
    remainingItemIds: nextRemainingItemIds,
    allowedContainerMap,
    forbiddenContainerMap,
    fixedAssignmentMap,
    forbiddenAssignmentMap,
    assignmentCountUpperBoundMap,
  });

  if (canCoverRemainingDemand) {
    searchMultipleContainerAssignments({
      itemIds,
      destinationIds,
      itemIndex: itemIndex + 1,
      assignmentsByItemId,
      assignmentEntries,
      containerLoads,
      containerLookup,
      mustNotShareMap,
      allowedContainerMap,
      forbiddenContainerMap,
      fixedAssignmentMap,
      forbiddenAssignmentMap,
      assignmentExclusionMap,
      assignmentCountUpperBoundMap,
      itemLookup,
      solutions,
      maxSolutions,
      model,
      currentScore: currentScore + subset.score,
      assignmentScoreMap,
      targetScoreMap,
    });
  }

  for (let index = subset.destinationIds.length - 1; index >= 0; index -= 1) {
    const containerId = subset.destinationIds[index];
    assignmentEntries.pop();
    containerLoads.set(containerId, (containerLoads.get(containerId) ?? 0) - 1);
  }

  const previousAssignments = getAssignedDestinationIds(assignmentsByItemId, itemId)
    .filter((destinationId) => !subset.destinationIds.includes(destinationId));
  assignmentsByItemId.set(itemId, previousAssignments);
}

function canPlaceItemInPosition({
  itemId,
  positionId,
  assignmentsByItemId,
  assignedPositionIds,
  mustShareMap,
  mustNotShareMap,
  mustBeAdjacentMap,
  mustNotBeAdjacentMap,
  adjacencyMap,
  positionToContainerMap,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentExclusionMap,
  assignmentCountUpperBoundMap,
}) {
  if (assignedPositionIds.has(positionId)) {
    return false;
  }

  const containerId = positionToContainerMap.get(positionId);
  if (!containerId) {
    return false;
  }

  const allowedContainerIds = allowedContainerMap.get(itemId);
  const forbiddenContainerIds = forbiddenContainerMap.get(itemId) ?? [];
  const fixedDestinationId = getSingleFixedDestinationId(fixedAssignmentMap, itemId);
  const forbiddenDestinationIds = forbiddenAssignmentMap.get(itemId) ?? new Set();

  if (Array.isArray(allowedContainerIds) && allowedContainerIds.length > 0 && !allowedContainerIds.includes(containerId)) {
    return false;
  }

  if (forbiddenContainerIds.includes(containerId)) {
    return false;
  }

  if (fixedDestinationId && fixedDestinationId !== positionId) {
    return false;
  }

  if (forbiddenDestinationIds.has(positionId)) {
    return false;
  }

  if (!respectsAssignmentCountUpperBounds(assignmentsByItemId, itemId, positionId, assignmentCountUpperBoundMap)) {
    return false;
  }

  const blockedDestinationIds = (assignmentExclusionMap.get(itemId) ?? new Map()).get(positionId) ?? new Set();
  const assignedDestinationId = assignmentsByItemId.get(itemId);
  if (assignedDestinationId && blockedDestinationIds.has(assignedDestinationId)) {
    return false;
  }

  for (const relatedItemId of mustShareMap.get(itemId) ?? []) {
    const relatedContainerId = getAssignedContainerId(relatedItemId, assignmentsByItemId, positionToContainerMap);
    if (relatedContainerId && relatedContainerId !== containerId) {
      return false;
    }
  }

  for (const blockedItemId of mustNotShareMap.get(itemId) ?? []) {
    const blockedContainerId = getAssignedContainerId(blockedItemId, assignmentsByItemId, positionToContainerMap);
    if (blockedContainerId && blockedContainerId === containerId) {
      return false;
    }
  }

  const neighbors = adjacencyMap.get(positionId) ?? new Set();

  for (const relatedItemId of mustBeAdjacentMap.get(itemId) ?? []) {
    const relatedPositionId = assignmentsByItemId.get(relatedItemId);
    if (relatedPositionId && !neighbors.has(relatedPositionId)) {
      return false;
    }
  }

  for (const blockedItemId of mustNotBeAdjacentMap.get(itemId) ?? []) {
    const blockedPositionId = assignmentsByItemId.get(blockedItemId);
    if (blockedPositionId && neighbors.has(blockedPositionId)) {
      return false;
    }
  }

  return true;
}

function searchPositionAssignments({
  itemIds,
  itemIndex,
  candidatePositionIdsByItemId,
  assignmentsByItemId,
  assignedPositionIds,
  mustShareMap,
  mustNotShareMap,
  mustBeAdjacentMap,
  mustNotBeAdjacentMap,
  adjacencyMap,
  positionToContainerMap,
  solutions,
  maxSolutions,
  itemLookup,
  positionLookup,
  containerLookup,
  allowedContainerMap,
  forbiddenContainerMap,
  fixedAssignmentMap,
  forbiddenAssignmentMap,
  assignmentExclusionMap,
  assignmentCountUpperBoundMap,
  model,
  assignmentScoreMap,
  targetScoreMap,
  suffixUpperBounds,
  currentScore,
}) {
  const scoreThreshold = getCurrentScoreThreshold(solutions, maxSolutions);
  const optimisticRemainingScore = suffixUpperBounds.get(itemIndex) ?? 0;
  if (scoreThreshold !== null && currentScore + optimisticRemainingScore < scoreThreshold) {
    return;
  }

  if (itemIndex >= itemIds.length) {
    pushRankedSolution(solutions, buildPositionAssignmentSolution(assignmentsByItemId, itemLookup, positionLookup, containerLookup, positionToContainerMap), model, maxSolutions);
    return;
  }

  const itemId = itemIds[itemIndex];
  const candidatePositionIds = (candidatePositionIdsByItemId.get(itemId) ?? [])
    .slice()
    .sort((leftPositionId, rightPositionId) => {
      const leftScore = getIncrementalScoreForDestination(itemId, leftPositionId, assignmentScoreMap, targetScoreMap);
      const rightScore = getIncrementalScoreForDestination(itemId, rightPositionId, assignmentScoreMap, targetScoreMap);
      return rightScore - leftScore;
    });

  for (const positionId of candidatePositionIds) {
    if (!canPlaceItemInPosition({
      itemId,
      positionId,
      assignmentsByItemId,
      assignedPositionIds,
      mustShareMap,
      mustNotShareMap,
      mustBeAdjacentMap,
      mustNotBeAdjacentMap,
      adjacencyMap,
      positionToContainerMap,
      allowedContainerMap,
      forbiddenContainerMap,
      fixedAssignmentMap,
      forbiddenAssignmentMap,
      assignmentExclusionMap,
      assignmentCountUpperBoundMap,
    })) {
      continue;
    }

    assignmentsByItemId.set(itemId, positionId);
    assignedPositionIds.add(positionId);
    searchPositionAssignments({
      itemIds,
      itemIndex: itemIndex + 1,
      candidatePositionIdsByItemId,
      assignmentsByItemId,
      assignedPositionIds,
      mustShareMap,
      mustNotShareMap,
      mustBeAdjacentMap,
      mustNotBeAdjacentMap,
      adjacencyMap,
      positionToContainerMap,
      solutions,
      maxSolutions,
      itemLookup,
      positionLookup,
      containerLookup,
      allowedContainerMap,
      forbiddenContainerMap,
      fixedAssignmentMap,
      forbiddenAssignmentMap,
      assignmentExclusionMap,
      assignmentCountUpperBoundMap,
      model,
      assignmentScoreMap,
      targetScoreMap,
      suffixUpperBounds,
      currentScore: currentScore + getIncrementalScoreForDestination(itemId, positionId, assignmentScoreMap, targetScoreMap),
    });
    assignedPositionIds.delete(positionId);
    assignmentsByItemId.delete(itemId);
  }
}

export class FirstSolverAdapter extends SolverAdapter {
  getCapabilities() {
    return {
      ...createDefaultCapabilities(),
      adjacency: true,
      positionMode: true,
      assignmentExclusions: true,
      perItemAssignmentUpperBounds: true,
      scopedAssignmentUpperBounds: true,
      fixedAssignments: true,
      forbiddenAssignments: true,
      softAssignmentScores: true,
      softItemCountTargets: true,
      optimization: true,
      weightedPreferences: true,
    };
  }

  validateModel(model) {
    const errors = [];
    const warnings = [];

    if (![ASSIGNMENT_MODES.CONTAINER, ASSIGNMENT_MODES.POSITION].includes(model.assignmentMode)) {
      errors.push('First solver adapter currently supports container mode and position mode only.');
    }

    const supportedConstraintKinds = model.assignmentMode === ASSIGNMENT_MODES.POSITION
      ? [
        CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
        CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
        CONSTRAINT_KINDS.MUST_BE_ADJACENT,
        CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT,
      ]
      : [
        CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
        CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
      ];

    const unsupportedConstraints = model.constraints.filter(
      (constraint) => !supportedConstraintKinds.includes(constraint.kind),
    );

    if (unsupportedConstraints.length > 0) {
      errors.push(model.assignmentMode === ASSIGNMENT_MODES.POSITION
        ? 'First solver adapter currently supports mustShareContainer, mustNotShareContainer, mustBeAdjacent, and mustNotBeAdjacent hard constraints in position mode.'
        : 'First solver adapter currently supports only mustShareContainer and mustNotShareContainer hard constraints in container mode.');
    }

    if (model.preferences.length > 0) {
      warnings.push('General soft preferences are ignored by the first solver adapter.');
    }

    if (model.assignmentMode === ASSIGNMENT_MODES.CONTAINER && (model.positions.length > 0 || model.topologies.length > 0)) {
      warnings.push('Positions and adjacency are ignored by the first solver adapter in container mode.');
    }

    const fixedAssignmentMap = buildFixedAssignmentMap(model.fixedAssignments ?? []);
    if (hasConflictingFixedAssignments(fixedAssignmentMap, model.assignmentMultiplicity)) {
      errors.push('A single item cannot have multiple fixed assignment destinations.');
    }

    if (model.assignmentMode === ASSIGNMENT_MODES.POSITION) {
      if (model.positions.length < model.items.length) {
        errors.push('Position mode requires at least as many positions as items.');
      }

      const positionToContainerMap = buildPositionToContainerMap(model.containments ?? []);
      const positionsWithoutContainer = model.positions.filter((position) => !positionToContainerMap.has(position.id));
      if (positionsWithoutContainer.length > 0) {
        errors.push('Position mode requires every position to belong to a container.');
      }
    }

    return {
      valid: errors.length === 0,
      model,
      errors,
      warnings,
    };
  }

  solve(model) {
    const startedAt = performance.now();
    const validation = this.validateModel(model);
    if (!validation.valid) {
      return createSolverResult({
        status: 'error',
        warnings: validation.errors,
        runtimeMs: Math.round(performance.now() - startedAt),
      });
    }

    const containerLookup = buildContainerLookup(model.containers);
    const itemLookup = buildItemLookup(model.items);
    const allowedContainerMap = buildAllowedContainerMap(model.items);
    const forbiddenContainerMap = buildForbiddenContainerMap(model.items);
    const fixedAssignmentMap = buildFixedAssignmentMap(model.fixedAssignments ?? []);
    const forbiddenAssignmentMap = buildForbiddenAssignmentMap(model.forbiddenAssignments ?? []);
    const assignmentExclusionMap = buildAssignmentExclusionMap(model.assignmentExclusions ?? []);
    const assignmentCountUpperBoundMap = buildAssignmentCountUpperBoundMap(model.assignmentCountUpperBounds ?? []);
    const solutions = [];
    const maxSolutions = 10;
    const assignmentScoreMap = getIncrementalAssignmentScoreMap(model.softAssignmentScores ?? []);
    const targetScoreMap = getIncrementalTargetScoreMap(model.softItemCountTargets ?? []);

    if (model.assignmentMode === ASSIGNMENT_MODES.CONTAINER) {
      const mustNotShareMap = buildMustNotShareMap(model.constraints);
      const containerIds = model.containers.map((container) => container.id);

      if (model.assignmentMultiplicity === 'multiple') {
        const assignmentsByItemId = new Map(model.items.map((item) => [item.id, []]));
        const assignmentEntries = [];
        const containerLoads = new Map(containerIds.map((containerId) => [containerId, 0]));

        searchMultipleContainerAssignments({
          itemIds: model.items
            .map((item) => item.id)
            .slice()
            .sort((leftItemId, rightItemId) => {
              const leftFixed = fixedAssignmentMap.get(leftItemId)?.size ?? 0;
              const rightFixed = fixedAssignmentMap.get(rightItemId)?.size ?? 0;
              if (leftFixed !== rightFixed) {
                return rightFixed - leftFixed;
              }

              const leftAllowed = allowedContainerMap.get(leftItemId);
              const rightAllowed = allowedContainerMap.get(rightItemId);
              const leftOptionCount = Array.isArray(leftAllowed) && leftAllowed.length > 0 ? leftAllowed.length : containerIds.length;
              const rightOptionCount = Array.isArray(rightAllowed) && rightAllowed.length > 0 ? rightAllowed.length : containerIds.length;
              return leftOptionCount - rightOptionCount;
            }),
          destinationIds: containerIds,
          itemIndex: 0,
          assignmentsByItemId,
          assignmentEntries,
          containerLoads,
          containerLookup,
          mustNotShareMap,
          allowedContainerMap,
          forbiddenContainerMap,
          fixedAssignmentMap,
          forbiddenAssignmentMap,
          assignmentExclusionMap,
          assignmentCountUpperBoundMap,
          itemLookup,
          solutions,
          maxSolutions,
          model,
          currentScore: 0,
          assignmentScoreMap,
          targetScoreMap,
        });
      } else {
        const components = normalizeComponents(model)
          .slice()
          .sort((left, right) => right.length - left.length);
        const assignmentsByItemId = new Map();
        const containerLoads = new Map(containerIds.map((containerId) => [containerId, 0]));
        const componentSoftScoreOptions = buildComponentSoftScoreOptions(components, containerIds, assignmentScoreMap, targetScoreMap);
        const componentSuffixUpperBounds = buildComponentSuffixUpperBounds(componentSoftScoreOptions);

        searchAssignments({
          components,
          componentIndex: 0,
          containerIds,
          assignmentsByItemId,
          mustNotShareMap,
          containerLoads,
          containerLookup,
          solutions,
          maxSolutions,
          itemLookup,
          allowedContainerMap,
          forbiddenContainerMap,
          fixedAssignmentMap,
          forbiddenAssignmentMap,
          assignmentCountUpperBoundMap,
          model,
          componentSoftScoreOptions,
          componentSuffixUpperBounds,
          currentScore: 0,
        });
      }
    } else {
      const positionLookup = buildPositionLookup(model.positions);
      const positionToContainerMap = buildPositionToContainerMap(model.containments ?? []);
      const containerToPositionsMap = buildContainerToPositionsMap(model.positions, positionToContainerMap);
      const mustShareMap = buildConstraintPairMap(model.constraints, CONSTRAINT_KINDS.MUST_SHARE_CONTAINER);
      const mustNotShareMap = buildConstraintPairMap(model.constraints, CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER);
      const mustBeAdjacentMap = buildConstraintPairMap(model.constraints, CONSTRAINT_KINDS.MUST_BE_ADJACENT);
      const mustNotBeAdjacentMap = buildConstraintPairMap(model.constraints, CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT);
      const adjacencyMap = model.derived?.adjacencyMap ?? new Map();
      const assignmentsByItemId = new Map();
      const assignedPositionIds = new Set();
      const candidatePositionIdsByItemId = new Map(model.items.map((item) => {
        const allowedContainerIds = allowedContainerMap.get(item.id);
        const forbiddenContainerIds = forbiddenContainerMap.get(item.id) ?? [];
        const candidatePositionIds = model.positions
          .filter((position) => {
            const containerId = positionToContainerMap.get(position.id);
            if (!containerId) {
              return false;
            }

            if (Array.isArray(allowedContainerIds) && allowedContainerIds.length > 0 && !allowedContainerIds.includes(containerId)) {
              return false;
            }

            if (forbiddenContainerIds.includes(containerId)) {
              return false;
            }

            return true;
          })
          .map((position) => position.id);
        return [item.id, candidatePositionIds];
      }));
      const itemIds = model.items
        .map((item) => item.id)
        .slice()
        .sort((leftItemId, rightItemId) => {
          const leftCandidates = candidatePositionIdsByItemId.get(leftItemId)?.length ?? Number.MAX_SAFE_INTEGER;
          const rightCandidates = candidatePositionIdsByItemId.get(rightItemId)?.length ?? Number.MAX_SAFE_INTEGER;
          if (leftCandidates !== rightCandidates) {
            return leftCandidates - rightCandidates;
          }

          const leftDegree = (mustShareMap.get(leftItemId)?.size ?? 0)
            + (mustNotShareMap.get(leftItemId)?.size ?? 0)
            + (mustBeAdjacentMap.get(leftItemId)?.size ?? 0)
            + (mustNotBeAdjacentMap.get(leftItemId)?.size ?? 0);
          const rightDegree = (mustShareMap.get(rightItemId)?.size ?? 0)
            + (mustNotShareMap.get(rightItemId)?.size ?? 0)
            + (mustBeAdjacentMap.get(rightItemId)?.size ?? 0)
            + (mustNotBeAdjacentMap.get(rightItemId)?.size ?? 0);

          if (leftDegree !== rightDegree) {
            return rightDegree - leftDegree;
          }

          const leftContainerOptions = Array.isArray(allowedContainerMap.get(leftItemId))
            ? allowedContainerMap.get(leftItemId).length
            : (containerToPositionsMap.size || Number.MAX_SAFE_INTEGER);
          const rightContainerOptions = Array.isArray(allowedContainerMap.get(rightItemId))
            ? allowedContainerMap.get(rightItemId).length
            : (containerToPositionsMap.size || Number.MAX_SAFE_INTEGER);

          return leftContainerOptions - rightContainerOptions;
        });

      const perItemSoftScoreUpperBounds = getPerItemSoftScoreUpperBounds(model.items, assignmentScoreMap, targetScoreMap);
      const suffixUpperBounds = buildSuffixUpperBounds(itemIds, perItemSoftScoreUpperBounds);

      searchPositionAssignments({
        itemIds,
        itemIndex: 0,
        candidatePositionIdsByItemId,
        assignmentsByItemId,
        assignedPositionIds,
        mustShareMap,
        mustNotShareMap,
        mustBeAdjacentMap,
        mustNotBeAdjacentMap,
        adjacencyMap,
        positionToContainerMap,
        solutions,
        maxSolutions,
        itemLookup,
        positionLookup,
        containerLookup,
        allowedContainerMap,
        forbiddenContainerMap,
        fixedAssignmentMap,
        forbiddenAssignmentMap,
        assignmentExclusionMap,
        assignmentCountUpperBoundMap,
        model,
        assignmentScoreMap,
        targetScoreMap,
        suffixUpperBounds,
        currentScore: 0,
      });
    }

    const rankedSolutions = rankAndAnnotateSolutions(solutions, model);

    return createSolverResult({
      status: rankedSolutions.length > 0 ? 'solved' : 'unsat',
      solutions: rankedSolutions,
      warnings: validation.warnings,
      runtimeMs: Math.round(performance.now() - startedAt),
      truncatedByLimit: rankedSolutions.length >= maxSolutions,
    });
  }
}
