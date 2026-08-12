import { isNonEmptyId } from './ids.js';

export const NODE_KINDS = {
  ITEM: 'item',
  GROUP: 'group',
  CONTAINER: 'container',
  POSITION: 'position',
};

export function isNodeKind(value) {
  return Object.values(NODE_KINDS).includes(value);
}

export function createNode({ id, kind, label, metadata = {} }) {
  return {
    id,
    kind,
    label,
    metadata,
  };
}

export function createItem({ id, label, metadata = {} }) {
  return createNode({ id, kind: NODE_KINDS.ITEM, label, metadata });
}

export function createGroup({ id, label, metadata = {} }) {
  return createNode({ id, kind: NODE_KINDS.GROUP, label, metadata });
}

export function createContainer({ id, label, minCapacity = 0, maxCapacity = null, metadata = {} }) {
  return createNode({
    id,
    kind: NODE_KINDS.CONTAINER,
    label,
    metadata: {
      minCapacity,
      maxCapacity,
      ...metadata,
    },
  });
}

export function createPosition({ id, label, metadata = {} }) {
  return createNode({ id, kind: NODE_KINDS.POSITION, label, metadata });
}

export function isNode(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    isNonEmptyId(value.id) &&
    isNodeKind(value.kind) &&
    typeof value.label === 'string' &&
    value.label.trim().length > 0,
  );
}
