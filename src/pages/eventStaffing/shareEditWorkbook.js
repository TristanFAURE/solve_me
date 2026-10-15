import * as XLSX from 'xlsx';
import { createId } from '../../core/model/ids.js';
import {
  createShareEditWorkbook,
  IDENTITY_TYPES,
  isValidIdentityValue,
  normalizeVisibleKey,
  parseShareEditWorkbook,
} from '../../workbooks/shareEdit.js';
import { readWorkbookFile, WorkbookSafetyError, WORKBOOK_LIMITS } from '../../workbooks/safety.js';
import {
  getEffectiveAssignmentPreference,
  getSlotGroupPreferenceMap,
  normalizePreferenceState,
  PREFERENCE_STATES,
} from './migration.js';
import { appendWorkbookLegend, EVENT_STAFFING_WORKBOOK_LEGEND } from '../../workbooks/legend.js';

const DOMAIN = 'event-staffing';
const DEFAULT_FILENAME = 'event-staffing-share-edit.xlsx';
const FIXED_COLUMNS = Object.freeze(['internalPersonId', 'internalGroupId', 'personKey', 'displayName', 'group']);
const IDENTITY_VALUES = new Set(Object.values(IDENTITY_TYPES));

export const EVENT_STAFFING_SHARE_EDIT_COLUMNS = FIXED_COLUMNS;

const TEXT = Object.freeze({
  en: {
    internalPersonId: 'Internal person ID', internalGroupId: 'Internal group ID', personKey: 'Person key',
    displayName: 'Display name', group: 'Staffing group',
    instructions: 'Use one row per person and staffing group. Edit only preference cells. Keep hidden mappings unchanged.',
    legend: 'P = prefer; N = prefer not; U = unavailable; blank = neutral.',
  },
  fr: {
    internalPersonId: 'ID interne de la personne', internalGroupId: 'ID interne du groupe', personKey: 'Clé personne',
    displayName: 'Nom affiché', group: 'Groupe de personnel',
    instructions: 'Utilisez une ligne par personne et groupe. Modifiez uniquement les préférences. Conservez les correspondances masquées.',
    legend: 'P = préfère; N = préfère éviter; U = indisponible; vide = neutre.',
  },
});

function text(value) {
  const result = String(value ?? '').trim();
  return /^'[=+\-@]/.test(result) ? result.slice(1) : result;
}

function identityValue(person, identityType) {
  if (identityType === IDENTITY_TYPES.EMAIL) return text(person?.email ?? person?.metadata?.participant?.email);
  if (identityType === IDENTITY_TYPES.EXTERNAL_KEY) return text(person?.metadata?.participant?.externalKey);
  return text(person?.name);
}

function preferenceValue(value) {
  const state = normalizePreferenceState(value);
  if (state === PREFERENCE_STATES.PREFER) return 'P';
  if (state === PREFERENCE_STATES.PREFER_NOT) return 'N';
  if (state === PREFERENCE_STATES.UNAVAILABLE) return 'U';
  return '';
}

function safeFilenamePart(value) {
  return text(value).replaceAll(/[^a-z0-9-_]+/gi, '-').replaceAll(/^-+|-+$/g, '') || 'person';
}

function workbookColumns(project, language) {
  const t = TEXT[language];
  return [
    { canonical: 'internalPersonId', label: t.internalPersonId, width: 22, hidden: true },
    { canonical: 'internalGroupId', label: t.internalGroupId, width: 22, hidden: true },
    { canonical: 'personKey', label: t.personKey, width: 30 },
    { canonical: 'displayName', label: t.displayName, width: 28 },
    { canonical: 'group', label: t.group, width: 24 },
    ...(project.events ?? []).slice().sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)).map((slot) => ({
      canonical: `pref:${slot.id}`,
      label: `${text(slot.date ?? slot.dateKey)} | ${text(slot.slotLabel ?? slot.label ?? slot.id)}`,
      width: 22,
      validationValues: ['P', 'N', 'U'],
    })),
  ];
}

