import {
  buildSchoolParticipantIndex,
  getContainedGroupIdsForItem,
  getContainerAcceptedLevelIds,
  getContainerTeacherIds,
} from '../../core/transform/domainMappings.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderEmptyState(message) {
  return `<section class="card school-display"><h2>Classroom display</h2><p class="muted-text">${escapeHtml(message)}</p></section>`;
}

function getUsableSolution(result, activeSolutionIndex) {
  const solutions = Array.isArray(result?.solutions) ? result.solutions : [];
  if (solutions.length === 0) return null;
  const requested = Number.isInteger(activeSolutionIndex) ? activeSolutionIndex : 0;
  const index = Math.min(Math.max(requested, 0), solutions.length - 1);
  return { solution: solutions[index], index, count: solutions.length };
}

function renderLabelList(labels, emptyText) {
  return labels.length
    ? `<ul class="school-display-label-list">${labels.map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`
    : `<span class="muted-text">${escapeHtml(emptyText)}</span>`;
}

function getCapacity(classroom) {
  return {
    minimum: classroom?.minCapacity ?? classroom?.metadata?.minCapacity ?? 0,
    maximum: classroom?.maxCapacity ?? classroom?.metadata?.maxCapacity ?? null,
  };
}

export function renderSchoolSolutionDisplay({
  project,
  normalizedProject: _normalizedProject,
  result,
  activeSolutionIndex = 0,
}) {
  if (!result) return renderEmptyState('Run the solver to generate a classroom display.');
  const selected = getUsableSolution(result, activeSolutionIndex);
  if (!selected) {
    if (result.status === 'unsat') return renderEmptyState('No valid class distribution can be displayed because the current rules are unsatisfiable.');
    if (result.status === 'error') return renderEmptyState('The solve must succeed before a classroom display is available.');
    return renderEmptyState('No usable class distribution is available to display.');
  }

  const classes = Array.isArray(project?.containers) ? project.containers : [];
  const levels = Array.isArray(project?.groups) ? project.groups : [];
  const { students, teachers } = buildSchoolParticipantIndex(project ?? {});
  const studentById = new Map(students.map((student) => [student.id, student]));
  const studentOrder = new Map(students.map((student, index) => [student.id, index]));
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]));
  const levelById = new Map(levels.map((level) => [level.id, level]));
  const classById = new Map(classes.map((classroom) => [classroom.id, classroom]));
  const studentsByClassId = new Map(classes.map((classroom) => [classroom.id, []]));
  const teachersByClassId = new Map(classes.map((classroom) => [classroom.id, []]));
  const hasTeacherAssignments = (selected.solution?.assignments ?? []).some((assignment) => teacherById.has(assignment?.itemRef?.id));

  (selected.solution?.assignments ?? []).forEach((assignment) => {
    const teacher = teacherById.get(assignment?.itemRef?.id);
    if (teacher && classById.has(assignment?.containerRef?.id)) {
      teachersByClassId.get(assignment.containerRef.id).push(teacher);
      return;
    }
    const student = studentById.get(assignment?.itemRef?.id);
    const classId = assignment?.containerRef?.id;
    if (student && classById.has(classId)) studentsByClassId.get(classId).push(student);
  });
  studentsByClassId.forEach((assignedStudents) => assignedStudents.sort(
    (left, right) => (studentOrder.get(left.id) ?? 0) - (studentOrder.get(right.id) ?? 0),
  ));

  const classrooms = classes.map((classroom) => {
    const assignedStudents = studentsByClassId.get(classroom.id) ?? [];
    const teachersForClass = hasTeacherAssignments
      ? teachersByClassId.get(classroom.id) ?? []
      : getContainerTeacherIds(classroom).map((teacherId) => teacherById.get(teacherId) ?? { id: teacherId, label: teacherId });
    const acceptedLevels = getContainerAcceptedLevelIds(classroom)
      .map((levelId) => levelById.get(levelId)?.label ?? levelId);
    const studentRows = assignedStudents.map((student) => {
      const studentLevels = getContainedGroupIdsForItem(project, student.id)
        .map((levelId) => levelById.get(levelId)?.label ?? levelId);
      return { student, levels: studentLevels };
    });
    const representedLevels = [...new Set(studentRows.flatMap((entry) => entry.levels))];
    const desks = [];
    for (let index = 0; index < studentRows.length; index += 2) desks.push(studentRows.slice(index, index + 2));
    const capacity = getCapacity(classroom);
    const maximum = capacity.maximum == null ? 'Unlimited' : String(capacity.maximum);

    return `<article class="school-classroom" data-class-id="${escapeHtml(classroom.id)}">
      <header class="school-classroom-header">
        <div><p class="eyebrow">Classroom</p><h3>${escapeHtml(classroom.label)}</h3></div>
        <span class="section-count-pill">${assignedStudents.length} student${assignedStudents.length === 1 ? '' : 's'}</span>
      </header>
      <dl class="summary-grid compact-summary-grid school-classroom-summary">
        <div><dt>Capacity</dt><dd>Min ${escapeHtml(capacity.minimum)} · Max ${escapeHtml(maximum)}</dd></div>
        <div><dt>Accepted levels</dt><dd>${renderLabelList(acceptedLevels, 'All levels')}</dd></div>
        <div><dt>Levels represented</dt><dd>${renderLabelList(representedLevels, 'None')}</dd></div>
      </dl>
      <section class="school-teaching-zone" aria-label="Teaching area for ${escapeHtml(classroom.label)}">
        <div class="school-board"><strong>${escapeHtml(classroom.label)}</strong><span>Teaching area</span></div>
        <div class="school-teacher-list">
          ${teachersForClass.length ? teachersForClass.map((teacher) => `<div class="school-teacher-chip"><span aria-hidden="true">🧑‍🏫</span><span>${escapeHtml(teacher.label)}</span></div>`).join('') : '<p class="muted-text">No teacher linked</p>'}
        </div>
      </section>
      <section aria-label="Student desks for ${escapeHtml(classroom.label)}">
        <h4>Student desks</h4>
        ${desks.length ? `<ol class="school-desk-grid">${desks.map((desk) => `<li class="school-desk"><ul>${desk.map(({ student, levels: studentLevels }) => `<li class="school-student-chip"><span aria-hidden="true">🧒</span><span><strong>${escapeHtml(student.label)}</strong>${studentLevels.length ? `<small>${escapeHtml(studentLevels.join(', '))}</small>` : ''}</span></li>`).join('')}</ul></li>`).join('')}</ol>` : '<p class="muted-text">No students assigned to this class.</p>'}
      </section>
    </article>`;
  }).join('');

  const incomplete = result.status === 'solved' ? '' : '<p class="result-status-banner">This display uses an available solution from an incomplete solve.</p>';
  return `<section class="school-display">
    <header class="panel-header"><div><p class="eyebrow">Selected solution</p><h2>Classroom display</h2></div><span class="panel-count">Solution ${selected.index + 1} of ${selected.count}</span></header>
    ${incomplete}
    <div class="school-display-board">${classrooms || '<p class="muted-text">No classes are configured.</p>'}</div>
    <p class="school-display-note">Desk positions are illustrative. Class assignments are determined by the selected solution.</p>
  </section>`;
}
