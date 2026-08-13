import { describe, expect, it } from 'vitest';
import { CONSTRAINT_KINDS } from '../../src/core/model/constraints.js';
import { createContainer, createGroup, createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { validateSchoolProject } from '../../src/pages/school/validateSchoolProject.js';

function buildSchoolProject() {
  return createEmptyProject({
    items: [
      createItem({ id: 'student-1', label: 'Alice', metadata: { schoolRole: 'student' } }),
      createItem({ id: 'teacher-1', label: 'Mr Smith', metadata: { schoolRole: 'teacher' } }),
    ],
    groups: [createGroup({ id: 'level-1', label: 'Level 1' })],
    containers: [
      createContainer({
        id: 'class-1',
        label: 'Class 1',
        minCapacity: 0,
        maxCapacity: 1,
        metadata: { acceptedLevelIds: ['level-1'], teacherIds: ['teacher-1'] },
      }),
    ],
    containments: [
      createContainmentRelation(createEntityRef('group', 'level-1'), createEntityRef('item', 'student-1')),
    ],
  });
}

describe('school validation', () => {
  it('keeps a minimal school scenario planner-valid', () => {
    const validation = validateSchoolProject(buildSchoolProject());
    expect(validation.valid).toBe(true);
  });

  it('detects impossible teacher/student school constraints', () => {
    const project = buildSchoolProject();
    project.constraints.push({
      kind: CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
      leftRef: createEntityRef('item', 'teacher-1'),
      rightRef: createEntityRef('item', 'student-1'),
      metadata: {},
    });

    const validation = validateSchoolProject(project);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'school-impossible-separation-rule')).toBe(true);
  });

  it('reports when a student has no compatible class', () => {
    const project = buildSchoolProject();
    project.containers[0].metadata.acceptedLevelIds = ['other-level'];

    const validation = validateSchoolProject(project);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'school-student-no-compatible-class')).toBe(true);
  });

  it('warns when a student belongs to multiple levels', () => {
    const project = buildSchoolProject();
    project.groups.push(createGroup({ id: 'level-2', label: 'Level 2' }));
    project.containments.push(
      createContainmentRelation(createEntityRef('group', 'level-2'), createEntityRef('item', 'student-1')),
    );

    const validation = validateSchoolProject(project);
    expect(validation.warnings.some((issue) => issue.code === 'school-student-multiple-levels')).toBe(true);
  });
});
