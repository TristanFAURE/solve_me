import { ASSIGNMENT_MODES } from '../model/assignmentModes.js';
import { isNode, NODE_KINDS } from '../model/nodes.js';
import { isProject, isViewHint } from '../model/project.js';
import { isRelation, RELATION_KINDS } from '../model/relations.js';

function createError(code, message, path) {
  return { level: 'error', code, message, path };
}

function getAllNodes(project) {
  return [
    ...project.items,
    ...project.groups,
    ...project.containers,
    ...project.positions,
  ];
}

function buildNodeIndex(project) {
  return new Map(getAllNodes(project).map((node) => [node.id, node]));
}

function validateNodeCollection(nodes, expectedKind, path) {
  const errors = [];
  const ids = new Set();

  nodes.forEach((node, index) => {
    const nodePath = `${path}[${index}]`;

    if (!isNode(node)) {
      errors.push(createError('invalid-node-shape', `Invalid node shape at ${nodePath}.`, nodePath));
      return;
    }

    if (node.kind !== expectedKind) {
      errors.push(
        createError(
          'unexpected-node-kind',
          `Node at ${nodePath} must have kind '${expectedKind}'.`,
          `${nodePath}.kind`,
        ),
      );
    }

    if (ids.has(node.id)) {
      errors.push(createError('duplicate-node-id', `Duplicate node id '${node.id}'.`, `${nodePath}.id`));
    }

    ids.add(node.id);
  });

  return errors;
}

function validateContainmentRelations(project, nodeIndex) {
  const errors = [];
  const seenContainments = new Set();
  const positionParents = new Map();

  project.containments.forEach((relation, index) => {
    const path = `containments[${index}]`;

    if (!isRelation(relation) || relation.kind !== RELATION_KINDS.CONTAINS) {
      errors.push(createError('invalid-containment', `Containment at ${path} must be a valid contains relation.`, path));
      return;
    }

    const fromNode = nodeIndex.get(relation.from.id);
    const toNode = nodeIndex.get(relation.to.id);

    if (!fromNode) {
      errors.push(createError('unknown-containment-source', `Unknown containment source '${relation.from.id}'.`, `${path}.from.id`));
      return;
    }

    if (!toNode) {
      errors.push(createError('unknown-containment-target', `Unknown containment target '${relation.to.id}'.`, `${path}.to.id`));
      return;
    }

    const containmentKey = `${relation.from.id}->${relation.to.id}`;
    if (seenContainments.has(containmentKey)) {
      errors.push(createError('duplicate-containment', `Duplicate containment '${containmentKey}'.`, path));
    }
    seenContainments.add(containmentKey);

    const isGroupMembership = fromNode.kind === NODE_KINDS.GROUP && toNode.kind === NODE_KINDS.ITEM;
    const isContainerPosition = fromNode.kind === NODE_KINDS.CONTAINER && toNode.kind === NODE_KINDS.POSITION;

    if (!isGroupMembership && !isContainerPosition) {
      errors.push(
        createError(
          'invalid-containment-shape',
          `Containment at ${path} must be Group->Item or Container->Position.`,
          path,
        ),
      );
    }

    if (isContainerPosition) {
      const existingParent = positionParents.get(toNode.id);
      if (existingParent && existingParent !== fromNode.id) {
        errors.push(
          createError(
            'position-multiple-parents',
            `Position '${toNode.id}' cannot belong to multiple containers.`,
            `${path}.to.id`,
          ),
        );
      }
      positionParents.set(toNode.id, fromNode.id);
    }
  });

  return errors;
}

function validateTopologyRelations(project, nodeIndex) {
  const errors = [];
  const seenAdjacency = new Set();

  project.topologies.forEach((relation, index) => {
    const path = `topologies[${index}]`;

    if (!isRelation(relation) || relation.kind !== RELATION_KINDS.ADJACENT) {
      errors.push(createError('invalid-topology', `Topology relation at ${path} must be an adjacency relation.`, path));
      return;
    }

    const fromNode = nodeIndex.get(relation.from.id);
    const toNode = nodeIndex.get(relation.to.id);

    if (!fromNode) {
      errors.push(createError('unknown-topology-source', `Unknown topology source '${relation.from.id}'.`, `${path}.from.id`));
      return;
    }

    if (!toNode) {
      errors.push(createError('unknown-topology-target', `Unknown topology target '${relation.to.id}'.`, `${path}.to.id`));
      return;
    }

    if (fromNode.kind !== NODE_KINDS.POSITION || toNode.kind !== NODE_KINDS.POSITION) {
      errors.push(createError('invalid-topology-shape', `Adjacency at ${path} must connect Position nodes only.`, path));
      return;
    }

    if (fromNode.id === toNode.id) {
      errors.push(createError('self-adjacency', `Adjacency at ${path} cannot connect a position to itself.`, path));
    }

    const adjacencyKey = [fromNode.id, toNode.id].sort().join('::');
    if (seenAdjacency.has(adjacencyKey)) {
      errors.push(createError('duplicate-adjacency', `Duplicate adjacency '${adjacencyKey}'.`, path));
    }
    seenAdjacency.add(adjacencyKey);
  });

  return errors;
}

