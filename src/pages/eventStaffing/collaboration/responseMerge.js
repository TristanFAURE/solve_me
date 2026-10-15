import { normalizeCollaborationEmail, validateCollaborationResponse } from './responseModel.js';
import { validateCollaborationManifest } from './collaborationManifest.js';

function personName(person) {
  return String(person?.name ?? person?.displayName ?? '').trim();
}

function same(value, other) {
  return JSON.stringify(value ?? {}) === JSON.stringify(other ?? {});
}

function sessionValues(source, dateKeys, groupIds, nested = false) {
  return Object.fromEntries(dateKeys.flatMap((dateKey) => {
    if (!Object.hasOwn(source ?? {}, dateKey)) return [];
    if (!nested) return [[dateKey, structuredClone(source[dateKey])]];
    const groups = Object.fromEntries(Object.entries(source[dateKey] ?? {}).filter(([groupId]) => groupIds.has(groupId)));
    return Object.keys(groups).length ? [[dateKey, groups]] : [];
  }));
}

function replaceSessionValues(existing, incoming, dateKeys) {
  return {
    ...Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => !dateKeys.has(key))),
    ...structuredClone(incoming),
  };
}

function clearsValues(oldDays, nextDays, oldGroups, nextGroups) {
  if (Object.keys(oldDays).some((dateKey) => !Object.hasOwn(nextDays, dateKey))) return true;
  return Object.entries(oldGroups).some(([dateKey, groups]) => Object.keys(groups).some(
    (groupId) => !Object.hasOwn(nextGroups[dateKey] ?? {}, groupId),
  ));
}

function stablePersonId(email, usedIds) {
  const stem = `collab-${email.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` || 'collab-person';
  let id = stem;
  let suffix = 2;
  while (usedIds.has(id)) id = `${stem}-${suffix++}`;
  usedIds.add(id);
  return id;
}

function responseValue(entry) {
  return entry?.response ?? entry?.value ?? entry;
}

export function previewCollaborationResponseMerge(project, manifest, decryptedResponses = []) {
  validateCollaborationManifest(manifest);
  const source = structuredClone(project ?? {});
  source.people = Array.isArray(source.people) ? source.people : [];
  source.preferences = Array.isArray(source.preferences) ? source.preferences : [];
  const report = { new: 0, matched: 0, renamed: 0, changed: 0, cleared: 0, stale: 0, errors: [] };
  const dateKeys = new Set(manifest.dateKeys);
  const groupIds = new Set(manifest.groups.map(({ id }) => id));
  const peopleByEmail = new Map();
  source.people.forEach((person) => {
    const email = normalizeCollaborationEmail(person.email);
    if (!email) return;
    if (peopleByEmail.has(email)) report.errors.push(`Existing people contain duplicate email "${email}".`);
    else peopleByEmail.set(email, person);
  });
  const seen = new Set();
  const usedIds = new Set(source.people.map(({ id }) => id));
  const changes = [];

  decryptedResponses.forEach((entry, index) => {
    if (entry?.error) {
      report.errors.push(`Response ${index + 1}: ${entry.error.message ?? entry.error}`);
      return;
    }
    let response;
    try {
      response = validateCollaborationResponse(responseValue(entry));
    } catch (error) {
      report.errors.push(`Response ${index + 1}: ${error.message}`);
      return;
    }
    if (seen.has(response.email)) {
      report.errors.push(`Duplicate response email "${response.email}".`);
      return;
    }
    seen.add(response.email);
    if (response.sessionId !== manifest.sessionId) {
      report.errors.push(`Response for "${response.email}" belongs to another collaboration session.`);
      return;
    }
    const unknownDates = [...Object.keys(response.dayPreferences), ...Object.keys(response.dayGroupPreferences)]
      .filter((dateKey) => !dateKeys.has(dateKey));
    const unknownGroups = Object.values(response.dayGroupPreferences).flatMap((values) => Object.keys(values))
      .filter((groupId) => !groupIds.has(groupId));
    if (unknownDates.length || unknownGroups.length) {
      report.errors.push(`Response for "${response.email}" references unknown session dates or groups.`);
      return;
    }
    if (response.manifestRevision !== manifest.revision) report.stale += 1;
    const person = peopleByEmail.get(response.email);
    if (person) report.matched += 1;
    else report.new += 1;
    if (person && personName(person) !== response.displayName) report.renamed += 1;
    const preference = person ? source.preferences.find(({ personId }) => personId === person.id) : null;
    const nextDays = sessionValues(response.dayPreferences, manifest.dateKeys, groupIds);
    const nextDayGroups = sessionValues(response.dayGroupPreferences, manifest.dateKeys, groupIds, true);
    const oldDays = sessionValues(preference?.dayPreferences, manifest.dateKeys, groupIds);
    const oldDayGroups = sessionValues(preference?.dayGroupPreferences, manifest.dateKeys, groupIds, true);
    if (!same(oldDays, nextDays) || !same(oldDayGroups, nextDayGroups)) report.changed += 1;
    if (clearsValues(oldDays, nextDays, oldDayGroups, nextDayGroups)) report.cleared += 1;
    changes.push({ response, personId: person?.id ?? stablePersonId(response.email, usedIds), nextDays, nextDayGroups });
  });

  return {
    canApply: report.errors.length === 0 && report.stale === 0,
    report,
    changes,
    manifestRevision: manifest.revision,
    sessionDateKeys: [...manifest.dateKeys],
  };
}

export const previewCollaborationResponses = previewCollaborationResponseMerge;

export function applyCollaborationResponseMerge(project, preview) {
  if (!preview?.canApply) throw new Error('Collaboration response preview contains blocking errors.');
  const candidate = structuredClone(project ?? {});
  candidate.people = Array.isArray(candidate.people) ? candidate.people : [];
  candidate.preferences = Array.isArray(candidate.preferences) ? candidate.preferences : [];
  const sessionDateKeys = new Set(preview.sessionDateKeys ?? []);

  preview.changes.forEach(({ response, personId, nextDays, nextDayGroups }) => {
    let person = candidate.people.find(({ email }) => normalizeCollaborationEmail(email) === response.email);
    if (!person) {
      person = { id: personId, name: response.displayName, firstName: response.firstName, lastName: response.lastName, email: response.email };
      candidate.people.push(person);
    } else {
      Object.assign(person, { name: response.displayName, firstName: response.firstName, lastName: response.lastName, email: response.email });
    }
    let preference = candidate.preferences.find((value) => value.personId === person.id);
    if (!preference) {
      preference = { personId: person.id, slotPreferences: {}, slotGroupPreferences: {}, dayPreferences: {}, dayGroupPreferences: {} };
      candidate.preferences.push(preference);
    }
    preference.dayPreferences = replaceSessionValues(preference.dayPreferences, nextDays, sessionDateKeys);
    preference.dayGroupPreferences = replaceSessionValues(preference.dayGroupPreferences, nextDayGroups, sessionDateKeys);
  });

  Object.keys(project).forEach((key) => delete project[key]);
  Object.assign(project, candidate);
  return project;
}

export const applyCollaborationResponses = applyCollaborationResponseMerge;
