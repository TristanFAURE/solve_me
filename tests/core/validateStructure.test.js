import { describe, expect, it } from 'vitest';
import { validateProject } from '../../src/core/validate/validateProject.js';
import { createContainer, createItem, createPosition } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';

function project(minCapacity, maxCapacity = null) {
  const positions = [createPosition({ id: 'p1', label: 'P1' }), createPosition({ id: 'p2', label: 'P2' })];
  return createEmptyProject({
    assignmentMode: 'position',
    items: [createItem({ id: 'a', label: 'A' })],
    containers: [createContainer({ id: 'table', label: 'Table', minCapacity, maxCapacity })],
    positions,
    containments: positions.map((position) => createContainmentRelation(createEntityRef('container', 'table'), createEntityRef('position', position.id))),
  });
}

describe('position-mode capacity validation', () => {
  it('rejects minimum capacity above position count even with unlimited maximum', () => {
    expect(validateProject(project(3)).errors).toContainEqual(expect.objectContaining({ code: 'minimum-capacity-exceeds-positions' }));
  });

  it.each([0, 2])('accepts minimum capacity %s with two positions', (minimum) => {
    expect(validateProject(project(minimum)).errors.some(({ code }) => code === 'minimum-capacity-exceeds-positions')).toBe(false);
  });
});
