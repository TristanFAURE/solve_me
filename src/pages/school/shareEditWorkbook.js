import * as XLSX from 'xlsx';
import { CONSTRAINT_KINDS, createConstraint } from '../../core/model/constraints.js';
import { createId } from '../../core/model/ids.js';
import { createGroup, createItem } from '../../core/model/nodes.js';
import { PREFERENCE_KINDS, createPreference } from '../../core/model/preferences.js';
import { createContainmentRelation, createEntityRef } from '../../core/model/relations.js';
import { buildSchoolParticipantIndex, getContainedGroupIdsForItem, SCHOOL_ITEM_ROLES } from '../../core/transform/domainMappings.js';
import {
  buildIdentityIndex,
  buildExportIdentityKeys,
  createShareEditWorkbook,
  identityValue,
  isValidIdentityValue,
  IDENTITY_TYPES,
  matchParticipant,
  normalizeVisibleKey,
  parseShareEditWorkbook,
  participantMetadata,
  readShareEditWorkbookFile,
  splitRelationshipList,
} from '../../workbooks/shareEdit.js';
import { appendWorkbookLegend, SCHOOL_WORKBOOK_LEGEND } from '../../workbooks/legend.js';

export const SCHOOL_SHARE_EDIT_COLUMNS = Object.freeze([
  'internalId', 'personKey', 'displayName', 'role', 'levels', 'fixedClass', 'excludedClasses',
  'mustShare', 'preferShare', 'preferSeparate', 'mustSeparate',
]);

const DOMAIN = 'school';
const DEFAULT_FILENAME = 'school-share-edit.xlsx';
const HARD_KINDS = Object.freeze({ mustShare: CONSTRAINT_KINDS.MUST_SHARE_CONTAINER, mustSeparate: CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER });
const SOFT_KINDS = Object.freeze({ preferShare: PREFERENCE_KINDS.PREFER_SHARE_CONTAINER, preferSeparate: PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS });
const ROLE_LABELS = Object.freeze({
  en: { student: 'Student', teacher: 'Teacher' },
  fr: { student: 'Élève', teacher: 'Enseignant' },
});
const ROLE_VALUES = new Map([
  ['student', SCHOOL_ITEM_ROLES.STUDENT], ['teacher', SCHOOL_ITEM_ROLES.TEACHER],
  ['élève', SCHOOL_ITEM_ROLES.STUDENT], ['etudiant', SCHOOL_ITEM_ROLES.STUDENT], ['étudiant', SCHOOL_ITEM_ROLES.STUDENT],
  ['enseignant', SCHOOL_ITEM_ROLES.TEACHER], ['enseignante', SCHOOL_ITEM_ROLES.TEACHER],
]);

function text(value) {
  return String(value ?? '').trim();
}

function list(value) {
  return splitRelationshipList(value);
}

function columns(language) {
  const french = language === 'fr';
  const labels = french
    ? ['ID interne', 'Clé personne', 'Nom affiché', 'Rôle', 'Niveau(x)', 'Classe imposée', 'Classes exclues', 'Doit être avec', 'Préfère être avec', 'Préfère être séparé', 'Doit être séparé']
    : ['Internal ID', 'Person key', 'Display name', 'Role', 'Level(s)', 'Fixed class', 'Excluded classes', 'Must be with', 'Prefer to be with', 'Prefer apart', 'Must be apart'];
  return SCHOOL_SHARE_EDIT_COLUMNS.map((canonical, index) => ({ canonical, label: labels[index], width: index < 4 ? 22 : 28, hidden: canonical === 'internalId', ...(canonical === 'role' ? { validationValues: Object.values(ROLE_LABELS[language]) } : {}) }));
}

function unorderedKey(kind, leftId, rightId) {
  return `${kind}\u0000${[leftId, rightId].sort().join('\u0000')}`;
}

function pairKey(leftId, rightId) {
  return [leftId, rightId].sort().join('\u0000');
}

