export const COLLABORATION_ROOT = '.event-staffing-collab';
export const COLLABORATION_MANIFEST_VERSION = 1;
export const COLLABORATION_MANIFEST_FILE = 'manifest.enc.json';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function slugifyCollaborationTitle(value) {
  return text(value).toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
}

export function collaborationDateKeys(project) {
  return [...new Set((project?.events ?? []).map((event) => text(event?.dateKey ?? event?.date)).filter(Boolean))];
}

export function collaborationGroups(project) {
  return (project?.groupTypes ?? []).map((group) => ({
    id: text(group?.id),
    label: text(group?.label ?? group?.name ?? group?.id),
  }));
}

export function collaborationConfiguration(project) {
  return {
    modelVersion: project?.modelVersion,
    title: text(project?.title),
    description: text(project?.description),
    events: structuredClone(Array.isArray(project?.events) ? project.events : []),
    groupTypes: structuredClone(Array.isArray(project?.groupTypes) ? project.groupTypes : []),
    requirements: structuredClone(Array.isArray(project?.requirements) ? project.requirements : []),
    people: structuredClone(Array.isArray(project?.people) ? project.people : []),
    cooldownRules: structuredClone(Array.isArray(project?.cooldownRules) ? project.cooldownRules : []),
    globalLimits: structuredClone(project?.globalLimits && typeof project.globalLimits === 'object' ? project.globalLimits : {}),
    forcedAssignments: structuredClone(Array.isArray(project?.forcedAssignments) ? project.forcedAssignments : []),
    forbiddenAssignments: structuredClone(Array.isArray(project?.forbiddenAssignments) ? project.forbiddenAssignments : []),
  };
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function restorePeople(currentPeople, configuredPeople) {
  if (!Array.isArray(configuredPeople)) return { people: currentPeople, personIdMap: new Map() };
  const matchedCurrentIds = new Set();
  const personIdMap = new Map();
  const people = configuredPeople.map((configuredPerson) => {
    const email = normalizeEmail(configuredPerson?.email);
    const currentPerson = currentPeople.find((person) => (
      !matchedCurrentIds.has(person.id)
      && (person.id === configuredPerson.id || (email && normalizeEmail(person.email) === email))
    ));
    if (currentPerson) {
      matchedCurrentIds.add(currentPerson.id);
      if (currentPerson.id !== configuredPerson.id) personIdMap.set(currentPerson.id, configuredPerson.id);
    }
    return structuredClone(configuredPerson);
  });
  currentPeople.forEach((person) => {
    if (!matchedCurrentIds.has(person.id)) people.push(structuredClone(person));
  });
  return { people, personIdMap };
}

export function applyCollaborationConfiguration(project, manifest) {
  validateCollaborationManifest(manifest);
  if (!manifest.configuration) return project;
  const configuration = structuredClone(manifest.configuration);
  const slotIds = new Set(configuration.events.map((event) => event.id));
  const dayKeys = new Set(configuration.events.map((event) => String(event.dateKey ?? event.date ?? '').trim()).filter(Boolean));
  const groupIds = new Set(configuration.groupTypes.map((group) => group.id));
  const currentPeople = Array.isArray(project?.people) ? project.people : [];
  const { people, personIdMap } = restorePeople(currentPeople, configuration.people);
  const preferences = (project?.preferences ?? []).map((preference) => ({
    ...preference,
    personId: personIdMap.get(preference.personId) ?? preference.personId,
    slotPreferences: Object.fromEntries(Object.entries(preference.slotPreferences ?? preference.eventPreferences ?? {}).filter(([slotId]) => slotIds.has(slotId))),
    slotGroupPreferences: Object.fromEntries(Object.entries(preference.slotGroupPreferences ?? {}).filter(([slotId]) => slotIds.has(slotId)).map(([slotId, values]) => [slotId, Object.fromEntries(Object.entries(values ?? {}).filter(([groupId]) => groupIds.has(groupId)))])),
    dayPreferences: Object.fromEntries(Object.entries(preference.dayPreferences ?? {}).filter(([dayKey]) => dayKeys.has(dayKey))),
    dayGroupPreferences: Object.fromEntries(Object.entries(preference.dayGroupPreferences ?? {}).filter(([dayKey]) => dayKeys.has(dayKey)).map(([dayKey, values]) => [dayKey, Object.fromEntries(Object.entries(values ?? {}).filter(([groupId]) => groupIds.has(groupId)))])),
  }));
  Object.assign(project, configuration, {
    people,
    preferences,
    forcedAssignments: structuredClone(Array.isArray(configuration.forcedAssignments) ? configuration.forcedAssignments : []),
    forbiddenAssignments: structuredClone(Array.isArray(configuration.forbiddenAssignments) ? configuration.forbiddenAssignments : []),
  });
  return project;
}

export function createCollaborationManifest(project, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const random = text(options.random ?? globalThis.crypto?.randomUUID?.().replaceAll('-', ''));
  const folderRandom = random.replace(/[^a-zA-Z0-9]/g, '');
  if (!folderRandom) throw new Error('A cryptographically random session value is required.');
  const title = text(options.title ?? project?.title) || 'Event staffing';
  const slug = slugifyCollaborationTitle(options.slug ?? title);
  const sessionId = text(options.sessionId ?? random);
  const folder = `${slug}--${folderRandom.slice(0, 16)}`;
  return {
    version: COLLABORATION_MANIFEST_VERSION,
    sessionId,
    folder,
    slug,
    title,
    status: 'open',
    revision: 1,
    dateKeys: collaborationDateKeys(project),
    groups: collaborationGroups(project),
    configuration: collaborationConfiguration(project),
    createdAt: now,
    updatedAt: now,
  };
}

export function validateCollaborationManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid collaboration manifest.');
  if (value.version !== COLLABORATION_MANIFEST_VERSION) throw new Error('Unsupported collaboration manifest version.');
  if (!text(value.sessionId) || !text(value.folder) || !text(value.slug) || !text(value.title)) throw new Error('Collaboration manifest identity is incomplete.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*--[a-zA-Z0-9]+$/.test(value.folder) || !value.folder.startsWith(`${value.slug}--`)) {
    throw new Error('Collaboration session folder is invalid.');
  }
  if (!Number.isInteger(value.revision) || value.revision < 1) throw new Error('Collaboration manifest revision is invalid.');
  if (!['open', 'closed'].includes(value.status)) throw new Error('Collaboration manifest status is invalid.');
  if (!Array.isArray(value.dateKeys) || value.dateKeys.some((key) => !text(key))) throw new Error('Collaboration manifest dates are invalid.');
  if (new Set(value.dateKeys).size !== value.dateKeys.length) throw new Error('Collaboration manifest dates must be unique.');
  if (!Array.isArray(value.groups) || value.groups.some((group) => !text(group?.id) || !text(group?.label))) throw new Error('Collaboration manifest groups are invalid.');
  if (new Set(value.groups.map(({ id }) => id)).size !== value.groups.length) throw new Error('Collaboration manifest groups must be unique.');
  if (value.configuration !== undefined) {
    const configuration = value.configuration;
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)
      || !Array.isArray(configuration.events) || !Array.isArray(configuration.groupTypes)
      || !Array.isArray(configuration.requirements) || !Array.isArray(configuration.cooldownRules)
      || (configuration.people !== undefined && !Array.isArray(configuration.people))
      || (configuration.forcedAssignments !== undefined && !Array.isArray(configuration.forcedAssignments))
      || (configuration.forbiddenAssignments !== undefined && !Array.isArray(configuration.forbiddenAssignments))
      || !configuration.globalLimits || typeof configuration.globalLimits !== 'object' || Array.isArray(configuration.globalLimits)) {
      throw new Error('Collaboration manifest configuration is invalid.');
    }
  }
  return value;
}