function validatePositionContainment(project, nodeIndex) {
  const errors = [];
  const containedPositionIds = new Set(
    project.containments
      .filter((relation) => relation.kind === RELATION_KINDS.CONTAINS)
      .filter((relation) => nodeIndex.get(relation.from.id)?.kind === NODE_KINDS.CONTAINER)
      .map((relation) => relation.to.id),
  );

  project.positions.forEach((position, index) => {
    if (!containedPositionIds.has(position.id)) {
      errors.push(
        createError(
          'position-without-container',
          `Position '${position.id}' must belong to exactly one container.`,
          `positions[${index}]`,
        ),
      );
    }
  });

  return errors;
}

function validateContainerCapacities(project) {
  const errors = [];

  project.containers.forEach((container, index) => {
    const path = `containers[${index}].metadata`;
    const minCapacity = container.metadata?.minCapacity ?? 0;
    const maxCapacity = container.metadata?.maxCapacity ?? null;

    if (!Number.isInteger(minCapacity) || minCapacity < 0) {
      errors.push(createError('invalid-min-capacity', `Container '${container.id}' has invalid minCapacity.`, `${path}.minCapacity`));
    }

    if (maxCapacity !== null && (!Number.isInteger(maxCapacity) || maxCapacity < 0)) {
      errors.push(createError('invalid-max-capacity', `Container '${container.id}' has invalid maxCapacity.`, `${path}.maxCapacity`));
    }

    if (maxCapacity !== null && Number.isInteger(minCapacity) && minCapacity > maxCapacity) {
      errors.push(createError('capacity-range-invalid', `Container '${container.id}' has minCapacity greater than maxCapacity.`, path));
    }
  });

  return errors;
}

function validatePositionCapacityConsistency(project, nodeIndex) {
  const errors = [];
  const positionsByContainer = new Map();

  project.containments
    .filter((relation) => relation.kind === RELATION_KINDS.CONTAINS)
    .forEach((relation) => {
      const fromNode = nodeIndex.get(relation.from.id);
      const toNode = nodeIndex.get(relation.to.id);

      if (fromNode?.kind === NODE_KINDS.CONTAINER && toNode?.kind === NODE_KINDS.POSITION) {
        const positions = positionsByContainer.get(fromNode.id) ?? [];
        positions.push(toNode.id);
        positionsByContainer.set(fromNode.id, positions);
      }
    });

  project.containers.forEach((container, index) => {
    const maxCapacity = container.metadata?.maxCapacity ?? null;
    const positionCount = (positionsByContainer.get(container.id) ?? []).length;

    if (project.assignmentMode === ASSIGNMENT_MODES.POSITION && positionCount === 0) {
      errors.push(createError('container-without-positions', `Container '${container.id}' must contain positions in position mode.`, `containers[${index}]`));
    }

    if (project.assignmentMode === ASSIGNMENT_MODES.POSITION && maxCapacity !== null && positionCount > 0 && maxCapacity !== positionCount) {
      errors.push(
        createError(
          'capacity-position-mismatch',
          `Container '${container.id}' maxCapacity must match its number of positions in position mode.`,
          `containers[${index}].metadata.maxCapacity`,
        ),
      );
    }
  });

  return errors;
}

export function validateStructure(project) {
  if (!isProject(project)) {
    return [createError('invalid-project-shape', 'Project is missing required top-level structure.', 'project')];
  }

  const errors = [
    ...validateNodeCollection(project.items, NODE_KINDS.ITEM, 'items'),
    ...validateNodeCollection(project.groups, NODE_KINDS.GROUP, 'groups'),
    ...validateNodeCollection(project.containers, NODE_KINDS.CONTAINER, 'containers'),
    ...validateNodeCollection(project.positions, NODE_KINDS.POSITION, 'positions'),
  ];

  if (!isViewHint(project.viewHint)) {
    errors.push(createError('invalid-view-hint', `Invalid viewHint '${project.viewHint}'.`, 'viewHint'));
  }

  const nodeIndex = buildNodeIndex(project);
  const totalNodeCount = getAllNodes(project).length;

  if (nodeIndex.size !== totalNodeCount) {
    errors.push(createError('duplicate-node-id-global', 'Node ids must be globally unique across all node collections.', 'nodes'));
  }

  errors.push(...validateContainmentRelations(project, nodeIndex));
  errors.push(...validateTopologyRelations(project, nodeIndex));
  errors.push(...validateContainerCapacities(project));

  if (project.assignmentMode === ASSIGNMENT_MODES.POSITION) {
    errors.push(...validatePositionContainment(project, nodeIndex));
    errors.push(...validatePositionCapacityConsistency(project, nodeIndex));
  }

  return errors;
}
