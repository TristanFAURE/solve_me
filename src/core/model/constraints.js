import { isEntityRef } from './relations.js';

export const CONSTRAINT_KINDS = {
  MUST_SHARE_CONTAINER: 'mustShareContainer',
  MUST_NOT_SHARE_CONTAINER: 'mustNotShareContainer',
  MUST_BE_ADJACENT: 'mustBeAdjacent',
  MUST_NOT_BE_ADJACENT: 'mustNotBeAdjacent',
};

export function isConstraintKind(value) {
  return Object.values(CONSTRAINT_KINDS).includes(value);
}

export function createConstraint({ kind, leftRef, rightRef, metadata = {} }) {
  return {
    kind,
    leftRef,
    rightRef,
    metadata,
  };
}

export function isConstraint(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    isConstraintKind(value.kind) &&
    isEntityRef(value.leftRef) &&
    isEntityRef(value.rightRef),
  );
}
