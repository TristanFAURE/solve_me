import { createEmptyProject, MODEL_VERSION } from '../core/model/project.js';

export function exportProject(project) {
  return JSON.stringify(project, null, 2);
}

export function parseProjectJson(jsonText) {
  return JSON.parse(jsonText);
}

export function coerceImportedProjectShape(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return createEmptyProject({
    ...value,
    modelVersion: value.modelVersion ?? MODEL_VERSION,
    items: Array.isArray(value.items) ? value.items : [],
    groups: Array.isArray(value.groups) ? value.groups : [],
    containers: Array.isArray(value.containers) ? value.containers : [],
    positions: Array.isArray(value.positions) ? value.positions : [],
    containments: Array.isArray(value.containments) ? value.containments : [],
    topologies: Array.isArray(value.topologies) ? value.topologies : [],
    constraints: Array.isArray(value.constraints) ? value.constraints : [],
    preferences: Array.isArray(value.preferences) ? value.preferences : [],
  });
}

export function importProject(jsonText) {
  return coerceImportedProjectShape(parseProjectJson(jsonText));
}
