import {
  getDayGroupPreferenceMap,
  getDayPreferenceMap,
  getPreferenceMap,
  getSlotGroupPreferenceMap,
  getSlotDayKey,
  normalizePreferenceState,
  PREFERENCE_STATES,
} from './migration.js';
import { escapeHtml } from './utils.js';
import { renderFieldLabel } from '../../components/common/fieldHelp.js';

const CHOICES = [
  [PREFERENCE_STATES.NEUTRAL, 'Neutral'],
  [PREFERENCE_STATES.PREFER, 'Prefer'],
  [PREFERENCE_STATES.PREFER_NOT, 'Prefer not'],
  [PREFERENCE_STATES.UNAVAILABLE, 'Unavailable'],
];

export function setSlotPreference(domainProject, personId, slotId, state) {
  let entry = domainProject.preferences.find((preference) => preference.personId === personId);
  if (!entry) {
    entry = { personId, slotPreferences: {} };
    domainProject.preferences.push(entry);
  }
  const slotPreferences = { ...getPreferenceMap(entry) };
  if (state === 'inherit') delete slotPreferences[slotId];
  else slotPreferences[slotId] = state;
  entry.slotPreferences = slotPreferences;
  delete entry.eventPreferences;
}

export function setDayAvailability(domainProject, personId, dayKey, state) {
  let entry = domainProject.preferences.find((preference) => preference.personId === personId);
  if (!entry) {
    entry = { personId, slotPreferences: {}, dayPreferences: {} };
    domainProject.preferences.push(entry);
  }
  const dayPreferences = { ...getDayPreferenceMap(entry) };
  const normalized = normalizePreferenceState(state) ?? PREFERENCE_STATES.NEUTRAL;
  if (normalized === PREFERENCE_STATES.NEUTRAL) delete dayPreferences[dayKey];
  else dayPreferences[dayKey] = normalized;
  entry.dayPreferences = dayPreferences;
  entry.slotPreferences = { ...getPreferenceMap(entry) };
  delete entry.eventPreferences;
}

export function setDayGroupPreference(domainProject, personId, dayKey, groupTypeId, state) {
  let entry = domainProject.preferences.find((preference) => preference.personId === personId);
  if (!entry) {
    entry = { personId, slotPreferences: {}, dayPreferences: {}, dayGroupPreferences: {} };
    domainProject.preferences.push(entry);
  }
  const dayGroupPreferences = structuredClone(getDayGroupPreferenceMap(entry));
  const valuesByGroup = { ...(dayGroupPreferences[dayKey] ?? {}) };
  if (state === 'inherit') delete valuesByGroup[groupTypeId];
  else valuesByGroup[groupTypeId] = normalizePreferenceState(state) ?? PREFERENCE_STATES.NEUTRAL;
  if (Object.keys(valuesByGroup).length === 0) delete dayGroupPreferences[dayKey];
  else dayGroupPreferences[dayKey] = valuesByGroup;
  entry.dayGroupPreferences = dayGroupPreferences;
  entry.slotPreferences = { ...getPreferenceMap(entry) };
  delete entry.eventPreferences;
}

export function setSlotGroupPreference(domainProject, personId, slotId, groupTypeId, state) {
  let entry = domainProject.preferences.find((preference) => preference.personId === personId);
  if (!entry) {
    entry = { personId, slotPreferences: {}, slotGroupPreferences: {}, dayPreferences: {}, dayGroupPreferences: {} };
    domainProject.preferences.push(entry);
  }
  const slotGroupPreferences = structuredClone(getSlotGroupPreferenceMap(entry));
  const valuesByGroup = { ...(slotGroupPreferences[slotId] ?? {}) };
  if (state === 'inherit') delete valuesByGroup[groupTypeId];
  else valuesByGroup[groupTypeId] = normalizePreferenceState(state) ?? PREFERENCE_STATES.NEUTRAL;
  if (Object.keys(valuesByGroup).length === 0) delete slotGroupPreferences[slotId];
  else slotGroupPreferences[slotId] = valuesByGroup;
  entry.slotGroupPreferences = slotGroupPreferences;
}

