import * as XLSX from 'xlsx';
import { createId } from '../../core/model/ids.js';
import { createItem } from '../../core/model/nodes.js';
import { createConstraint } from '../../core/model/constraints.js';
import { createPreference } from '../../core/model/preferences.js';
import { createEntityRef } from '../../core/model/relations.js';
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
  SHARED_LANGUAGE,
  splitRelationshipList,
} from '../../workbooks/shareEdit.js';
import { appendWorkbookLegend, WEDDING_WORKBOOK_LEGEND } from '../../workbooks/legend.js';

const DOMAIN = 'wedding';
const WORKBOOK_SOURCE = 'wedding-share-edit';
const DEFAULT_FILENAME = 'wedding-share-edit.xlsx';
export const WEDDING_SHARE_EDIT_COLUMNS = Object.freeze([
  'internalId',
  'guestKey',
  'displayName',
  'mustSameTable',
  'preferSameTable',
  'preferDifferentTable',
  'mustDifferentTable',
]);
const HARD_KINDS = Object.freeze({
  mustSameTable: 'mustShareContainer',
  mustDifferentTable: 'mustNotShareContainer',
});
const SOFT_KINDS = Object.freeze({
  preferSameTable: 'preferShareContainer',
  preferDifferentTable: 'preferSeparateContainers',
});

function columns(language) {
  const t = SHARED_LANGUAGE[language] ?? SHARED_LANGUAGE.en;
  return [
    { canonical: 'internalId', label: 'Internal ID', width: 20, hidden: true },
    { canonical: 'guestKey', label: t.guestKey, width: 30 },
    { canonical: 'displayName', label: t.displayName, width: 28 },
    { canonical: 'mustSameTable', label: t.mustSameTable, width: 38 },
    { canonical: 'preferSameTable', label: t.preferSameTable, width: 38 },
    { canonical: 'preferDifferentTable', label: t.preferDifferentTable, width: 38 },
    { canonical: 'mustDifferentTable', label: t.mustDifferentTable, width: 38 },
  ];
}

function unorderedKey(kind, leftId, rightId) {
  return `${kind}\u0000${[leftId, rightId].sort().join('\u0000')}`;
}

function pairKey(leftId, rightId) {
  return [leftId, rightId].sort().join('\u0000');
}

function itemRelation(entry) {
  return entry?.leftRef?.kind === 'item' && entry?.rightRef?.kind === 'item';
}

function isWorkbookEntry(entry) {
  return entry?.metadata?.source === WORKBOOK_SOURCE;
}

function declarationsForConstraint(entry) {
  if (Array.isArray(entry?.metadata?.workbookDeclarations)) return entry.metadata.workbookDeclarations;
  if (!isWorkbookEntry(entry) || !itemRelation(entry)) return [];
  return [{ sourceId: entry.leftRef.id, targetId: entry.rightRef.id }];
}

function votesForPreference(entry) {
  if (Array.isArray(entry?.metadata?.directionalVotes)) return entry.metadata.directionalVotes.map((vote) => ({
    fromId: String(vote?.fromId ?? vote?.sourceId ?? '').trim(),
    toId: String(vote?.toId ?? vote?.targetId ?? '').trim(),
    weight: Number.isFinite(Number(vote?.weight)) && Number(vote.weight) > 0 ? Number(vote.weight) : 1,
  })).filter((vote) => vote.fromId && vote.toId);
  if (!isWorkbookEntry(entry) || !itemRelation(entry)) return [];
  return [{ fromId: entry.leftRef.id, toId: entry.rightRef.id, weight: Number(entry.weight) || 1 }];
}