function assertGeneratedBounds(rowCount, columnCount) {
  if (rowCount + 8 > WORKBOOK_LIMITS.maxRowsPerSheet) {
    throw new WorkbookSafetyError(`The Share & Edit workbook exceeds the ${WORKBOOK_LIMITS.maxRowsPerSheet} row limit.`);
  }
  if (columnCount > WORKBOOK_LIMITS.maxColumnsPerSheet) {
    throw new WorkbookSafetyError(`The Share & Edit workbook exceeds the ${WORKBOOK_LIMITS.maxColumnsPerSheet} column limit.`);
  }
}

export function createEventStaffingShareEditWorkbook(domainProject, options = {}) {
  const project = domainProject ?? {};
  const language = options.language === 'fr' ? 'fr' : 'en';
  const identityType = options.identityType ?? IDENTITY_TYPES.FULL_NAME;
  if (!IDENTITY_VALUES.has(identityType)) throw new Error('Unsupported workbook identity type.');
  const selectedIds = options.personIds ? new Set(options.personIds) : null;
  const people = (project.people ?? []).filter((person) => !selectedIds || selectedIds.has(person.id));
  const identityKeys = new Set();
  people.forEach((person) => {
    const key = normalizeVisibleKey(identityValue(person, identityType));
    if (!key) throw new Error(`Every Event Staffing participant needs a ${identityType} value before export.`);
    if (identityKeys.has(key)) throw new Error(`The selected ${identityType} values must be unique before export.`);
    identityKeys.add(key);
  });
  const groups = project.groupTypes ?? [];
  const slots = project.events ?? [];
  const rows = people.flatMap((person) => groups.map((group) => {
    const preference = (project.preferences ?? []).find((entry) => entry.personId === person.id);
    return {
      internalPersonId: person.id,
      internalGroupId: group.id,
      personKey: identityValue(person, identityType),
      displayName: person.name ?? '',
      group: group.label ?? group.id,
      ...Object.fromEntries(slots.map((slot) => [
        `pref:${slot.id}`,
        preferenceValue(getEffectiveAssignmentPreference(preference, slot, group.id)),
      ])),
    };
  }));
  const columns = workbookColumns(project, language);
  assertGeneratedBounds(rows.length, columns.length);
  const workbook = createShareEditWorkbook({
    domain: DOMAIN,
    projectTitle: project.title ?? '',
    language,
    identityType,
    columns,
    rows,
    instructions: TEXT[language].instructions,
    legend: TEXT[language].legend,
    revision: options.revision,
  });
  return appendWorkbookLegend(workbook, 'Event Staffing Share & Edit legend', EVENT_STAFFING_WORKBOOK_LEGEND);
}

export function exportEventStaffingShareEditWorkbook(project, options = {}) {
  const workbook = createEventStaffingShareEditWorkbook(project, options);
  XLSX.writeFile(workbook, typeof options === 'string' ? options : (options.filename ?? DEFAULT_FILENAME));
  return workbook;
}

export function exportEventStaffingPersonalWorkbook(project, selectedPerson, options = {}) {
  const personId = typeof selectedPerson === 'string' ? selectedPerson : selectedPerson?.id ?? selectedPerson?.personId;
  const person = (project?.people ?? []).find((entry) => entry.id === personId);
  if (!person) throw new Error('Choose a current person for the personalized workbook.');
  const filename = options.filename ?? `event-staffing-person-${safeFilenamePart(person.name ?? identityValue(person, options.identityType))}.xlsx`;
  const workbook = createEventStaffingShareEditWorkbook(project, { ...options, personIds: [person.id] });
  XLSX.writeFile(workbook, filename);
  return workbook;
}

