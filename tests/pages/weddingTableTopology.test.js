import { describe, expect, it } from 'vitest';
import { createContainer, createItem, createPosition } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createAdjacencyRelation, createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { buildRingAdjacency, removeWeddingTable } from '../../src/pages/wedding/tableTopology.js';

describe('wedding table topology', () => {
  it('builds exactly one undirected adjacency for a two-seat ring', () => {
    const topologies = buildRingAdjacency(['seat-1', 'seat-2']);

    expect(topologies).toHaveLength(1);
    expect(new Set([topologies[0].from.id, topologies[0].to.id])).toEqual(new Set(['seat-1', 'seat-2']));
  });

  it('removes a table, its seats, and their references without changing another table', () => {
    const table1 = createContainer({ id: 'table-1', label: 'Table 1', maxCapacity: 2 });
    const table2 = createContainer({ id: 'table-2', label: 'Table 2', maxCapacity: 2 });
    const seat1 = createPosition({ id: 'seat-1', label: 'Seat 1' });
    const seat2 = createPosition({ id: 'seat-2', label: 'Seat 2' });
    const seat3 = createPosition({ id: 'seat-3', label: 'Seat 3' });
    const seat4 = createPosition({ id: 'seat-4', label: 'Seat 4' });
    const guest = createItem({ id: 'guest-1', label: 'Guest' });
    const project = createEmptyProject({
      items: [guest],
      containers: [table1, table2],
      positions: [seat1, seat2, seat3, seat4],
      containments: [
        createContainmentRelation(createEntityRef('container', table1.id), createEntityRef('position', seat1.id)),
        createContainmentRelation(createEntityRef('container', table1.id), createEntityRef('position', seat2.id)),
        createContainmentRelation(createEntityRef('container', table2.id), createEntityRef('position', seat3.id)),
        createContainmentRelation(createEntityRef('container', table2.id), createEntityRef('position', seat4.id)),
      ],
      topologies: [
        createAdjacencyRelation(createEntityRef('position', seat1.id), createEntityRef('position', seat2.id)),
        createAdjacencyRelation(createEntityRef('position', seat3.id), createEntityRef('position', seat4.id)),
      ],
      fixedAssignments: [
        { itemId: guest.id, destinationId: seat1.id },
        { itemId: guest.id, destinationId: seat3.id },
      ],
      softAssignmentScores: [
        { itemId: guest.id, destinationId: table1.id, score: 1 },
        { itemId: guest.id, destinationId: table2.id, score: 2 },
      ],
    });

    expect(removeWeddingTable(project, table1.id)).toBe(true);
    expect(project.containers).toEqual([table2]);
    expect(project.positions).toEqual([seat3, seat4]);
    expect(project.containments).toHaveLength(2);
    expect(project.containments.every((relation) => relation.from.id === table2.id)).toBe(true);
    expect(project.topologies).toHaveLength(1);
    expect(new Set([project.topologies[0].from.id, project.topologies[0].to.id])).toEqual(new Set([seat3.id, seat4.id]));
    expect(project.fixedAssignments).toEqual([{ itemId: guest.id, destinationId: seat3.id }]);
    expect(project.softAssignmentScores).toEqual([{ itemId: guest.id, destinationId: table2.id, score: 2 }]);
  });
});
