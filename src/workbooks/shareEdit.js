import * as XLSX from 'xlsx';
import { applyWorksheetLayout, hideReservedWorksheets } from './layout.js';
import { neutralizeFormulaValue, readWorkbookFile, sanitizeWorkbookValue, validateWorkbookBounds, WorkbookSafetyError, WORKBOOK_LIMITS } from './safety.js';

export const SHARE_EDIT_SHEET = 'Share & Edit';
export const SHARE_EDIT_MANIFEST_SHEET = '_ShareEdit';
export const SHARE_EDIT_VERSION = 1;
export const IDENTITY_TYPES = Object.freeze({ FULL_NAME: 'fullName', EMAIL: 'email', EXTERNAL_KEY: 'externalKey' });
const IDENTITY_VALUES = new Set(Object.values(IDENTITY_TYPES));

export const SHARED_LANGUAGE = Object.freeze({
  en: {
    purpose: 'Stakeholder contribution workbook. Edit the visible table and import it back into the application.',
    listLegend: 'Relationship lists use exact visible keys separated by semicolons.',
    personKey: 'Person key', guestKey: 'Guest key', displayName: 'Display name', role: 'Role', levels: 'Level(s)',
    fixedClass: 'Fixed class', excludedClasses: 'Excluded classes', mustShare: 'Must be with', preferShare: 'Prefer to be with', preferSeparate: 'Prefer apart', mustSeparate: 'Must be apart',
    mustSameTable: 'Must same table', preferSameTable: 'Prefer same table', preferDifferentTable: 'Prefer different table', mustDifferentTable: 'Must different table',
    group: 'Group', project: 'Project', workbookPurpose: 'Workbook purpose', revision: 'Export revision', identity: 'Identity', instructions: 'Instructions', legend: 'Legend',
  },
  fr: {
    purpose: 'Classeur de contribution. Modifiez le tableau visible puis réimportez-le dans l’application.',
    listLegend: 'Les relations utilisent les clés visibles exactes séparées par des points-virgules.',
    personKey: 'Clé personne', guestKey: 'Clé invité', displayName: 'Nom affiché', role: 'Rôle', levels: 'Niveau(x)',
    fixedClass: 'Classe imposée', excludedClasses: 'Classes exclues', mustShare: 'Doit être avec', preferShare: 'Préfère être avec', preferSeparate: 'Préfère être séparé', mustSeparate: 'Doit être séparé',
    mustSameTable: 'Même table obligatoire', preferSameTable: 'Préfère la même table', preferDifferentTable: 'Préfère une table différente', mustDifferentTable: 'Tables différentes obligatoires',
    group: 'Groupe', project: 'Projet', workbookPurpose: 'Objectif du classeur', revision: 'Révision export', identity: 'Identité', instructions: 'Instructions', legend: 'Légende',
  },
});

function languagePack(language) {
  return SHARED_LANGUAGE[language] ?? SHARED_LANGUAGE.en;
}

function assertSafeExportText(value) {
  if (typeof value !== 'string') return;
  if (/\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?\b/i.test(value)
    || /(?:^|\s)(?:[A-Za-z]:\\|\/home\/|\/Users\/|\/workspace\/)/.test(value)) {
    throw new Error('Share & Edit exports cannot contain internal URLs or local filesystem paths.');
  }
}

export function participantMetadata(entity) {
  const participant = entity?.metadata?.participant ?? {};
  return {
    email: String(participant.email ?? entity?.email ?? entity?.metadata?.email ?? '').trim(),
    externalKey: String(participant.externalKey ?? entity?.externalKey ?? entity?.metadata?.externalKey ?? '').trim(),
  };
}

export function identityValue(entity, identityType) {
  const metadata = participantMetadata(entity);
  if (identityType === IDENTITY_TYPES.EMAIL) return metadata.email;
  if (identityType === IDENTITY_TYPES.EXTERNAL_KEY) return metadata.externalKey;
  return String(entity?.label ?? '').trim();
}

