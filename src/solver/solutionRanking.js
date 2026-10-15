import { createSolution } from '../core/model/solution.js';
import { evaluateObjectives } from './objectives.js';

function assignmentKey(assignment) {
  return JSON.stringify([
    assignment.containerRef?.id ?? null,
    assignment.positionRef?.id ?? null,
    assignment.itemRef.id,
  ]);
}

export function createAssignmentFingerprint(solution) {
  return JSON.stringify(solution.assignments.map(assignmentKey).sort());
}

export function assignmentDistance(left, right) {
  const leftSet = new Set(left.assignments.map(assignmentKey));
  const rightSet = new Set(right.assignments.map(assignmentKey));
  let distance = 0;
  leftSet.forEach((key) => {
    if (!rightSet.has(key)) distance += 1;
  });
  rightSet.forEach((key) => {
    if (!leftSet.has(key)) distance += 1;
  });
  return distance;
}

export function rankUniqueSolutions(solutions, model, options) {
  const unique = new Map();
  solutions.forEach((solution) => {
    const fingerprint = createAssignmentFingerprint(solution);
    if (!unique.has(fingerprint)) {
      const scoreDetails = evaluateObjectives(solution, model, options);
      unique.set(fingerprint, createSolution({
        ...solution,
        score: scoreDetails.total,
        scoreDetails: options.includeScoreDetails ? scoreDetails : null,
        fingerprint,
      }));
    }
  });

  return [...unique.values()].sort((left, right) => (
    right.score - left.score || left.fingerprint.localeCompare(right.fingerprint)
  ));
}

export function selectDiverseSolutions(rankedSolutions, maxSolutions, minimumDistance) {
  const selected = [];
  for (const solution of rankedSolutions) {
    const distances = selected.map((existing) => assignmentDistance(solution, existing));
    if (distances.every((distance) => distance >= minimumDistance)) {
      selected.push(createSolution({
        ...solution,
        diversity: {
          minimumAssignmentDistance: minimumDistance,
          nearestSelectedDistance: distances.length > 0 ? Math.min(...distances) : null,
        },
      }));
      if (selected.length >= maxSolutions) break;
    }
  }
  return selected;
}
