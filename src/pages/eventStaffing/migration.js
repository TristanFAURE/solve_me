export const EVENT_STAFFING_MODEL_VERSION = 2;

export const PREFERENCE_STATES = Object.freeze({
  PREFER: 'prefer',
  NEUTRAL: 'neutral',
  PREFER_NOT: 'preferNot',
  UNAVAILABLE: 'unavailable',
});

const LEGACY_PREFERENCE_STATES = Object.freeze({
  P: PREFERENCE_STATES.PREFER,
  X: PREFERENCE_STATES.PREFER,
  Y: PREFERENCE_STATES.PREFER,
  N: PREFERENCE_STATES.PREFER_NOT,
  U: PREFERENCE_STATES.UNAVAILABLE,
  '': PREFERENCE_STATES.NEUTRAL,
});

export function normalizePreferenceState(value) {
  if (value === null || value === undefined) return PREFERENCE_STATES.NEUTRAL;
  const text = String(value).trim();
  if (Object.hasOwn(LEGACY_PREFERENCE_STATES, text.toUpperCase())) {
    return LEGACY_PREFERENCE_STATES[text.toUpperCase()];
  }
  const normalized = text.toLowerCase().replaceAll(/[\s_-]+/g, '');
  if (normalized === 'prefer' || normalized === 'preferred' || normalized === 'yes') return PREFERENCE_STATES.PREFER;
  if (normalized === 'neutral') return PREFERENCE_STATES.NEUTRAL;
  if (normalized === 'prefernot' || normalized === 'notpreferred' || normalized === 'no') return PREFERENCE_STATES.PREFER_NOT;
  if (normalized === 'unavailable') return PREFERENCE_STATES.UNAVAILABLE;
  return null;
}

export function getSlotId(value) {
  return value?.slotId ?? value?.eventId ?? value?.id ?? null;
}

function migrateSlot(event, index) {
  const date = typeof event?.date === 'string' ? event.date.trim() : '';
  return {
    ...event,
    id: event.id,
    dateKey: String(event?.dateKey ?? date ?? '').trim() || `undated:${event.id}`,
    date,
    slotLabel: String(event?.slotLabel ?? event?.label ?? event?.id ?? '').trim(),
    label: String(event?.label ?? event?.slotLabel ?? event?.id ?? '').trim(),
    orderIndex: Number.isInteger(event?.orderIndex) ? event.orderIndex : index,
  };
}

function migrateReference(entry) {
  const slotId = getSlotId(entry);
  return slotId ? { ...entry, eventId: slotId, slotId } : { ...entry };
}

export function migrateEventStaffingProject(project = {}) {
  const source = project && typeof project === 'object' ? project : {};
  const events = (Array.isArray(source.events) ? source.events : Array.isArray(source.slots) ? source.slots : [])
    .map(migrateSlot);
  const preferences = (Array.isArray(source.preferences) ? source.preferences : []).map((entry) => {
    const values = entry?.slotPreferences ?? entry?.eventPreferences ?? {};
    const slotPreferences = {};
    Object.entries(values && typeof values === 'object' ? values : {}).forEach(([slotId, value]) => {
      const state = normalizePreferenceState(value);
      slotPreferences[slotId] = state ?? value;
    });
    return { ...entry, slotPreferences };
  });

  return {
    ...source,
    modelVersion: EVENT_STAFFING_MODEL_VERSION,
    events,
    groupTypes: Array.isArray(source.groupTypes) ? source.groupTypes.map((value) => ({ ...value })) : [],
    requirements: (Array.isArray(source.requirements) ? source.requirements : []).map(migrateReference),
    people: (Array.isArray(source.people) ? source.people : []).map((person) => ({ ...person })),
    cooldownRules: (Array.isArray(source.cooldownRules) ? source.cooldownRules : []).map((rule) => ({ ...rule })),
    forcedAssignments: (Array.isArray(source.forcedAssignments) ? source.forcedAssignments : []).map(migrateReference),
    forbiddenAssignments: (Array.isArray(source.forbiddenAssignments) ? source.forbiddenAssignments : []).map(migrateReference),
    preferences,
    globalLimits: { ...(source.globalLimits ?? {}) },
  };
}

export function getPreferenceMap(entry) {
  return entry?.slotPreferences ?? entry?.eventPreferences ?? {};
}
