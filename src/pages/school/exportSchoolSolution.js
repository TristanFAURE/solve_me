import * as XLSX from 'xlsx';
import {
  buildSchoolClassroomIndex,
  buildSchoolParticipantIndex,
  getContainedGroupIdsForItem,
} from '../../core/transform/domainMappings.js';

function getSolutionAssignments(solution) {
  return Array.isArray(solution?.assignments) ? solution.assignments : [];
}

function getLabelById(entries) {
  return new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry.label]));
}

function getStudentAssignmentsByClassId(solution) {
  const assignmentsByClassId = new Map();

  for (const assignment of getSolutionAssignments(solution)) {
    if (assignment?.itemRef?.kind !== 'item' || assignment?.containerRef?.kind !== 'container') {
      continue;
    }

    const classId = assignment.containerRef.id;
    if (!assignmentsByClassId.has(classId)) {
      assignmentsByClassId.set(classId, []);
    }

    assignmentsByClassId.get(classId).push(assignment.itemRef.id);
  }

  return assignmentsByClassId;
}

function joinLabels(labels) {
  return labels.length > 0 ? labels.join(', ') : '';
}

function buildSummaryRows(project, solverResult, solutionIndex, classrooms, students) {
  return [
    ['Scenario', project?.title || 'School scenario'],
    ['Selected solution', String(solutionIndex + 1)],
    ['Solver status', solverResult?.status || 'unknown'],
    ['Returned solutions', String(solverResult?.solutions?.length ?? 0)],
    ['Students', String(students.length)],
    ['Classes', String(classrooms.length)],
    ['Runtime (ms)', String(solverResult?.runtimeMs ?? 0)],
    ['Exported at', new Date().toISOString()],
  ];
}

function buildClassesSheetRows(project, solution, classrooms, levelLabelById, teacherLabelById, studentLabelById) {
  const assignmentsByClassId = getStudentAssignmentsByClassId(solution);
  const rows = [];

  for (const classroom of classrooms) {
    const studentIds = assignmentsByClassId.get(classroom.id) ?? [];
    const studentLabels = studentIds.map((studentId) => studentLabelById.get(studentId) || studentId);
    const acceptedLevelLabels = classroom.acceptedLevelIds.map((levelId) => levelLabelById.get(levelId) || levelId);
    const teacherLabels = classroom.teacherIds.map((teacherId) => teacherLabelById.get(teacherId) || teacherId);

    rows.push({
      Class: classroom.label,
      Teachers: joinLabels(teacherLabels),
      'Accepted levels': acceptedLevelLabels.length > 0 ? joinLabels(acceptedLevelLabels) : 'All levels',
      Capacity: classroom.capacity ?? '',
      'Assigned students count': studentIds.length,
      Students: joinLabels(studentLabels),
    });
  }

  return rows;
}

function buildStudentsSheetRows(project, solution, levelLabelById, classLabelById) {
  const { students } = buildSchoolParticipantIndex(project);
  const assignmentByStudentId = new Map(
    getSolutionAssignments(solution)
      .filter((assignment) => assignment?.itemRef?.kind === 'item' && assignment?.containerRef?.kind === 'container')
      .map((assignment) => [assignment.itemRef.id, assignment.containerRef.id]),
  );

  return students.map((student) => {
    const levelLabels = getContainedGroupIdsForItem(project, student.id).map((levelId) => levelLabelById.get(levelId) || levelId);
    const assignedClassId = assignmentByStudentId.get(student.id);

    return {
      Student: student.label,
      Level: joinLabels(levelLabels),
      Class: assignedClassId ? (classLabelById.get(assignedClassId) || assignedClassId) : '',
    };
  });
}

export function exportSchoolSolutionWorkbook(project, solverResult, solutionIndex = 0) {
  if (solverResult?.status !== 'solved' || !Array.isArray(solverResult?.solutions) || solverResult.solutions.length === 0) {
    throw new Error('A solved school result is required before exporting an Excel workbook.');
  }

  const clampedSolutionIndex = Math.min(Math.max(solutionIndex, 0), solverResult.solutions.length - 1);
  const solution = solverResult.solutions[clampedSolutionIndex];
  const classrooms = buildSchoolClassroomIndex(project);
  const { students, teachers } = buildSchoolParticipantIndex(project);
  const levels = Array.isArray(project?.groups) ? project.groups : [];

  const levelLabelById = getLabelById(levels);
  const teacherLabelById = getLabelById(teachers);
  const studentLabelById = getLabelById(students);
  const classLabelById = new Map(classrooms.map((classroom) => [classroom.id, classroom.label]));

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet(buildSummaryRows(project, solverResult, clampedSolutionIndex, classrooms, students));
  const classesSheet = XLSX.utils.json_to_sheet(buildClassesSheetRows(project, solution, classrooms, levelLabelById, teacherLabelById, studentLabelById));
  const studentsSheet = XLSX.utils.json_to_sheet(buildStudentsSheetRows(project, solution, levelLabelById, classLabelById));

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(workbook, classesSheet, 'Classes');
  XLSX.utils.book_append_sheet(workbook, studentsSheet, 'Students');

  const safeTitle = String(project?.title || 'school-solution')
    .trim()
    .replaceAll(/[^a-z0-9-_]+/gi, '-')
    .replaceAll(/^-+|-+$/g, '') || 'school-solution';

  XLSX.writeFile(workbook, `${safeTitle}-solution-${clampedSolutionIndex + 1}.xlsx`);
}
