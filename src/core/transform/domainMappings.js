export const VIEW_HINTS = {
  GENERIC: 'generic',
  WEDDING: 'wedding',
  SCHOOL: 'school',
};

export const SCHOOL_ITEM_ROLES = {
  STUDENT: 'student',
  TEACHER: 'teacher',
};

export function getEntityMetadata(entity) {
  return entity && typeof entity.metadata === 'object' && entity.metadata
    ? entity.metadata
    : {};
}

export function getSchoolItemRole(item) {
  const metadata = getEntityMetadata(item);
  return metadata.schoolRole || null;
}

export function isSchoolStudent(item) {
  return getSchoolItemRole(item) === SCHOOL_ITEM_ROLES.STUDENT;
}

export function isSchoolTeacher(item) {
  return getSchoolItemRole(item) === SCHOOL_ITEM_ROLES.TEACHER;
}

export function getContainerAcceptedLevelIds(container) {
  const metadata = getEntityMetadata(container);
  return Array.isArray(metadata.acceptedLevelIds)
    ? metadata.acceptedLevelIds.filter((value) => typeof value === 'string' && value)
    : [];
}

export function getContainerTeacherIds(container) {
  const metadata = getEntityMetadata(container);
  return Array.isArray(metadata.teacherIds)
    ? metadata.teacherIds.filter((value) => typeof value === 'string' && value)
    : [];
}

export function getContainedGroupIdsForItem(project, itemId) {
  return Array.isArray(project?.containments)
    ? project.containments
      .filter((containment) => containment?.from?.kind === 'group' && containment?.to?.kind === 'item' && containment.to.id === itemId)
      .map((containment) => containment.from.id)
    : [];
}

export function getStudentLevelIds(project, studentId) {
  return getContainedGroupIdsForItem(project, studentId);
}

export function classAcceptsStudentLevel(project, container, studentId) {
  const acceptedLevelIds = getContainerAcceptedLevelIds(container);
  const studentLevelIds = getStudentLevelIds(project, studentId);

  if (!studentLevelIds.length) {
    return false;
  }

  if (!acceptedLevelIds.length) {
    return true;
  }

  return studentLevelIds.some((levelId) => acceptedLevelIds.includes(levelId));
}

export function getAllowedContainerIdsForStudent(project, studentId) {
  const containers = Array.isArray(project?.containers) ? project.containers : [];

  return containers
    .filter((container) => classAcceptsStudentLevel(project, container, studentId))
    .map((container) => container.id);
}

export function getTeacherAssociatedContainerIds(project, teacherId) {
  const containers = Array.isArray(project?.containers) ? project.containers : [];

  return containers
    .filter((container) => getContainerTeacherIds(container).includes(teacherId))
    .map((container) => container.id);
}

export function buildSchoolParticipantIndex(project) {
  const items = Array.isArray(project?.items) ? project.items : [];

  return {
    students: items.filter(isSchoolStudent),
    teachers: items.filter(isSchoolTeacher),
  };
}

export function buildSchoolClassroomIndex(project) {
  const containers = Array.isArray(project?.containers) ? project.containers : [];

  return containers.map((container) => ({
    id: container.id,
    label: container.label,
    capacity: getEntityMetadata(container).maxCapacity ?? null,
    acceptedLevelIds: getContainerAcceptedLevelIds(container),
    teacherIds: getContainerTeacherIds(container),
    isMixedLevel: getContainerAcceptedLevelIds(container).length > 1,
  }));
}

export function deriveTeacherLinkedAssignmentHints(project) {
  const constraints = Array.isArray(project?.constraints) ? project.constraints : [];
  const preferences = Array.isArray(project?.preferences) ? project.preferences : [];

  const requiredByStudentId = {};
  const forbiddenByStudentId = {};
  const preferredByStudentId = {};
  const avoidedByStudentId = {};

  for (const constraint of constraints) {
    const left = constraint?.leftRef;
    const right = constraint?.rightRef;

    if (left?.kind !== 'item' || right?.kind !== 'item') {
      continue;
    }

    const leftIsTeacher = isSchoolTeacher(findItemById(project, left.id));
    const rightIsTeacher = isSchoolTeacher(findItemById(project, right.id));
    const leftIsStudent = isSchoolStudent(findItemById(project, left.id));
    const rightIsStudent = isSchoolStudent(findItemById(project, right.id));

    if (constraint.kind === 'mustShareContainer') {
      if (leftIsTeacher && rightIsStudent) {
        requiredByStudentId[right.id] = getTeacherAssociatedContainerIds(project, left.id);
      } else if (rightIsTeacher && leftIsStudent) {
        requiredByStudentId[left.id] = getTeacherAssociatedContainerIds(project, right.id);
      }
    }

    if (constraint.kind === 'mustNotShareContainer') {
      if (leftIsTeacher && rightIsStudent) {
        forbiddenByStudentId[right.id] = getTeacherAssociatedContainerIds(project, left.id);
      } else if (rightIsTeacher && leftIsStudent) {
        forbiddenByStudentId[left.id] = getTeacherAssociatedContainerIds(project, right.id);
      }
    }
  }

  for (const preference of preferences) {
    const left = preference?.leftRef;
    const right = preference?.rightRef;

    if (left?.kind !== 'item' || right?.kind !== 'item') {
      continue;
    }

    const leftIsTeacher = isSchoolTeacher(findItemById(project, left.id));
    const rightIsTeacher = isSchoolTeacher(findItemById(project, right.id));
    const leftIsStudent = isSchoolStudent(findItemById(project, left.id));
    const rightIsStudent = isSchoolStudent(findItemById(project, right.id));

    if (preference.kind === 'preferShareContainer') {
      if (leftIsTeacher && rightIsStudent) {
        preferredByStudentId[right.id] = getTeacherAssociatedContainerIds(project, left.id);
      } else if (rightIsTeacher && leftIsStudent) {
        preferredByStudentId[left.id] = getTeacherAssociatedContainerIds(project, right.id);
      }
    }

    if (preference.kind === 'preferSeparateContainers') {
      if (leftIsTeacher && rightIsStudent) {
        avoidedByStudentId[right.id] = getTeacherAssociatedContainerIds(project, left.id);
      } else if (rightIsTeacher && leftIsStudent) {
        avoidedByStudentId[left.id] = getTeacherAssociatedContainerIds(project, right.id);
      }
    }
  }

  return {
    requiredByStudentId,
    forbiddenByStudentId,
    preferredByStudentId,
    avoidedByStudentId,
  };
}

export function findItemById(project, itemId) {
  const items = Array.isArray(project?.items) ? project.items : [];
  return items.find((item) => item.id === itemId) || null;
}
