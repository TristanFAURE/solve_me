import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../../src/core/normalize/normalizeProject.js';
import { createContainer, createItem, createPosition } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createPreference, PREFERENCE_KINDS } from '../../src/core/model/preferences.js';
import { createAdjacencyRelation, createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';

const ref = (kind, id) => createEntityRef(kind, id);

function solve(project) {
  return new FirstSolverAdapter().solve(normalizeProject(project), {
    mode: 'topK',
    maxSolutions: 20,
    includeScoreDetails: true,
    scoreWeights: { preferences: 1, targets: 0, equity: 0 },
  });
}

describe('general relation preference optimization', () => {
  it.each([
    [PREFERENCE_KINDS.PREFER_SHARE_CONTAINER, true],
    [PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS, false],
  ])('ranks %s container solutions', (kind, shouldShare) => {
    const project = createEmptyProject({
      items: [createItem({ id: 'a', label: 'A' }), createItem({ id: 'b', label: 'B' })],
      containers: [createContainer({ id: 'left', label: 'Left', maxCapacity: 2 }), createContainer({ id: 'right', label: 'Right', maxCapacity: 2 })],
      preferences: [createPreference({ kind, leftRef: ref('item', 'a'), rightRef: ref('item', 'b'), weight: 7 })],
    });
    const result = solve(project);
    const assignments = new Map(result.solutions[0].assignments.map((assignment) => [assignment.itemRef.id, assignment.containerRef.id]));
    expect(assignments.get('a') === assignments.get('b')).toBe(shouldShare);
    expect(result.solutions[0].scoreDetails.assignmentScores).toBe(7);
    expect(result.solutions[0].scoreDetails.relationPreferences).toEqual({ satisfied: 1, total: 1, satisfiedWeight: 7, totalWeight: 7 });
  });

  it('ranks adjacency and non-adjacency preferences in position mode', () => {
    const positions = ['one', 'two', 'three'].map((id) => createPosition({ id, label: id }));
    const project = createEmptyProject({
      assignmentMode: 'position',
      items: [createItem({ id: 'a', label: 'A' }), createItem({ id: 'b', label: 'B' })],
      containers: [createContainer({ id: 'table', label: 'Table', maxCapacity: 3 })],
      positions,
      containments: positions.map((position) => createContainmentRelation(ref('container', 'table'), ref('position', position.id))),
      topologies: [createAdjacencyRelation(ref('position', 'one'), ref('position', 'two'))],
      preferences: [createPreference({ kind: PREFERENCE_KINDS.PREFER_NON_ADJACENT, leftRef: ref('item', 'a'), rightRef: ref('item', 'b'), weight: 5 })],
    });
    const result = solve(project);
    const assigned = new Map(result.solutions[0].assignments.map((assignment) => [assignment.itemRef.id, assignment.positionRef.id]));
    expect(new Set([assigned.get('a'), assigned.get('b')])).toEqual(new Set(['one', 'three']));
    expect(result.solutions[0].scoreDetails.assignmentScores).toBe(5);
    expect(result.solutions[0].scoreDetails.relationPreferences.satisfied).toBe(1);
  });

  it('uses adjacency preferences to guide the first incumbent in a larger seat plan', () => {
    const positions = Array.from({ length: 18 }, (_, index) => createPosition({ id: `p-${index}`, label: `Seat ${index + 1}` }));
    const items = [
      createItem({ id: 'juliette', label: 'Juliette' }),
      createItem({ id: 'florence', label: 'Florence' }),
      ...Array.from({ length: 8 }, (_, index) => createItem({ id: `other-${index}`, label: `Other ${index}` })),
    ];
    const project = createEmptyProject({
      assignmentMode: 'position',
      items,
      containers: [createContainer({ id: 'table', label: 'Table', maxCapacity: 18 })],
      positions,
      containments: positions.map((position) => createContainmentRelation(ref('container', 'table'), ref('position', position.id))),
      topologies: positions.map((position, index) => createAdjacencyRelation(ref('position', position.id), ref('position', positions[(index + 1) % positions.length].id))),
      preferences: [createPreference({ kind: PREFERENCE_KINDS.PREFER_ADJACENT, leftRef: ref('item', 'juliette'), rightRef: ref('item', 'florence'), weight: 10 })],
    });
    const result = new FirstSolverAdapter().solve(normalizeProject(project), { mode: 'first', includeScoreDetails: true });
    const assigned = new Map(result.solutions[0].assignments.map((assignment) => [assignment.itemRef.id, assignment.positionRef.id]));
    const adjacency = normalizeProject(project).derived.adjacencyMap;
    expect(adjacency.get(assigned.get('juliette')).has(assigned.get('florence'))).toBe(true);
    expect(result.solutions[0].scoreDetails.relationPreferences.satisfied).toBe(1);
  });

  it('places preferred adjacency endpoints before a large must-share group fills neighboring seats', () => {
    const positions = Array.from({ length: 18 }, (_, index) => createPosition({ id: `seat-${index}`, label: `Seat ${index + 1}` }));
    const groupMembers = ['tristan', 'juliette', ...Array.from({ length: 12 }, (_, index) => `group-${index}`)];
    const items = [...groupMembers, 'florence', 'clement', 'florent'].map((id) => createItem({ id, label: id }));
    const mustShare = [];
    groupMembers.forEach((left, index) => groupMembers.slice(index + 1).forEach((right) => mustShare.push({
      kind: 'mustShareContainer', leftRef: ref('item', left), rightRef: ref('item', right), metadata: {},
    })));
    const project = createEmptyProject({
      assignmentMode: 'position',
      items,
      containers: [createContainer({ id: 'large', label: 'Large', maxCapacity: 18 })],
      positions,
      containments: positions.map((position) => createContainmentRelation(ref('container', 'large'), ref('position', position.id))),
      topologies: positions.map((position, index) => createAdjacencyRelation(ref('position', position.id), ref('position', positions[(index + 1) % positions.length].id))),
      constraints: [
        ...mustShare,
        { kind: 'mustBeAdjacent', leftRef: ref('item', 'tristan'), rightRef: ref('item', 'juliette'), metadata: {} },
        { kind: 'mustBeAdjacent', leftRef: ref('item', 'florence'), rightRef: ref('item', 'clement'), metadata: {} },
      ],
      preferences: [
        createPreference({ kind: PREFERENCE_KINDS.PREFER_ADJACENT, leftRef: ref('item', 'florence'), rightRef: ref('item', 'juliette'), weight: 1 }),
        createPreference({ kind: PREFERENCE_KINDS.PREFER_ADJACENT, leftRef: ref('item', 'florent'), rightRef: ref('item', 'tristan'), weight: 1 }),
      ],
    });
    const normalized = normalizeProject(project);
    const result = new FirstSolverAdapter().solve(normalized, { mode: 'first', includeScoreDetails: true });
    expect(result.solutions[0].scoreDetails.relationPreferences).toMatchObject({ satisfied: 2, total: 2 });
  });
});
