import { isNonEmptyId } from './ids.js';

export const RELATION_KINDS = {
  CONTAINS: 'contains',
  ADJACENT: 'adjacent',
};

export function isRelationKind(value) {
  return Object.values(RELATION_KINDS).includes(value);
}

export function createEntityRef(kind, id) {
  return { kind, id };
}

export function isEntityRef(value) {
  return Boolean(
    value && typeof value === 'object' && typeof value.kind === 'string' && isNonEmptyId(value.id),
  );
}

export function createRelation({ kind, from, to, metadata = {} }) {
  return {
    kind,
    from,
    to,
    metadata,
  };
}

export function createContainmentRelation(from, to, metadata = {}) {
  return createRelation({
    kind: RELATION_KINDS.CONTAINS,
    from,
    to,
    metadata,
  });
}

export function createAdjacencyRelation(from, to, metadata = {}) {
  return createRelation({
    kind: RELATION_KINDS.ADJACENT,
    from,
    to,
    metadata,
  });
}

export function isRelation(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    isRelationKind(value.kind) &&
    isEntityRef(value.from) &&
    isEntityRef(value.to),
  );
}
