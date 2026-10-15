import { CONSTRAINT_KINDS } from '../../core/model/constraints.js';
import { createAssignment, createSolution } from '../../core/model/solution.js';
import { ASSIGNMENT_MODES } from '../../core/model/assignmentModes.js';
import { NODE_KINDS } from '../../core/model/nodes.js';
import { PREFERENCE_KINDS } from '../../core/model/preferences.js';
import { SolverAdapter } from '../solverAdapter.js';
import { createDefaultCapabilities } from '../solverCapabilities.js';
import { createSolverResult } from '../solverResult.js';
import { SOLVE_MODES, validateSolveOptions } from '../solveOptions.js';
import {
  createAssignmentFingerprint,
  rankUniqueSolutions,
  selectDiverseSolutions,
} from '../solutionRanking.js';

const FIRST_SOLUTION_FOUND = Symbol('firstSolutionFound');
const TIME_LIMIT_REACHED = Symbol('timeLimitReached');
const TOP_K_ESTABLISHED = Symbol('topKEstablished');
const MIN_DIVERSITY_CANDIDATE_RETENTION = 256;
const DIVERSITY_RETENTION_FACTOR = 8;
const MIN_DIVERSITY_SEARCH_LIMIT = 4096;
const DIVERSITY_SEARCH_FACTOR = 64;

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

function buildPreferencePairMap(preferences = []) {
  const map = new Map();
  preferences.forEach((preference) => {
    const leftId = preference.leftRef?.id;
    const rightId = preference.rightRef?.id;
    if (!leftId || !rightId) return;
    const left = map.get(leftId) ?? [];
    left.push({ preference, otherItemId: rightId });
    map.set(leftId, left);
    const right = map.get(rightId) ?? [];
    right.push({ preference, otherItemId: leftId });
    map.set(rightId, right);
  });
  return map;
}

