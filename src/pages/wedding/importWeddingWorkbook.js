import * as XLSX from 'xlsx';
import { createId } from '../../core/model/ids.js';
import { createContainer, createGroup, createItem } from '../../core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../core/model/project.js';
import { createContainmentRelation, createEntityRef } from '../../core/model/relations.js';
import { WEDDING_TABLE_SHAPES } from './tableTopology.js';

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

function getOrCreateGroup(groupsByLabel, project, label) {
  const normalizedLabel = normalizeCell(label);
  if (!normalizedLabel) {
    return null;
  }

  if (!groupsByLabel.has(normalizedLabel)) {
    const group = createGroup({
      id: createId('group'),
      label: normalizedLabel,
    });
    project.groups.push(group);
    groupsByLabel.set(normalizedLabel, group);
  }

  return groupsByLabel.get(normalizedLabel);
}

function getOrCreateTable(tablesByLabel, project, label) {
  const normalizedLabel = normalizeCell(label);
  if (!normalizedLabel) {
    return null;
  }

  if (!tablesByLabel.has(normalizedLabel)) {
    const table = createContainer({
      id: createId('container'),
      label: normalizedLabel,
      minCapacity: 0,
      maxCapacity: null,
      metadata: {
        shape: WEDDING_TABLE_SHAPES.ROUND,
      },
    });
    project.containers.push(table);
    tablesByLabel.set(normalizedLabel, table);
  }

  return tablesByLabel.get(normalizedLabel);
}

function applyGuestsSheet(project, guestRows, groupsByLabel, tablesByLabel) {
  if (guestRows.length === 0) {
    throw new Error('The workbook must contain a Guests sheet.');
  }

  const firstRow = guestRows[0];
  const guestColumn = findColumnName(firstRow, ['guest'], true);
  const groupsColumn = findColumnName(firstRow, ['groups', 'group']);
  const tableColumn = findColumnName(firstRow, ['table']);

  const seenGuestLabels = new Set();

  for (const row of guestRows) {
    const guestLabel = normalizeCell(row[guestColumn]);
    if (!guestLabel || seenGuestLabels.has(guestLabel)) {
      continue;
    }
    seenGuestLabels.add(guestLabel);

    const guest = createItem({
      id: createId('item'),
      label: guestLabel,
    });
    project.items.push(guest);

    const groupLabels = groupsColumn ? splitCommaSeparated(row[groupsColumn]) : [];
    for (const groupLabel of groupLabels) {
      const group = getOrCreateGroup(groupsByLabel, project, groupLabel);
      if (group) {
        project.containments.push(createContainmentRelation(createEntityRef('group', group.id), createEntityRef('item', guest.id)));
      }
    }

    const tableLabel = tableColumn ? normalizeCell(row[tableColumn]) : '';
    if (tableLabel) {
      getOrCreateTable(tablesByLabel, project, tableLabel);
    }
  }
}

function applyGroupsSheet(project, groupRows, groupsByLabel, guestsByLabel) {
  if (groupRows.length === 0) {
    return;
  }

  const firstRow = groupRows[0];
  const groupColumn = findColumnName(firstRow, ['group'], true);
  const guestsColumn = findColumnName(firstRow, ['guests', 'guest']);

  for (const row of groupRows) {
    const groupLabel = normalizeCell(row[groupColumn]);
    if (!groupLabel) {
      continue;
    }

    const group = getOrCreateGroup(groupsByLabel, project, groupLabel);
    const guestLabels = guestsColumn ? splitCommaSeparated(row[guestsColumn]) : [];
    for (const guestLabel of guestLabels) {
      const guest = guestsByLabel.get(guestLabel);
      if (guest) {
        const exists = project.containments.some((relation) => relation?.from?.kind === 'group' && relation?.from?.id === group.id && relation?.to?.kind === 'item' && relation?.to?.id === guest.id);
        if (!exists) {
          project.containments.push(createContainmentRelation(createEntityRef('group', group.id), createEntityRef('item', guest.id)));
        }
      }
    }
  }
}

