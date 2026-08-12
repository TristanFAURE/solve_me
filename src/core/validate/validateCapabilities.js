import { CONSTRAINT_KINDS } from '../model/constraints.js';
import { PREFERENCE_KINDS } from '../model/preferences.js';

function createError(code, message, path) {
  return { level: 'error', code, message, path };
}

function createWarning(code, message, path) {
  return { level: 'warning', code, message, path };
}

export function validateCapabilities(project, capabilities) {
  if (!capabilities) {
    return { errors: [], warnings: [] };
  }

  const errors = [];
  const warnings = [];

  project.constraints.forEach((constraint, index) => {
    const usesAdjacency = [
      CONSTRAINT_KINDS.MUST_BE_ADJACENT,
      CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT,
    ].includes(constraint.kind);

    if (usesAdjacency && !capabilities.adjacency) {
      errors.push(
        createError(
          'unsupported-adjacency-constraint',
          `Active solver does not support adjacency constraint '${constraint.kind}'.`,
          `constraints[${index}].kind`,
        ),
      );
    }
  });

  project.preferences.forEach((preference, index) => {
    if (!capabilities.softPreferences) {
      warnings.push(
        createWarning(
          'unsupported-soft-preference',
          `Active solver may ignore preference '${preference.kind}'.`,
          `preferences[${index}].kind`,
        ),
      );
      return;
    }

    const usesAdjacency = [
      PREFERENCE_KINDS.PREFER_ADJACENT,
      PREFERENCE_KINDS.PREFER_NON_ADJACENT,
    ].includes(preference.kind);

    if (usesAdjacency && !capabilities.adjacency) {
      errors.push(
        createError(
          'unsupported-adjacency-preference',
          `Active solver does not support adjacency preference '${preference.kind}'.`,
          `preferences[${index}].kind`,
        ),
      );
    }

    if (preference.weight !== 1 && !capabilities.weightedPreferences) {
      warnings.push(
        createWarning(
          'unsupported-weighted-preference',
          `Active solver may ignore non-default weight on preference '${preference.kind}'.`,
          `preferences[${index}].weight`,
        ),
      );
    }
  });

  return { errors, warnings };
}
