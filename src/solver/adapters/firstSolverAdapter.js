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

function buildAssignmentSolution(assignmentsByItemId, itemLookup, containerLookup) {
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

function canPlaceComponent(component, containerId, assignmentsByItemId, mustNotShareMap, containerLoads, containerLookup, allowedContainerMap, forbiddenContainerMap) {
  const container = containerLookup.get(containerId);
  if (!container) {
    return false;
  }

  const maxCapacity = container.metadata?.maxCapacity;
  const nextLoad = (containerLoads.get(containerId) ?? 0) + getComponentDemand(component);
  if (maxCapacity !== null && maxCapacity !== undefined && nextLoad > maxCapacity) {
    return false;
  }

  for (const itemId of component) {
    const allowedContainerIds = allowedContainerMap.get(itemId);
    const forbiddenContainerIds = forbiddenContainerMap.get(itemId) ?? [];

    if (Array.isArray(allowedContainerIds) && allowedContainerIds.length > 0 && !allowedContainerIds.includes(containerId)) {
      return false;
    }

    if (forbiddenContainerIds.includes(containerId)) {
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
}) {
  if (solutions.length >= maxSolutions) {
    return;
  }

  if (componentIndex >= components.length) {
    solutions.push(buildAssignmentSolution(assignmentsByItemId, itemLookup, containerLookup));
    return;
  }

  const component = components[componentIndex];

  for (const containerId of containerIds) {
    if (!canPlaceComponent(component, containerId, assignmentsByItemId, mustNotShareMap, containerLoads, containerLookup, allowedContainerMap, forbiddenContainerMap)) {
      continue;
    }

    placeComponent(component, containerId, assignmentsByItemId, containerLoads);
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
    });
    unplaceComponent(component, containerId, assignmentsByItemId, containerLoads);
  }
}

export class FirstSolverAdapter extends SolverAdapter {
  getCapabilities() {
    return createDefaultCapabilities();
  }

  validateModel(model) {
    const errors = [];
    const warnings = [];

    if (model.assignmentMode !== ASSIGNMENT_MODES.CONTAINER) {
      errors.push('First solver adapter currently supports container mode only.');
    }

    const unsupportedConstraints = model.constraints.filter(
      (constraint) => ![
        CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
        CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
      ].includes(constraint.kind),
    );

    if (unsupportedConstraints.length > 0) {
      errors.push('First solver adapter currently supports only mustShareContainer and mustNotShareContainer hard constraints.');
    }

    if (model.preferences.length > 0) {
      warnings.push('Soft preferences are ignored by the first solver adapter.');
    }

    if (model.positions.length > 0 || model.topologies.length > 0) {
      warnings.push('Positions and adjacency are ignored by the first solver adapter.');
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
    const mustNotShareMap = buildMustNotShareMap(model.constraints);
    const allowedContainerMap = buildAllowedContainerMap(model.items);
    const forbiddenContainerMap = buildForbiddenContainerMap(model.items);
    const components = normalizeComponents(model)
      .slice()
      .sort((left, right) => right.length - left.length);
    const containerIds = model.containers.map((container) => container.id);
    const assignmentsByItemId = new Map();
    const containerLoads = new Map(containerIds.map((containerId) => [containerId, 0]));
    const solutions = [];
    const maxSolutions = 10;

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
    });
    return createSolverResult({
      status: solutions.length > 0 ? 'solved' : 'unsat',
      solutions,
      warnings: validation.warnings,
      runtimeMs: Math.round(performance.now() - startedAt),
      truncatedByLimit: solutions.length >= maxSolutions,
    });
  }
}
