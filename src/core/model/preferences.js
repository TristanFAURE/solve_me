import { isEntityRef } from './relations.js';

export const PREFERENCE_KINDS = {
  PREFER_SHARE_CONTAINER: 'preferShareContainer',
  PREFER_SEPARATE_CONTAINERS: 'preferSeparateContainers',
  PREFER_ADJACENT: 'preferAdjacent',
  PREFER_NON_ADJACENT: 'preferNonAdjacent',
};

export function isPreferenceKind(value) {
  return Object.values(PREFERENCE_KINDS).includes(value);
}

export function createPreference({ kind, leftRef, rightRef, weight = 1, metadata = {} }) {
  return {
    kind,
    leftRef,
    rightRef,
    weight,
    metadata,
  };
}

export function isPreference(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    isPreferenceKind(value.kind) &&
    isEntityRef(value.leftRef) &&
    isEntityRef(value.rightRef) &&
    Number.isFinite(value.weight) &&
    value.weight >= 0,
  );
}
