import { expect } from 'vitest';
import { buildAdjacencyIndex, buildAssignmentIndex } from './projectBuilder.js';

function getAssignment(solution, itemId) {
  const assignment = buildAssignmentIndex(solution).get(itemId);
  expect(assignment, `Missing assignment for '${itemId}'.`).toBeDefined();
  return assignment;
}

export function expectSolved(result) {
  expect(result.status).toBe('solved');
  expect(result.solutions.length).toBeGreaterThan(0);
}

export function expectUnsat(result) {
  expect(result.status).toBe('unsat');
  expect(result.solutions).toHaveLength(0);
}

export function expectValidationError(validation, expectedMessagePart) {
  expect(validation.valid).toBe(false);
  expect(validation.errors.some((message) => message.includes(expectedMessagePart))).toBe(true);
}

export function expectEverySolution(result, predicate) {
  result.solutions.forEach((solution) => {
    expect(predicate(solution)).toBe(true);
  });
}

export function inSameContainer(leftItemId, rightItemId) {
  return (solution) => getAssignment(solution, leftItemId).containerRef?.id === getAssignment(solution, rightItemId).containerRef?.id;
}

export function notInSameContainer(leftItemId, rightItemId) {
  return (solution) => getAssignment(solution, leftItemId).containerRef?.id !== getAssignment(solution, rightItemId).containerRef?.id;
}

export function assignedToContainer(itemId, containerId) {
  return (solution) => getAssignment(solution, itemId).containerRef?.id === containerId;
}

export function areAdjacent(project, leftItemId, rightItemId) {
  const adjacencyIndex = buildAdjacencyIndex(project);

  return (solution) => {
    const leftPositionId = getAssignment(solution, leftItemId).positionRef?.id;
    const rightPositionId = getAssignment(solution, rightItemId).positionRef?.id;

    if (!leftPositionId || !rightPositionId) {
      return false;
    }

    return adjacencyIndex.get(leftPositionId)?.has(rightPositionId) ?? false;
  };
}

export function areNotAdjacent(project, leftItemId, rightItemId) {
  const adjacencyIndex = buildAdjacencyIndex(project);

  return (solution) => {
    const leftPositionId = getAssignment(solution, leftItemId).positionRef?.id;
    const rightPositionId = getAssignment(solution, rightItemId).positionRef?.id;

    if (!leftPositionId || !rightPositionId) {
      return false;
    }

    return !(adjacencyIndex.get(leftPositionId)?.has(rightPositionId) ?? false);
  };
}