function relationLists(project) {
  const hard = new Map();
  const soft = new Map();
  const add = (map, sourceId, column, targetId) => {
    const values = map.get(sourceId) ?? { mustSameTable: [], preferSameTable: [], preferDifferentTable: [], mustDifferentTable: [] };
    values[column].push(targetId);
    map.set(sourceId, values);
  };
  for (const entry of project.constraints ?? []) {
    if (!itemRelation(entry)) continue;
    const column = entry.kind === HARD_KINDS.mustSameTable ? 'mustSameTable' : entry.kind === HARD_KINDS.mustDifferentTable ? 'mustDifferentTable' : null;
    if (!column) continue;
    add(hard, entry.leftRef.id, column, entry.rightRef.id);
    add(hard, entry.rightRef.id, column, entry.leftRef.id);
  }
  for (const entry of project.preferences ?? []) {
    if (!itemRelation(entry)) continue;
    const column = entry.kind === SOFT_KINDS.preferSameTable ? 'preferSameTable' : entry.kind === SOFT_KINDS.preferDifferentTable ? 'preferDifferentTable' : null;
    if (!column) continue;
    const votes = votesForPreference(entry);
    if (votes.length) {
      votes.forEach((vote) => add(soft, vote.fromId, column, vote.toId));
    } else {
      add(soft, entry.leftRef.id, column, entry.rightRef.id);
    }
  }
  return { hard, soft };
}

function exportRows(project, identityType, visibleById) {
  const guests = project.items ?? [];
  const { hard, soft } = relationLists(project);
  return guests.map((guest) => {
    const hardValues = hard.get(guest.id) ?? {};
    const softValues = soft.get(guest.id) ?? {};
    const list = (values) => (values ?? []).map((id) => visibleById.get(id)).filter(Boolean).join('; ');
    return {
      internalId: guest.id,
      guestKey: visibleById.get(guest.id),
      displayName: guest.label,
      mustSameTable: list(hardValues.mustSameTable),
      preferSameTable: list(softValues.preferSameTable),
      preferDifferentTable: list(softValues.preferDifferentTable),
      mustDifferentTable: list(hardValues.mustDifferentTable),
    };
  });
}

export function createWeddingShareEditWorkbook(project, options = {}) {
  const language = options.language === 'fr' ? 'fr' : 'en';
  const identityType = options.identityType ?? IDENTITY_TYPES.FULL_NAME;
  const visibleById = buildExportIdentityKeys(project?.items ?? [], identityType, 'Wedding guest');
  const workbook = createShareEditWorkbook({
    domain: DOMAIN,
    projectTitle: project?.title ?? '',
    language,
    identityType,
    columns: columns(language),
    rows: exportRows(project ?? {}, identityType, visibleById),
    revision: options.revision,
  });
  return appendWorkbookLegend(workbook, 'Wedding Share & Edit legend', WEDDING_WORKBOOK_LEGEND);
}

export function exportWeddingShareEditWorkbook(project, options = {}) {
  const workbook = createWeddingShareEditWorkbook(project, options);
  XLSX.writeFile(workbook, typeof options === 'string' ? options : (options.filename ?? DEFAULT_FILENAME));
  return workbook;
}

function addIssue(report, row, message) {
  report.errors.push(row ? `Row ${row}: ${message}` : message);
}

function updateParticipant(guest, row, identityType) {
  const displayName = String(row.displayName ?? '').trim();
  const key = String(row.guestKey ?? '').trim();
  let changed = false;
  if (displayName && displayName !== guest.label) {
    guest.label = displayName;
    changed = true;
  }
  if (identityType !== IDENTITY_TYPES.FULL_NAME) {
    const field = identityType === IDENTITY_TYPES.EMAIL ? 'email' : 'externalKey';
    const current = participantMetadata(guest)[field];
    if (key !== current) {
      guest.metadata = { ...guest.metadata, participant: { ...guest.metadata?.participant, [field]: key } };
      changed = true;
    }
  }
  return changed;
}

function newParticipant(row, identityType) {
  const key = String(row.guestKey ?? '').trim();
  const label = String(row.displayName ?? '').trim() || key;
  const metadata = {};
  if (identityType === IDENTITY_TYPES.EMAIL) metadata.participant = { email: key };
  if (identityType === IDENTITY_TYPES.EXTERNAL_KEY) metadata.participant = { externalKey: key };
  return createItem({ id: createId('item'), label, metadata });
}