function applyTablesSheet(project, tableRows, tablesByLabel) {
  if (tableRows.length === 0) {
    return;
  }

  const firstRow = tableRows[0];
  const tableColumn = findColumnName(firstRow, ['table'], true);
  const capacityColumn = findColumnName(firstRow, ['capacity', 'max capacity']);
  const shapeColumn = findColumnName(firstRow, ['shape']);

  for (const row of tableRows) {
    const tableLabel = normalizeCell(row[tableColumn]);
    if (!tableLabel) {
      continue;
    }

    const table = getOrCreateTable(tablesByLabel, project, tableLabel);
    if (!table.metadata) {
      table.metadata = {};
    }

    if (capacityColumn) {
      const capacityValue = normalizeCell(row[capacityColumn]);
      if (capacityValue) {
        const parsedCapacity = Number.parseInt(capacityValue, 10);
        if (!Number.isNaN(parsedCapacity)) {
          table.metadata.maxCapacity = parsedCapacity;
        }
      }
    }

    if (shapeColumn) {
      const shapeValue = normalizeHeader(row[shapeColumn]);
      if (Object.values(WEDDING_TABLE_SHAPES).includes(shapeValue)) {
        table.metadata.shape = shapeValue;
      }
    }
  }
}

function applySeatingSheet(project, seatingRows, groupsByLabel, tablesByLabel, guestsByLabel) {
  if (seatingRows.length === 0) {
    return;
  }

  const firstRow = seatingRows[0];
  const guestColumn = findColumnName(firstRow, ['guest'], true);
  const groupsColumn = findColumnName(firstRow, ['groups', 'group']);
  const tableColumn = findColumnName(firstRow, ['table']);

  for (const row of seatingRows) {
    const guestLabel = normalizeCell(row[guestColumn]);
    if (!guestLabel) {
      continue;
    }

    const guest = guestsByLabel.get(guestLabel);
    if (!guest) {
      continue;
    }

    const tableLabel = tableColumn ? normalizeCell(row[tableColumn]) : '';
    if (tableLabel) {
      getOrCreateTable(tablesByLabel, project, tableLabel);
    }

    const groupLabels = groupsColumn ? splitCommaSeparated(row[groupsColumn]) : [];
    for (const groupLabel of groupLabels) {
      const group = getOrCreateGroup(groupsByLabel, project, groupLabel);
      if (!group) {
        continue;
      }

      const exists = project.containments.some((relation) => relation?.from?.kind === 'group' && relation?.from?.id === group.id && relation?.to?.kind === 'item' && relation?.to?.id === guest.id);
      if (!exists) {
        project.containments.push(createContainmentRelation(createEntityRef('group', group.id), createEntityRef('item', guest.id)));
      }
    }
  }
}

export async function importWeddingWorkbook(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const guestRows = getSheetRows(workbook, ['guests']);
  const groupRows = getSheetRows(workbook, ['groups']);
  const tableRows = getSheetRows(workbook, ['tables']);
  const seatingRows = getSheetRows(workbook, ['seating']);

  const project = createEmptyProject({
    title: file.name.replace(/\.[^.]+$/, ''),
    description: 'Imported from wedding workbook',
    viewHint: VIEW_HINTS.WEDDING,
  });

  const groupsByLabel = new Map();
  const tablesByLabel = new Map();

  applyGuestsSheet(project, guestRows, groupsByLabel, tablesByLabel);

  const guestsByLabel = new Map((project.items ?? []).map((guest) => [guest.label, guest]));

  applyGroupsSheet(project, groupRows, groupsByLabel, guestsByLabel);
  applyTablesSheet(project, tableRows, tablesByLabel);
  applySeatingSheet(project, seatingRows, groupsByLabel, tablesByLabel, guestsByLabel);

  for (const table of project.containers) {
    table.metadata = {
      ...table.metadata,
      shape: table.metadata?.shape || WEDDING_TABLE_SHAPES.ROUND,
    };
  }

  return project;
}
