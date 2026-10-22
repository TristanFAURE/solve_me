import * as XLSX from 'xlsx';
import {
  neutralizeMatrix,
  neutralizeRows,
  readWorkbookFile,
  sheetToSafeRows,
  WorkbookSafetyError,
} from '../../workbooks/safety.js';
import { appendConfigurationEnvelope, readConfigurationEnvelope } from '../../workbooks/configurationEnvelope.js';
import { applyWorksheetLayout } from '../../workbooks/layout.js';
import { createEventStaffingDestinationId, transformEventStaffingProject } from '../../core/transform/eventStaffingProject.js';
import { normalizeProject } from '../../core/normalize/normalizeProject.js';
import { validateProject } from '../../core/validate/validateProject.js';
import { getDayGroupPreferenceMap, getDayPreferenceMap, getEffectiveSlotPreference, getPreferenceMap, getSlotDayKey, getSlotGroupPreferenceMap, migrateEventStaffingProject, normalizePreferenceState, PREFERENCE_STATES } from './migration.js';
import { validateEventStaffingProject } from './validateEventStaffingProject.js';
import { appendWorkbookLegend, EVENT_STAFFING_WORKBOOK_LEGEND } from '../../workbooks/legend.js';

const IDENTITY_HEADERS = new Set(['Person ID', 'Name', 'Email']);
export const EVENT_STAFFING_WORKBOOK_DOMAIN = 'event-staffing';

