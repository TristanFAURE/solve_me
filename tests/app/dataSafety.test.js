import { describe, expect, it, vi } from 'vitest';
import { confirmProjectReplacement, hasProjectWork } from '../../src/app/dataSafety.js';
import { createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../src/core/model/project.js';

describe('project replacement confirmation policy', () => {
  it('does not prompt for an empty project', () => {
    const confirm = vi.fn(() => false);
    const project = createEmptyProject({ viewHint: VIEW_HINTS.SCHOOL, title: 'School scenario' });

    expect(hasProjectWork(project)).toBe(false);
    expect(confirmProjectReplacement(project, 'Replace?', confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('cancels replacement of non-empty work when confirmation is declined', () => {
    const confirm = vi.fn(() => false);
    const project = createEmptyProject({
      items: [createItem({ id: 'item-1', label: 'Existing item' })],
    });

    expect(confirmProjectReplacement(project, 'Replace?', confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Replace?');
    expect(project.items).toHaveLength(1);
  });

  it('fails closed outside a browser when non-empty work needs confirmation', () => {
    const project = createEmptyProject({ description: 'Authored notes' });

    expect(confirmProjectReplacement(project, 'Replace?', null)).toBe(false);
  });
});
