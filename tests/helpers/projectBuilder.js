import { ASSIGNMENT_MODES } from '../../src/core/model/assignmentModes.js';
import { createConstraint, CONSTRAINT_KINDS } from '../../src/core/model/constraints.js';
import { createContainer, createItem, createPosition } from '../../src/core/model/nodes.js';
import { createPreference } from '../../src/core/model/preferences.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import {
  createAdjacencyRelation,
  createContainmentRelation,
  createEntityRef,
  RELATION_KINDS,
} from '../../src/core/model/relations.js';
import { normalizeProject } from '../../src/core/normalize/normalizeProject.js';

function createRef(kind, id) {
  return createEntityRef(kind, id);
}

function createNamedMap(entries) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

class ScenarioBuilder {
  constructor() {
    this.assignmentModeValue = ASSIGNMENT_MODES.CONTAINER;
    this.itemsList = [];
    this.groupsList = [];
    this.containersList = [];
    this.positionsList = [];
    this.containmentsList = [];
    this.topologiesList = [];
    this.constraintsList = [];
    this.preferencesList = [];
  }

  containerMode() {
    this.assignmentModeValue = ASSIGNMENT_MODES.CONTAINER;
    return this;
  }

  positionMode() {
    this.assignmentModeValue = ASSIGNMENT_MODES.POSITION;
    return this;
  }

  items(...labels) {
    labels.flat().forEach((label) => {
      this.itemsList.push(createItem({ id: label, label }));
    });
    return this;
  }

  containers(definition) {
    Object.entries(definition).forEach(([containerId, value]) => {
      if (Array.isArray(value)) {
        this.containersList.push(createContainer({
          id: containerId,
          label: containerId,
          maxCapacity: value.length,
        }));

        value.forEach((positionId) => {
          this.positionsList.push(createPosition({ id: positionId, label: positionId }));
          this.containmentsList.push(createContainmentRelation(
            createRef('container', containerId),
            createRef('position', positionId),
          ));
        });
        return;
      }

      this.containersList.push(createContainer({
        id: containerId,
        label: containerId,
        maxCapacity: value,
      }));
    });

    return this;
  }

  adjacent(leftPositionId, rightPositionId) {
    this.topologiesList.push(createAdjacencyRelation(
      createRef('position', leftPositionId),
      createRef('position', rightPositionId),
    ));
    return this;
  }

  mustShare(leftItemId, rightItemId, metadata = {}) {
    this.constraintsList.push(createConstraint({
      kind: CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
      leftRef: createRef('item', leftItemId),
      rightRef: createRef('item', rightItemId),
      metadata,
    }));
    return this;
  }

  mustNotShare(leftItemId, rightItemId, metadata = {}) {
    this.constraintsList.push(createConstraint({
      kind: CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
      leftRef: createRef('item', leftItemId),
      rightRef: createRef('item', rightItemId),
      metadata,
    }));
    return this;
  }

  mustBeAdjacent(leftItemId, rightItemId, metadata = {}) {
    this.constraintsList.push(createConstraint({
      kind: CONSTRAINT_KINDS.MUST_BE_ADJACENT,
      leftRef: createRef('item', leftItemId),
      rightRef: createRef('item', rightItemId),
      metadata,
    }));
    return this;
  }

  mustNotBeAdjacent(leftItemId, rightItemId, metadata = {}) {
    this.constraintsList.push(createConstraint({
      kind: CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT,
      leftRef: createRef('item', leftItemId),
      rightRef: createRef('item', rightItemId),
      metadata,
    }));
    return this;
  }

  preferShare(leftItemId, rightItemId, weight = 1) {
    this.preferencesList.push(createPreference({
      kind: 'preferShareContainer',
      leftRef: createRef('item', leftItemId),
      rightRef: createRef('item', rightItemId),
      weight,
    }));
    return this;
  }

  allowed(itemId, containerIds) {
    const item = this.itemsList.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error(`Unknown item '${itemId}' in allowed().`);
    }

    item.metadata = {
      ...item.metadata,
      allowedContainerIds: [...containerIds],
    };
    return this;
  }

  forbidden(itemId, containerIds) {
    const item = this.itemsList.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error(`Unknown item '${itemId}' in forbidden().`);
    }

    item.metadata = {
      ...item.metadata,
      forbiddenContainerIds: [...containerIds],
    };
    return this;
  }

  build() {
    return createEmptyProject({
      assignmentMode: this.assignmentModeValue,
      items: this.itemsList,
      groups: this.groupsList,
      containers: this.containersList,
      positions: this.positionsList,
      containments: this.containmentsList,
      topologies: this.topologiesList,
      constraints: this.constraintsList,
      preferences: this.preferencesList,
    });
  }

  buildNormalized() {
    return normalizeProject(this.build());
  }
}

export function scenario() {
  return new ScenarioBuilder();
}

export function buildAssignmentIndex(solution) {
  return new Map(solution.assignments.map((assignment) => [assignment.itemRef.id, assignment]));
}

export function buildAdjacencyIndex(project) {
  const adjacency = new Map();

  project.topologies
    .filter((relation) => relation.kind === RELATION_KINDS.ADJACENT)
    .forEach((relation) => {
      const leftNeighbors = adjacency.get(relation.from.id) ?? new Set();
      leftNeighbors.add(relation.to.id);
      adjacency.set(relation.from.id, leftNeighbors);

      const rightNeighbors = adjacency.get(relation.to.id) ?? new Set();
      rightNeighbors.add(relation.from.id);
      adjacency.set(relation.to.id, rightNeighbors);
    });

  return adjacency;
}

export function buildContainerIndex(project) {
  return createNamedMap(project.containers);
}