function getIncrementalRelationPreferenceScore({
  itemId,
  positionId,
  assignmentsByItemId,
  preferencePairMap,
  positionToContainerMap,
  adjacencyMap,
}) {
  const containerId = positionToContainerMap.get(positionId);
  return (preferencePairMap.get(itemId) ?? []).reduce((total, { preference, otherItemId }) => {
    const otherPositionId = assignmentsByItemId.get(otherItemId);
    if (!otherPositionId) return total;
    const sharesContainer = containerId === positionToContainerMap.get(otherPositionId);
    const adjacent = adjacencyMap.get(positionId)?.has(otherPositionId) ?? false;
    const satisfied = preference.kind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER ? sharesContainer
      : preference.kind === PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS ? !sharesContainer
        : preference.kind === PREFERENCE_KINDS.PREFER_ADJACENT ? adjacent
          : preference.kind === PREFERENCE_KINDS.PREFER_NON_ADJACENT ? !adjacent
            : false;
    return total + (satisfied ? preference.weight : 0);
  }, 0);
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

function pushRankedSolution(solutions, solution, model, maxSolutions, searchState) {
  const [rankedSolution] = rankUniqueSolutions([solution], model, searchState.options);
  const fingerprint = rankedSolution.fingerprint;
  if (searchState.fingerprints.has(fingerprint)) return;
  searchState.fingerprints.add(fingerprint);
  searchState.qualifyingSolutions += 1;
  solutions.push(rankedSolution);
  solutions.sort((left, right) => (
    right.score - left.score || left.fingerprint.localeCompare(right.fingerprint)
  ));

  if (solutions.length > searchState.retainedCandidateLimit) {
    const removed = solutions.pop();
    searchState.fingerprints.delete(removed.fingerprint);
    searchState.candidateRetentionTruncated = true;
  }

  const previousBestFingerprint = searchState.bestSolution?.fingerprint;
  searchState.bestSolution = solutions[0] ?? searchState.bestSolution;
  const incumbentImproved = searchState.bestSolution?.fingerprint !== previousBestFingerprint;
  if (incumbentImproved) {
    searchState.incumbentCount += 1;
    searchState.pendingIncumbent = searchState.bestSolution;
  }
  reportProgress(searchState, incumbentImproved);

  if (searchState.stopWhenDiverseCount !== null) {
    const diverseSolutions = selectDiverseSolutions(
      solutions,
      searchState.stopWhenDiverseCount,
      searchState.options.diversity.minimumAssignmentDistance,
    );
    if (diverseSolutions.length >= searchState.stopWhenDiverseCount) {
      searchState.stoppedAfterLimit = true;
      searchState.boundedSearchReason = 'diversity-established';
      throw TOP_K_ESTABLISHED;
    }
  }

  if (searchState.stopAfterSolutionCount !== null
    && searchState.qualifyingSolutions >= searchState.stopAfterSolutionCount) {
    searchState.stoppedAfterLimit = true;
    searchState.boundedSearchReason ??= 'candidate-budget';
    throw TOP_K_ESTABLISHED;
  }

  if (searchState.mode === SOLVE_MODES.FIRST) {
    searchState.stoppedAfterFirst = true;
    throw FIRST_SOLUTION_FOUND;
  }
}

function reportProgress(searchState, incumbentFound = false) {
  const onProgress = searchState.runtimeHooks?.onProgress;
  const onIncumbent = searchState.runtimeHooks?.onIncumbent;
  if (typeof onProgress !== 'function' && typeof onIncumbent !== 'function') return;

  const now = performance.now();
  if (now - searchState.lastProgressAt < 100 && !(incumbentFound && !searchState.hasReportedProgress)) return;
  searchState.lastProgressAt = now;
  searchState.hasReportedProgress = true;
  const snapshot = {
    phase: 'searching',
    exploredNodes: searchState.exploredNodes,
    prunedNodes: searchState.prunedNodes,
    solutionCount: searchState.qualifyingSolutions,
    elapsedMs: Math.round(now - searchState.startedAt),
    bestSolution: searchState.bestSolution,
  };
  if (typeof onProgress === 'function') {
    try {
      onProgress(snapshot);
    } catch {
      // Runtime observers are diagnostic only and must never affect search correctness.
    }
  }
  if (searchState.pendingIncumbent && typeof onIncumbent === 'function') {
    try {
      onIncumbent(snapshot);
    } catch {
      // Runtime observers are diagnostic only and must never affect search correctness.
    }
  }
  searchState.pendingIncumbent = null;
}

function checkTimeLimit(searchState) {
  reportProgress(searchState);
  if (searchState.deadline !== null && performance.now() >= searchState.deadline) {
    searchState.timeoutReached = true;
    throw TIME_LIMIT_REACHED;
  }
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
  searchState,
}) {
  checkTimeLimit(searchState);
  searchState.exploredNodes += 1;

  if (componentIndex >= components.length) {
    if (allContainerMinCapacitiesSatisfied(containerLoads, containerIds, containerLookup)) {
      pushRankedSolution(solutions, buildContainerAssignmentSolution(assignmentsByItemId, itemLookup, containerLookup), model, maxSolutions, searchState);
    }
    return;
  }

  const remainingDemand = components
    .slice(componentIndex)
    .reduce((total, component) => total + getComponentDemand(component), 0);

  if (!canStillSatisfyRemainingMinCapacities(containerLoads, containerIds, containerLookup, remainingDemand)) {
    searchState.prunedNodes += 1;
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
        searchState,
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

  for (const blockedItemId of mustNotShareMap.get(itemId) ?? []) {
    if (isDestinationAlreadyAssigned(assignmentsByItemId, blockedItemId, containerId)) {
      return false;
    }
  }

  return true;
}

function searchMultipleContainerAssignments({
  itemIds,
  destinationIds,
  remainingPairs,
  assignmentsByItemId,
  assignmentEntries,
  containerLoads,
  containerLookup,
  mustShareMap,
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
  searchState,
}) {
  checkTimeLimit(searchState);
  searchState.exploredNodes += 1;
  const remainingPairKeys = new Set(remainingPairs.map(({ itemId, containerId }) => `${itemId}\u0000${containerId}`));
  const fixedCanStillBeSatisfied = [...fixedAssignmentMap.entries()].every(([itemId, requiredDestinationIds]) => (
    [...requiredDestinationIds].every((containerId) => (
      isDestinationAlreadyAssigned(assignmentsByItemId, itemId, containerId)
      || remainingPairKeys.has(`${itemId}\u0000${containerId}`)
    ))
  ));
  if (!fixedCanStillBeSatisfied) {
    searchState.prunedNodes += 1;
    return;
  }

  const minimumsCanStillBeSatisfied = destinationIds.every((containerId) => {
    const shortfall = Math.max(
      0,
      getContainerMinCapacity(containerLookup.get(containerId)) - (containerLoads.get(containerId) ?? 0),
    );
    return remainingPairs.filter((pair) => pair.containerId === containerId).length >= shortfall;
  });
  if (!minimumsCanStillBeSatisfied) {
    searchState.prunedNodes += 1;
    return;
  }

  if (remainingPairs.length === 0) {
    const allFixedAssignmentsSatisfied = [...fixedAssignmentMap.entries()].every(([itemId, requiredDestinationIds]) => {
      const assignedDestinationIds = new Set(getAssignedDestinationIds(assignmentsByItemId, itemId));
      return [...requiredDestinationIds].every((destinationId) => assignedDestinationIds.has(destinationId));
    });
    const allMustShareConstraintsSatisfied = [...mustShareMap.entries()].every(([itemId, relatedItemIds]) => {
      const assigned = [...getAssignedDestinationIds(assignmentsByItemId, itemId)].sort();
      return [...relatedItemIds].every((relatedItemId) => {
        const relatedAssigned = [...getAssignedDestinationIds(assignmentsByItemId, relatedItemId)].sort();
        return JSON.stringify(assigned) === JSON.stringify(relatedAssigned);
      });
    });

    if (allFixedAssignmentsSatisfied
      && allMustShareConstraintsSatisfied
      && allContainerMinCapacitiesSatisfied(containerLoads, destinationIds, containerLookup)) {
      pushRankedSolution(
        solutions,
        buildContainerMultiAssignmentSolution(assignmentEntries, itemLookup, containerLookup),
        model,
        maxSolutions,
        searchState,
      );
    }
    return;
  }

  const unmetDestinationIds = destinationIds
    .filter((containerId) => (containerLoads.get(containerId) ?? 0) < getContainerMinCapacity(containerLookup.get(containerId)))
    .sort((left, right) => {
      const leftChoices = remainingPairs.filter((pair) => pair.containerId === left).length;
      const rightChoices = remainingPairs.filter((pair) => pair.containerId === right).length;
      return leftChoices - rightChoices || String(left).localeCompare(String(right));
    });
  const fixedPairIndex = remainingPairs.findIndex(({ itemId, containerId }) => (
    fixedAssignmentMap.get(itemId)?.has(containerId)
  ));
  const pairIndex = unmetDestinationIds.length > 0
    ? remainingPairs.findIndex((pair) => pair.containerId === unmetDestinationIds[0])
    : (fixedPairIndex >= 0 ? fixedPairIndex : 0);
  const pair = remainingPairs[pairIndex];
  const nextPairs = remainingPairs.filter((_, index) => index !== pairIndex);
  const recurse = () => searchMultipleContainerAssignments({
    itemIds,
    destinationIds,
    remainingPairs: nextPairs,
    assignmentsByItemId,
    assignmentEntries,
    containerLoads,
    containerLookup,
    mustShareMap,
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
    searchState,
  });

  const maxCapacity = getContainerMaxCapacity(containerLookup.get(pair.containerId));
  const hasCapacity = maxCapacity === null || maxCapacity === undefined
    || (containerLoads.get(pair.containerId) ?? 0) < maxCapacity;
  if (hasCapacity && canAddMultiAssignment({
    ...pair,
    assignmentsByItemId,
    mustNotShareMap,
    allowedContainerMap,
    forbiddenContainerMap,
    fixedAssignmentMap,
    forbiddenAssignmentMap,
    assignmentExclusionMap,
    assignmentCountUpperBoundMap,
  })) {
    assignmentsByItemId.set(pair.itemId, [...getAssignedDestinationIds(assignmentsByItemId, pair.itemId), pair.containerId]);
    assignmentEntries.push(pair);
    containerLoads.set(pair.containerId, (containerLoads.get(pair.containerId) ?? 0) + 1);
    recurse();
    containerLoads.set(pair.containerId, (containerLoads.get(pair.containerId) ?? 0) - 1);
    assignmentEntries.pop();
    assignmentsByItemId.set(
      pair.itemId,
      getAssignedDestinationIds(assignmentsByItemId, pair.itemId).filter((id) => id !== pair.containerId),
    );
  }

  if (!fixedAssignmentMap.get(pair.itemId)?.has(pair.containerId)) {
    recurse();
  }
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
  containerIds,
  containerLoads,
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
  preferencePairMap,
  suffixUpperBounds,
  currentScore,
  searchState,
}) {
  checkTimeLimit(searchState);
  searchState.exploredNodes += 1;

  if (itemIndex >= itemIds.length) {
    if (allContainerMinCapacitiesSatisfied(containerLoads, containerIds, containerLookup)) {
      pushRankedSolution(solutions, buildPositionAssignmentSolution(assignmentsByItemId, itemLookup, positionLookup, containerLookup, positionToContainerMap), model, maxSolutions, searchState);
    }
    return;
  }

  const remainingItemCount = itemIds.length - itemIndex;
  if (!canStillSatisfyRemainingMinCapacities(containerLoads, containerIds, containerLookup, remainingItemCount)) {
    searchState.prunedNodes += 1;
    return;
  }

  const itemId = itemIds[itemIndex];
  const candidatePositionIds = (candidatePositionIdsByItemId.get(itemId) ?? [])
    .slice()
    .sort((leftPositionId, rightPositionId) => {
      const leftScore = getIncrementalScoreForDestination(itemId, leftPositionId, assignmentScoreMap, targetScoreMap)
        + getIncrementalRelationPreferenceScore({ itemId, positionId: leftPositionId, assignmentsByItemId, preferencePairMap, positionToContainerMap, adjacencyMap });
      const rightScore = getIncrementalScoreForDestination(itemId, rightPositionId, assignmentScoreMap, targetScoreMap)
        + getIncrementalRelationPreferenceScore({ itemId, positionId: rightPositionId, assignmentsByItemId, preferencePairMap, positionToContainerMap, adjacencyMap });
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
    const containerId = positionToContainerMap.get(positionId);
    containerLoads.set(containerId, (containerLoads.get(containerId) ?? 0) + 1);
    try {
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
        containerIds,
        containerLoads,
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
        preferencePairMap,
        suffixUpperBounds,
        currentScore: currentScore
          + getIncrementalScoreForDestination(itemId, positionId, assignmentScoreMap, targetScoreMap)
          + getIncrementalRelationPreferenceScore({ itemId, positionId, assignmentsByItemId, preferencePairMap, positionToContainerMap, adjacencyMap }),
        searchState,
      });
    } finally {
      containerLoads.set(containerId, (containerLoads.get(containerId) ?? 0) - 1);
      assignedPositionIds.delete(positionId);
      assignmentsByItemId.delete(itemId);
    }
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
      softPreferences: true,
      optimization: true,
      weightedPreferences: true,
      scoreDetails: true,
      scoreWeights: true,
      diversity: true,
      timeout: true,
      partialResults: true,
      solutionFingerprints: true,
      searchStatistics: true,
    };
  }

  validateModel(model, options = {}) {
    const optionValidation = validateSolveOptions(options, this.getCapabilities());
    const errors = [...optionValidation.errors];
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

    if (model.assignmentMode === ASSIGNMENT_MODES.CONTAINER && (model.positions.length > 0 || model.topologies.length > 0)) {
      warnings.push('Positions and adjacency are ignored by the first solver adapter in container mode.');
    }

    const fixedAssignmentMap = buildFixedAssignmentMap(model.fixedAssignments ?? []);
    if (hasConflictingFixedAssignments(fixedAssignmentMap, model.assignmentMultiplicity)) {
      errors.push('A single item cannot have multiple fixed assignment destinations.');
    }

    if ((optionValidation.options.scoreWeights.equity ?? 0) !== 0) {
      const eligibleItemIds = optionValidation.options.equityEligibleItemIds
        ?? model.metadata?.equityEligibleItemIds;
      if (!Array.isArray(eligibleItemIds)) {
        errors.push('A nonzero equity weight requires an explicit equityEligibleItemIds array in solve options or model metadata.');
      } else {
        const knownItemIds = new Set(model.items.map((item) => item.id));
        if (eligibleItemIds.some((itemId) => !knownItemIds.has(itemId))) {
          errors.push('equityEligibleItemIds contains an unknown item id.');
        }
      }
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
      options: optionValidation.options,
    };
  }

  solve(model, options = {}, runtimeHooks = {}) {
    const startedAt = performance.now();
    const validation = this.validateModel(model, options);
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
    const normalizedOptions = validation.options;
    const maxSolutions = normalizedOptions.maxSolutions;
    const retainedCandidateLimit = normalizedOptions.diversity.enabled
      ? Math.max(MIN_DIVERSITY_CANDIDATE_RETENTION, maxSolutions * DIVERSITY_RETENTION_FACTOR)
      : maxSolutions;
    const searchState = {
      mode: normalizedOptions.mode,
      options: normalizedOptions,
      qualifyingSolutions: 0,
      stoppedAfterFirst: false,
      exploredNodes: 0,
      prunedNodes: 0,
      fingerprints: new Set(),
      deadline: normalizedOptions.timeLimitMs === null
        ? null
        : startedAt + normalizedOptions.timeLimitMs,
      timeoutReached: false,
      stoppedAfterLimit: false,
      stopAfterSolutionCount: null,
      stopWhenDiverseCount: null,
      boundedSearchReason: null,
      retainedCandidateLimit,
      candidateRetentionTruncated: false,
      runtimeHooks,
      startedAt,
      lastProgressAt: startedAt,
      hasReportedProgress: false,
      bestSolution: null,
      pendingIncumbent: null,
      incumbentCount: 0,
    };
    const assignmentScoreMap = getIncrementalAssignmentScoreMap(model.softAssignmentScores ?? []);
    const targetScoreMap = getIncrementalTargetScoreMap(model.softItemCountTargets ?? []);

    if (typeof runtimeHooks.onSearchStart === 'function') {
      try {
        runtimeHooks.onSearchStart();
      } catch {
        // Runtime observers are diagnostic only and must never affect search correctness.
      }
    }

    try {
      if (model.assignmentMode === ASSIGNMENT_MODES.CONTAINER) {
      const mustNotShareMap = buildMustNotShareMap(model.constraints);
      const mustShareMap = buildConstraintPairMap(model.constraints, CONSTRAINT_KINDS.MUST_SHARE_CONTAINER);
      const containerIds = model.containers.map((container) => container.id);

      if (model.assignmentMultiplicity === 'multiple') {
        const equityItemIds = normalizedOptions.equityEligibleItemIds
          ?? model.metadata?.equityEligibleItemIds
          ?? [];
        const objectiveIsConstant = (model.softAssignmentScores ?? []).length === 0
          && (model.softItemCountTargets ?? []).length === 0
          && ((normalizedOptions.scoreWeights.equity ?? 0) === 0 || equityItemIds.length < 2);
        // Constant-objective repeated assignment spaces are exponential. Bound the search, but
        // allow diversity filtering to inspect enough candidates to establish distant alternatives.
        if (normalizedOptions.mode === SOLVE_MODES.TOP_K
          && objectiveIsConstant
          && model.items.length * containerIds.length > 20) {
          if (normalizedOptions.diversity.enabled) {
            searchState.stopWhenDiverseCount = maxSolutions;
            searchState.stopAfterSolutionCount = Math.max(
              MIN_DIVERSITY_SEARCH_LIMIT,
              maxSolutions * DIVERSITY_SEARCH_FACTOR,
            );
          } else {
            searchState.stopAfterSolutionCount = maxSolutions + 1;
          }
        }
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
          remainingPairs: model.items
            .flatMap((item) => containerIds.map((containerId) => ({ itemId: item.id, containerId })))
            .sort((left, right) => (
              String(left.containerId).localeCompare(String(right.containerId))
              || String(left.itemId).localeCompare(String(right.itemId))
            )),
          assignmentsByItemId,
          assignmentEntries,
          containerLoads,
          containerLookup,
          mustShareMap,
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
          searchState,
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
          searchState,
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
      const preferencePairMap = buildPreferencePairMap(model.preferences);
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

          const leftAdjacencyPriority = (mustBeAdjacentMap.get(leftItemId)?.size ?? 0)
            + (mustNotBeAdjacentMap.get(leftItemId)?.size ?? 0)
            + (preferencePairMap.get(leftItemId)?.filter(({ preference }) => (
              preference.kind === PREFERENCE_KINDS.PREFER_ADJACENT
              || preference.kind === PREFERENCE_KINDS.PREFER_NON_ADJACENT
            )).length ?? 0);
          const rightAdjacencyPriority = (mustBeAdjacentMap.get(rightItemId)?.size ?? 0)
            + (mustNotBeAdjacentMap.get(rightItemId)?.size ?? 0)
            + (preferencePairMap.get(rightItemId)?.filter(({ preference }) => (
              preference.kind === PREFERENCE_KINDS.PREFER_ADJACENT
              || preference.kind === PREFERENCE_KINDS.PREFER_NON_ADJACENT
            )).length ?? 0);
          if (leftAdjacencyPriority !== rightAdjacencyPriority) {
            return rightAdjacencyPriority - leftAdjacencyPriority;
          }

          const leftDegree = (mustShareMap.get(leftItemId)?.size ?? 0)
            + (mustNotShareMap.get(leftItemId)?.size ?? 0)
            + (mustBeAdjacentMap.get(leftItemId)?.size ?? 0)
            + (mustNotBeAdjacentMap.get(leftItemId)?.size ?? 0)
            + (preferencePairMap.get(leftItemId)?.length ?? 0);
          const rightDegree = (mustShareMap.get(rightItemId)?.size ?? 0)
            + (mustNotShareMap.get(rightItemId)?.size ?? 0)
            + (mustBeAdjacentMap.get(rightItemId)?.size ?? 0)
            + (mustNotBeAdjacentMap.get(rightItemId)?.size ?? 0)
            + (preferencePairMap.get(rightItemId)?.length ?? 0);

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
      const containerIds = model.containers.map((container) => container.id);
      const containerLoads = new Map(containerIds.map((containerId) => [containerId, 0]));

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
        containerIds,
        containerLoads,
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
        preferencePairMap,
        suffixUpperBounds,
        currentScore: 0,
        searchState,
      });
      }
    } catch (error) {
      if (error !== FIRST_SOLUTION_FOUND && error !== TIME_LIMIT_REACHED && error !== TOP_K_ESTABLISHED) {
        throw error;
      }
    }

    if (typeof runtimeHooks.onSearchEnd === 'function') {
      try {
        runtimeHooks.onSearchEnd();
      } catch {
        // Runtime observers are diagnostic only and must never affect search correctness.
      }
    }

    const allRankedSolutions = rankUniqueSolutions(solutions, model, normalizedOptions);
    const rankedSolutions = normalizedOptions.diversity.enabled
      ? selectDiverseSolutions(
        allRankedSolutions,
        maxSolutions,
        normalizedOptions.diversity.minimumAssignmentDistance,
      )
      : allRankedSolutions.slice(0, maxSolutions);
    const diversityUnmet = normalizedOptions.diversity.enabled
      && rankedSolutions.length < Math.min(maxSolutions, allRankedSolutions.length);
    const diversityRetentionAffected = normalizedOptions.diversity.enabled
      && searchState.candidateRetentionTruncated
      && rankedSolutions.length < maxSolutions;
    const searchComplete = !searchState.stoppedAfterFirst
      && !searchState.stoppedAfterLimit
      && !searchState.timeoutReached
      && !diversityRetentionAffected;
    const warnings = [...validation.warnings];
    if (diversityUnmet) {
      warnings.push(`Only ${rankedSolutions.length} solutions met the requested minimum assignment distance.`);
    }
    if (searchState.boundedSearchReason === 'candidate-budget') {
      warnings.push('The bounded diversity candidate search ended before the requested alternatives were established.');
    }
    if (diversityRetentionAffected) {
      warnings.push('Bounded candidate retention prevented proving that no additional diverse alternatives exist.');
    }
    const status = searchState.timeoutReached
      ? (rankedSolutions.length > 0 ? 'partial' : 'timeout')
      : (rankedSolutions.length > 0 ? 'solved' : 'unsat');

    return createSolverResult({
      status,
      solutions: rankedSolutions,
      warnings,
      runtimeMs: Math.round(performance.now() - startedAt),
      searchComplete,
      optimalityProven: normalizedOptions.mode === SOLVE_MODES.OPTIMIZE
        && searchComplete
        && rankedSolutions.length > 0,
      truncatedByLimit: searchState.qualifyingSolutions > maxSolutions
        || searchState.candidateRetentionTruncated,
      interrupted: searchState.timeoutReached || searchState.stoppedAfterFirst,
      timeoutReached: searchState.timeoutReached,
      exploredNodes: searchState.exploredNodes,
      prunedNodes: searchState.prunedNodes,
      incumbentCount: searchState.incumbentCount,
      canonicalRankingComplete: normalizedOptions.mode !== SOLVE_MODES.FIRST && searchComplete,
      solutionSelection: normalizedOptions.mode !== SOLVE_MODES.FIRST && searchComplete
        ? 'canonical'
        : 'best-found',
    });
  }
}