function prepareParticipants(parsed, project, report) {
  const guests = structuredClone(project.items ?? []);
  const originalIndex = buildIdentityIndex(guests, parsed.identityType);
  const seenIds = new Set();
  const seenKeys = new Set();
  const prepared = [];

  for (const row of parsed.rows) {
    const id = String(row.internalId ?? '').trim();
    const key = String(row.guestKey ?? '').trim();
    const displayName = String(row.displayName ?? '').trim();
    const normalizedKey = normalizeVisibleKey(key);
    if (!key) addIssue(report, row._rowNumber, 'Guest key is required.');
    if (key && !isValidIdentityValue(key, parsed.identityType)) addIssue(report, row._rowNumber, `Guest key is not a valid ${parsed.identityType} value.`);
    if (!displayName) addIssue(report, row._rowNumber, 'Display name is required.');
    if (id && seenIds.has(id)) addIssue(report, row._rowNumber, `Duplicate internal ID "${id}".`);
    if (normalizedKey && seenKeys.has(normalizedKey)) addIssue(report, row._rowNumber, `Duplicate guest key "${key}".`);
    if (id) seenIds.add(id);
    if (normalizedKey) seenKeys.add(normalizedKey);

    const idParticipant = id ? originalIndex.byId.get(id) : null;
    const keyMatches = originalIndex.byKey.get(normalizedKey) ?? [];
    if (idParticipant && keyMatches.some((entry) => entry.id !== idParticipant.id)) addIssue(report, row._rowNumber, 'Internal ID and guest key identify different guests.');
    const match = matchParticipant(originalIndex, id, key);
    if (match.ambiguous) {
      addIssue(report, row._rowNumber, `Guest key "${key}" is ambiguous.`);
      continue;
    }
    const guest = match.participant ?? (key && displayName ? newParticipant(row, parsed.identityType) : null);
    if (!guest) continue;
    if (!match.participant) {
      guests.push(guest);
      report.created += 1;
    } else {
      report.matched += 1;
      if (updateParticipant(guest, row, parsed.identityType)) report.updated += 1;
    }
    prepared.push({ row, guest });
  }

  const finalIndex = buildIdentityIndex(guests, parsed.identityType);
  for (const [key, matches] of finalIndex.byKey) {
    if (key && matches.length > 1 && seenKeys.has(key)) addIssue(report, null, `Guest key "${identityValue(matches[0], parsed.identityType)}" matches multiple guests.`);
  }
  prepared.forEach(({ row, guest }) => {
    const key = normalizeVisibleKey(row.guestKey);
    if (!key) return;
    const matches = finalIndex.byKey.get(key) ?? [];
    if (matches.some((entry) => entry.id !== guest.id)) addIssue(report, row._rowNumber, `Guest key "${row.guestKey}" matches multiple guests.`);
    if (!matches.some((entry) => entry.id === guest.id)) matches.push(guest);
    finalIndex.byKey.set(key, matches);
  });
  return { guests, prepared, finalIndex };
}

function collectDeclarations(prepared, index, report) {
  const hard = [];
  const soft = [];
  const oppositeByPair = new Map();
  const softByDirection = new Map();
  for (const { row, guest } of prepared) {
    for (const [column, kind] of Object.entries({ ...HARD_KINDS, ...SOFT_KINDS })) {
      for (const targetKey of splitRelationshipList(row[column])) {
        const targetMatch = matchParticipant(index, '', targetKey);
        if (targetMatch.ambiguous) {
          addIssue(report, row._rowNumber, `Relationship target "${targetKey}" is ambiguous.`);
          continue;
        }
        if (!targetMatch.participant) {
          addIssue(report, row._rowNumber, `Relationship target "${targetKey}" was not found.`);
          continue;
        }
        if (targetMatch.participant.id === guest.id) {
          addIssue(report, row._rowNumber, 'Self-relations are not allowed.');
          continue;
        }
        const declaration = { kind, sourceId: guest.id, targetId: targetMatch.participant.id };
        if (Object.hasOwn(HARD_KINDS, column)) {
          const pair = pairKey(declaration.sourceId, declaration.targetId);
          const previous = oppositeByPair.get(pair);
          if (previous && previous !== kind) addIssue(report, row._rowNumber, 'The same guests cannot be both required together and required apart.');
          oppositeByPair.set(pair, kind);
          hard.push(declaration);
        } else {
          const direction = `${declaration.sourceId}\u0000${declaration.targetId}`;
          const previous = softByDirection.get(direction);
          if (previous && previous !== kind) addIssue(report, row._rowNumber, 'The same directional vote cannot prefer both the same table and different tables.');
          softByDirection.set(direction, kind);
          soft.push(declaration);
        }
      }
    }
  }
  return { hard, soft };
}