function normalizeIdentity(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function safeFilename(value, fallback) {
  return String(value || fallback).trim().replaceAll(/[^a-z0-9-_]+/gi, '-').replaceAll(/^-+|-+$/g, '') || fallback;
}

function coverageSummary(project, slotId) {
  const categoryById = new Map(project.groupTypes.map((category) => [category.id, category.label ?? category.id]));
  return project.requirements.filter((requirement) => (requirement.slotId ?? requirement.eventId) === slotId)
    .map((requirement) => `${categoryById.get(requirement.groupTypeId) ?? requirement.groupTypeId} ${requirement.min}-${requirement.max}`)
    .join(', ');
}

function createSlotColumns(project) {
  const usedHeaders = new Set();
  return project.events.slice().sort((left, right) => left.orderIndex - right.orderIndex).map((slot) => {
    const baseHeader = `${slot.date} | ${slot.slotLabel}`;
    let key = baseHeader;
    let suffix = 2;
    while (usedHeaders.has(key)) {
      key = `${baseHeader} [${suffix}]`;
      suffix += 1;
    }
    usedHeaders.add(key);
    return {
      key,
      slot,
      displayLabel: suffix === 2 ? slot.slotLabel : `${slot.slotLabel} [${suffix - 1}]`,
    };
  });
}

function preferenceColumnName(position) {
  return `Preference column ${position}`;
}

function createPreferenceSheet(project, columns) {
  const firstHeader = ['Name', 'Email', 'Person ID', ...columns.map(({ slot }, index) => (
    index === 0 || columns[index - 1].slot.date !== slot.date ? slot.date : ''
  ))];
  const secondHeader = ['', '', '', ...columns.map(({ displayLabel }) => displayLabel)];
  const personRows = project.people.map((person) => [
    person.name,
    person.email ?? '',
    person.id,
    ...columns.map(({ slot }) => preferenceToWorkbookValue(getEffectiveSlotPreference(
      project.preferences.find((entry) => entry.personId === person.id),
      slot,
    ))),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet(neutralizeMatrix([firstHeader, secondHeader, ...personRows]));
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
    { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
  ];
  for (let start = 0; start < columns.length;) {
    let end = start;
    while (end + 1 < columns.length && columns[end + 1].slot.date === columns[start].slot.date) end += 1;
    if (end > start) merges.push({ s: { r: 0, c: start + 3 }, e: { r: 0, c: end + 3 } });
    start = end + 1;
  }
  sheet['!merges'] = merges;
  return applyWorksheetLayout(sheet, [24, 30, 20, ...columns.map(() => 16)], { autoFilter: false });
}

function preferenceToWorkbookValue(value) {
  const state = normalizePreferenceState(value);
  if (state === PREFERENCE_STATES.PREFER) return 'P';
  if (state === PREFERENCE_STATES.PREFER_NOT) return 'N';
  if (state === PREFERENCE_STATES.UNAVAILABLE) return 'U';
  return '';
}

export function createEventStaffingPreferenceWorkbook(domainProject) {
  const project = migrateEventStaffingProject(domainProject);
  const columns = createSlotColumns(project);
  const slotRows = columns.map(({ key, slot }, index) => ({
    'Preference column key': key,
    'Preference column position': index + 4,
    'Slot ID': slot.id,
    Date: slot.date,
    'Slot label': slot.slotLabel,
    'Category coverage': coverageSummary(project, slot.id),
  }));
  const instructions = [
    ['Event Staffing preference workbook'],
    ['Edit only preference cells on the Preferences sheet. Dates are grouped in the first header row and slot labels are in the second. Do not change identity or Slots mapping values.'],
    ['P', 'Prefer (X, Y, YES, PREFER, and PREFERRED are also accepted)'],
    ['blank', 'Neutral'],
    ['N', 'Prefer not'],
    ['U', 'Unavailable (hard prohibition for every category in that slot)'],
    ['Accepted values', 'P/X/Y/YES/PREFER/PREFERRED; blank/NEUTRAL; N/NO/PREFER NOT; U/UNAVAILABLE. Values are case-insensitive.'],
    ['Identity matching', 'Person ID first, then unique case-insensitive email, then unique case-insensitive name. Unknown people are not created.'],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, applyWorksheetLayout(XLSX.utils.aoa_to_sheet(neutralizeMatrix(instructions)), [24, 100], { autoFilter: false }), 'Instructions');
  XLSX.utils.book_append_sheet(workbook, createPreferenceSheet(project, columns), 'Preferences');
  XLSX.utils.book_append_sheet(workbook, applyWorksheetLayout(XLSX.utils.json_to_sheet(neutralizeRows(slotRows), { header: ['Preference column key', 'Preference column position', 'Slot ID', 'Date', 'Slot label', 'Category coverage'] }), [34, 26, 20, 14, 22, 40]), 'Slots');
  appendWorkbookLegend(workbook, 'Event Staffing preference legend', EVENT_STAFFING_WORKBOOK_LEGEND);
  return workbook;
}

export function exportEventStaffingPreferenceWorkbook(domainProject) {
  const workbook = createEventStaffingPreferenceWorkbook(domainProject);
  XLSX.writeFile(workbook, `${safeFilename(domainProject?.title, 'event-staffing')}-preferences.xlsx`);
}

function appendReadableSheet(workbook, name, rows, widths, headers) {
  XLSX.utils.book_append_sheet(workbook, applyWorksheetLayout(XLSX.utils.json_to_sheet(neutralizeRows(rows), { header: headers }), widths), name);
}

export function createEventStaffingConfigurationWorkbook(domainProject, options = {}) {
  const project = migrateEventStaffingProject(domainProject);
  const workbook = createEventStaffingPreferenceWorkbook(project);
  workbook.Sheets.Instructions = XLSX.utils.aoa_to_sheet(neutralizeMatrix([
    ['Event Staffing configuration workbook'],
    ['Full replacement uses the reserved configuration envelope after preview and confirmation. Readable sheets other than Preferences are reference views.'],
    ['Preferences is editable and may be applied alone. Dates are grouped in the first header row and slot labels are in the second. Keep identity and Slots mapping values stable.'],
    ['P', 'Prefer (X, Y, YES, PREFER, and PREFERRED are also accepted)'],
    ['blank', 'Neutral (NEUTRAL is also accepted)'],
    ['N', 'Prefer not (NO and PREFER NOT are also accepted)'],
    ['U', 'Unavailable (UNAVAILABLE is also accepted)'],
    ['Values', 'Preference values are case-insensitive.'],
  ]));
  applyWorksheetLayout(workbook.Sheets.Instructions, [24, 110], { autoFilter: false });
  appendReadableSheet(workbook, 'Categories', project.groupTypes.map((entry) => ({ 'Category ID': entry.id, Category: entry.label })), [20, 28], ['Category ID', 'Category']);
  appendReadableSheet(workbook, 'Requirements', project.requirements.map((entry) => ({ 'Slot ID': entry.slotId ?? entry.eventId, 'Category ID': entry.groupTypeId, Minimum: entry.min, Maximum: entry.max })), [20, 20, 12, 12], ['Slot ID', 'Category ID', 'Minimum', 'Maximum']);
  appendReadableSheet(workbook, 'People', project.people.map((entry) => ({
    'Person ID': entry.id, Name: entry.name, Email: entry.email ?? '', 'Maximum assignments': entry.maxAssignments ?? '', 'Target assignments': entry.targetAssignments ?? '',
    'Allowed categories': (entry.allowedGroupTypeIds ?? []).join(', '), 'Forbidden categories': (entry.forbiddenGroupTypeIds ?? []).join(', '),
    'Maximum by category': JSON.stringify(entry.maxAssignmentsPerGroupType ?? {}), 'Target by category': JSON.stringify(entry.targetAssignmentsPerGroupType ?? {}),
  })), [20, 24, 30, 20, 20, 30, 30, 34, 34], ['Person ID', 'Name', 'Email', 'Maximum assignments', 'Target assignments', 'Allowed categories', 'Forbidden categories', 'Maximum by category', 'Target by category']);
  appendReadableSheet(workbook, 'Cooldowns', project.cooldownRules.map((entry) => ({ 'Trigger categories': Array.isArray(entry.triggerGroupTypes) ? entry.triggerGroupTypes.join(', ') : entry.triggerGroupTypes, 'Blocked categories': Array.isArray(entry.blockedGroupTypes) ? entry.blockedGroupTypes.join(', ') : entry.blockedGroupTypes, 'Blocked next slots': entry.blockedNextEventCount })), [32, 32, 20], ['Trigger categories', 'Blocked categories', 'Blocked next slots']);
  appendReadableSheet(workbook, 'Forced assignments', project.forcedAssignments.map((entry) => ({ 'Person ID': entry.personId, 'Slot ID': entry.slotId ?? entry.eventId, 'Category ID': entry.groupTypeId })), [20, 20, 20], ['Person ID', 'Slot ID', 'Category ID']);
  appendReadableSheet(workbook, 'Forbidden assignments', project.forbiddenAssignments.map((entry) => ({ 'Person ID': entry.personId, 'Slot ID': entry.slotId ?? entry.eventId, 'Category ID': entry.groupTypeId })), [20, 20, 20], ['Person ID', 'Slot ID', 'Category ID']);
  appendReadableSheet(workbook, 'Limits', Object.entries(project.globalLimits ?? {}).map(([key, value]) => ({ Limit: key, Value: value ?? '' })), [32, 16], ['Limit', 'Value']);
  return appendConfigurationEnvelope(workbook, EVENT_STAFFING_WORKBOOK_DOMAIN, project, options);
}

export function exportEventStaffingConfigurationWorkbook(domainProject) {
  XLSX.writeFile(createEventStaffingConfigurationWorkbook(domainProject), 'event-staffing-configuration.xlsx');
}

function findSheet(workbook, name) {
  const actualName = workbook.SheetNames.find((sheetName) => sheetName.toLowerCase() === name.toLowerCase());
  return actualName ? workbook.Sheets[actualName] : null;
}

function uniqueLookup(values, keySelector) {
  const lookup = new Map();
  values.forEach((value) => {
    const key = keySelector(value);
    if (!key) return;
    const existing = lookup.get(key) ?? [];
    existing.push(value);
    lookup.set(key, existing);
  });
  return lookup;
}

export function parseEventStaffingPreferenceWorkbook(workbook, domainProject) {
  const project = migrateEventStaffingProject(domainProject);
  const preferencesSheet = findSheet(workbook, 'Preferences');
  const slotsSheet = findSheet(workbook, 'Slots');
  if (!preferencesSheet || !slotsSheet) throw new WorkbookSafetyError('The workbook must contain Preferences and Slots sheets.');
  if (!preferencesSheet['!ref']) throw new WorkbookSafetyError('The Preferences sheet is empty.');
  const preferencesRange = XLSX.utils.decode_range(preferencesSheet['!ref']);
  const preferenceMatrix = XLSX.utils.sheet_to_json(preferencesSheet, { header: 1, defval: '', raw: false });
  const slotRows = sheetToSafeRows(slotsSheet);
  const knownSlotIds = new Set(project.events.map((slot) => slot.id));
  const expectedColumns = new Map(createSlotColumns(project).map((column, index) => [column.slot.id, {
    ...column,
    position: index + 4,
  }]));
  const slotIdByColumn = new Map();
  const unknownSlotMappings = [];
  const usesColumnPositions = String(slotsSheet.B1?.v ?? '').trim() === 'Preference column position'
    || slotRows.some((row) => String(row['Preference column position'] ?? '').trim() !== '');
  slotRows.forEach((row, index) => {
    const columnKey = String(row['Preference column key'] ?? '').trim();
    const slotId = String(row['Slot ID'] ?? '').trim();
    const rawPosition = String(row['Preference column position'] ?? '').trim();
    const position = Number(rawPosition);
    const mappingKey = usesColumnPositions ? preferenceColumnName(position) : columnKey;
    const validPosition = !usesColumnPositions || (/^\d+$/.test(rawPosition) && position >= 4 && position <= preferencesRange.e.c + 1);
    const expected = expectedColumns.get(slotId);
    const displayedDate = String(preferenceMatrix[0]?.[position - 1] ?? '').trim()
      || String(preferenceMatrix[0]?.slice(3, position - 1).findLast((value) => String(value ?? '').trim()) ?? '').trim();
    const displayedSlot = String(preferenceMatrix[1]?.[position - 1] ?? '').trim();
    const positionMatchesHeaders = !usesColumnPositions || (expected
      && position === expected.position
      && columnKey === expected.key
      && String(row.Date ?? '').trim() === expected.slot.date
      && String(row['Slot label'] ?? '').trim() === expected.slot.slotLabel
      && displayedDate === expected.slot.date
      && displayedSlot === expected.displayLabel);
    if (!columnKey || !slotId || !knownSlotIds.has(slotId) || !validPosition || !positionMatchesHeaders || slotIdByColumn.has(mappingKey)) {
      unknownSlotMappings.push(index + 2);
      return;
    }
    slotIdByColumn.set(mappingKey, slotId);
  });

  const rows = usesColumnPositions
    ? sheetToSafeRows(preferencesSheet, {
      header: Array.from({ length: preferencesRange.e.c + 1 }, (_, index) => (
        index < 3 ? ['Name', 'Email', 'Person ID'][index] : preferenceColumnName(index + 1)
      )),
      range: 2,
    })
    : sheetToSafeRows(preferencesSheet);
  const preferenceRowOffset = usesColumnPositions ? 3 : 2;

  const personById = new Map(project.people.map((person) => [person.id, person]));
  const peopleByEmail = uniqueLookup(project.people, (person) => normalizeIdentity(person.email));
  const peopleByName = uniqueLookup(project.people, (person) => normalizeIdentity(person.name));
  const seenPersonIds = new Set();
  const changes = [];
  const report = {
    matchedRows: 0,
    unknownRows: 0,
    duplicateRows: 0,
    ambiguousRows: 0,
    invalidRows: 0,
    invalidCells: 0,
    preferenceCells: 0,
    unknownSlotMappings: unknownSlotMappings.length,
    issues: unknownSlotMappings.map((row) => `Slots row ${row} has an unknown or duplicate mapping.`),
  };

  rows.forEach((row, rowIndex) => {
    const personId = String(row['Person ID'] ?? '').trim();
    const email = normalizeIdentity(row.Email);
    const name = normalizeIdentity(row.Name);
    if (!personId && !email && !name) {
      report.invalidRows += 1;
      report.issues.push(`Preferences row ${rowIndex + preferenceRowOffset} has no person identity.`);
      return;
    }
    let matches = personId && personById.has(personId) ? [personById.get(personId)] : [];
    if (matches.length === 0 && email) matches = peopleByEmail.get(email) ?? [];
    if (matches.length === 0 && name) matches = peopleByName.get(name) ?? [];
    if (matches.length === 0) {
      report.unknownRows += 1;
      report.issues.push(`Preferences row ${rowIndex + preferenceRowOffset} does not match a current person.`);
      return;
    }
    if (matches.length !== 1) {
      report.ambiguousRows += 1;
      report.issues.push(`Preferences row ${rowIndex + preferenceRowOffset} matches more than one person.`);
      return;
    }
    const person = matches[0];
    if (seenPersonIds.has(person.id)) {
      report.duplicateRows += 1;
      report.issues.push(`Preferences row ${rowIndex + preferenceRowOffset} duplicates person "${person.name}".`);
      return;
    }
    seenPersonIds.add(person.id);
    report.matchedRows += 1;
    Object.entries(row).forEach(([columnKey, rawValue]) => {
      if (IDENTITY_HEADERS.has(columnKey)) return;
      const slotId = slotIdByColumn.get(columnKey);
      if (!slotId) {
        report.unknownSlotMappings += 1;
        report.issues.push(`Preference column "${columnKey}" has no valid Slots mapping.`);
        return;
      }
      const state = normalizePreferenceState(rawValue);
      if (!state) {
        report.invalidCells += 1;
        report.issues.push(`Preferences row ${rowIndex + preferenceRowOffset}, column "${columnKey}" has an invalid value.`);
        return;
      }
      report.preferenceCells += 1;
      changes.push({ personId: person.id, slotId, state });
    });
  });

  const slotsById = new Map(project.events.map((slot) => [slot.id, slot]));
  const retainedGroupOverrides = new Set();
  changes.forEach(({ personId, slotId }) => {
    const preference = project.preferences.find((entry) => entry.personId === personId);
    const dayKey = getSlotDayKey(slotsById.get(slotId));
    if (Object.keys(getDayGroupPreferenceMap(preference)[dayKey] ?? {}).length > 0) {
      retainedGroupOverrides.add(`${personId}\u0000${dayKey}`);
    }
  });
  if (retainedGroupOverrides.size > 0) {
    report.issues.push(`${retainedGroupOverrides.size} day/group override set(s) remain active and take precedence over imported slot values. Edit them in the Rules availability calendar.`);
  }

  return {
    report,
    changes,
    canApply: report.ambiguousRows === 0 && report.duplicateRows === 0 && report.invalidRows === 0
      && report.invalidCells === 0 && report.unknownSlotMappings === 0,
  };
}

export async function previewEventStaffingPreferenceFile(file, domainProject) {
  return parseEventStaffingPreferenceWorkbook(await readWorkbookFile(file), domainProject);
}

export async function previewEventStaffingWorkbookFile(file, domainProject) {
  const workbook = await readWorkbookFile(file);
  const envelope = readConfigurationEnvelope(workbook, EVENT_STAFFING_WORKBOOK_DOMAIN);
  if (!envelope) return { kind: 'preferences', ...parseEventStaffingPreferenceWorkbook(workbook, domainProject) };
  let preferencePreview;
  try {
    preferencePreview = parseEventStaffingPreferenceWorkbook(workbook, domainProject);
  } catch (error) {
    preferencePreview = {
      canApply: false,
      changes: [],
      report: {
        matchedRows: 0, unknownRows: 0, duplicateRows: 0, ambiguousRows: 0, invalidRows: 0,
        invalidCells: 0, preferenceCells: 0, unknownSlotMappings: 0,
        issues: [error instanceof WorkbookSafetyError ? error.message : 'Preferences could not be previewed.'],
      },
    };
  }
  const project = migrateEventStaffingProject(envelope.configuration);
  const validation = validateEventStaffingProject(project);
  const genericValidation = validation.valid ? validateProject(normalizeProject(transformEventStaffingProject(project))) : null;
  if (!validation.valid || !genericValidation?.valid) throw new WorkbookSafetyError('The imported Event Staffing configuration has validation errors.');
  return {
    kind: 'configuration',
    project,
    validation,
    genericValidation,
    preferencePreview,
    canReplace: true,
    canApply: preferencePreview.canApply,
    report: preferencePreview.report,
    changes: preferencePreview.changes,
  };
}

export function getEventStaffingReplacementFromPreview(preview) {
  if (preview?.kind !== 'configuration' || !preview.canReplace || !preview.project) throw new Error('A valid full configuration preview is required.');
  return migrateEventStaffingProject(structuredClone(preview.project));
}

export function applyEventStaffingPreferencePreview(domainProject, preview) {
  if (!preview?.canApply || !Array.isArray(preview.changes)) throw new Error('Resolve workbook errors before applying preferences.');
  const preferencesByPersonId = new Map((domainProject.preferences ?? []).map((entry) => [entry.personId, {
    ...entry,
    slotPreferences: { ...getPreferenceMap(entry) },
    dayPreferences: { ...getDayPreferenceMap(entry) },
    dayGroupPreferences: structuredClone(getDayGroupPreferenceMap(entry)),
    slotGroupPreferences: structuredClone(getSlotGroupPreferenceMap(entry)),
  }]));
  const slotsById = new Map((domainProject.events ?? []).map((slot) => [slot.id, slot]));
  const replacedDaysByPerson = new Map();
  preview.changes.forEach(({ personId, slotId, state }) => {
    const entry = preferencesByPersonId.get(personId) ?? { personId, slotPreferences: {}, slotGroupPreferences: {}, dayPreferences: {}, dayGroupPreferences: {} };
    const dayKey = getSlotDayKey(slotsById.get(slotId));
    const replacedDays = replacedDaysByPerson.get(personId) ?? new Set();
    if (!replacedDays.has(dayKey)) {
      delete entry.dayPreferences[dayKey];
      replacedDays.add(dayKey);
      replacedDaysByPerson.set(personId, replacedDays);
    }
    entry.slotPreferences[slotId] = state;
    preferencesByPersonId.set(personId, entry);
  });
  domainProject.preferences = [...preferencesByPersonId.values()];
  return preview.changes.length;
}

function parseDestinationId(destinationId) {
  const match = /^event:(.*)::group:(.*)$/.exec(destinationId ?? '') ?? /^event__(.*)__group__(.*)$/.exec(destinationId ?? '');
  return match ? { slotId: match[1], categoryId: match[2] } : null;
}

export function createEventStaffingSolutionWorkbook(domainProject, solverResult, solutionIndex = 0) {
  const project = migrateEventStaffingProject(domainProject);
  if (!Array.isArray(solverResult?.solutions) || solverResult.solutions.length === 0) throw new Error('A solved staffing result is required before exporting.');
  const index = Math.min(Math.max(solutionIndex, 0), solverResult.solutions.length - 1);
  const solution = solverResult.solutions[index];
  const slots = new Map(project.events.map((slot) => [slot.id, slot]));
  const categories = new Map(project.groupTypes.map((category) => [category.id, category]));
  const people = new Map(project.people.map((person) => [person.id, person]));
  const counts = new Map(project.people.map((person) => [person.id, new Map()]));
  const unavailableAssignments = new Map((solution.administratorUnavailableAssignments ?? [])
    .map((entry) => [`${entry.personId}\u0000${entry.destinationId}`, entry]));
  const omittedRequirements = new Map((solverResult.administratorOmittedRequirements ?? [])
    .map((entry) => [`${entry.eventId}\u0000${entry.groupTypeId}`, entry]));
  const assignmentsByDestination = new Map();
  (solution.assignments ?? []).forEach((assignment) => {
    const destinationId = assignment.containerRef?.id ?? assignment.positionRef?.id;
    const assignments = assignmentsByDestination.get(destinationId) ?? [];
    assignments.push(assignment);
    assignmentsByDestination.set(destinationId, assignments);
  });
  function assignmentRow(assignment, destinationId) {
    const destination = parseDestinationId(destinationId);
    const slot = slots.get(destination?.slotId);
    const person = people.get(assignment.itemRef?.id);
    const category = categories.get(destination?.categoryId);
    const categoryCounts = counts.get(person?.id) ?? new Map();
    categoryCounts.set(category?.label ?? destination?.categoryId, (categoryCounts.get(category?.label ?? destination?.categoryId) ?? 0) + 1);
    if (person) counts.set(person.id, categoryCounts);
    const relaxedUnavailable = unavailableAssignments.get(`${assignment.itemRef?.id}\u0000${destinationId}`);
    return {
      Date: slot?.date ?? '',
      Slot: slot?.slotLabel ?? destination?.slotId ?? '',
      Category: category?.label ?? destination?.categoryId ?? '',
      Person: person?.name ?? assignment.itemRef?.id ?? '',
      Email: person?.email ?? '',
      Comment: relaxedUnavailable
        ? `Assigned despite declared unavailability through a temporary administrator relaxation: ${relaxedUnavailable.label}`
        : '',
    };
  }
  const eventOrder = new Map(project.events.map((event) => [event.id, event.orderIndex]));
  const categoryOrder = new Map(project.groupTypes.map((category, categoryIndex) => [category.id, categoryIndex]));
  const scheduleRows = [...project.requirements]
    .sort((left, right) => (eventOrder.get(left.eventId) ?? 0) - (eventOrder.get(right.eventId) ?? 0)
      || (categoryOrder.get(left.groupTypeId) ?? 0) - (categoryOrder.get(right.groupTypeId) ?? 0))
    .flatMap((requirement) => {
      const destinationId = createEventStaffingDestinationId(requirement.eventId, requirement.groupTypeId);
      const assignments = assignmentsByDestination.get(destinationId) ?? [];
      if (assignments.length > 0) return assignments.map((assignment) => assignmentRow(assignment, destinationId));
      const slot = slots.get(requirement.eventId);
      const category = categories.get(requirement.groupTypeId);
      const omitted = omittedRequirements.get(`${requirement.eventId}\u0000${requirement.groupTypeId}`);
      return [{
        Date: slot?.date ?? '',
        Slot: slot?.slotLabel ?? requirement.eventId,
        Category: category?.label ?? requirement.groupTypeId,
        Person: '',
        Email: '',
        Comment: omitted
          ? `Not solved by administrator: ${omitted.label ?? `${requirement.eventId} / ${requirement.groupTypeId}`}`
          : '',
      }];
    });
  const peopleRows = project.people.map((person) => ({
    Person: person.name,
    Email: person.email ?? '',
    Total: [...(counts.get(person.id)?.values() ?? [])].reduce((sum, value) => sum + value, 0),
    'Category counts': [...(counts.get(person.id)?.entries() ?? [])].map(([label, value]) => `${label}: ${value}`).join(', '),
    Target: person.targetAssignments ?? '',
    'Preference contribution': solution.scoreDetails?.assignmentScores ?? '',
    'Target contribution': solution.scoreDetails?.itemCountTargets ?? '',
    'Equity contribution': solution.scoreDetails?.equity ?? '',
  }));
  const metadata = [
    ['Rank', index + 1], ['Score', solution.score ?? ''], ['Status', solverResult.status ?? ''],
    ['Search complete', solverResult.searchComplete ? 'Yes' : 'No'], ['Optimality proven', solverResult.optimalityProven ? 'Yes' : 'No'],
    ['Timeout reached', solverResult.timeoutReached ? 'Yes' : 'No'], ['Runtime (ms)', solverResult.runtimeMs ?? 0],
  ];
  (solverResult.administratorOmittedRequirements ?? []).forEach((requirement) => {
    metadata.push(['Not solved by administrator', requirement.label ?? `${requirement.eventId ?? ''} / ${requirement.groupTypeId ?? ''}`]);
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(neutralizeRows(scheduleRows)), 'Schedule');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(neutralizeRows(peopleRows)), 'People summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(neutralizeMatrix(metadata)), 'Solution metadata');
  appendWorkbookLegend(workbook, 'Event Staffing solution legend', EVENT_STAFFING_WORKBOOK_LEGEND);
  return workbook;
}

export function exportEventStaffingSolutionWorkbook(domainProject, solverResult, solutionIndex = 0) {
  const workbook = createEventStaffingSolutionWorkbook(domainProject, solverResult, solutionIndex);
  XLSX.writeFile(workbook, `event-staffing-solution-${solutionIndex + 1}.xlsx`);
}
