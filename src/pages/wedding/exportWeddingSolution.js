import * as XLSX from 'xlsx';
import { getContainedGroupIdsForItem } from '../../core/transform/domainMappings.js';

function getSolutionAssignments(solution) {
  return Array.isArray(solution?.assignments) ? solution.assignments : [];
}

function getLabelById(entries) {
  return new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry.label]));
}

function joinLabels(labels) {
  return labels.length > 0 ? labels.join(', ') : '';
}

function getTableIdBySeatId(project) {
  const map = new Map();

  for (const relation of Array.isArray(project?.containments) ? project.containments : []) {
    if (relation?.from?.kind === 'container' && relation?.to?.kind === 'position') {
      map.set(relation.to.id, relation.from.id);
    }
  }

  return map;
}

function getAssignedSeatIdByGuestId(solution) {
  const map = new Map();

  for (const assignment of getSolutionAssignments(solution)) {
    if (assignment?.itemRef?.kind === 'item' && assignment?.positionRef?.kind === 'position') {
      map.set(assignment.itemRef.id, assignment.positionRef.id);
    }
  }

  return map;
}

function getAssignedTableIdByGuestId(project, solution) {
  const map = new Map();
  const tableIdBySeatId = getTableIdBySeatId(project);

  for (const assignment of getSolutionAssignments(solution)) {
    if (assignment?.itemRef?.kind !== 'item') {
      continue;
    }

    if (assignment?.containerRef?.kind === 'container') {
      map.set(assignment.itemRef.id, assignment.containerRef.id);
      continue;
    }

    if (assignment?.positionRef?.kind === 'position') {
      const tableId = tableIdBySeatId.get(assignment.positionRef.id);
      if (tableId) {
        map.set(assignment.itemRef.id, tableId);
      }
    }
  }

  return map;
}

function buildSummaryRows(project, solverResult, solutionIndex, guests, groups, tables, seatsDefined) {
  return [
    ['Event', project?.title || 'Wedding plan'],
    ['Selected solution', String(solutionIndex + 1)],
    ['Solver status', solverResult?.status || 'unknown'],
    ['Returned solutions', String(solverResult?.solutions?.length ?? 0)],
    ['Guests', String(guests.length)],
    ['Groups', String(groups.length)],
    ['Tables', String(tables.length)],
    ['Seat-aware mode', seatsDefined ? 'Yes' : 'No'],
    ['Runtime (ms)', String(solverResult?.runtimeMs ?? 0)],
    ['Exported at', new Date().toISOString()],
  ];
}

function buildSeatingSheetRows(project, solution, guestLabelById, groupLabelById, tableLabelById, seatLabelById) {
  const rows = [];
  const guests = Array.isArray(project?.items) ? project.items : [];
  const assignedTableIdByGuestId = getAssignedTableIdByGuestId(project, solution);
  const assignedSeatIdByGuestId = getAssignedSeatIdByGuestId(solution);

  for (const guest of guests) {
    const guestGroupLabels = getContainedGroupIdsForItem(project, guest.id)
      .map((groupId) => groupLabelById.get(groupId) || groupId)
      .sort((left, right) => left.localeCompare(right));
    const tableId = assignedTableIdByGuestId.get(guest.id) || '';
    const seatId = assignedSeatIdByGuestId.get(guest.id) || '';

    rows.push({
      Table: tableId ? (tableLabelById.get(tableId) || tableId) : '',
      Seat: seatId ? (seatLabelById.get(seatId) || seatId) : '',
      Guest: guestLabelById.get(guest.id) || guest.id,
      Groups: joinLabels(guestGroupLabels),
    });
  }

  rows.sort((left, right) => {
    const tableCompare = String(left.Table).localeCompare(String(right.Table));
    if (tableCompare !== 0) {
      return tableCompare;
    }

    const seatCompare = String(left.Seat).localeCompare(String(right.Seat));
    if (seatCompare !== 0) {
      return seatCompare;
    }

    return String(left.Guest).localeCompare(String(right.Guest));
  });

  return rows;
}