function addIndexValue(index, key, value) {
  if (!key) return;
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

function setIdentity(person, identityType, key, displayName) {
  person.name = displayName;
  if (identityType === IDENTITY_TYPES.EMAIL) {
    person.email = key;
    person.metadata = { ...(person.metadata ?? {}), participant: { ...(person.metadata?.participant ?? {}), email: key } };
  }
  if (identityType === IDENTITY_TYPES.EXTERNAL_KEY) {
    person.metadata = { ...(person.metadata ?? {}), participant: { ...(person.metadata?.participant ?? {}), externalKey: key } };
  }
}

function createPerson(identityType, key, displayName) {
  const person = { id: createId('person'), name: displayName, metadata: { participant: {} } };
  setIdentity(person, identityType, key, displayName);
  return person;
}

function workbookHeaders(workbook) {
  const sheet = workbook?.Sheets?.['Share & Edit'];
  const matrix = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) : [];
  return {
    canonical: (matrix[6] ?? []).map((value) => text(value)),
    visible: (matrix[7] ?? []).map((value) => text(value)),
  };
}

function buildPreview(parsed, headers, domainProject) {
  const { canonical, visible } = headers;
  const candidate = structuredClone(domainProject ?? {});
  candidate.people ??= [];
  candidate.preferences ??= [];
  const report = {
    rows: parsed.rows.length, matched: 0, created: 0, updated: 0, preferenceCells: 0,
    duplicateRows: 0, invalidCells: 0, errors: [], warnings: [], canApply: false,
  };
  const issue = (row, message) => report.errors.push(row ? `Share & Edit row ${row}: ${message}` : message);
  const slotsById = new Map((candidate.events ?? []).map((slot) => [slot.id, slot]));
  const dynamicColumns = canonical.filter((column) => column.startsWith('pref:'));
  canonical.filter((column) => !FIXED_COLUMNS.includes(column) && !column.startsWith('pref:'))
    .forEach((column) => issue(null, `Unknown canonical column "${column}".`));
  const slotIds = dynamicColumns.map((column) => column.slice(5));
  slotIds.forEach((slotId) => {
    const slot = slotsById.get(slotId);
    if (!slotId || !slot) {
      issue(null, `Preference mapping references stale or unknown slot "${slotId}".`);
      return;
    }
  });

  const groupsById = new Map((candidate.groupTypes ?? []).map((group) => [group.id, group]));
  const peopleById = new Map(candidate.people.map((person) => [person.id, person]));
  const peopleByKey = new Map();
  candidate.people.forEach((person) => addIndexValue(peopleByKey, normalizeVisibleKey(identityValue(person, parsed.identityType)), person));
  const seenPairs = new Set();
  const seenPersonRows = new Map();
  const represented = [];

  for (const row of parsed.rows) {
    const personId = text(row.internalPersonId);
    const groupId = text(row.internalGroupId);
    const key = text(row.personKey);
    const displayName = text(row.displayName);
    const groupName = text(row.group);
    if (!key) issue(row._rowNumber, 'personKey is required.');
    if (key && !isValidIdentityValue(key, parsed.identityType)) issue(row._rowNumber, `personKey is not a valid ${parsed.identityType} value.`);
    if (!displayName) issue(row._rowNumber, 'displayName is required.');
    const group = groupsById.get(groupId);
    if (!group) issue(row._rowNumber, `Staffing group "${groupId}" is unknown.`);
    else if (normalizeVisibleKey(groupName) !== normalizeVisibleKey(group.label ?? group.id)) {
      issue(row._rowNumber, 'internalGroupId and group identify different staffing groups.');
    }

    const stablePerson = personId ? peopleById.get(personId) : null;
    const keyMatches = peopleByKey.get(normalizeVisibleKey(key)) ?? [];
    if (personId && !stablePerson) issue(row._rowNumber, `Person ID "${personId}" is stale or unknown.`);
    if (stablePerson && keyMatches.some((person) => person.id !== stablePerson.id)) {
      issue(row._rowNumber, 'internalPersonId and personKey identify different people.');
    }
    if (!stablePerson && keyMatches.length > 1) issue(row._rowNumber, `personKey "${key}" is ambiguous.`);
    let person = stablePerson ?? (keyMatches.length === 1 ? keyMatches[0] : null);
    if (!person && !personId && key && displayName) {
      person = createPerson(parsed.identityType, key, displayName);
      candidate.people.push(person);
      peopleById.set(person.id, person);
      addIndexValue(peopleByKey, normalizeVisibleKey(key), person);
      report.created += 1;
    } else if (person) {
      report.matched += 1;
    }
    if (!person || !group) continue;

    const personSignature = `${normalizeVisibleKey(key)}\u0000${displayName}`;
    const previousSignature = seenPersonRows.get(person.id);
    if (previousSignature && previousSignature !== personSignature) issue(row._rowNumber, 'The person identity differs between staffing group rows.');
    seenPersonRows.set(person.id, personSignature);
    const pair = `${person.id}\u0000${group.id}`;
    if (seenPairs.has(pair)) {
      report.duplicateRows += 1;
      issue(row._rowNumber, 'The person and staffing group row is duplicated.');
      continue;
    }
    seenPairs.add(pair);
    if (!previousSignature) {
      const before = JSON.stringify(person);
      setIdentity(person, parsed.identityType, key, displayName);
      if (JSON.stringify(person) !== before && stablePerson) report.updated += 1;
    }
    represented.push({ row, person, group });
  }

  represented.forEach(({ row, person, group }) => {
    let entry = candidate.preferences.find((preference) => preference.personId === person.id);
    if (!entry) {
      entry = { personId: person.id, slotPreferences: {}, slotGroupPreferences: {}, dayPreferences: {}, dayGroupPreferences: {} };
      candidate.preferences.push(entry);
    }
    const slotGroupPreferences = structuredClone(getSlotGroupPreferenceMap(entry));
    dynamicColumns.forEach((column, index) => {
      const slotId = slotIds[index];
      if (!slotsById.has(slotId)) return;
      const state = normalizePreferenceState(row[column]);
      if (!state) {
        report.invalidCells += 1;
        issue(row._rowNumber, `Preference for slot "${slotId}" must be P, N, U, or blank.`);
        return;
      }
      const valuesByGroup = { ...(slotGroupPreferences[slotId] ?? {}) };
      valuesByGroup[group.id] = state;
      slotGroupPreferences[slotId] = valuesByGroup;
      report.preferenceCells += 1;
    });
    entry.slotGroupPreferences = slotGroupPreferences;
    delete entry.eventGroupPreferences;
  });

  report.canApply = report.errors.length === 0;
  return {
    ...parsed,
    project: candidate,
    report,
    canApply: report.canApply,
    baseProjectId: domainProject?.projectId,
    baseSnapshot: JSON.stringify(domainProject),
  };
}

export function parseEventStaffingShareEditWorkbook(workbook, domainProject) {
  const headers = workbookHeaders(workbook);
  const parsed = parseShareEditWorkbook(workbook, DOMAIN, FIXED_COLUMNS);
  return buildPreview(parsed, headers, domainProject);
}

export async function previewEventStaffingShareEditWorkbookFile(file, domainProject) {
  const workbook = await readWorkbookFile(file);
  return parseEventStaffingShareEditWorkbook(workbook, domainProject);
}

export function applyEventStaffingShareEditPreview(domainProject, preview) {
  if (!preview?.canApply || !preview.project) throw new Error('Resolve workbook errors before applying Share & Edit changes.');
  if (domainProject && preview.baseProjectId !== undefined && preview.baseProjectId !== domainProject.projectId) {
    throw new Error('The Event Staffing Share & Edit preview belongs to another project.');
  }
  if (preview.baseSnapshot !== JSON.stringify(domainProject)) throw new Error('The Event Staffing project changed after preview. Preview the workbook again.');
  return structuredClone(preview.project);
}
