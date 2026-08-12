function addNeighbor(adjacencyMap, fromId, toId) {
  const neighbors = adjacencyMap.get(fromId) ?? new Set();
  neighbors.add(toId);
  adjacencyMap.set(fromId, neighbors);
}

export function buildTopology(project) {
  const adjacencyMap = new Map();

  project.topologies.forEach((relation) => {
    addNeighbor(adjacencyMap, relation.from.id, relation.to.id);
    addNeighbor(adjacencyMap, relation.to.id, relation.from.id);
  });

  return {
    project,
    adjacencyMap,
  };
}
