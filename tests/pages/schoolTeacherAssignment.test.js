import { describe, expect, it } from 'vitest';
import { createConstraint, CONSTRAINT_KINDS } from '../../src/core/model/constraints.js';
import { createContainer, createGroup, createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createPreference, PREFERENCE_KINDS } from '../../src/core/model/preferences.js';
import { createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { assignTeachersToSchoolResult, assignTeachersToSchoolSolution } from '../../src/pages/school/teacherAssignment.js';

const ref = (kind, id) => createEntityRef(kind, id);

function project() {
  return createEmptyProject({
    viewHint: 'school',
    items: [
      createItem({ id: 'student', label: 'Student', metadata: { schoolRole: 'student' } }),
      createItem({ id: 'teacher-a', label: 'Teacher A', metadata: { schoolRole: 'teacher', classPreferences: { 'class-b': 'prefer' } } }),
      createItem({ id: 'teacher-b', label: 'Teacher B', metadata: { schoolRole: 'teacher' } }),
    ],
    groups: [createGroup({ id: 'level', label: 'Level' })],
    containers: [
      createContainer({ id: 'class-a', label: 'Class A', maxCapacity: 2, metadata: { acceptedLevelIds: ['level'], teacherIds: ['teacher-b'] } }),
      createContainer({ id: 'class-b', label: 'Class B', maxCapacity: 2, metadata: { acceptedLevelIds: ['level'], teacherIds: [] } }),
    ],
    containments: [
      createContainmentRelation(ref('group', 'level'), ref('item', 'student')),
      createContainmentRelation(ref('group', 'level'), ref('item', 'teacher-a')),
      createContainmentRelation(ref('group', 'level'), ref('item', 'teacher-b')),
    ],
  });
}

const studentSolution = (classId = 'class-a') => ({ assignments: [{ itemRef: ref('item', 'student'), containerRef: ref('container', classId), metadata: { itemLabel: 'Student' } }] });

describe('School teacher assignment', () => {
  it('keeps explicit links hard and optimizes unlinked teacher class preferences', () => {
    const result = assignTeachersToSchoolSolution(project(), studentSolution());
    const assignments = new Map(result.assignments.map((assignment) => [assignment.itemRef.id, assignment.containerRef.id]));
    expect(assignments.get('teacher-b')).toBe('class-a');
    expect(assignments.get('teacher-a')).toBe('class-b');
    expect(result.score).toBe(10);
  });

  it('uses teacher/student relation preferences and hard relationships', () => {
    const value = project();
    value.containers.forEach((classroom) => { classroom.metadata.teacherIds = []; });
    value.preferences = [createPreference({ kind: PREFERENCE_KINDS.PREFER_SHARE_CONTAINER, leftRef: ref('item', 'teacher-a'), rightRef: ref('item', 'student'), weight: 20 })];
    value.constraints = [createConstraint({ kind: CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER, leftRef: ref('item', 'teacher-b'), rightRef: ref('item', 'student') })];
    const result = assignTeachersToSchoolSolution(value, studentSolution('class-a'));
    const assignments = new Map(result.assignments.map((assignment) => [assignment.itemRef.id, assignment.containerRef.id]));
    expect(assignments.get('teacher-a')).toBe('class-a');
    expect(assignments.get('teacher-b')).toBe('class-b');
  });

  it('returns null when fixed links or availability make matching impossible', () => {
    const value = project();
    value.items.find((item) => item.id === 'teacher-b').metadata.classPreferences = { 'class-a': 'unavailable' };
    expect(assignTeachersToSchoolSolution(value, studentSolution())).toBeNull();
  });

  it('merges teacher assignments into every returned solution without mutation', () => {
    const value = project();
    const result = { status: 'solved', solutions: [studentSolution()], warnings: [] };
    const snapshot = structuredClone(result);
    const assigned = assignTeachersToSchoolResult(value, result);
    expect(assigned.solutions[0].assignments).toHaveLength(3);
    expect(assigned.solutions[0].assignments.filter((entry) => entry.metadata.schoolRole === 'teacher')).toHaveLength(2);
    expect(result).toEqual(snapshot);
  });
});