function buildGuestsSheetRows(project, solution, groupLabelById, tableLabelById, seatLabelById) {
  const guests = Array.isArray(project?.items) ? project.items : [];
  const assignedTableIdByGuestId = getAssignedTableIdByGuestId(project, solution);
  const assignedSeatIdByGuestId = getAssignedSeatIdByGuestId(solution);

  return guests.map((guest) => {
    const guestGroupLabels = getContainedGroupIdsForItem(project, guest.id)
      .map((groupId) => groupLabelById.get(groupId) || groupId)
      .sort((left, right) => left.localeCompare(right));
    const tableId = assignedTableIdByGuestId.get(guest.id);
    const seatId = assignedSeatIdByGuestId.get(guest.id);

    return {
      Guest: guest.label,
      Groups: joinLabels(guestGroupLabels),
      Table: tableId ? (tableLabelById.get(tableId) || tableId) : '',
      Seat: seatId ? (seatLabelById.get(seatId) || seatId) : '',
    };
  });
}

function buildGroupsSheetRows(project) {
  const groups = Array.isArray(project?.groups) ? project.groups : [];
  const guests = Array.isArray(project?.items) ? project.items : [];

  return groups.map((group) => {
    const memberLabels = guests
      .filter((guest) => getContainedGroupIdsForItem(project, guest.id).includes(group.id))
      .map((guest) => guest.label)
      .sort((left, right) => left.localeCompare(right));

    return {
      Group: group.label,
      Guests: joinLabels(memberLabels),
    };
  });
}

function buildTablesSheetRows(project) {
  const tables = Array.isArray(project?.containers) ? project.containers : [];
  const containments = Array.isArray(project?.containments) ? project.containments : [];

  return tables.map((table) => {
    const seatCount = containments.filter((relation) => relation?.from?.kind === 'container' && relation?.from?.id === table.id && relation?.to?.kind === 'position').length;

    return {
      Table: table.label,
      Capacity: table?.metadata?.maxCapacity ?? '',
      Shape: table?.metadata?.shape ?? '',
      Seats: seatCount || '',
    };
  });
}

export function exportWeddingSolutionWorkbook(project, solverResult, solutionIndex = 0) {
  if (solverResult?.status !== 'solved' || !Array.isArray(solverResult?.solutions) || solverResult.solutions.length === 0) {
    throw new Error('A solved wedding result is required before exporting an Excel workbook.');
  }

  const clampedSolutionIndex = Math.min(Math.max(solutionIndex, 0), solverResult.solutions.length - 1);
  const solution = solverResult.solutions[clampedSolutionIndex];
  const guests = Array.isArray(project?.items) ? project.items : [];
  const groups = Array.isArray(project?.groups) ? project.groups : [];
  const tables = Array.isArray(project?.containers) ? project.containers : [];
  const positions = Array.isArray(project?.positions) ? project.positions : [];

  const guestLabelById = getLabelById(guests);
  const groupLabelById = getLabelById(groups);
  const tableLabelById = getLabelById(tables);
  const seatLabelById = getLabelById(positions);

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet(buildSummaryRows(project, solverResult, clampedSolutionIndex, guests, groups, tables, positions.length > 0));
  const seatingSheet = XLSX.utils.json_to_sheet(buildSeatingSheetRows(project, solution, guestLabelById, groupLabelById, tableLabelById, seatLabelById));
  const guestsSheet = XLSX.utils.json_to_sheet(buildGuestsSheetRows(project, solution, groupLabelById, tableLabelById, seatLabelById));
  const groupsSheet = XLSX.utils.json_to_sheet(buildGroupsSheetRows(project));
  const tablesSheet = XLSX.utils.json_to_sheet(buildTablesSheetRows(project));

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(workbook, seatingSheet, 'Seating');
  XLSX.utils.book_append_sheet(workbook, guestsSheet, 'Guests');
  XLSX.utils.book_append_sheet(workbook, groupsSheet, 'Groups');
  XLSX.utils.book_append_sheet(workbook, tablesSheet, 'Tables');

  const safeTitle = String(project?.title || 'wedding-plan')
    .trim()
    .replaceAll(/[^a-z0-9-_]+/gi, '-')
    .replaceAll(/^-+|-+$/g, '') || 'wedding-plan';

  XLSX.writeFile(workbook, `${safeTitle}-solution-${clampedSolutionIndex + 1}.xlsx`);
}
