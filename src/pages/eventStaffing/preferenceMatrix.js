import { getPreferenceMap, PREFERENCE_STATES } from './migration.js';
import { escapeHtml } from './utils.js';

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
  entry.slotPreferences = { ...getPreferenceMap(entry), [slotId]: state };
  delete entry.eventPreferences;
}

export function renderPreferenceMatrix(domainProject) {
  const slots = domainProject.events.slice().sort((left, right) => left.orderIndex - right.orderIndex);
  const preferencesByPersonId = new Map(domainProject.preferences.map((entry) => [entry.personId, getPreferenceMap(entry)]));
  if (domainProject.people.length === 0 || slots.length === 0) {
    return '<section class="panel"><h2>Preferences</h2><p class="muted-text">Add people and slots to edit the person-by-slot preference matrix.</p></section>';
  }
  return `
    <section class="panel">
      <h2>Person-by-slot preferences</h2>
      <p class="muted-text">Prefer, neutral, and prefer not affect score. Unavailable is a hard prohibition for every category in the slot.</p>
      <div class="table-wrap event-staffing-scroll-box top-gap">
        <table class="data-table preference-matrix">
          <thead><tr><th>Person</th>${slots.map((slot) => `<th>${escapeHtml(slot.date || 'No date')}<br />${escapeHtml(slot.slotLabel)}</th>`).join('')}</tr></thead>
          <tbody>${domainProject.people.map((person) => `
            <tr><th>${escapeHtml(person.name)}</th>${slots.map((slot) => {
    const current = preferencesByPersonId.get(person.id)?.[slot.id] ?? PREFERENCE_STATES.NEUTRAL;
    return `<td><select data-slot-preference data-person-id="${escapeHtml(person.id)}" data-slot-id="${escapeHtml(slot.id)}" aria-label="${escapeHtml(`${person.name}, ${slot.slotLabel}`)}">${CHOICES.map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('')}</select></td>`;
  }).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`;
}
