import { describe, expect, it } from 'vitest';
import { createContainer, createGroup, createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject } from '../../src/core/model/project.js';
import { createAssignment, createSolution } from '../../src/core/model/solution.js';
import { createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { renderSchoolSolutionDisplay } from '../../src/pages/school/schoolSolutionDisplay.js';

const ref = (kind, id) => createEntityRef(kind, id);
const render = (project, result, activeSolutionIndex = 0) => renderSchoolSolutionDisplay({
  project,
  normalizedProject: project,
  result,
  activeSolutionIndex,
});

function buildProject() {
  return createEmptyProject({
    items: [
      createItem({ id: 'student-a', label: 'Alice <A>', metadata: { schoolRole: 'student' } }),
      createItem({ id: 'student-b', label: 'Bob & B', metadata: { schoolRole: 'student' } }),
      createItem({ id: 'student-c', label: 'Cara', metadata: { schoolRole: 'student' } }),
      createItem({ id: 'teacher-a', label: 'Ms <Ada>', metadata: { schoolRole: 'teacher' } }),
      createItem({ id: 'other', label: 'Not a student', metadata: {} }),
    ],
    groups: [
      createGroup({ id: 'level-1', label: 'Level <1>' }),
      createGroup({ id: 'level-2', label: 'Level 2' }),
    ],
    containers: [
      createContainer({
        id: 'class-a',
        label: 'Class <A>',
        minCapacity: 1,
        maxCapacity: 3,
        metadata: { acceptedLevelIds: ['level-1', 'level-2'], teacherIds: ['teacher-a'] },
      }),
      createContainer({
        id: 'class-b',
        label: 'Empty & class',
        maxCapacity: 2,
        metadata: { acceptedLevelIds: [], teacherIds: [] },
      }),
    ],
    containments: [
      createContainmentRelation(ref('group', 'level-1'), ref('item', 'student-a')),
      createContainmentRelation(ref('group', 'level-2'), ref('item', 'student-b')),
      createContainmentRelation(ref('group', 'level-1'), ref('item', 'student-c')),
    ],
  });
}

function solution(assignments) {
  return createSolution({ assignments });
}

function assignment(studentId, classId) {
  return createAssignment({ itemRef: ref('item', studentId), containerRef: ref('container', classId) });
}

describe('renderSchoolSolutionDisplay', () => {
  it('renders dedicated no-result, unsatisfiable, error, and unavailable states', () => {
    const project = buildProject();

    expect(render(project, null)).toContain('Run the solver to generate a classroom display.');
    expect(render(project, { status: 'unsat', solutions: [] })).toContain('No valid class distribution');
    expect(render(project, { status: 'error', solutions: [] })).toContain('solve must succeed');
    expect(render(project, { status: 'solved', solutions: [] })).toContain('No usable class distribution');
  });

  it('clamps the selected solution and uses only its assignments as authoritative', () => {
    const project = buildProject();
    const result = {
      status: 'solved',
      solutions: [
        solution([assignment('student-a', 'class-a')]),
        solution([assignment('student-b', 'class-a')]),
      ],
    };

    const high = render(project, result, 99);
    const low = render(project, result, -4);

    expect(high).toContain('Solution 2 of 2');
    expect(high).toContain('Bob &amp; B');
    expect(high).not.toContain('Alice &lt;A&gt;');
    expect(low).toContain('Solution 1 of 2');
    expect(low).toContain('Alice &lt;A&gt;');
    expect(low).not.toContain('Bob &amp; B');
  });

  it('renders every class, including empty classes, with source metadata and capacities', () => {
    const html = render(buildProject(), {
      status: 'solved',
      solutions: [solution([assignment('student-a', 'class-a')])],
    });

    expect(html.match(/<article class="school-classroom"/g)).toHaveLength(2);
    expect(html).toContain('Class &lt;A&gt;');
    expect(html).toContain('Empty &amp; class');
    expect(html).toContain('Min 1 · Max 3');
    expect(html).toContain('Min 0 · Max 2');
    expect(html).toContain('No students assigned to this class.');
    expect(html).toContain('All levels');
    expect(html).toContain('No teacher linked');
  });

  it('shows escaped visible teacher and student names, accepted levels, and represented levels', () => {
    const html = render(buildProject(), {
      status: 'solved',
      solutions: [solution([
        assignment('student-a', 'class-a'),
        assignment('student-b', 'class-a'),
      ])],
    });

    expect(html).toContain('<span aria-hidden="true">🧑‍🏫</span><span>Ms &lt;Ada&gt;</span>');
    expect(html).toContain('<span aria-hidden="true">🧒</span>');
    expect(html).toContain('Alice &lt;A&gt;');
    expect(html).toContain('Bob &amp; B');
    expect(html).toContain('Level &lt;1&gt;');
    expect(html).toContain('Level 2');
    expect(html).not.toContain('Alice <A>');
    expect(html).not.toContain('Ms <Ada>');
  });

  it('builds deterministic desks containing at most two students', () => {
    const html = render(buildProject(), {
      status: 'solved',
      solutions: [solution([
        assignment('student-c', 'class-a'),
        assignment('student-a', 'class-a'),
        assignment('student-b', 'class-a'),
      ])],
    });
    expect(html.match(/class="school-desk"/g)).toHaveLength(2);
    expect(html.indexOf('Alice &lt;A&gt;')).toBeLessThan(html.indexOf('Bob &amp; B'));
    expect(html.indexOf('Bob &amp; B')).toBeLessThan(html.indexOf('Cara'));
    expect(html.match(/🧒/g)).toHaveLength(3);
  });

  it('ignores non-students and malformed or unknown assignments', () => {
    const html = render(buildProject(), {
      status: 'solved',
      solutions: [solution([
        assignment('other', 'class-a'),
        assignment('teacher-a', 'class-a'),
        assignment('student-a', 'missing-class'),
        createAssignment({ itemRef: ref('item', 'student-b'), containerRef: null }),
      ])],
    });

    expect(html).not.toContain('Not a student');
    expect(html).toContain('No students assigned to this class.');
  });

  it.each(['partial', 'timeout', 'cancelled'])('renders a usable %s solution with an incomplete-result notice', (status) => {
    const html = render(buildProject(), {
      status,
      solutions: [solution([assignment('student-a', 'class-a')])],
    });

    expect(html).toContain('Alice &lt;A&gt;');
    expect(html).toContain('available solution from an incomplete solve');
  });

  it('uses semantic class and desk lists and includes the planning disclaimer', () => {
    const html = render(buildProject(), {
      status: 'solved',
      solutions: [solution([assignment('student-a', 'class-a')])],
    });

    expect(html).toContain('<article class="school-classroom"');
    expect(html).toContain('<ol class="school-desk-grid">');
    expect(html).toContain('<ul>');
    expect(html).toContain('Desk positions are illustrative. Class assignments are determined by the selected solution.');
  });

  it('does not mutate the project or solver result', () => {
    const project = buildProject();
    const result = {
      status: 'solved',
      solutions: [solution([assignment('student-a', 'class-a')])],
    };
    const beforeProject = structuredClone(project);
    const beforeResult = structuredClone(result);

    render(project, result, 0);

    expect(project).toEqual(beforeProject);
    expect(result).toEqual(beforeResult);
  });
});