function rebuildConstraints(project, sourceIds, declarations, report) {
  const preservedByKey = new Map();
  const workbookDeclarations = [];
  for (const entry of project.constraints ?? []) {
    if (!isWorkbookEntry(entry)) {
      const key = itemRelation(entry) ? unorderedKey(entry.kind, entry.leftRef.id, entry.rightRef.id) : `other\u0000${preservedByKey.size}`;
      if (!preservedByKey.has(key)) preservedByKey.set(key, entry);
      continue;
    }
    declarationsForConstraint(entry).forEach((declaration) => {
      if (!sourceIds.has(declaration.sourceId)) workbookDeclarations.push({ kind: entry.kind, ...declaration });
    });
  }
  workbookDeclarations.push(...declarations);
  const grouped = new Map();
  workbookDeclarations.forEach((declaration) => {
    const key = unorderedKey(declaration.kind, declaration.sourceId, declaration.targetId);
    const group = grouped.get(key) ?? { kind: declaration.kind, declarations: [] };
    if (!group.declarations.some((value) => value.sourceId === declaration.sourceId && value.targetId === declaration.targetId)) group.declarations.push({ sourceId: declaration.sourceId, targetId: declaration.targetId });
    grouped.set(key, group);
  });
  const preserved = [...preservedByKey.values()];
  const previousKeys = new Set((project.constraints ?? []).filter(isWorkbookEntry).map((entry) => unorderedKey(entry.kind, entry.leftRef.id, entry.rightRef.id)));
  const preservedKeys = new Set(preserved.filter(itemRelation).map((entry) => unorderedKey(entry.kind, entry.leftRef.id, entry.rightRef.id)));
  const generated = [...grouped.entries()].filter(([key]) => !preservedKeys.has(key)).map(([, { kind, declarations: values }]) => {
    const [leftId, rightId] = [values[0].sourceId, values[0].targetId].sort();
    return createConstraint({ kind, leftRef: createEntityRef('item', leftId), rightRef: createEntityRef('item', rightId), metadata: { source: WORKBOOK_SOURCE, workbookDeclarations: values } });
  });
  const nextKeys = new Set(generated.map((entry) => unorderedKey(entry.kind, entry.leftRef.id, entry.rightRef.id)));
  report.relationshipsCreated = [...nextKeys].filter((key) => !previousKeys.has(key)).length;
  report.relationshipsRemoved = [...previousKeys].filter((key) => !nextKeys.has(key)).length;
  return [...preserved, ...generated];
}