export function assertUniqueIdentityValues(participants, identityType, label = 'participant') {
  const seen = new Set();
  participants.forEach((participant) => {
    const value = identityValue(participant, identityType);
    const key = normalizeVisibleKey(value);
    if (!key) throw new Error(`Every ${label} needs a ${identityType} value before export.`);
    if (!isValidIdentityValue(value, identityType)) throw new Error(`A ${label} has an invalid ${identityType} value.`);
    if (seen.has(key)) throw new Error(`The selected ${identityType} values must be unique before export.`);
    seen.add(key);
  });
}

export function buildExportIdentityKeys(participants, identityType, label = 'participant') {
  if (identityType !== IDENTITY_TYPES.FULL_NAME) {
    assertUniqueIdentityValues(participants, identityType, label);
    return new Map(participants.map((participant) => [participant.id, identityValue(participant, identityType)]));
  }
  const counts = new Map();
  participants.forEach((participant) => {
    const value = identityValue(participant, identityType);
    if (!isValidIdentityValue(value, identityType)) throw new Error(`Every ${label} needs a full name before export.`);
    const key = normalizeVisibleKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const indexes = new Map();
  const used = new Set();
  const result = new Map();
  participants.forEach((participant) => {
    const base = identityValue(participant, identityType);
    const normalized = normalizeVisibleKey(base);
    const nextIndex = (indexes.get(normalized) ?? 0) + 1;
    indexes.set(normalized, nextIndex);
    let value = counts.get(normalized) > 1 ? `${base} [${nextIndex}]` : base;
    let suffix = nextIndex;
    while (used.has(normalizeVisibleKey(value))) {
      suffix += 1;
      value = `${base} [${suffix}]`;
    }
    used.add(normalizeVisibleKey(value));
    result.set(participant.id, value);
  });
  return result;
}

export function isValidIdentityValue(value, identityType) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 320) return false;
  if (identityType === IDENTITY_TYPES.EMAIL) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  return true;
}

export function normalizeVisibleKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function importedCellValue(value) {
  const sanitized = sanitizeWorkbookValue(value);
  return typeof sanitized === 'string' && /^'[=+\-@]/.test(sanitized) ? sanitized.slice(1) : sanitized;
}

export function splitRelationshipList(value) {
  return String(value ?? '').split(';').map((entry) => entry.trim()).filter(Boolean);
}

export function createShareEditWorkbook({ domain, projectTitle, language = 'en', identityType = IDENTITY_TYPES.FULL_NAME, columns, rows, instructions, legend, revision = new Date().toISOString() }) {
  if (!IDENTITY_VALUES.has(identityType)) throw new Error('Unsupported workbook identity type.');
  const t = languagePack(language);
  assertSafeExportText(projectTitle);
  rows.forEach((row) => Object.values(row).forEach(assertSafeExportText));
  const canonicalHeaders = columns.map(({ canonical }) => canonical);
  const visibleHeaders = columns.map(({ label }) => label);
  const matrix = [
    [t.project, projectTitle], [t.workbookPurpose, t.purpose], [t.revision, revision], [t.identity, identityType],
    [t.instructions, instructions ?? t.purpose], [t.legend, legend ?? t.listLegend],
    canonicalHeaders,
    visibleHeaders,
    ...rows.map((row) => columns.map(({ canonical }) => neutralizeFormulaValue(row[canonical] ?? ''))),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  applyWorksheetLayout(sheet, columns.map(({ width = 22 }) => width), { autoFilter: false });
  sheet['!rows'] = [{}, {}, {}, {}, {}, {}, { hidden: true }, {}];
  sheet['!cols'] = columns.map(({ width = 22, hidden = false }) => ({ wch: width, hidden }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 7, c: 0 }, e: { r: Math.max(7, matrix.length - 1), c: columns.length - 1 } }) };
  sheet['!freeze'] = { xSplit: 0, ySplit: 8, topLeftCell: 'A9', activePane: 'bottomLeft', state: 'frozen' };
  sheet['!dataValidation'] = columns.flatMap((column, index) => column.validationValues?.length ? [{
    sqref: `${XLSX.utils.encode_col(index)}9:${XLSX.utils.encode_col(index)}${WORKBOOK_LIMITS.maxRowsPerSheet}`,
    type: 'list',
    allowBlank: true,
    formula1: `"${column.validationValues.join(',')}"`,
  }] : []);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHARE_EDIT_SHEET);
  const manifest = XLSX.utils.aoa_to_sheet([
    ['format', 'share-edit'], ['version', SHARE_EDIT_VERSION], ['domain', domain], ['language', language], ['identityType', identityType], ['revision', revision], ['canonicalHeaderRow', 7], ['visibleHeaderRow', 8],
  ]);
  XLSX.utils.book_append_sheet(workbook, manifest, SHARE_EDIT_MANIFEST_SHEET);
  hideReservedWorksheets(workbook, [SHARE_EDIT_MANIFEST_SHEET]);
  validateWorkbookBounds(workbook);
  return workbook;
}

