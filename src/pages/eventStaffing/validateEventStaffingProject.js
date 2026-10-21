import {
  getDayGroupPreferenceMap,
  getDayPreferenceMap,
  getEffectiveAssignmentPreference,
  getPreferenceMap,
  getSlotGroupPreferenceMap,
  getSlotDayKey,
  migrateEventStaffingProject,
  normalizePreferenceState,
  PREFERENCE_STATES,
} from './migration.js';

function isOmittedOptionalNumber(value) {
  return value === undefined || value === null || value === '';
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function maximumSimultaneousCoverage(people, requirements, forcedAssignments, canWorkGroup) {
  const requirementByGroup = new Map(requirements.map((requirement) => [requirement.groupTypeId, requirement]));
  const remainingByGroup = new Map(requirements.map((requirement) => [requirement.groupTypeId, requirement.min]));
  const reservedPeople = new Set();
  let coveredByForcedAssignments = 0;

  forcedAssignments.forEach((assignment) => {
    if (reservedPeople.has(assignment.personId)) return;
    reservedPeople.add(assignment.personId);
    const remaining = remainingByGroup.get(assignment.groupTypeId) ?? 0;
    if (remaining <= 0) return;
    remainingByGroup.set(assignment.groupTypeId, remaining - 1);
    coveredByForcedAssignments += 1;
  });

  const demand = [...remainingByGroup].flatMap(([groupTypeId, count]) => Array.from(
    { length: Math.max(0, count) },
    (_, index) => ({ id: `${groupTypeId}:${index}`, groupTypeId, requirement: requirementByGroup.get(groupTypeId) }),
  ));
  const availablePeople = people.filter((person) => !reservedPeople.has(person.id));
  demand.sort((left, right) => (
    availablePeople.filter((person) => canWorkGroup(person, left.requirement)).length
    - availablePeople.filter((person) => canWorkGroup(person, right.requirement)).length
  ));

  const demandById = new Map(demand.map((entry) => [entry.id, entry]));
  const matchedDemandByPerson = new Map();
  function assign(entry, seenPeople) {
    for (const person of availablePeople) {
      if (seenPeople.has(person.id) || !canWorkGroup(person, entry.requirement)) continue;
      seenPeople.add(person.id);
      const previousDemandId = matchedDemandByPerson.get(person.id);
      if (!previousDemandId || assign(demandById.get(previousDemandId), seenPeople)) {
        matchedDemandByPerson.set(person.id, entry.id);
        return true;
      }
    }
    return false;
  }

  const unmatchedEntries = [];
  let matched = coveredByForcedAssignments;
  demand.forEach((entry) => {
    if (assign(entry, new Set())) matched += 1;
    else unmatchedEntries.push(entry);
  });
  const involvedDemandIds = new Set(unmatchedEntries.map(({ id }) => id));
  const involvedPeople = new Set();
  const queue = [...unmatchedEntries];
  while (queue.length > 0) {
    const entry = queue.shift();
    availablePeople.forEach((person) => {
      if (involvedPeople.has(person.id) || !canWorkGroup(person, entry.requirement)) return;
      involvedPeople.add(person.id);
      const matchedDemandId = matchedDemandByPerson.get(person.id);
      if (matchedDemandId && !involvedDemandIds.has(matchedDemandId)) {
        involvedDemandIds.add(matchedDemandId);
        queue.push(demandById.get(matchedDemandId));
      }
    });
  }
  return {
    matched,
    unmatchedGroupTypeIds: [...new Set([...involvedDemandIds].map((id) => demandById.get(id).groupTypeId))],
  };
}

export function validateEventStaffingProject(domainProject = {}) {
  domainProject = migrateEventStaffingProject(domainProject);
  const errors = [];
  const warnings = [];

  const events = Array.isArray(domainProject.events) ? domainProject.events : [];
  const groupTypes = Array.isArray(domainProject.groupTypes) ? domainProject.groupTypes : [];
  const requirements = Array.isArray(domainProject.requirements) ? domainProject.requirements : [];
  const people = Array.isArray(domainProject.people) ? domainProject.people : [];
  const cooldownRules = Array.isArray(domainProject.cooldownRules) ? domainProject.cooldownRules : [];
  const preferences = Array.isArray(domainProject.preferences) ? domainProject.preferences : [];
  const forcedAssignments = Array.isArray(domainProject.forcedAssignments) ? domainProject.forcedAssignments : [];
  const forbiddenAssignments = Array.isArray(domainProject.forbiddenAssignments) ? domainProject.forbiddenAssignments : [];

  const eventIds = new Set(events.map((event) => event?.id).filter((id) => typeof id === 'string' && id.trim().length > 0));
  const dayKeys = new Set(events.map(getSlotDayKey));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const groupTypeIds = new Set(groupTypes.map((groupType) => groupType?.id).filter((id) => typeof id === 'string' && id.trim().length > 0));
  const personIds = new Set(people.map((person) => person?.id).filter((id) => typeof id === 'string' && id.trim().length > 0));

  if (events.length === 0) {
    errors.push({ level: 'error', code: 'event-staffing-no-events', message: 'Add at least one event before solving the staffing plan.', path: 'events' });
  }

  if (groupTypes.length === 0) {
    errors.push({ level: 'error', code: 'event-staffing-no-group-types', message: 'Add at least one reusable group type before solving the staffing plan.', path: 'groupTypes' });
  }

  if (requirements.length === 0) {
    errors.push({ level: 'error', code: 'event-staffing-no-requirements', message: 'Add at least one event-group staffing requirement before solving.', path: 'requirements' });
  }

  if (people.length === 0) {
    errors.push({ level: 'error', code: 'event-staffing-no-people', message: 'Add at least one person before solving the staffing plan.', path: 'people' });
  }

  const seenEventIds = new Set();
  const seenOrderIndexes = new Set();
  events.forEach((event, index) => {
    if (typeof event?.id !== 'string' || event.id.trim().length === 0) {
      errors.push({ level: 'error', code: 'event-staffing-event-missing-id', message: 'Every event must have an id.', path: `events[${index}]` });
    } else if (seenEventIds.has(event.id)) {
      errors.push({ level: 'error', code: 'event-staffing-duplicate-event-id', message: `Event id "${event.id}" is duplicated.`, path: `events[${index}].id` });
    } else {
      seenEventIds.add(event.id);
    }

    if (typeof event?.dateKey !== 'string' || event.dateKey.trim().length === 0) {
      errors.push({ level: 'error', code: 'event-staffing-slot-missing-date-key', message: 'Every slot must have a date key.', path: `events[${index}].dateKey` });
    }
    if (event?.date && !isIsoDate(event.date)) {
      errors.push({ level: 'error', code: 'event-staffing-invalid-slot-date', message: `Slot "${event.slotLabel || event.id}" must use a YYYY-MM-DD date.`, path: `events[${index}].date` });
    }
    if (typeof event?.slotLabel !== 'string' || event.slotLabel.trim().length === 0) {
      errors.push({ level: 'error', code: 'event-staffing-slot-missing-label', message: 'Every slot must have a label.', path: `events[${index}].slotLabel` });
    }

    if (!Number.isInteger(event?.orderIndex)) {
      errors.push({ level: 'error', code: 'event-staffing-event-missing-order', message: `Event "${event?.label ?? event?.id ?? index + 1}" must define an integer order index.`, path: `events[${index}].orderIndex` });
    } else if (seenOrderIndexes.has(event.orderIndex)) {
      errors.push({ level: 'error', code: 'event-staffing-duplicate-order-index', message: `Multiple events use order index ${event.orderIndex}.`, path: `events[${index}].orderIndex` });
    } else {
      seenOrderIndexes.add(event.orderIndex);
    }
  });

  const seenGroupTypeIds = new Set();
  groupTypes.forEach((groupType, index) => {
    if (typeof groupType?.id !== 'string' || groupType.id.trim().length === 0) {
      errors.push({ level: 'error', code: 'event-staffing-group-type-missing-id', message: 'Every group type must have an id.', path: `groupTypes[${index}]` });
    } else if (seenGroupTypeIds.has(groupType.id)) {
      errors.push({ level: 'error', code: 'event-staffing-duplicate-group-type-id', message: `Group type id "${groupType.id}" is duplicated.`, path: `groupTypes[${index}].id` });
    } else {
      seenGroupTypeIds.add(groupType.id);
    }
  });

  const seenPersonIds = new Set();
  const seenEmails = new Map();
  people.forEach((person, index) => {
    const personName = person?.name ?? person?.id ?? `person ${index + 1}`;

    if (typeof person?.id !== 'string' || person.id.trim().length === 0) {
      errors.push({ level: 'error', code: 'event-staffing-person-missing-id', message: 'Every person must have an id.', path: `people[${index}]` });
    } else if (seenPersonIds.has(person.id)) {
      errors.push({ level: 'error', code: 'event-staffing-duplicate-person-id', message: `Person id "${person.id}" is duplicated.`, path: `people[${index}].id` });
    } else {
      seenPersonIds.add(person.id);
    }

    if (person?.email !== undefined && person.email !== null && typeof person.email !== 'string') {
      errors.push({ level: 'error', code: 'event-staffing-invalid-person-email', message: `Person "${personName}" must use a text email value.`, path: `people[${index}].email` });
    } else if (String(person?.email ?? '').trim()) {
      const normalizedEmail = person.email.trim().toLocaleLowerCase();
      if (seenEmails.has(normalizedEmail)) {
        errors.push({ level: 'error', code: 'event-staffing-duplicate-person-email', message: `Email "${person.email}" is used by more than one person.`, path: `people[${index}].email` });
      } else {
        seenEmails.set(normalizedEmail, person.id);
      }
    }

    if (!isOmittedOptionalNumber(person?.maxAssignments) && (!Number.isInteger(person.maxAssignments) || person.maxAssignments < 0)) {
      errors.push({ level: 'error', code: 'event-staffing-invalid-person-max-assignments', message: `Person "${personName}" must use a non-negative integer maxAssignments value.`, path: `people[${index}].maxAssignments` });
    }

    if (!isOmittedOptionalNumber(person?.targetAssignments) && (!Number.isInteger(person.targetAssignments) || person.targetAssignments < 0)) {
      errors.push({ level: 'error', code: 'event-staffing-invalid-person-target-assignments', message: `Person "${personName}" must use a non-negative integer targetAssignments value.`, path: `people[${index}].targetAssignments` });
    }

    Object.entries(person?.maxAssignmentsPerGroupType ?? {}).forEach(([groupTypeId, limitValue]) => {
      if (!groupTypeIds.has(groupTypeId)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-person-group-max-group-type', message: `Person "${personName}" references unknown per-group max group type "${groupTypeId}".`, path: `people[${index}].maxAssignmentsPerGroupType.${groupTypeId}` });
        return;
      }

      if (!Number.isInteger(limitValue) || limitValue < 0) {
        errors.push({ level: 'error', code: 'event-staffing-invalid-person-group-max', message: `Person "${personName}" must use a non-negative integer maxAssignmentsPerGroupType value for group type "${groupTypeId}".`, path: `people[${index}].maxAssignmentsPerGroupType.${groupTypeId}` });
      }
    });

    Object.entries(person?.targetAssignmentsPerGroupType ?? {}).forEach(([groupTypeId, targetValue]) => {
      if (!groupTypeIds.has(groupTypeId)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-person-group-target-group-type', message: `Person "${personName}" references unknown per-group target group type "${groupTypeId}".`, path: `people[${index}].targetAssignmentsPerGroupType.${groupTypeId}` });
        return;
      }

      if (!Number.isInteger(targetValue) || targetValue < 0) {
        errors.push({ level: 'error', code: 'event-staffing-invalid-person-group-target', message: `Person "${personName}" must use a non-negative integer targetAssignmentsPerGroupType value for group type "${groupTypeId}".`, path: `people[${index}].targetAssignmentsPerGroupType.${groupTypeId}` });
      }
    });

    const allowedGroupTypeIds = Array.isArray(person?.allowedGroupTypeIds) ? person.allowedGroupTypeIds : [];
    const forbiddenGroupTypeIds = Array.isArray(person?.forbiddenGroupTypeIds) ? person.forbiddenGroupTypeIds : [];

    allowedGroupTypeIds.forEach((groupTypeId) => {
      if (!groupTypeIds.has(groupTypeId)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-allowed-group-type', message: `Person "${personName}" references unknown allowed group type "${groupTypeId}".`, path: `people[${index}].allowedGroupTypeIds` });
      }
    });

    forbiddenGroupTypeIds.forEach((groupTypeId) => {
      if (!groupTypeIds.has(groupTypeId)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-forbidden-group-type', message: `Person "${personName}" references unknown forbidden group type "${groupTypeId}".`, path: `people[${index}].forbiddenGroupTypeIds` });
      }
    });

    const overlap = allowedGroupTypeIds.filter((groupTypeId) => forbiddenGroupTypeIds.includes(groupTypeId));
    if (overlap.length > 0) {
      errors.push({ level: 'error', code: 'event-staffing-conflicting-eligibility', message: `Person "${personName}" cannot both allow and forbid the same group type (${overlap.join(', ')}).`, path: `people[${index}]` });
    }
  });

  const seenRequirementKeys = new Set();
  requirements.forEach((requirement, index) => {
    const label = `${requirement?.eventId ?? 'unknown event'} / ${requirement?.groupTypeId ?? 'unknown group type'}`;

    if (!eventIds.has(requirement?.eventId)) {
      errors.push({ level: 'error', code: 'event-staffing-unknown-requirement-event', message: `Requirement ${label} references an unknown event.`, path: `requirements[${index}].eventId` });
    }

    if (!groupTypeIds.has(requirement?.groupTypeId)) {
      errors.push({ level: 'error', code: 'event-staffing-unknown-requirement-group-type', message: `Requirement ${label} references an unknown group type.`, path: `requirements[${index}].groupTypeId` });
    }

    if (!Number.isInteger(requirement?.min) || requirement.min < 0 || !Number.isInteger(requirement?.max) || requirement.max < 0) {
      errors.push({ level: 'error', code: 'event-staffing-invalid-requirement-bounds', message: `Requirement ${label} must use non-negative integer min and max values.`, path: `requirements[${index}]` });
      return;
    }

    if (requirement.min > requirement.max) {
      errors.push({ level: 'error', code: 'event-staffing-requirement-min-exceeds-max', message: `Requirement ${label} has min ${requirement.min} greater than max ${requirement.max}.`, path: `requirements[${index}]` });
    }

    const key = `${requirement?.eventId}::${requirement?.groupTypeId}`;
    if (seenRequirementKeys.has(key)) {
      errors.push({ level: 'error', code: 'event-staffing-duplicate-requirement', message: `Requirement ${label} is duplicated.`, path: `requirements[${index}]` });
    } else {
      seenRequirementKeys.add(key);
    }
  });

  cooldownRules.forEach((rule, index) => {
    if (!Number.isInteger(rule?.blockedNextEventCount) || rule.blockedNextEventCount < 1) {
      errors.push({ level: 'error', code: 'event-staffing-invalid-cooldown-span', message: `Cooldown rule ${index + 1} must use an integer blockedNextEventCount of at least 1.`, path: `cooldownRules[${index}].blockedNextEventCount` });
    }

    ['triggerGroupTypes', 'blockedGroupTypes'].forEach((fieldName) => {
      const value = rule?.[fieldName];
      if (value === 'ANY') {
        return;
      }

      const groupTypeList = Array.isArray(value) ? value : [];
      if (groupTypeList.length === 0) {
        errors.push({ level: 'error', code: 'event-staffing-empty-cooldown-scope', message: `Cooldown rule ${index + 1} must use "ANY" or a non-empty ${fieldName} list.`, path: `cooldownRules[${index}].${fieldName}` });
        return;
      }

      groupTypeList.forEach((groupTypeId) => {
        if (!groupTypeIds.has(groupTypeId)) {
          errors.push({ level: 'error', code: 'event-staffing-unknown-cooldown-group-type', message: `Cooldown rule ${index + 1} references unknown group type "${groupTypeId}".`, path: `cooldownRules[${index}].${fieldName}` });
        }
      });
    });
  });

  const requirementKeys = new Set(requirements.map((requirement) => `${requirement.eventId}::${requirement.groupTypeId}`));
  [...forcedAssignments, ...forbiddenAssignments].forEach((assignment, index) => {
    if (!personIds.has(assignment?.personId)) {
      errors.push({ level: 'error', code: 'event-staffing-unknown-assignment-person', message: `Assignment ${index + 1} references an unknown person.`, path: `assignments[${index}].personId` });
    }

    if (!eventIds.has(assignment?.eventId)) {
      errors.push({ level: 'error', code: 'event-staffing-unknown-assignment-event', message: `Assignment ${index + 1} references an unknown event.`, path: `assignments[${index}].eventId` });
    }

    if (!groupTypeIds.has(assignment?.groupTypeId)) {
      errors.push({ level: 'error', code: 'event-staffing-unknown-assignment-group-type', message: `Assignment ${index + 1} references an unknown group type.`, path: `assignments[${index}].groupTypeId` });
    }
    if (eventIds.has(assignment?.eventId) && groupTypeIds.has(assignment?.groupTypeId)
      && !requirementKeys.has(`${assignment.eventId}::${assignment.groupTypeId}`)) {
      errors.push({ level: 'error', code: 'event-staffing-assignment-without-requirement', message: `Assignment ${index + 1} references a category that is not active in the slot.`, path: `assignments[${index}]` });
    }
  });

  const forcedKeys = new Set(forcedAssignments.map((entry) => `${entry.personId}::${entry.eventId}::${entry.groupTypeId}`));
  forbiddenAssignments.forEach((entry, index) => {
    if (forcedKeys.has(`${entry.personId}::${entry.eventId}::${entry.groupTypeId}`)) {
      errors.push({ level: 'error', code: 'event-staffing-forced-forbidden-conflict', message: 'The same person, slot, and category cannot be both forced and forbidden.', path: `forbiddenAssignments[${index}]`, eventId: entry.eventId, groupTypeId: entry.groupTypeId, personId: entry.personId });
    }
  });
  const forcedPersonSlotKeys = new Set();
  forcedAssignments.forEach((entry, index) => {
    const key = `${entry.personId}::${entry.eventId}`;
    if (forcedPersonSlotKeys.has(key)) errors.push({ level: 'error', code: 'event-staffing-multiple-forced-slot-categories', message: 'A person cannot be forced into more than one category in the same slot.', path: `forcedAssignments[${index}]` });
    forcedPersonSlotKeys.add(key);
  });

  preferences.forEach((preference, index) => {
    if (!personIds.has(preference?.personId)) {
      errors.push({ level: 'error', code: 'event-staffing-unknown-preference-person', message: `Preference row ${index + 1} references an unknown person.`, path: `preferences[${index}].personId` });
      return;
    }

    const eventPreferences = getPreferenceMap(preference);
    if (!eventPreferences || typeof eventPreferences !== 'object') {
      errors.push({ level: 'error', code: 'event-staffing-invalid-preference-map', message: `Preferences for person "${preference.personId}" must use an eventPreferences object.`, path: `preferences[${index}].eventPreferences` });
      return;
    }

    Object.entries(eventPreferences).forEach(([eventId, value]) => {
      if (!eventIds.has(eventId)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-preference-event', message: `Preferences for person "${preference.personId}" reference unknown event "${eventId}".`, path: `preferences[${index}].eventPreferences.${eventId}` });
      }

      const state = normalizePreferenceState(value);
      if (!state) {
        errors.push({ level: 'error', code: 'event-staffing-invalid-preference-value', message: `Preference value for person "${preference.personId}" and slot "${eventId}" is invalid.`, path: `preferences[${index}].slotPreferences.${eventId}` });
      }
    });

    Object.entries(getSlotGroupPreferenceMap(preference)).forEach(([eventId, valuesByGroup]) => {
      if (!eventIds.has(eventId)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-slot-group-preference-slot', message: `Slot/group preferences for person "${preference.personId}" reference unknown slot "${eventId}".`, path: `preferences[${index}].slotGroupPreferences.${eventId}` });
      }
      if (!valuesByGroup || typeof valuesByGroup !== 'object' || Array.isArray(valuesByGroup)) {
        errors.push({ level: 'error', code: 'event-staffing-invalid-slot-group-preference-map', message: `Slot/group preferences for person "${preference.personId}" and slot "${eventId}" must be an object.`, path: `preferences[${index}].slotGroupPreferences.${eventId}` });
        return;
      }
      Object.entries(valuesByGroup).forEach(([groupTypeId, value]) => {
        if (!groupTypeIds.has(groupTypeId)) errors.push({ level: 'error', code: 'event-staffing-unknown-slot-group-preference-group', message: `Slot/group preferences for person "${preference.personId}" reference unknown group "${groupTypeId}".`, path: `preferences[${index}].slotGroupPreferences.${eventId}.${groupTypeId}` });
        if (!normalizePreferenceState(value)) errors.push({ level: 'error', code: 'event-staffing-invalid-slot-group-preference', message: `Slot/group preference for person "${preference.personId}", slot "${eventId}", and group "${groupTypeId}" is invalid.`, path: `preferences[${index}].slotGroupPreferences.${eventId}.${groupTypeId}` });
      });
    });

    Object.entries(getDayPreferenceMap(preference)).forEach(([dayKey, value]) => {
      if (!dayKeys.has(dayKey)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-preference-day', message: `Preferences for person "${preference.personId}" reference unknown day "${dayKey}".`, path: `preferences[${index}].dayPreferences.${dayKey}` });
      }
      if (!normalizePreferenceState(value)) {
        errors.push({ level: 'error', code: 'event-staffing-invalid-day-preference', message: `Day preference for person "${preference.personId}" and day "${dayKey}" is invalid.`, path: `preferences[${index}].dayPreferences.${dayKey}` });
      }
    });

    Object.entries(getDayGroupPreferenceMap(preference)).forEach(([dayKey, valuesByGroup]) => {
      if (!dayKeys.has(dayKey)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-group-preference-day', message: `Group preferences for person "${preference.personId}" reference unknown day "${dayKey}".`, path: `preferences[${index}].dayGroupPreferences.${dayKey}` });
      }
      if (!valuesByGroup || typeof valuesByGroup !== 'object' || Array.isArray(valuesByGroup)) {
        errors.push({ level: 'error', code: 'event-staffing-invalid-day-group-preference-map', message: `Group preferences for person "${preference.personId}" and day "${dayKey}" must be an object.`, path: `preferences[${index}].dayGroupPreferences.${dayKey}` });
        return;
      }
      Object.entries(valuesByGroup).forEach(([groupTypeId, value]) => {
        if (!groupTypeIds.has(groupTypeId)) {
          errors.push({ level: 'error', code: 'event-staffing-unknown-preference-group', message: `Group preferences for person "${preference.personId}" reference unknown group "${groupTypeId}".`, path: `preferences[${index}].dayGroupPreferences.${dayKey}.${groupTypeId}` });
        }
        if (!normalizePreferenceState(value)) {
          errors.push({ level: 'error', code: 'event-staffing-invalid-day-group-preference', message: `Group preference for person "${preference.personId}", day "${dayKey}", and group "${groupTypeId}" is invalid.`, path: `preferences[${index}].dayGroupPreferences.${dayKey}.${groupTypeId}` });
        }
      });
    });

    forcedAssignments.forEach((assignment) => {
      const slot = eventById.get(assignment.eventId);
      if (assignment.personId === preference.personId
        && slot
        && getEffectiveAssignmentPreference(preference, slot, assignment.groupTypeId) === PREFERENCE_STATES.UNAVAILABLE) {
        errors.push({ level: 'error', code: 'event-staffing-forced-unavailable-conflict', message: `Person "${preference.personId}" is both forced and unavailable for ${slot.date || getSlotDayKey(slot)} / ${slot.slotLabel ?? slot.label ?? slot.id}.`, path: `preferences[${index}]`, eventId: slot.id, groupTypeId: assignment.groupTypeId, personId: preference.personId });
      }
    });
  });

  if (!isOmittedOptionalNumber(domainProject?.globalLimits?.maxAssignmentsPerPerson) && (!Number.isInteger(domainProject.globalLimits.maxAssignmentsPerPerson) || domainProject.globalLimits.maxAssignmentsPerPerson < 0)) {
    errors.push({ level: 'error', code: 'event-staffing-invalid-global-max-assignments', message: 'globalLimits.maxAssignmentsPerPerson must be a non-negative integer when provided.', path: 'globalLimits.maxAssignmentsPerPerson' });
  }

  if (!isOmittedOptionalNumber(domainProject?.globalLimits?.maxAssignmentsPerGroupType) && (!Number.isInteger(domainProject.globalLimits.maxAssignmentsPerGroupType) || domainProject.globalLimits.maxAssignmentsPerGroupType < 0)) {
    errors.push({ level: 'error', code: 'event-staffing-invalid-global-group-limit', message: 'globalLimits.maxAssignmentsPerGroupType must be a non-negative integer when provided.', path: 'globalLimits.maxAssignmentsPerGroupType' });
  }

  if (!isOmittedOptionalNumber(domainProject?.globalLimits?.targetAssignmentsPerGroupType) && (!Number.isInteger(domainProject.globalLimits.targetAssignmentsPerGroupType) || domainProject.globalLimits.targetAssignmentsPerGroupType < 0)) {
    errors.push({ level: 'error', code: 'event-staffing-invalid-global-group-target', message: 'globalLimits.targetAssignmentsPerGroupType must be a non-negative integer when provided.', path: 'globalLimits.targetAssignmentsPerGroupType' });
  }

  const preferenceByPersonId = new Map(preferences.map((entry) => [entry.personId, entry]));
  const canWorkGroupForSlot = (person, slot, requirement) => {
    const allowed = Array.isArray(person.allowedGroupTypeIds) ? person.allowedGroupTypeIds : [];
    const forbidden = Array.isArray(person.forbiddenGroupTypeIds) ? person.forbiddenGroupTypeIds : [];
    if (allowed.length > 0 && !allowed.includes(requirement.groupTypeId)) return false;
    if (forbidden.includes(requirement.groupTypeId)) return false;
    if (forbiddenAssignments.some((assignment) => assignment.personId === person.id
      && assignment.eventId === slot.id && assignment.groupTypeId === requirement.groupTypeId)) return false;
    return getEffectiveAssignmentPreference(preferenceByPersonId.get(person.id), slot, requirement.groupTypeId) !== PREFERENCE_STATES.UNAVAILABLE;
  };

  events.forEach((slot) => {
    const slotRequirements = requirements.filter((requirement) => requirement.eventId === slot.id);
    const totalMinimum = slotRequirements.reduce((sum, requirement) => sum + (Number.isInteger(requirement.min) ? requirement.min : 0), 0);
    const canWorkGroup = (person, requirement) => canWorkGroupForSlot(person, slot, requirement);
    const availablePeople = people.filter((person) => slotRequirements.some((requirement) => (
      canWorkGroup(person, requirement)
    ))).length;
    if (totalMinimum > availablePeople) {
      errors.push({ level: 'error', code: 'event-staffing-insufficient-slot-coverage', message: `Slot "${slot.slotLabel}" requires at least ${totalMinimum} people but only ${availablePeople} are available in the roster.`, path: `events.${slot.id}`, eventId: slot.id });
    }
    const insufficientGroupTypeIds = [];
    slotRequirements.forEach((requirement) => {
      const availableForGroup = people.filter((person) => (
        canWorkGroup(person, requirement)
      )).length;
      if (requirement.min > availableForGroup) {
        insufficientGroupTypeIds.push(requirement.groupTypeId);
        errors.push({ level: 'error', code: 'event-staffing-insufficient-group-coverage', message: `Slot "${slot.slotLabel}" requires ${requirement.min} person(s) for group "${requirement.groupTypeId}" but only ${availableForGroup} are available.`, path: `events.${slot.id}`, eventId: slot.id, groupTypeId: requirement.groupTypeId });
      }
    });
    if (totalMinimum <= availablePeople && insufficientGroupTypeIds.length === 0) {
      const simultaneous = maximumSimultaneousCoverage(
        people,
        slotRequirements.filter((requirement) => Number.isInteger(requirement.min) && requirement.min > 0),
        forcedAssignments.filter((assignment) => assignment.eventId === slot.id),
        canWorkGroup,
      );
      if (simultaneous.matched < totalMinimum) {
        errors.push({
          level: 'error',
          code: 'event-staffing-insufficient-simultaneous-coverage',
          message: `Slot "${slot.slotLabel}" requires ${totalMinimum} distinct assignment(s), but eligibility and availability allow at most ${simultaneous.matched} simultaneously.`,
          path: `events.${slot.id}`,
          eventId: slot.id,
          groupTypeIds: simultaneous.unmatchedGroupTypeIds,
        });
      }
    }
    if (totalMinimum === 0) warnings.push({ level: 'warning', code: 'event-staffing-zero-minimum-coverage', message: `Slot "${slot.slotLabel}" has no required minimum coverage.`, path: `events.${slot.id}` });
  });

  const hasAdjacentAnyCooldown = cooldownRules.some((rule) => rule?.triggerGroupTypes === 'ANY'
    && rule?.blockedGroupTypes === 'ANY' && rule?.blockedNextEventCount === 1);
  if (hasAdjacentAnyCooldown) {
    const orderedEvents = [...events].sort((left, right) => left.orderIndex - right.orderIndex);
    for (let index = 0; index < orderedEvents.length - 1; index += 1) {
      const windowEvents = orderedEvents.slice(index, index + 2);
      const syntheticRequirements = windowEvents.flatMap((slot) => requirements
        .filter((requirement) => requirement.eventId === slot.id && Number.isInteger(requirement.min) && requirement.min > 0)
        .map((requirement) => ({
          ...requirement,
          originalGroupTypeId: requirement.groupTypeId,
          groupTypeId: `${slot.id}\u0000${requirement.groupTypeId}`,
        })));
      const syntheticForcedAssignments = forcedAssignments
        .filter((assignment) => windowEvents.some((slot) => slot.id === assignment.eventId))
        .map((assignment) => ({ ...assignment, groupTypeId: `${assignment.eventId}\u0000${assignment.groupTypeId}` }));
      const simultaneous = maximumSimultaneousCoverage(
        people,
        syntheticRequirements,
        syntheticForcedAssignments,
        (person, requirement) => canWorkGroupForSlot(
          person,
          eventById.get(requirement.eventId),
          { ...requirement, groupTypeId: requirement.originalGroupTypeId },
        ),
      );
      const totalMinimum = syntheticRequirements.reduce((sum, requirement) => sum + requirement.min, 0);
      if (simultaneous.matched >= totalMinimum) continue;
      const involvedByEvent = new Map();
      simultaneous.unmatchedGroupTypeIds.forEach((syntheticGroupTypeId) => {
        const separator = syntheticGroupTypeId.indexOf('\u0000');
        const eventId = syntheticGroupTypeId.slice(0, separator);
        const groupTypeId = syntheticGroupTypeId.slice(separator + 1);
        const involved = involvedByEvent.get(eventId) ?? new Set();
        involved.add(groupTypeId);
        involvedByEvent.set(eventId, involved);
      });
      involvedByEvent.forEach((involved, eventId) => {
        const first = windowEvents[0];
        const second = windowEvents[1];
        errors.push({
          level: 'error',
          code: 'event-staffing-insufficient-cooldown-coverage',
          message: `Slots "${first.slotLabel}" and "${second.slotLabel}" require ${totalMinimum} distinct assignment(s), but availability and the consecutive-event cooldown allow at most ${simultaneous.matched}.`,
          path: `events.${eventId}`,
          eventId,
          relatedEventIds: windowEvents.map((slot) => slot.id),
          groupTypeIds: [...involved],
        });
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