export function movePreferenceMatrixDay(domainProject, currentDayKey, offset) {
  const dayKeys = [...new Set(domainProject.events
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map(getSlotDayKey))];
  if (dayKeys.length === 0) return '';
  const currentIndex = Math.max(0, dayKeys.indexOf(currentDayKey));
  return dayKeys[Math.min(Math.max(currentIndex + offset, 0), dayKeys.length - 1)];
}

export function movePreferenceMatrixPerson(domainProject, currentPersonId, offset) {
  const people = domainProject.people ?? [];
  if (people.length === 0) return '';
  const currentIndex = Math.max(0, people.findIndex((person) => person.id === currentPersonId));
  return people[Math.min(Math.max(currentIndex + offset, 0), people.length - 1)].id;
}

export function renderPreferenceMatrix(domainProject, viewState = {}) {
  const slots = domainProject.events.slice().sort((left, right) => left.orderIndex - right.orderIndex);
  const preferenceEntriesByPersonId = new Map(domainProject.preferences.map((entry) => [entry.personId, entry]));
  if (domainProject.people.length === 0 || slots.length === 0) {
    return '<section class="panel"><h2>Preferences</h2><p class="muted-text">Add people and slots to edit the person-by-slot preference matrix.</p></section>';
  }
  const dateGroups = [];
  const dateGroupsByKey = new Map();
  slots.forEach((slot) => {
    const dayKey = getSlotDayKey(slot);
    if (!dateGroupsByKey.has(dayKey)) {
      const group = { dayKey, label: slot.date || 'No date', slots: [] };
      dateGroupsByKey.set(dayKey, group);
      dateGroups.push(group);
    }
    dateGroupsByKey.get(dayKey).slots.push(slot);
  });
  const selectedPersonId = typeof viewState === 'string' ? viewState : viewState.preferenceMatrixPersonId;
  const person = domainProject.people.find((entry) => entry.id === selectedPersonId) ?? domainProject.people[0];
  const personIndex = domainProject.people.findIndex((entry) => entry.id === person.id);
  const preferenceEntry = preferenceEntriesByPersonId.get(person.id);
  const dayPreferences = getDayPreferenceMap(preferenceEntry);
  const dayGroupPreferences = getDayGroupPreferenceMap(preferenceEntry);
  const slotGroupPreferences = getSlotGroupPreferenceMap(preferenceEntry);
  const activeDayKey = dateGroupsByKey.has(viewState.preferenceMatrixDayKey)
    ? viewState.preferenceMatrixDayKey
    : dateGroups[0].dayKey;
  const activeDateIndex = dateGroups.findIndex((group) => group.dayKey === activeDayKey);
  const activeDate = dateGroups[activeDateIndex];
  const peopleFilter = ['all', ...CHOICES.map(([value]) => value)].includes(viewState.preferenceMatrixPeopleFilter)
    ? viewState.preferenceMatrixPeopleFilter
    : 'all';
  const visiblePeople = domainProject.people.filter((entry) => {
    if (peopleFilter === 'all') return true;
    const state = normalizePreferenceState(getDayPreferenceMap(preferenceEntriesByPersonId.get(entry.id))[activeDayKey]) ?? PREFERENCE_STATES.NEUTRAL;
    return state === peopleFilter;
  });
  const personCalendar = `
    <section class="panel">
      <details class="details-panel availability-calendar-panel" open>
      <summary>Person availability calendar</summary>
      <p class="muted-text">Select one person, then review every date and staffing group. More specific values override broader ones: slot/group, day/group, slot, then whole day. Explicit Neutral masks broader preferences.</p>
      <div class="event-staffing-inline-actions top-gap">
        <button type="button" class="navigation-arrow" data-event-staffing-action="previous-preference-person"${personIndex <= 0 ? ' disabled' : ''} aria-label="Previous availability person"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m12.5 4-6 6 6 6" /></svg></button>
        <label>${renderFieldLabel('Person', 'Select whose availability and preferences are displayed across every date and category.')}<select name="preferenceMatrixPersonId">${domainProject.people.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === person.id ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`).join('')}</select></label>
        <button type="button" class="navigation-arrow" data-event-staffing-action="next-preference-person"${personIndex >= domainProject.people.length - 1 ? ' disabled' : ''} aria-label="Next availability person"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 4 6 6-6 6" /></svg></button>
      </div>
      <div class="table-wrap event-staffing-scroll-box top-gap">
        <table class="data-table preference-matrix">
          <thead><tr><th>Availability</th>${dateGroups.map((group) => `<th>${escapeHtml(group.label)}</th>`).join('')}</tr></thead>
          <tbody>
            <tr><th>Whole day</th>${dateGroups.map((group) => {
    const dayState = dayPreferences[group.dayKey] ?? PREFERENCE_STATES.NEUTRAL;
    return `<td><select data-day-availability data-person-id="${escapeHtml(person.id)}" data-day-key="${escapeHtml(group.dayKey)}" aria-label="${escapeHtml(`${person.name}, ${group.label}, whole day preference`)}">${CHOICES.map(([value, label]) => `<option value="${value}"${dayState === value ? ' selected' : ''}>${value === PREFERENCE_STATES.PREFER ? 'Available / prefer' : label}</option>`).join('')}</select></td>`;
  }).join('')}</tr>
            ${domainProject.groupTypes.map((groupType) => `<tr><th>${escapeHtml(groupType.label)}</th>${dateGroups.map((group) => {
    const hasRequirement = group.slots.some((slot) => domainProject.requirements.some((requirement) => (
      (requirement.slotId ?? requirement.eventId) === slot.id && requirement.groupTypeId === groupType.id
    )));
    if (!hasRequirement) return '<td><span class="muted-text">—</span></td>';
    const current = Object.hasOwn(dayGroupPreferences[group.dayKey] ?? {}, groupType.id)
      ? dayGroupPreferences[group.dayKey][groupType.id]
      : 'inherit';
    const groupChoices = [['inherit', 'Use whole day'], ...CHOICES];
    return `<td><select data-day-group-preference data-person-id="${escapeHtml(person.id)}" data-day-key="${escapeHtml(group.dayKey)}" data-group-type-id="${escapeHtml(groupType.id)}" aria-label="${escapeHtml(`${person.name}, ${group.label}, ${groupType.label}`)}">${groupChoices.map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('')}</select></td>`;
  }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <details class="details-panel top-gap">
        <summary>Slot and group overrides</summary>
        <p class="muted-text">These are the most specific preferences and override every day/group, slot-wide, and day-wide value.</p>
        <div class="table-wrap event-staffing-scroll-box"><table class="data-table"><thead><tr><th>Date</th><th>Slot</th><th>Group</th><th>Preference</th></tr></thead><tbody>
          ${slots.flatMap((slot) => domainProject.requirements.filter((requirement) => (requirement.slotId ?? requirement.eventId) === slot.id).map((requirement) => {
    const group = domainProject.groupTypes.find((entry) => entry.id === requirement.groupTypeId);
    const current = Object.hasOwn(slotGroupPreferences[slot.id] ?? {}, requirement.groupTypeId) ? slotGroupPreferences[slot.id][requirement.groupTypeId] : 'inherit';
    return `<tr><td>${escapeHtml(slot.date || getSlotDayKey(slot))}</td><td>${escapeHtml(slot.slotLabel)}</td><td>${escapeHtml(group?.label ?? requirement.groupTypeId)}</td><td><select data-slot-group-preference data-person-id="${escapeHtml(person.id)}" data-slot-id="${escapeHtml(slot.id)}" data-group-type-id="${escapeHtml(requirement.groupTypeId)}" aria-label="${escapeHtml(`${person.name}, ${slot.slotLabel}, ${group?.label ?? requirement.groupTypeId}`)}"><option value="inherit"${current === 'inherit' ? ' selected' : ''}>Use broader preference</option>${CHOICES.map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('')}</select></td></tr>`;
  })).join('')}
        </tbody></table></div>
      </details>
      </details>
    </section>`;
  const dateCalendar = `
    <section class="panel">
      <details class="details-panel availability-calendar-panel" open>
      <summary>Date availability overview</summary>
      <p class="muted-text">Review or edit every person's group preference for one date. Values inherit from each person's whole-day setting unless overridden.</p>
      <div class="event-staffing-inline-actions">
        <button type="button" class="navigation-arrow" data-event-staffing-action="previous-preference-day"${activeDateIndex <= 0 ? ' disabled' : ''} aria-label="Previous availability date"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m12.5 4-6 6 6 6" /></svg></button>
        <label>${renderFieldLabel('Date', 'Select the date whose category availability is shown for all people.')}<select name="preferenceMatrixDayKey">${dateGroups.map((group) => `<option value="${escapeHtml(group.dayKey)}"${group.dayKey === activeDayKey ? ' selected' : ''}>${escapeHtml(group.label)}</option>`).join('')}</select></label>
        <button type="button" class="navigation-arrow" data-event-staffing-action="next-preference-day"${activeDateIndex >= dateGroups.length - 1 ? ' disabled' : ''} aria-label="Next availability date"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 4 6 6-6 6" /></svg></button>
        <label>${renderFieldLabel('Show people', 'Filter columns by each person’s whole-day availability state on the selected date.')}<select name="preferenceMatrixPeopleFilter"><option value="all"${peopleFilter === 'all' ? ' selected' : ''}>All</option>${CHOICES.map(([value, label]) => `<option value="${value}"${peopleFilter === value ? ' selected' : ''}>${value === PREFERENCE_STATES.PREFER ? 'Available / prefer' : label}</option>`).join('')}</select></label>
      </div>
      <div class="table-wrap event-staffing-scroll-box top-gap">
        <table class="data-table preference-matrix">
          <thead><tr><th>Group</th>${visiblePeople.map((entry) => `<th>${escapeHtml(entry.name)}<br /><small>${escapeHtml(normalizePreferenceState(getDayPreferenceMap(preferenceEntriesByPersonId.get(entry.id))[activeDayKey]) ?? PREFERENCE_STATES.NEUTRAL)}</small></th>`).join('')}</tr></thead>
          <tbody>${domainProject.groupTypes.map((groupType) => `<tr><th>${escapeHtml(groupType.label)}</th>${visiblePeople.map((entry) => {
    const personPreference = preferenceEntriesByPersonId.get(entry.id);
    const hasRequirement = activeDate.slots.some((slot) => domainProject.requirements.some((requirement) => (
      (requirement.slotId ?? requirement.eventId) === slot.id && requirement.groupTypeId === groupType.id
    )));
    if (!hasRequirement) return '<td><span class="muted-text">—</span></td>';
    const valuesByGroup = getDayGroupPreferenceMap(personPreference)[activeDayKey] ?? {};
    const current = Object.hasOwn(valuesByGroup, groupType.id) ? valuesByGroup[groupType.id] : 'inherit';
    const groupChoices = [['inherit', 'Use whole day'], ...CHOICES];
    return `<td><select data-day-group-preference data-person-id="${escapeHtml(entry.id)}" data-day-key="${escapeHtml(activeDayKey)}" data-group-type-id="${escapeHtml(groupType.id)}" aria-label="${escapeHtml(`${entry.name}, ${activeDate.label}, ${groupType.label}`)}">${groupChoices.map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('')}</select></td>`;
  }).join('')}</tr>`).join('') || `<tr><td colspan="${visiblePeople.length + 1}" class="muted-text">No staffing groups are configured.</td></tr>`}</tbody>
        </table>
      </div>
      ${visiblePeople.length === 0 ? '<p class="muted-text">No people match this whole-day filter.</p>' : ''}
      </details>
    </section>`;
  return `${personCalendar}${dateCalendar}`;
}
