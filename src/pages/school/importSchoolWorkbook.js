import * as XLSX from 'xlsx';
import { createId } from '../../core/model/ids.js';
import { createContainer, createGroup, createItem } from '../../core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../core/model/project.js';
import { createContainmentRelation, createEntityRef } from '../../core/model/relations.js';
import { SCHOOL_ITEM_ROLES } from '../../core/transform/domainMappings.js';

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function normalizeCell(value) {
  return String(value ?? '').trim();
}

function splitCommaSeparated(value) {
  return normalizeCell(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getSheetRows(workbook, preferredNames) {
  const sheetName = workbook.SheetNames.find((name) => preferredNames.includes(normalizeHeader(name)));
  if (!sheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: '',
    raw: false,
  });
}

function findColumnName(row, acceptedHeaders, required = false) {
  const keys = Object.keys(row ?? {});
  const foundKey = keys.find((key) => acceptedHeaders.includes(normalizeHeader(key)));

  if (!foundKey && required) {
    throw new Error(`Missing required column: ${acceptedHeaders[0]}`);
  }

  return foundKey || null;
}

function upsertLevel(levelsByLabel, project, label) {
  const normalizedLabel = normalizeCell(label);
  if (!normalizedLabel) {
    return null;
  }

  if (!levelsByLabel.has(normalizedLabel)) {
    const group = createGroup({
      id: createId('group'),
      label: normalizedLabel,
    });
    project.groups.push(group);
    levelsByLabel.set(normalizedLabel, group);
  }

  return levelsByLabel.get(normalizedLabel);
}

function upsertTeacher(teachersByLabel, project, label) {
  const normalizedLabel = normalizeCell(label);
  if (!normalizedLabel) {
    return null;
  }

  if (!teachersByLabel.has(normalizedLabel)) {
    const teacher = createItem({
      id: createId('item'),
      label: normalizedLabel,
      metadata: { schoolRole: SCHOOL_ITEM_ROLES.TEACHER },
    });
    project.items.push(teacher);
    teachersByLabel.set(normalizedLabel, teacher);
  }

  return teachersByLabel.get(normalizedLabel);
}

function upsertClass(classesByLabel, project, label) {
  const normalizedLabel = normalizeCell(label);
  if (!normalizedLabel) {
    return null;
  }

  if (!classesByLabel.has(normalizedLabel)) {
    const classroom = createContainer({
      id: createId('container'),
      label: normalizedLabel,
      minCapacity: 0,
      maxCapacity: null,
      metadata: {
        acceptedLevelIds: [],
        teacherIds: [],
      },
    });
    project.containers.push(classroom);
    classesByLabel.set(normalizedLabel, classroom);
  }

  return classesByLabel.get(normalizedLabel);
}

function pushUniqueId(list, value) {
  if (!value || list.includes(value)) {
    return;
  }

  list.push(value);
}

function applyStudentsSheet(project, studentRows, levelsByLabel, classesByLabel) {
  if (studentRows.length === 0) {
    throw new Error('The workbook must contain a Students sheet.');
  }

  const firstRow = studentRows[0];
  const studentColumn = findColumnName(firstRow, ['student'], true);
  const levelColumn = findColumnName(firstRow, ['level', 'levels']);
  const classColumn = findColumnName(firstRow, ['class']);

  const seenStudentLabels = new Set();

  for (const row of studentRows) {
    const studentLabel = normalizeCell(row[studentColumn]);
    if (!studentLabel) {
      continue;
    }

    if (seenStudentLabels.has(studentLabel)) {
      continue;
    }
    seenStudentLabels.add(studentLabel);

    const student = createItem({
      id: createId('item'),
      label: studentLabel,
      metadata: { schoolRole: SCHOOL_ITEM_ROLES.STUDENT },
    });
    project.items.push(student);

    const levelLabels = levelColumn ? splitCommaSeparated(row[levelColumn]) : [];
    for (const levelLabel of levelLabels) {
      const level = upsertLevel(levelsByLabel, project, levelLabel);
      if (level) {
        project.containments.push(createContainmentRelation(createEntityRef('group', level.id), createEntityRef('item', student.id)));
      }
    }

    const classLabel = classColumn ? normalizeCell(row[classColumn]) : '';
    if (classLabel) {
      upsertClass(classesByLabel, project, classLabel);
    }
  }
}

function applyClassesSheet(project, classRows, levelsByLabel, classesByLabel, teachersByLabel) {
  if (classRows.length === 0) {
    return;
  }

  const firstRow = classRows[0];
  const classColumn = findColumnName(firstRow, ['class'], true);
  const teachersColumn = findColumnName(firstRow, ['teachers', 'teacher']);
  const acceptedLevelsColumn = findColumnName(firstRow, ['accepted levels', 'accepted level', 'levels', 'level']);
  const capacityColumn = findColumnName(firstRow, ['capacity']);

  for (const row of classRows) {
    const classLabel = normalizeCell(row[classColumn]);
    if (!classLabel) {
      continue;
    }

    const classroom = upsertClass(classesByLabel, project, classLabel);
    if (!classroom.metadata) {
      classroom.metadata = { acceptedLevelIds: [], teacherIds: [] };
    }

    if (acceptedLevelsColumn) {
      const acceptedLevelLabels = splitCommaSeparated(row[acceptedLevelsColumn]).filter((entry) => normalizeHeader(entry) !== 'all levels');
      for (const levelLabel of acceptedLevelLabels) {
        const level = upsertLevel(levelsByLabel, project, levelLabel);
        if (level) {
          pushUniqueId(classroom.metadata.acceptedLevelIds, level.id);
        }
      }
    }

    if (teachersColumn) {
      const teacherLabels = splitCommaSeparated(row[teachersColumn]);
      for (const teacherLabel of teacherLabels) {
        const teacher = upsertTeacher(teachersByLabel, project, teacherLabel);
        if (teacher) {
          pushUniqueId(classroom.metadata.teacherIds, teacher.id);
        }
      }
    }

    if (capacityColumn) {
      const capacityValue = normalizeCell(row[capacityColumn]);
      if (capacityValue) {
        const parsedCapacity = Number.parseInt(capacityValue, 10);
        if (!Number.isNaN(parsedCapacity)) {
          classroom.metadata.maxCapacity = parsedCapacity;
        }
      }
    }
  }
}

export async function importSchoolWorkbook(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const studentRows = getSheetRows(workbook, ['students']);
  const classRows = getSheetRows(workbook, ['classes']);

  const project = createEmptyProject({
    title: file.name.replace(/\.[^.]+$/, ''),
    description: 'Imported from school workbook',
    viewHint: VIEW_HINTS.SCHOOL,
  });

  const levelsByLabel = new Map();
  const classesByLabel = new Map();
  const teachersByLabel = new Map();

  applyStudentsSheet(project, studentRows, levelsByLabel, classesByLabel);
  applyClassesSheet(project, classRows, levelsByLabel, classesByLabel, teachersByLabel);

  return project;
}
