import { isEntityRef } from './relations.js';

export function createAssignment({ itemRef, containerRef = null, positionRef = null, metadata = {} }) {
  return {
    itemRef,
    containerRef,
    positionRef,
    metadata,
  };
}

export function isAssignment(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    isEntityRef(value.itemRef) &&
    (value.containerRef === null || isEntityRef(value.containerRef)) &&
    (value.positionRef === null || isEntityRef(value.positionRef)),
  );
}

export function createSolution({ assignments = [], score = null, violations = [], metadata = {} } = {}) {
  return {
    assignments,
    score,
    violations,
    metadata,
  };
}

export function isSolution(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isAssignment) &&
    Array.isArray(value.violations),
  );
}
