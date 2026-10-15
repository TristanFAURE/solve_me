import { describe, expect, it } from 'vitest';
import { createContainer, createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { normalizeProject } from '../../src/core/normalize/normalizeProject.js';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';

describe('solver runtime hooks', () => {
  it('reports an incumbent separately and ignores observer failures', () => {
    const project = createEmptyProject();
    project.items.push(createItem({ id: 'item', label: 'Item' }));
    project.containers.push(createContainer({ id: 'container', label: 'Container', maxCapacity: 1 }));
    const incumbents = [];
    const result = new FirstSolverAdapter().solve(normalizeProject(project), { mode: 'first', maxSolutions: 1 }, {
      onProgress() { throw new Error('observer failure'); },
      onIncumbent(snapshot) { incumbents.push(snapshot); },
    });

    expect(result.status).toBe('solved');
    expect(incumbents).toHaveLength(1);
    expect(incumbents[0].bestSolution.assignments).toHaveLength(1);
  });
});
