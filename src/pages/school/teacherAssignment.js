import { CONSTRAINT_KINDS } from '../../core/model/constraints.js';
import { PREFERENCE_KINDS } from '../../core/model/preferences.js';
import {
  buildSchoolParticipantIndex,
  getContainedGroupIdsForItem,
  getContainerAcceptedLevelIds,
  getContainerTeacherIds,
} from '../../core/transform/domainMappings.js';

function teacherCanTeachClass(project, teacher, classroom) {
  const teacherLevels = getContainedGroupIdsForItem(project, teacher.id);
  const acceptedLevels = getContainerAcceptedLevelIds(classroom);
  if (teacherLevels.length > 0 && acceptedLevels.length > 0 && !teacherLevels.some((id) => acceptedLevels.includes(id))) return false;
  return teacher.metadata?.classPreferences?.[classroom.id] !== 'unavailable';
}

function relationScore(project, solution, teacherId, classId) {
  const studentClass = new Map((solution.assignments ?? [])
    .filter((assignment) => assignment?.metadata?.schoolRole !== 'teacher')
    .map((assignment) => [assignment.itemRef?.id, assignment.containerRef?.id]));
  let score = 0;
  for (const relation of project.preferences ?? []) {
    const studentId = relation.leftRef?.id === teacherId ? relation.rightRef?.id
      : relation.rightRef?.id === teacherId ? relation.leftRef?.id : null;
    if (!studentId || !studentClass.has(studentId)) continue;
    const together = studentClass.get(studentId) === classId;
    const weight = Number.isFinite(relation.weight) ? relation.weight : 1;
    if (relation.kind === PREFERENCE_KINDS.PREFER_SHARE_CONTAINER && together) score += weight;
    if (relation.kind === PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS && together) score -= weight;
  }
  return score;
}

function satisfiesTeacherStudentConstraints(project, solution, teacherId, classId) {
  const studentClass = new Map((solution.assignments ?? []).map((assignment) => [assignment.itemRef?.id, assignment.containerRef?.id]));
  return (project.constraints ?? []).every((constraint) => {
    const studentId = constraint.leftRef?.id === teacherId ? constraint.rightRef?.id
      : constraint.rightRef?.id === teacherId ? constraint.leftRef?.id : null;
    if (!studentId || !studentClass.has(studentId)) return true;
    if (constraint.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) return studentClass.get(studentId) === classId;
    if (constraint.kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER) return studentClass.get(studentId) !== classId;
    return true;
  });
}

function preferenceScore(teacher, classroom) {
  const value = teacher.metadata?.classPreferences?.[classroom.id];
  if (value === 'prefer') return 10;
  if (value === 'preferNot') return -10;
  return 0;
}

export function assignTeachersToSchoolSolution(project, solution) {
  const { teachers } = buildSchoolParticipantIndex(project);
  const classes = project.containers ?? [];
  if (teachers.length === 0) return { assignments: [], score: 0 };
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]));
  const fixedByClassId = new Map();
  const usedFixedTeachers = new Set();
  for (const classroom of classes) {
    const linked = getContainerTeacherIds(classroom);
    if (linked.length > 1) return null;
    if (linked.length === 1) {
      const teacher = teacherById.get(linked[0]);
      if (!teacher || usedFixedTeachers.has(teacher.id) || !teacherCanTeachClass(project, teacher, classroom)) return null;
      fixedByClassId.set(classroom.id, teacher);
      usedFixedTeachers.add(teacher.id);
    }
  }

  let best = null;
  const search = (classIndex, used, assignments, score) => {
    if (classIndex >= classes.length) {
      const key = assignments.map(({ teacher, classroom }) => `${classroom.id}:${teacher.id}`).join('|');
      if (!best || score > best.score || (score === best.score && key < best.key)) best = { assignments: [...assignments], score, key };
      return;
    }
    const classroom = classes[classIndex];
    const fixed = fixedByClassId.get(classroom.id);
    const candidates = fixed ? [fixed] : teachers.filter((teacher) => !used.has(teacher.id));
    candidates
      .filter((teacher) => teacherCanTeachClass(project, teacher, classroom))
      .filter((teacher) => satisfiesTeacherStudentConstraints(project, solution, teacher.id, classroom.id))
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((teacher) => {
        const nextUsed = new Set(used);
        nextUsed.add(teacher.id);
        search(classIndex + 1, nextUsed, [...assignments, { teacher, classroom }], score
          + preferenceScore(teacher, classroom)
          + relationScore(project, solution, teacher.id, classroom.id));
      });
  };
  search(0, new Set(usedFixedTeachers), [], 0);
  if (!best) return null;
  return {
    score: best.score,
    assignments: best.assignments.map(({ teacher, classroom }) => ({
      itemRef: { kind: 'item', id: teacher.id },
      containerRef: { kind: 'container', id: classroom.id },
      positionRef: null,
      metadata: {
        itemLabel: teacher.label,
        containerLabel: classroom.label,
        schoolRole: 'teacher',
        assignmentSource: getContainerTeacherIds(classroom).includes(teacher.id) ? 'fixed-link' : 'optimized',
      },
    })),
  };
}

export function assignTeachersToSchoolResult(project, result) {
  if (!(result?.solutions?.length > 0)) return result;
  const solutions = result.solutions.flatMap((solution) => {
    const teacherResult = assignTeachersToSchoolSolution(project, solution);
    if (!teacherResult) return [];
    return [{
      ...solution,
      assignments: [...(solution.assignments ?? []), ...teacherResult.assignments],
      score: (solution.score ?? 0) + teacherResult.score,
      scoreDetails: {
        ...(solution.scoreDetails ?? {}),
        teacherPreferences: teacherResult.score,
        total: (solution.scoreDetails?.total ?? solution.score ?? 0) + teacherResult.score,
      },
    }];
  });
  if (solutions.length === 0) {
    return { ...result, status: 'unsat', solutions: [], warnings: [...(result.warnings ?? []), 'No valid one-teacher-per-class assignment satisfies the School teacher rules.'] };
  }
  solutions.sort((left, right) => {
    const leftScore = Number.isFinite(left.score) ? left.score : Number.NEGATIVE_INFINITY;
    const rightScore = Number.isFinite(right.score) ? right.score : Number.NEGATIVE_INFINITY;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return String(left.fingerprint ?? '').localeCompare(String(right.fingerprint ?? ''));
  });
  return { ...result, solutions };
}
