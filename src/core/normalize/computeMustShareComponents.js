import { CONSTRAINT_KINDS } from '../model/constraints.js';

function addEdge(graph, leftId, rightId) {
  const leftNeighbors = graph.get(leftId) ?? new Set();
  leftNeighbors.add(rightId);
  graph.set(leftId, leftNeighbors);

  const rightNeighbors = graph.get(rightId) ?? new Set();
  rightNeighbors.add(leftId);
  graph.set(rightId, rightNeighbors);
}

export function computeMustShareComponents(project) {
  const graph = new Map();

  project.constraints
    .filter((constraint) => constraint.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER)
    .forEach((constraint) => {
      addEdge(graph, constraint.leftRef.id, constraint.rightRef.id);
    });

  const visited = new Set();
  const components = [];

  graph.forEach((_, nodeId) => {
    if (visited.has(nodeId)) {
      return;
    }

    const stack = [nodeId];
    const members = [];
    visited.add(nodeId);

    while (stack.length > 0) {
      const current = stack.pop();
      members.push(current);

      for (const neighbor of graph.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    components.push(members);
  });

  return components;
}