function manifestValues(workbook) {
  const sheet = workbook.Sheets?.[SHARE_EDIT_MANIFEST_SHEET];
  if (!sheet) throw new WorkbookSafetyError('The workbook is not a Share & Edit workbook.');
  return new Map(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }).map(([key, value]) => [String(key), value]));
}

export function parseShareEditWorkbook(workbook, domain, requiredColumns) {
  const manifest = manifestValues(workbook);
  if (manifest.get('format') !== 'share-edit' || Number(manifest.get('version')) !== SHARE_EDIT_VERSION) throw new WorkbookSafetyError('The Share & Edit workbook version is unsupported.');
  if (manifest.get('domain') !== domain) throw new WorkbookSafetyError('The Share & Edit workbook belongs to another use case.');
  const identityType = String(manifest.get('identityType'));
  if (!IDENTITY_VALUES.has(identityType)) throw new WorkbookSafetyError('The workbook identity type is unsupported.');
  const sheet = workbook.Sheets?.[SHARE_EDIT_SHEET];
  if (!sheet) throw new WorkbookSafetyError(`The workbook must contain the ${SHARE_EDIT_SHEET} sheet.`);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (matrix.length < 8) throw new WorkbookSafetyError('The Share & Edit sheet is incomplete.');
  const canonical = (matrix[6] ?? []).map((value) => String(sanitizeWorkbookValue(value)).trim());
  if (new Set(canonical).size !== canonical.length || requiredColumns.some((column) => !canonical.includes(column))) throw new WorkbookSafetyError('The Share & Edit sheet has missing or duplicate canonical columns.');
  const rows = matrix.slice(8).filter((row) => row.some((value) => String(value ?? '').trim())).map((values, rowIndex) => {
    if (values.length > WORKBOOK_LIMITS.maxColumnsPerSheet) throw new WorkbookSafetyError('The Share & Edit sheet exceeds the column limit.');
    return Object.fromEntries(canonical.map((key, index) => [key, importedCellValue(values[index] ?? '')]).concat([['_rowNumber', rowIndex + 9]]));
  });
  return { identityType, language: String(manifest.get('language') || 'en'), revision: String(manifest.get('revision') || ''), rows };
}

export async function readShareEditWorkbookFile(file, domain, requiredColumns) {
  return parseShareEditWorkbook(await readWorkbookFile(file), domain, requiredColumns);
}

export function buildIdentityIndex(participants, identityType) {
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  const byKey = new Map();
  participants.forEach((participant) => {
    const key = normalizeVisibleKey(identityValue(participant, identityType));
    if (!key) return;
    const values = byKey.get(key) ?? [];
    values.push(participant);
    byKey.set(key, values);
  });
  return { byId, byKey };
}

export function matchParticipant(index, internalId, visibleKey) {
  const id = String(internalId ?? '').trim();
  if (id && index.byId.has(id)) return { participant: index.byId.get(id), match: 'id' };
  const matches = index.byKey.get(normalizeVisibleKey(visibleKey)) ?? [];
  if (matches.length === 1) return { participant: matches[0], match: 'key' };
  if (matches.length > 1) return { participant: null, ambiguous: true };
  return { participant: null, match: 'new' };
}