export function reviseCollaborationManifest(manifest, changes = {}, now = new Date().toISOString()) {
  validateCollaborationManifest(manifest);
  const next = {
    ...structuredClone(manifest),
    ...structuredClone(changes),
    version: COLLABORATION_MANIFEST_VERSION,
    sessionId: manifest.sessionId,
    folder: manifest.folder,
    slug: manifest.slug,
    createdAt: manifest.createdAt,
    revision: manifest.revision + 1,
    updatedAt: now,
  };
  return validateCollaborationManifest(next);
}

export function closeCollaborationManifest(manifest, now) {
  return reviseCollaborationManifest(manifest, { status: 'closed' }, now);
}

export function reopenCollaborationManifest(manifest, now) {
  return reviseCollaborationManifest(manifest, { status: 'open' }, now);
}

export function collaborationManifestPath(folder) {
  return `${COLLABORATION_ROOT}/${folder}/${COLLABORATION_MANIFEST_FILE}`;
}

export function manifestPickerData(manifest) {
  validateCollaborationManifest(manifest);
  return {
    sessionId: manifest.sessionId,
    folder: manifest.folder,
    slug: manifest.slug,
    title: manifest.title,
    status: manifest.status,
    revision: manifest.revision,
    dateKeys: [...manifest.dateKeys],
    updatedAt: manifest.updatedAt,
  };
}
