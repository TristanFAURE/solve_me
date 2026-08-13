import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_MODES } from '../../src/core/model/assignmentModes.js';
import { CONSTRAINT_KINDS } from '../../src/core/model/constraints.js';
import { createContainer, createGroup, createItem, createPosition } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createAdjacencyRelation, createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { validateWeddingProject } from '../../src/pages/wedding/validateWeddingProject.js';

function buildWeddingProject() {
  return createEmptyProject({
    assignmentMode: ASSIGNMENT_MODES.POSITION,
    items: [createItem({ id: 'guest-1', label: 'Alex' }), createItem({ id: 'guest-2', label: 'Sam' })],
    groups: [createGroup({ id: 'group-1', label: 'Family' })],
    containers: [createContainer({ id: 'table-1', label: 'Table 1', minCapacity: 0, maxCapacity: 2 })],
    positions: [createPosition({ id: 'seat-1', label: 'Seat 1' }), createPosition({ id: 'seat-2', label: 'Seat 2' })],
    containments: [
      createContainmentRelation(createEntityRef('group', 'group-1'), createEntityRef('item', 'guest-1')),
      createContainmentRelation(createEntityRef('container', 'table-1'), createEntityRef('position', 'seat-1')),
      createContainmentRelation(createEntityRef('container', 'table-1'), createEntityRef('position', 'seat-2')),
    ],
    topologies: [
      createAdjacencyRelation(createEntityRef('position', 'seat-1'), createEntityRef('position', 'seat-2')),
    ],
  });
}

describe('wedding validation', () => {
  it('keeps a minimal seat-aware wedding scenario planner-valid', () => {
    const validation = validateWeddingProject(buildWeddingProject());
    expect(validation.valid).toBe(true);
  });

  it('detects invalid cross-table wedding adjacency', () => {
    const project = buildWeddingProject();
    project.containers.push(createContainer({ id: 'table-2', label: 'Table 2', minCapacity: 0, maxCapacity: 1 }));
    project.positions.push(createPosition({ id: 'seat-3', label: 'Seat 3' }));
    project.containments.push(createContainmentRelation(createEntityRef('container', 'table-2'), createEntityRef('position', 'seat-3')));
    project.topologies.push(createAdjacencyRelation(createEntityRef('position', 'seat-2'), createEntityRef('position', 'seat-3')));

    const validation = validateWeddingProject(project);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'wedding-cross-table-seat-adjacency')).toBe(true);
  });

  it('requires seat-aware mode for adjacency rules', () => {
    const project = buildWeddingProject();
    project.assignmentMode = ASSIGNMENT_MODES.CONTAINER;
    project.constraints.push({
      kind: CONSTRAINT_KINDS.MUST_BE_ADJACENT,
      leftRef: createEntityRef('item', 'guest-1'),
      rightRef: createEntityRef('item', 'guest-2'),
      metadata: {},
    });

    const validation = validateWeddingProject(project);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'wedding-adjacency-needs-seat-mode')).toBe(true);
  });

  it('warns when seat counts do not match table capacity', () => {
    const project = buildWeddingProject();
    project.positions.push(createPosition({ id: 'seat-3', label: 'Seat 3' }));
    project.containments.push(createContainmentRelation(createEntityRef('container', 'table-1'), createEntityRef('position', 'seat-3')));

    const validation = validateWeddingProject(project);
    expect(validation.warnings.some((issue) => issue.code === 'wedding-seat-capacity-mismatch')).toBe(true);
  });
});