function rebuildPreferences(project, sourceIds, declarations, report) {
  const preserved = [];
  const votes = [];
  for (const entry of project.preferences ?? []) {
    if (!isWorkbookEntry(entry)) {
      preserved.push(entry);
      continue;
    }
    votesForPreference(entry).forEach((vote) => {
      if (!sourceIds.has(vote.fromId)) votes.push({ kind: entry.kind, sourceId: vote.fromId, targetId: vote.toId, weight: vote.weight });
    });
  }
  votes.push(...declarations);
  const preservedDirections = new Set();
  preserved.filter(itemRelation).forEach((entry) => {
    const directional = votesForPreference(entry);
    const values = directional.length ? directional : [{ fromId: entry.leftRef.id, toId: entry.rightRef.id }];
    values.forEach((vote) => preservedDirections.add(`${entry.kind}\u0000${vote.fromId}\u0000${vote.toId}`));
  });
  const grouped = new Map();
  votes.forEach((vote) => {
    if (preservedDirections.has(`${vote.kind}\u0000${vote.sourceId}\u0000${vote.targetId}`)) return;
    const key = unorderedKey(vote.kind, vote.sourceId, vote.targetId);
    const group = grouped.get(key) ?? { kind: vote.kind, votes: [] };
    if (!group.votes.some((value) => value.fromId === vote.sourceId && value.toId === vote.targetId)) group.votes.push({ fromId: vote.sourceId, toId: vote.targetId, weight: Number(vote.weight) || 1 });
    grouped.set(key, group);
  });
  const previous = new Map((project.preferences ?? []).filter(isWorkbookEntry).map((entry) => [unorderedKey(entry.kind, entry.leftRef.id, entry.rightRef.id), entry.weight]));
  const generated = [...grouped.values()].map(({ kind, votes: directionalVotes }) => {
    const [leftId, rightId] = [directionalVotes[0].fromId, directionalVotes[0].toId].sort();
    return createPreference({ kind, leftRef: createEntityRef('item', leftId), rightRef: createEntityRef('item', rightId), weight: directionalVotes.reduce((sum, vote) => sum + vote.weight, 0), metadata: { source: WORKBOOK_SOURCE, directionalVotes } });
  });
  const next = new Map(generated.map((entry) => [unorderedKey(entry.kind, entry.leftRef.id, entry.rightRef.id), entry.weight]));
  report.preferencesChanged = [...new Set([...previous.keys(), ...next.keys()])].filter((key) => previous.get(key) !== next.get(key)).length;
  return [...preserved, ...generated];
}

function buildPreview(parsed, project) {
  const report = { matched: 0, created: 0, updated: 0, relationshipsCreated: 0, relationshipsRemoved: 0, preferencesChanged: 0, errors: [], warnings: [], canApply: false };
  const candidate = structuredClone(project);
  const { guests, prepared, finalIndex } = prepareParticipants(parsed, candidate, report);
  candidate.items = guests;
  const declarations = collectDeclarations(prepared, finalIndex, report);
  const sourceIds = new Set(prepared.map(({ guest }) => guest.id));
  candidate.constraints = rebuildConstraints(candidate, sourceIds, declarations.hard, report);
  const hardKindsByPair = new Map();
  candidate.constraints.filter(itemRelation).forEach((entry) => {
    const key = pairKey(entry.leftRef.id, entry.rightRef.id);
    const kinds = hardKindsByPair.get(key) ?? new Set();
    kinds.add(entry.kind);
    hardKindsByPair.set(key, kinds);
  });
  if ([...hardKindsByPair.values()].some((kinds) => kinds.has(HARD_KINDS.mustSameTable) && kinds.has(HARD_KINDS.mustDifferentTable))) {
    report.errors.push('A guest pair cannot be both required at the same table and required at different tables.');
  }
  candidate.preferences = rebuildPreferences(candidate, sourceIds, declarations.soft, report);
  report.canApply = report.errors.length === 0;
  return { ...parsed, canApply: report.canApply, report, project: candidate, baseProjectId: project?.projectId, baseSnapshot: JSON.stringify(project) };
}

export function parseWeddingShareEditWorkbook(workbook, project) {
  return buildPreview(parseShareEditWorkbook(workbook, DOMAIN, WEDDING_SHARE_EDIT_COLUMNS), project);
}

export async function previewWeddingShareEditWorkbookFile(file, project) {
  return buildPreview(await readShareEditWorkbookFile(file, DOMAIN, WEDDING_SHARE_EDIT_COLUMNS), project);
}

export function applyWeddingShareEditPreview(project, preview) {
  if (!preview?.canApply || !preview?.project) throw new Error('The Wedding Share & Edit preview cannot be applied.');
  if (project && preview.baseProjectId !== undefined && preview.baseProjectId !== project.projectId) throw new Error('The Wedding Share & Edit preview belongs to another project.');
  if (preview.baseSnapshot !== JSON.stringify(project)) throw new Error('The Wedding project changed after preview. Preview the workbook again.');
  return structuredClone(preview.project);
}
