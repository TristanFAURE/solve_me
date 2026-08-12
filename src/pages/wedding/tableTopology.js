import { createId } from '../../core/model/ids.js';
import { createPosition } from '../../core/model/nodes.js';
import { createAdjacencyRelation, createContainmentRelation, createEntityRef } from '../../core/model/relations.js';

export const WEDDING_TABLE_SHAPES = {
  ROUND: 'round',
  SQUARE: 'square',
  RECTANGLE: 'rectangle',
};

export function getWeddingTableShape(table) {
  const shape = table?.metadata?.shape;
  return Object.values(WEDDING_TABLE_SHAPES).includes(shape) ? shape : WEDDING_TABLE_SHAPES.ROUND;
}

export function getTableGenerationMode(table) {
  return table?.metadata?.generationMode || 'auto';
}

export function getSeatTableId(project, seatId) {
  return (project?.containments ?? []).find((relation) => relation?.from?.kind === 'container' && relation?.to?.kind === 'position' && relation.to.id === seatId)?.from?.id ?? null;
}

export function getSeatsForTable(project, tableId) {
  const seatIds = new Set(
    (project?.containments ?? [])
      .filter((relation) => relation?.from?.kind === 'container' && relation?.from?.id === tableId && relation?.to?.kind === 'position')
      .map((relation) => relation.to.id),
  );

  return (project?.positions ?? []).filter((seat) => seatIds.has(seat.id));
}

export function getGeneratedSeatsForTable(project, tableId) {
  return getSeatsForTable(project, tableId)
    .filter((seat) => seat?.metadata?.generated)
    .sort((left, right) => (left?.metadata?.seatIndex ?? Number.MAX_SAFE_INTEGER) - (right?.metadata?.seatIndex ?? Number.MAX_SAFE_INTEGER));
}

export function buildRingAdjacency(seatIds) {
  if (!Array.isArray(seatIds) || seatIds.length < 2) {
    return [];
  }

  const relations = [];
  for (let index = 0; index < seatIds.length; index += 1) {
    const fromId = seatIds[index];
    const toId = seatIds[(index + 1) % seatIds.length];
    if (!fromId || !toId || fromId === toId) {
      continue;
    }

    relations.push(createAdjacencyRelation(createEntityRef('position', fromId), createEntityRef('position', toId)));
  }

  return relations;
}

export function removeSeatsForTable(project, tableId) {
  const tableSeatIds = new Set(getSeatsForTable(project, tableId).map((seat) => seat.id));

  project.positions = (project.positions ?? []).filter((seat) => !tableSeatIds.has(seat.id));
  project.containments = (project.containments ?? []).filter(
    (relation) => !(relation?.from?.kind === 'container' && relation?.from?.id === tableId && relation?.to?.kind === 'position'),
  );
  project.topologies = (project.topologies ?? []).filter(
    (relation) => !tableSeatIds.has(relation?.from?.id) && !tableSeatIds.has(relation?.to?.id),
  );
}

export function setTableGenerationMode(table, generationMode) {
  if (!table.metadata) {
    table.metadata = {};
  }

  table.metadata.generationMode = generationMode;
}

export function setTableShape(table, shape) {
  if (!table.metadata) {
    table.metadata = {};
  }

  table.metadata.shape = Object.values(WEDDING_TABLE_SHAPES).includes(shape) ? shape : WEDDING_TABLE_SHAPES.ROUND;
}

export function generateSeatsForTable(project, table) {
  const maxCapacity = table?.metadata?.maxCapacity;
  if (!Number.isInteger(maxCapacity) || maxCapacity <= 0) {
    return { createdSeatCount: 0, shape: getWeddingTableShape(table) };
  }

  removeSeatsForTable(project, table.id);

  const shape = getWeddingTableShape(table);
  const createdSeatIds = [];

  for (let index = 1; index <= maxCapacity; index += 1) {
    const seatId = createId('position');
    createdSeatIds.push(seatId);
    project.positions.push(createPosition({
      id: seatId,
      label: `${table.label || 'Table'} ${index}`,
      metadata: {
        generated: true,
        seatIndex: index,
        tableShape: shape,
      },
    }));
    project.containments.push(
      createContainmentRelation(createEntityRef('container', table.id), createEntityRef('position', seatId)),
    );
  }

  project.topologies.push(...buildRingAdjacency(createdSeatIds));

  if (!table.metadata) {
    table.metadata = {};
  }

  table.metadata.generatedSeatCount = createdSeatIds.length;
  setTableGenerationMode(table, 'auto');

  return {
    createdSeatCount: createdSeatIds.length,
    shape,
  };
}

export function findGeneratedNeighbor(project, tableId, seatId, direction) {
  const seats = getGeneratedSeatsForTable(project, tableId);
  const currentIndex = seats.findIndex((seat) => seat.id === seatId);
  if (currentIndex === -1 || seats.length < 2) {
    return null;
  }

  const neighborIndex = direction === 'left'
    ? (currentIndex - 1 + seats.length) % seats.length
    : (currentIndex + 1) % seats.length;

  return seats[neighborIndex] ?? null;
}

export function hasAdjacency(project, leftSeatId, rightSeatId) {
  return (project?.topologies ?? []).some((relation) => {
    const fromId = relation?.from?.id;
    const toId = relation?.to?.id;
    return (fromId === leftSeatId && toId === rightSeatId) || (fromId === rightSeatId && toId === leftSeatId);
  });
}

export function removeAdjacencyBetween(project, leftSeatId, rightSeatId) {
  project.topologies = (project.topologies ?? []).filter((relation) => {
    const fromId = relation?.from?.id;
    const toId = relation?.to?.id;
    return !((fromId === leftSeatId && toId === rightSeatId) || (fromId === rightSeatId && toId === leftSeatId));
  });
}

export function removeGeneratedSeatAdjacency(project, table, seatId, direction) {
  const neighbor = findGeneratedNeighbor(project, table.id, seatId, direction);
  if (!neighbor) {
    return false;
  }

  removeAdjacencyBetween(project, seatId, neighbor.id);
  setTableGenerationMode(table, 'manual-adjusted');
  return true;
}

export function removeGeneratedSeatBothSides(project, table, seatId) {
  const removedLeft = removeGeneratedSeatAdjacency(project, table, seatId, 'left');
  const removedRight = removeGeneratedSeatAdjacency(project, table, seatId, 'right');
  return removedLeft || removedRight;
}
