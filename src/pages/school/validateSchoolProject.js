import { CONSTRAINT_KINDS } from '../../core/model/constraints.js';
import {
  buildSchoolParticipantIndex,
  findItemById,
  getContainedGroupIdsForItem,
  getContainerAcceptedLevelIds,
  getTeacherAssociatedContainerIds,
  isSchoolStudent,
  isSchoolTeacher,
} from '../../core/transform/domainMappings.js';

function createIssue(level, code, message, path) {
  return { level, code, message, path };
}

function findCompatibleClassIdsForStudent(project, studentId) {
  const studentLevelIds = getContainedGroupIdsForItem(project, studentId);
  const containers = Array.isArray(project?.containers) ? project.containers : [];

  if (studentLevelIds.length === 0) {
    return [];
  }

  return containers
    .filter((container) => {
      const acceptedLevelIds = getContainerAcceptedLevelIds(container);
      return acceptedLevelIds.length === 0 || acceptedLevelIds.some((levelId) => studentLevelIds.includes(levelId));
    })
    .map((container) => container.id);
}

export function validateSchoolProject(project) {
  const errors = [];
  const warnings = [];
  const students = buildSchoolParticipantIndex(project).students;
  const teachers = buildSchoolParticipantIndex(project).teachers;
  const classes = Array.isArray(project?.containers) ? project.containers : [];

  students.forEach((student, index) => {
    const levelIds = getContainedGroupIdsForItem(project, student.id);
    if (levelIds.length === 0) {
      errors.push(createIssue('error', 'school-student-missing-level', `Student "${student.label}" must belong to at least one level before solving.`, `students[${index}]`));
    }

    if (levelIds.length > 1) {
      warnings.push(createIssue('warning', 'school-student-multiple-levels', `Student "${student.label}" belongs to multiple levels. This is unusual in the school workflow and may reduce clarity for users.`, `students[${index}]`));
    }

    if (levelIds.length > 0) {
      const compatibleClassIds = findCompatibleClassIdsForStudent(project, student.id);
      if (compatibleClassIds.length === 0) {
        errors.push(createIssue('error', 'school-student-no-compatible-class', `Student "${student.label}" has no compatible class because none of the classes accepts the student's level.`, `students[${index}]`));
      }
    }
  });

  classes.forEach((classroom, index) => {
    const acceptedLevelIds = getContainerAcceptedLevelIds(classroom);
    if (acceptedLevelIds.length === 0) {
      warnings.push(createIssue('warning', 'school-class-all-levels-allowed', `Class "${classroom.label}" has no selected level, so it currently accepts students from all levels.`, `classes[${index}]`));
    }
  });

  const totalMaxCapacity = classes.reduce((sum, classroom) => {
    const maxCapacity = classroom.metadata?.maxCapacity;
    return sum + (Number.isFinite(maxCapacity) ? maxCapacity : 0);
  }, 0);

  if (classes.length > 0 && totalMaxCapacity < students.length) {
    errors.push(createIssue('error', 'school-capacity-too-small', `The total class capacity (${totalMaxCapacity}) is smaller than the number of students (${students.length}). Some students would have nowhere to go.`, 'classes'));
  }

  const constraints = Array.isArray(project?.constraints) ? project.constraints : [];
  constraints.forEach((constraint, index) => {
    const leftItem = findItemById(project, constraint.leftRef?.id);
    const rightItem = findItemById(project, constraint.rightRef?.id);
    const leftIsTeacher = isSchoolTeacher(leftItem);
    const rightIsTeacher = isSchoolTeacher(rightItem);
    const leftIsStudent = isSchoolStudent(leftItem);
    const rightIsStudent = isSchoolStudent(rightItem);

    if (constraint.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) {
      if (leftIsTeacher && rightIsStudent) {
        const teacherClassIds = getTeacherAssociatedContainerIds(project, leftItem.id);
        const compatibleClassIds = findCompatibleClassIdsForStudent(project, rightItem.id);
        const feasibleClassIds = compatibleClassIds.filter((id) => teacherClassIds.includes(id));
        if (teacherClassIds.length === 0) {
          errors.push(createIssue('error', 'school-teacher-rule-without-class', `Teacher "${leftItem.label}" must be linked to at least one class before using a must-be-together rule with student "${rightItem.label}".`, `rules[${index}]`));
        } else if (feasibleClassIds.length === 0) {
          errors.push(createIssue('error', 'school-impossible-teacher-student-rule', `Student "${rightItem.label}" cannot be placed with teacher "${leftItem.label}" because none of that teacher's classes accepts the student's level.`, `rules[${index}]`));
        }
      }

      if (rightIsTeacher && leftIsStudent) {
        const teacherClassIds = getTeacherAssociatedContainerIds(project, rightItem.id);
        const compatibleClassIds = findCompatibleClassIdsForStudent(project, leftItem.id);
        const feasibleClassIds = compatibleClassIds.filter((id) => teacherClassIds.includes(id));
        if (teacherClassIds.length === 0) {
          errors.push(createIssue('error', 'school-teacher-rule-without-class', `Teacher "${rightItem.label}" must be linked to at least one class before using a must-be-together rule with student "${leftItem.label}".`, `rules[${index}]`));
        } else if (feasibleClassIds.length === 0) {
          errors.push(createIssue('error', 'school-impossible-teacher-student-rule', `Student "${leftItem.label}" cannot be placed with teacher "${rightItem.label}" because none of that teacher's classes accepts the student's level.`, `rules[${index}]`));
        }
      }
    }

    if (constraint.kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER) {
      if (leftIsTeacher && rightIsStudent) {
        const teacherClassIds = getTeacherAssociatedContainerIds(project, leftItem.id);
        const compatibleClassIds = findCompatibleClassIdsForStudent(project, rightItem.id);
        if (teacherClassIds.length > 0 && compatibleClassIds.length > 0 && compatibleClassIds.every((id) => teacherClassIds.includes(id))) {
          errors.push(createIssue('error', 'school-impossible-separation-rule', `Student "${rightItem.label}" cannot be kept away from teacher "${leftItem.label}" because every compatible class for the student is linked to that teacher.`, `rules[${index}]`));
        }
      }

      if (rightIsTeacher && leftIsStudent) {
        const teacherClassIds = getTeacherAssociatedContainerIds(project, rightItem.id);
        const compatibleClassIds = findCompatibleClassIdsForStudent(project, leftItem.id);
        if (teacherClassIds.length > 0 && compatibleClassIds.length > 0 && compatibleClassIds.every((id) => teacherClassIds.includes(id))) {
          errors.push(createIssue('error', 'school-impossible-separation-rule', `Student "${leftItem.label}" cannot be kept away from teacher "${rightItem.label}" because every compatible class for the student is linked to that teacher.`, `rules[${index}]`));
        }
      }
    }
  });

  teachers.forEach((teacher, index) => {
    const linkedClassIds = getTeacherAssociatedContainerIds(project, teacher.id);
    if (linkedClassIds.length === 0) {
      warnings.push(createIssue('warning', 'school-teacher-without-class', `Teacher "${teacher.label}" is not linked to any class yet, so teacher-based rules may not influence solving.`, `teachers[${index}]`));
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
