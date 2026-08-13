function isOmittedOptionalNumber(value) {
  return value === undefined || value === null || value === '';
}

export function validateEventStaffingProject(domainProject = {}) {
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
  people.forEach((person, index) => {
    const personName = person?.name ?? person?.id ?? `person ${index + 1}`;

    if (typeof person?.id !== 'string' || person.id.trim().length === 0) {
      errors.push({ level: 'error', code: 'event-staffing-person-missing-id', message: 'Every person must have an id.', path: `people[${index}]` });
    } else if (seenPersonIds.has(person.id)) {
      errors.push({ level: 'error', code: 'event-staffing-duplicate-person-id', message: `Person id "${person.id}" is duplicated.`, path: `people[${index}].id` });
    } else {
      seenPersonIds.add(person.id);
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
  });

  preferences.forEach((preference, index) => {
    if (!personIds.has(preference?.personId)) {
      errors.push({ level: 'error', code: 'event-staffing-unknown-preference-person', message: `Preference row ${index + 1} references an unknown person.`, path: `preferences[${index}].personId` });
      return;
    }

    const eventPreferences = preference?.eventPreferences;
    if (!eventPreferences || typeof eventPreferences !== 'object') {
      errors.push({ level: 'error', code: 'event-staffing-invalid-preference-map', message: `Preferences for person "${preference.personId}" must use an eventPreferences object.`, path: `preferences[${index}].eventPreferences` });
      return;
    }

    Object.entries(eventPreferences).forEach(([eventId, value]) => {
      if (!eventIds.has(eventId)) {
        errors.push({ level: 'error', code: 'event-staffing-unknown-preference-event', message: `Preferences for person "${preference.personId}" reference unknown event "${eventId}".`, path: `preferences[${index}].eventPreferences.${eventId}` });
      }

      if (value !== 'Y' && value !== 'N' && value !== '' && value !== null && value !== undefined) {
        errors.push({ level: 'error', code: 'event-staffing-invalid-preference-value', message: `Preference value for person "${preference.personId}" and event "${eventId}" must be Y, N, or empty.`, path: `preferences[${index}].eventPreferences.${eventId}` });
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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
