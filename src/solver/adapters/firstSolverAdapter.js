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

function hasConflictingFixedAssignments(fixedAssignmentMap) {
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

  return bounds.every((bound) => {
    const currentDestinationId = assignmentsByItemId.get(itemId);
    const currentCount = currentDestinationId && bound.destinationIds.has(currentDestinationId) ? 1 : 0;
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

function canStillSatisfyRemainingMinCapacities(containerLoads, containerIds, containerLookup, remainingDemand) {
  let totalShortfall = 0;

  for (const containerId of containerIds) {
    const container = containerLookup.get(containerId);
    const minCapacity = getContainerMinCapacity(container);
    const currentLoad = containerLoads.get(containerId) ?? 0;
    totalShortfall += Math.max(0, minCapacity - currentLoad);
  }

  return totalShortfall <= remainingDemand;
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
      if (assignmentsByItemId.get(blockedId) === containerId) {
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
}) {
  if (solutions.length >= maxSolutions) {
    return;
  }

  if (componentIndex >= components.length) {
    if (allContainerMinCapacitiesSatisfied(containerLoads, containerIds, containerLookup)) {
      solutions.push(buildContainerAssignmentSolution(assignmentsByItemId, itemLookup, containerLookup));
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

  for (const containerId of containerIds) {
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
      });
    }
    unplaceComponent(component, containerId, assignmentsByItemId, containerLoads);
  }
}

function getAssignedContainerId(itemId, assignmentsByItemId, positionToContainerMap) {
  const positionId = assignmentsByItemId.get(itemId);
  return positionId ? (positionToContainerMap.get(positionId) ?? null) : null;
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
}) {
  if (solutions.length >= maxSolutions) {
    return;
  }

  if (itemIndex >= itemIds.length) {
    solutions.push(buildPositionAssignmentSolution(assignmentsByItemId, itemLookup, positionLookup, containerLookup, positionToContainerMap));
    return;
  }

  const itemId = itemIds[itemIndex];
  const candidatePositionIds = candidatePositionIdsByItemId.get(itemId) ?? [];

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

    if (model.preferences.length > 0 || (model.softAssignmentScores?.length ?? 0) > 0 || (model.softItemCountTargets?.length ?? 0) > 0) {
      warnings.push('Soft preferences are ignored by the first solver adapter.');
    }

    if (model.assignmentMode === ASSIGNMENT_MODES.CONTAINER && (model.positions.length > 0 || model.topologies.length > 0)) {
      warnings.push('Positions and adjacency are ignored by the first solver adapter in container mode.');
    }

    const fixedAssignmentMap = buildFixedAssignmentMap(model.fixedAssignments ?? []);
    if (hasConflictingFixedAssignments(fixedAssignmentMap)) {
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

    if (model.assignmentMode === ASSIGNMENT_MODES.CONTAINER) {
      const mustNotShareMap = buildMustNotShareMap(model.constraints);
      const components = normalizeComponents(model)
        .slice()
        .sort((left, right) => right.length - left.length);
      const containerIds = model.containers.map((container) => container.id);
      const assignmentsByItemId = new Map();
      const containerLoads = new Map(containerIds.map((containerId) => [containerId, 0]));

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
      });
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
      });
    }

    return createSolverResult({
      status: solutions.length > 0 ? 'solved' : 'unsat',
      solutions,
      warnings: validation.warnings,
      runtimeMs: Math.round(performance.now() - startedAt),
      truncatedByLimit: solutions.length >= maxSolutions,
    });
  }
}