function appendKey(map, key, value) {
  if (!key) return;
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function uniqueByLabel(entries) {
  const result = new Map();
  (entries ?? []).forEach((entry) => appendKey(result, normalizeVisibleKey(entry.label), entry));
  return result;
}

function counterpart(entry, participantId) {
  if (entry?.leftRef?.id === participantId) return entry.rightRef?.id;
  if (entry?.rightRef?.id === participantId) return entry.leftRef?.id;
  return null;
}

function directionalVotes(preference) {
  const votes = preference?.metadata?.directionalVotes;
  if (Array.isArray(votes)) {
    return votes.map((vote) => ({
      fromId: text(vote?.fromId ?? vote?.from),
      toId: text(vote?.toId ?? vote?.to),
      weight: Number.isFinite(Number(vote?.weight)) && Number(vote.weight) > 0 ? Number(vote.weight) : 1,
    })).filter((vote) => vote.fromId && vote.toId);
  }
  if (votes && typeof votes === 'object') {
    return Object.entries(votes).flatMap(([fromId, targets]) => (
      Array.isArray(targets) ? targets.map((toId) => ({ fromId, toId: text(toId), weight: 1 })) : []
    )).filter((vote) => vote.fromId && vote.toId);
  }
  return preference?.leftRef?.id && preference?.rightRef?.id
    ? [{ fromId: preference.leftRef.id, toId: preference.rightRef.id, weight: Number(preference.weight) || 1 }]
    : [];
}

function exportRelationshipKeys(project, participant, kind, visibleById, preferences = false) {
  const participants = new Map((project.items ?? []).map((item) => [item.id, item]));
  const entries = preferences ? (project.preferences ?? []) : (project.constraints ?? []);
  const ids = [];
  entries.filter((entry) => entry.kind === kind).forEach((entry) => {
    if (preferences) {
      const votes = directionalVotes(entry).filter((vote) => vote.fromId === participant.id);
      votes.forEach((vote) => ids.push(vote.toId));
      return;
    }
    const otherId = counterpart(entry, participant.id);
    if (otherId) ids.push(otherId);
  });
  return [...new Set(ids)].map((id) => visibleById.get(id)).filter(Boolean).join('; ');
}

export function createSchoolShareEditWorkbook(project, options = {}) {
  const language = options.language === 'fr' ? 'fr' : 'en';
  const identityType = options.identityType ?? IDENTITY_TYPES.FULL_NAME;
  const participants = buildSchoolParticipantIndex(project);
  const allParticipants = [...participants.students, ...participants.teachers];
  const visibleById = buildExportIdentityKeys(allParticipants, identityType, 'School participant');
  const levelLabels = new Map((project.groups ?? []).map((entry) => [entry.id, entry.label]));
  const classLabels = new Map((project.containers ?? []).map((entry) => [entry.id, entry.label]));
  const fixedByParticipant = new Map((project.fixedAssignments ?? []).map((entry) => [entry.itemId, entry.destinationId]));
  const rows = allParticipants.map((participant) => ({
    internalId: participant.id,
    personKey: visibleById.get(participant.id),
    displayName: participant.label,
    role: ROLE_LABELS[language][participant.metadata?.schoolRole] ?? ROLE_LABELS[language].student,
    levels: getContainedGroupIdsForItem(project, participant.id).map((id) => levelLabels.get(id) ?? id).join('; '),
    fixedClass: classLabels.get(fixedByParticipant.get(participant.id)) ?? '',
    excludedClasses: (participant.metadata?.forbiddenContainerIds ?? []).map((id) => classLabels.get(id) ?? id).join('; '),
    mustShare: exportRelationshipKeys(project, participant, CONSTRAINT_KINDS.MUST_SHARE_CONTAINER, visibleById),
    preferShare: exportRelationshipKeys(project, participant, PREFERENCE_KINDS.PREFER_SHARE_CONTAINER, visibleById, true),
    preferSeparate: exportRelationshipKeys(project, participant, PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS, visibleById, true),
    mustSeparate: exportRelationshipKeys(project, participant, CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER, visibleById),
  }));
  const workbook = createShareEditWorkbook({
    domain: DOMAIN,
    projectTitle: project?.title ?? '',
    language,
    identityType,
    columns: columns(language),
    rows,
    revision: options.revision,
  });
  return appendWorkbookLegend(workbook, 'School Share & Edit legend', SCHOOL_WORKBOOK_LEGEND);
}

export function exportSchoolShareEditWorkbook(project, options = {}) {
  const workbook = createSchoolShareEditWorkbook(project, options);
  XLSX.writeFile(workbook, typeof options === 'string' ? options : (options.filename ?? DEFAULT_FILENAME));
  return workbook;
}

function createReport(rowCount) {
  return {
    counts: { rows: rowCount, matched: 0, created: 0, levelsCreated: 0 },
    additions: 0,
    updates: 0,
    relationships: 0,
    preferences: 0,
    errors: [],
    warnings: [],
  };
}

function roleValue(value) {
  return ROLE_VALUES.get(normalizeVisibleKey(value).normalize('NFC')) ?? null;
}

function rowError(report, row, message) {
  report.errors.push(`Share & Edit row ${row._rowNumber}: ${message}`);
}

function resolveNamedValue(lookup, rawValue) {
  const matches = lookup.get(normalizeVisibleKey(rawValue)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function addParticipantIdentityMetadata(metadata, identityType, key) {
  const participant = { ...(metadata?.participant ?? {}) };
  if (identityType === IDENTITY_TYPES.EMAIL) participant.email = key;
  if (identityType === IDENTITY_TYPES.EXTERNAL_KEY) participant.externalKey = key;
  return { ...(metadata ?? {}), participant };
}

function parseRows(parsed, project) {
  const candidate = structuredClone(project);
  candidate.items ??= [];
  candidate.groups ??= [];
  candidate.containers ??= [];
  candidate.containments ??= [];
  candidate.constraints ??= [];
  candidate.preferences ??= [];
  candidate.fixedAssignments ??= [];
  const report = createReport(parsed.rows.length);
  const originalParticipants = [...buildSchoolParticipantIndex(candidate).students, ...buildSchoolParticipantIndex(candidate).teachers];
  const originalKeys = new Map(originalParticipants.map((participant) => [participant.id, identityValue(participant, parsed.identityType)]));
  const identityIndex = buildIdentityIndex(originalParticipants, parsed.identityType);
  const seenParticipantIds = new Set();
  const seenRowKeys = new Map();
  const rowEntries = [];

  parsed.rows.forEach((row) => {
    const internalId = text(row.internalId);
    const personKey = text(row.personKey);
    const displayName = text(row.displayName);
    const role = roleValue(row.role);
    if (!personKey) rowError(report, row, 'personKey is required.');
    if (personKey && !isValidIdentityValue(personKey, parsed.identityType)) rowError(report, row, `personKey is not a valid ${parsed.identityType} value.`);
    if (!displayName) rowError(report, row, 'displayName is required.');
    if (!role) rowError(report, row, 'role must be Student or Teacher (localized labels are also accepted).');
    const keyMatches = identityIndex.byKey.get(normalizeVisibleKey(personKey)) ?? [];
    const idParticipant = internalId ? identityIndex.byId.get(internalId) : null;
    if (idParticipant && keyMatches.some((entry) => entry.id !== idParticipant.id)) {
      rowError(report, row, 'internalId and personKey identify different participants.');
    }
    const matched = matchParticipant(identityIndex, internalId, personKey);
    if (matched.ambiguous) rowError(report, row, 'personKey matches more than one participant.');
    let participant = matched.participant;
    if (!participant && !matched.ambiguous && personKey && displayName && role) {
      participant = createItem({
        id: createId('item'),
        label: displayName,
        metadata: addParticipantIdentityMetadata({ schoolRole: role }, parsed.identityType, personKey),
      });
      candidate.items.push(participant);
      identityIndex.byId.set(participant.id, participant);
      appendKey(identityIndex.byKey, normalizeVisibleKey(personKey), participant);
      report.counts.created += 1;
      report.additions += 1;
    } else if (participant) {
      report.counts.matched += 1;
      report.updates += 1;
    }
    if (!participant) return;
    if (seenParticipantIds.has(participant.id)) rowError(report, row, 'participant identity is duplicated in the workbook.');
    seenParticipantIds.add(participant.id);
    const normalizedRowKey = normalizeVisibleKey(personKey);
    if (seenRowKeys.has(normalizedRowKey) && seenRowKeys.get(normalizedRowKey) !== participant.id) rowError(report, row, 'personKey is duplicated in the workbook.');
    seenRowKeys.set(normalizedRowKey, participant.id);
    participant.label = displayName;
    participant.metadata = addParticipantIdentityMetadata({ ...(participant.metadata ?? {}), schoolRole: role }, parsed.identityType, personKey);
    rowEntries.push({ row, participant, personKey });
  });

  const levelLookup = uniqueByLabel(candidate.groups);
  const classLookup = uniqueByLabel(candidate.containers);
  rowEntries.forEach(({ row, participant }) => {
    const levelIds = [];
    list(row.levels).forEach((label) => {
      const matches = levelLookup.get(normalizeVisibleKey(label)) ?? [];
      if (matches.length > 1) {
        rowError(report, row, `level "${label}" is ambiguous.`);
        return;
      }
      let level = matches[0];
      if (!level) {
        level = createGroup({ id: createId('group'), label });
        candidate.groups.push(level);
        appendKey(levelLookup, normalizeVisibleKey(label), level);
        report.counts.levelsCreated += 1;
        report.additions += 1;
      }
      levelIds.push(level.id);
    });
    candidate.containments = candidate.containments.filter((entry) => !(entry?.from?.kind === 'group' && entry?.to?.kind === 'item' && entry.to.id === participant.id));
    [...new Set(levelIds)].forEach((levelId) => candidate.containments.push(createContainmentRelation(createEntityRef('group', levelId), createEntityRef('item', participant.id))));

    const fixedName = text(row.fixedClass);
    const fixedClass = fixedName ? resolveNamedValue(classLookup, fixedName) : null;
    if (fixedName && !fixedClass) rowError(report, row, `fixed class "${fixedName}" is unknown or ambiguous.`);
    candidate.fixedAssignments = candidate.fixedAssignments.filter((entry) => entry.itemId !== participant.id);
    if (fixedClass) candidate.fixedAssignments.push({ itemId: participant.id, destinationId: fixedClass.id });

    const forbiddenIds = [];
    list(row.excludedClasses).forEach((name) => {
      const classroom = resolveNamedValue(classLookup, name);
      if (!classroom) rowError(report, row, `excluded class "${name}" is unknown or ambiguous.`);
      else forbiddenIds.push(classroom.id);
    });
    participant.metadata = { ...(participant.metadata ?? {}), forbiddenContainerIds: [...new Set(forbiddenIds)] };
    if (fixedClass && forbiddenIds.includes(fixedClass.id)) rowError(report, row, `fixed class "${fixedName}" cannot also be excluded.`);
  });

  const participantByKey = new Map();
  originalParticipants.forEach((participant) => appendKey(participantByKey, normalizeVisibleKey(originalKeys.get(participant.id)), participant));
  rowEntries.forEach(({ personKey, participant }) => appendKey(participantByKey, normalizeVisibleKey(personKey), participant));
  const includedIds = new Set(rowEntries.map(({ participant }) => participant.id));
  const importedHard = [];
  const importedVotes = [];
  const resolveTarget = (row, value) => {
    const matches = [...new Map((participantByKey.get(normalizeVisibleKey(value)) ?? []).map((entry) => [entry.id, entry])).values()];
    if (matches.length !== 1) {
      rowError(report, row, `relationship target "${value}" is ${matches.length ? 'ambiguous' : 'unknown'}.`);
      return null;
    }
    return matches[0];
  };
  rowEntries.forEach(({ row, participant }) => {
    Object.entries(HARD_KINDS).forEach(([column, kind]) => list(row[column]).forEach((value) => {
      const target = resolveTarget(row, value);
      if (!target) return;
      if (target.id === participant.id) {
        rowError(report, row, `${column} cannot target the same participant.`);
        return;
      }
      importedHard.push({ kind, leftId: participant.id, rightId: target.id });
    }));
    Object.entries(SOFT_KINDS).forEach(([column, kind]) => list(row[column]).forEach((value) => {
      const target = resolveTarget(row, value);
      if (!target) return;
      if (target.id === participant.id) {
        rowError(report, row, `${column} cannot target the same participant.`);
        return;
      }
      importedVotes.push({ kind, fromId: participant.id, toId: target.id, weight: 1 });
    }));
  });

  const retainedHard = candidate.constraints.filter((entry) => !includedIds.has(entry.leftRef?.id) && !includedIds.has(entry.rightRef?.id));
  const hardByKey = new Map();
  [...retainedHard.map((entry) => ({ entry, kind: entry.kind, leftId: entry.leftRef.id, rightId: entry.rightRef.id })), ...importedHard].forEach((value) => {
    const key = unorderedKey(value.kind, value.leftId, value.rightId);
    if (!hardByKey.has(key)) hardByKey.set(key, value.entry ?? createConstraint({ kind: value.kind, leftRef: createEntityRef('item', value.leftId), rightRef: createEntityRef('item', value.rightId) }));
  });
  const hardPairKinds = new Map();
  hardByKey.forEach((entry) => {
    const key = pairKey(entry.leftRef.id, entry.rightRef.id);
    const kinds = hardPairKinds.get(key) ?? new Set();
    kinds.add(entry.kind);
    hardPairKinds.set(key, kinds);
  });
  hardPairKinds.forEach((kinds) => {
    if (kinds.has(CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) && kinds.has(CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER)) report.errors.push('A participant pair cannot be both must-share and must-separate.');
  });
  candidate.constraints = [...hardByKey.values()];
  report.relationships = importedHard.length ? new Set(importedHard.map((entry) => unorderedKey(entry.kind, entry.leftId, entry.rightId))).size : 0;

  const retainedVotes = candidate.preferences.flatMap((preference) => directionalVotes(preference).filter((vote) => !includedIds.has(vote.fromId)).map((vote) => ({ ...vote, kind: preference.kind })));
  const votesByDirection = new Map();
  [...retainedVotes, ...importedVotes].forEach((vote) => {
    const key = `${vote.kind}\u0000${vote.fromId}\u0000${vote.toId}`;
    if (!votesByDirection.has(key)) votesByDirection.set(key, vote);
  });
  const preferencesByPair = new Map();
  votesByDirection.forEach((vote) => {
    const key = unorderedKey(vote.kind, vote.fromId, vote.toId);
    const group = preferencesByPair.get(key) ?? { kind: vote.kind, votes: [] };
    group.votes.push(vote);
    preferencesByPair.set(key, group);
  });
  candidate.preferences = [...preferencesByPair.values()].map(({ kind, votes }) => createPreference({
    kind,
    leftRef: createEntityRef('item', votes[0].fromId),
    rightRef: createEntityRef('item', votes[0].toId),
    weight: votes.reduce((sum, vote) => sum + vote.weight, 0),
    metadata: { directionalVotes: votes.map(({ fromId, toId, weight }) => ({ fromId, toId, weight })) },
  }));
  const softPairKinds = new Map();
  importedVotes.forEach((vote) => {
    const key = `${vote.fromId}\u0000${vote.toId}`;
    const kinds = softPairKinds.get(key) ?? new Set();
    kinds.add(vote.kind);
    softPairKinds.set(key, kinds);
  });
  softPairKinds.forEach((kinds) => {
    if (kinds.has(PREFERENCE_KINDS.PREFER_SHARE_CONTAINER) && kinds.has(PREFERENCE_KINDS.PREFER_SEPARATE_CONTAINERS)) report.errors.push('A directional vote cannot prefer both sharing and separation for the same participant pair.');
  });
  report.preferences = importedVotes.length;
  report.canApply = report.errors.length === 0;
  return { project: candidate, report, canApply: report.canApply, baseSnapshot: JSON.stringify(project) };
}

export function parseSchoolShareEditWorkbook(workbook, project) {
  return parseRows(parseShareEditWorkbook(workbook, DOMAIN, SCHOOL_SHARE_EDIT_COLUMNS), project);
}

export async function previewSchoolShareEditWorkbookFile(file, project) {
  return parseRows(await readShareEditWorkbookFile(file, DOMAIN, SCHOOL_SHARE_EDIT_COLUMNS), project);
}

export function applySchoolShareEditPreview(project, preview) {
  if (!preview?.canApply || !preview.project) throw new Error('Resolve workbook errors before applying Share & Edit changes.');
  if (preview.baseSnapshot !== JSON.stringify(project)) throw new Error('The School project changed after preview. Preview the workbook again.');
  return structuredClone(preview.project);
}
