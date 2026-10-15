export const EVENT_STAFFING_MODEL_VERSION = 3;

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

export function getSlotDayKey(slot) {
  return String(slot?.dateKey ?? slot?.date ?? '').trim() || `undated:${slot?.id ?? ''}`;
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
    const dayPreferences = Object.fromEntries(Object.entries(entry?.dayPreferences ?? entry?.dayAvailability ?? {}).map(([dayKey, value]) => [
      dayKey,
      normalizePreferenceState(value) ?? value,
    ]));
    const dayGroupPreferences = Object.fromEntries(Object.entries(entry?.dayGroupPreferences ?? {}).map(([dayKey, valuesByGroup]) => [
      dayKey,
      Object.fromEntries(Object.entries(valuesByGroup && typeof valuesByGroup === 'object' ? valuesByGroup : {}).map(([groupTypeId, value]) => [
        groupTypeId,
        normalizePreferenceState(value) ?? value,
      ])),
    ]));
    const slotGroupPreferences = Object.fromEntries(Object.entries(entry?.slotGroupPreferences ?? entry?.eventGroupPreferences ?? {}).map(([slotId, valuesByGroup]) => [
      slotId,
      Object.fromEntries(Object.entries(valuesByGroup && typeof valuesByGroup === 'object' ? valuesByGroup : {}).map(([groupTypeId, value]) => [
        groupTypeId,
        normalizePreferenceState(value) ?? value,
      ])),
    ]));
    const { dayAvailability: _legacyDayAvailability, ...migratedEntry } = entry ?? {};
    return { ...migratedEntry, slotPreferences, slotGroupPreferences, dayPreferences, dayGroupPreferences };
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

export function getDayPreferenceMap(entry) {
  return entry?.dayPreferences ?? entry?.dayAvailability ?? {};
}

export function getDayGroupPreferenceMap(entry) {
  return entry?.dayGroupPreferences ?? {};
}

export function getSlotGroupPreferenceMap(entry) {
  return entry?.slotGroupPreferences ?? entry?.eventGroupPreferences ?? {};
}

export function getEffectiveSlotPreference(entry, slot) {
  const dayState = normalizePreferenceState(getDayPreferenceMap(entry)[getSlotDayKey(slot)]) ?? PREFERENCE_STATES.NEUTRAL;
  if (dayState === PREFERENCE_STATES.UNAVAILABLE) {
    return PREFERENCE_STATES.UNAVAILABLE;
  }
  if (Object.hasOwn(getPreferenceMap(entry), slot?.id)) {
    return normalizePreferenceState(getPreferenceMap(entry)[slot.id]) ?? PREFERENCE_STATES.NEUTRAL;
  }
  return dayState;
}

export function getEffectiveAssignmentPreference(entry, slot, groupTypeId) {
  return getEffectiveAssignmentPreferenceWithSource(entry, slot, groupTypeId).state;
}

export function getEffectiveAssignmentPreferenceWithSource(entry, slot, groupTypeId) {
  const slotGroups = getSlotGroupPreferenceMap(entry)[slot?.id] ?? {};
  if (Object.hasOwn(slotGroups, groupTypeId)) {
    return { state: normalizePreferenceState(slotGroups[groupTypeId]) ?? PREFERENCE_STATES.NEUTRAL, source: 'slotGroup' };
  }
  const valuesByGroup = getDayGroupPreferenceMap(entry)[getSlotDayKey(slot)] ?? {};
  if (Object.hasOwn(valuesByGroup, groupTypeId)) {
    return { state: normalizePreferenceState(valuesByGroup[groupTypeId]) ?? PREFERENCE_STATES.NEUTRAL, source: 'dayGroup' };
  }
  if (Object.hasOwn(getPreferenceMap(entry), slot?.id)) {
    return { state: normalizePreferenceState(getPreferenceMap(entry)[slot.id]) ?? PREFERENCE_STATES.NEUTRAL, source: 'slot' };
  }
  const dayKey = getSlotDayKey(slot);
  if (Object.hasOwn(getDayPreferenceMap(entry), dayKey)) {
    return { state: normalizePreferenceState(getDayPreferenceMap(entry)[dayKey]) ?? PREFERENCE_STATES.NEUTRAL, source: 'day' };
  }
  return { state: PREFERENCE_STATES.NEUTRAL, source: 'neutral' };
}

export function moveSlotDayPreferences(domainProject, slotId, oldDayKey, newDayKey) {
  if (!oldDayKey || !newDayKey || oldDayKey === newDayKey) return;
  const oldDayStillUsed = (domainProject.events ?? []).some((slot) => (
    slot.id !== slotId && getSlotDayKey(slot) === oldDayKey
  ));
  (domainProject.preferences ?? []).forEach((entry) => {
    const dayPreferences = { ...getDayPreferenceMap(entry) };
    const dayGroupPreferences = structuredClone(getDayGroupPreferenceMap(entry));
    if (!oldDayStillUsed && Object.hasOwn(dayPreferences, oldDayKey) && !Object.hasOwn(dayPreferences, newDayKey)) {
      dayPreferences[newDayKey] = dayPreferences[oldDayKey];
    }
    if (!oldDayStillUsed && Object.hasOwn(dayGroupPreferences, oldDayKey) && !Object.hasOwn(dayGroupPreferences, newDayKey)) {
      dayGroupPreferences[newDayKey] = dayGroupPreferences[oldDayKey];
    }
    if (!oldDayStillUsed) {
      delete dayPreferences[oldDayKey];
      delete dayGroupPreferences[oldDayKey];
    }
    entry.dayPreferences = dayPreferences;
    entry.dayGroupPreferences = dayGroupPreferences;
  });
}
