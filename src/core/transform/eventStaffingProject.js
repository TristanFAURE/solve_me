import { ASSIGNMENT_MODES } from '../model/assignmentModes.js';
import { createContainer, createItem } from '../model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../model/project.js';
import {
  getEffectiveAssignmentPreference,
  getPreferenceMap,
  migrateEventStaffingProject,
  PREFERENCE_STATES,
} from '../../pages/eventStaffing/migration.js';

const ANY_GROUP_TYPES = 'ANY';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sortEventsByOrder(events) {
  return [...events].sort((left, right) => {
    const leftOrder = Number.isFinite(left?.orderIndex) ? left.orderIndex : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right?.orderIndex) ? right.orderIndex : Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
  });
}

function createDestinationId(eventId, groupTypeId) {
  return `event:${eventId}::group:${groupTypeId}`;
}

function getRuleGroupTypes(groupTypes, availableGroupTypeIds) {
  if (groupTypes === ANY_GROUP_TYPES) {
    return [...availableGroupTypeIds];
  }

  return toArray(groupTypes)
    .map(toNonEmptyString)
    .filter((groupTypeId) => availableGroupTypeIds.includes(groupTypeId));
}

function buildDestinationIdsByEventId(requirements) {
  const map = new Map();

  requirements.forEach((requirement) => {
    const eventDestinationIds = map.get(requirement.eventId) ?? [];
    eventDestinationIds.push(createDestinationId(requirement.eventId, requirement.groupTypeId));
    map.set(requirement.eventId, eventDestinationIds);
  });

  return map;
}

function buildDestinationIdsByEventAndGroupType(requirements) {
  const map = new Map();

  requirements.forEach((requirement) => {
    const eventMap = map.get(requirement.eventId) ?? new Map();
    const destinationIds = eventMap.get(requirement.groupTypeId) ?? [];
    destinationIds.push(createDestinationId(requirement.eventId, requirement.groupTypeId));
    eventMap.set(requirement.groupTypeId, destinationIds);
    map.set(requirement.eventId, eventMap);
  });

  return map;
}

function createCooldownAssignmentExclusions({
  cooldownRules,
  orderedEvents,
  availableGroupTypeIds,
  people,
  destinationIdsByEventAndGroupType,
}) {
  const exclusions = [];

  cooldownRules.forEach((rule) => {
    const blockedNextEventCount = Number.isInteger(rule?.blockedNextEventCount) ? rule.blockedNextEventCount : 0;
    if (blockedNextEventCount < 1) {
      return;
    }

    const triggerGroupTypes = getRuleGroupTypes(rule?.triggerGroupTypes, availableGroupTypeIds);
    const blockedGroupTypes = getRuleGroupTypes(rule?.blockedGroupTypes, availableGroupTypeIds);

    if (!triggerGroupTypes.length || !blockedGroupTypes.length) {
      return;
    }

    orderedEvents.forEach((event, eventIndex) => {
      const blockedEvents = orderedEvents.slice(eventIndex + 1, eventIndex + 1 + blockedNextEventCount);

      triggerGroupTypes.forEach((triggerGroupTypeId) => {
        const triggerDestinationIds = destinationIdsByEventAndGroupType.get(event.id)?.get(triggerGroupTypeId) ?? [];

        triggerDestinationIds.forEach((triggerDestinationId) => {
          blockedEvents.forEach((blockedEvent) => {
            blockedGroupTypes.forEach((blockedGroupTypeId) => {
              const blockedDestinationIds = destinationIdsByEventAndGroupType.get(blockedEvent.id)?.get(blockedGroupTypeId) ?? [];

              blockedDestinationIds.forEach((blockedDestinationId) => {
                people.forEach((person) => {
                  exclusions.push({
                    itemId: person.id,
                    firstDestinationId: triggerDestinationId,
                    secondDestinationId: blockedDestinationId,
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  return exclusions;
}

function createPerEventExclusivityBounds({ people, orderedEvents, destinationIdsByEventId }) {
  const bounds = [];

  people.forEach((person) => {
    orderedEvents.forEach((event) => {
      const destinationIds = destinationIdsByEventId.get(event.id) ?? [];
      if (destinationIds.length < 2) {
        return;
      }

      bounds.push({
        itemId: person.id,
        destinationIds: [...destinationIds],
        maxCount: 1,
        metadata: { eventStaffingScope: 'slot-exclusivity', eventId: event.id },
      });
    });
  });

  return bounds;
}

function createRequirementContainers(requirements, groupTypeLabelById, eventById) {
  return requirements.map((requirement) => {
    const destinationId = createDestinationId(requirement.eventId, requirement.groupTypeId);
    const slot = eventById.get(requirement.eventId);
    const eventLabel = slot?.slotLabel ?? slot?.label ?? requirement.eventId;
    const groupTypeLabel = groupTypeLabelById.get(requirement.groupTypeId) ?? requirement.groupTypeId;

    return createContainer({
      id: destinationId,
      label: `${eventLabel} - ${groupTypeLabel}`,
      minCapacity: requirement.min,
      maxCapacity: requirement.max,
      metadata: {
        domain: 'eventStaffing',
        eventId: requirement.eventId,
        slotId: requirement.eventId,
        dateKey: slot?.dateKey ?? '',
        date: slot?.date ?? '',
        slotLabel: eventLabel,
        groupTypeId: requirement.groupTypeId,
      },
    });
  });
}

function createPeopleItems(people) {
  return people.map((person) => createItem({
    id: person.id,
    label: person.name ?? person.id,
    metadata: {
      domain: 'eventStaffing',
      personId: person.id,
    },
  }));
}

function createEligibilityForbiddenAssignments({ people, groupTypes, requirements }) {
  const groupTypeIds = groupTypes.map((groupType) => groupType.id);
  const forbiddenAssignments = [];

  people.forEach((person) => {
    const allowedGroupTypeIds = toArray(person?.allowedGroupTypeIds).map(toNonEmptyString).filter(Boolean);
    const forbiddenGroupTypeIds = toArray(person?.forbiddenGroupTypeIds).map(toNonEmptyString).filter(Boolean);

    const effectiveForbiddenGroupTypeIds = allowedGroupTypeIds.length > 0
      ? groupTypeIds.filter((groupTypeId) => !allowedGroupTypeIds.includes(groupTypeId))
      : forbiddenGroupTypeIds;

    requirements.forEach((requirement) => {
      if (effectiveForbiddenGroupTypeIds.includes(requirement.groupTypeId)) {
        forbiddenAssignments.push({
          itemId: person.id,
          destinationId: createDestinationId(requirement.eventId, requirement.groupTypeId),
        });
      }
    });
  });

  return forbiddenAssignments;
}

function createForcedAssignments(assignments) {
  return toArray(assignments)
    .filter((assignment) => toNonEmptyString(assignment?.personId) && toNonEmptyString(assignment?.eventId) && toNonEmptyString(assignment?.groupTypeId))
    .map((assignment) => ({
      itemId: assignment.personId,
      destinationId: createDestinationId(assignment.eventId, assignment.groupTypeId),
    }));
}

function createEventPreferenceTerms(preferences, requirements, orderedEvents) {
  const eventIds = new Set(orderedEvents.map((event) => event.id));
  const requirementsByEventId = new Map();
  requirements.forEach((requirement) => {
    const eventRequirements = requirementsByEventId.get(requirement.eventId) ?? [];
    eventRequirements.push(requirement);
    requirementsByEventId.set(requirement.eventId, eventRequirements);
  });
  const scores = [];
  const forbiddenAssignments = [];
  toArray(preferences).forEach((preference) => {
    const personId = toNonEmptyString(preference?.personId);
    const eventPreferences = getPreferenceMap(preference);

    if (!personId || typeof eventPreferences !== 'object' || !eventPreferences) {
      return;
    }

    orderedEvents.forEach((event) => {
      const eventId = event.id;
      (requirementsByEventId.get(eventId) ?? []).forEach((requirement) => {
        const state = getEffectiveAssignmentPreference(preference, event, requirement.groupTypeId);
        if (!eventIds.has(eventId) || !state || state === PREFERENCE_STATES.NEUTRAL) return;
        const assignment = {
          itemId: personId,
          destinationId: createDestinationId(requirement.eventId, requirement.groupTypeId),
        };
        if (state === PREFERENCE_STATES.UNAVAILABLE) forbiddenAssignments.push(assignment);
        else scores.push({ ...assignment, score: state === PREFERENCE_STATES.PREFER ? 1 : -1 });
      });
    });
  });
  return { scores, forbiddenAssignments };
}

function createPersonAssignmentUpperBounds({ people, requirements, globalLimits, availableGroupTypeIds }) {
  const bounds = [];
  const allDestinationIds = requirements.map((requirement) => createDestinationId(requirement.eventId, requirement.groupTypeId));
  const destinationIdsByGroupTypeId = new Map();

  requirements.forEach((requirement) => {
    const destinationIds = destinationIdsByGroupTypeId.get(requirement.groupTypeId) ?? [];
    destinationIds.push(createDestinationId(requirement.eventId, requirement.groupTypeId));
    destinationIdsByGroupTypeId.set(requirement.groupTypeId, destinationIds);
  });

  people.forEach((person) => {
    const maxAssignments = Number.isInteger(person?.maxAssignments)
      ? person.maxAssignments
      : (Number.isInteger(globalLimits?.maxAssignmentsPerPerson) ? globalLimits.maxAssignmentsPerPerson : null);

    if (maxAssignments !== null) {
      bounds.push({
        itemId: person.id,
        destinationIds: [...allDestinationIds],
        maxCount: maxAssignments,
        metadata: { eventStaffingScope: 'person-total-maximum' },
      });
    }

    availableGroupTypeIds.forEach((groupTypeId) => {
      const overrideValue = person?.maxAssignmentsPerGroupType?.[groupTypeId];
      const maxAssignmentsForGroupType = Number.isInteger(overrideValue)
        ? overrideValue
        : (Number.isInteger(globalLimits?.maxAssignmentsPerGroupType) ? globalLimits.maxAssignmentsPerGroupType : null);

      if (maxAssignmentsForGroupType === null) {
        return;
      }

      const destinationIds = destinationIdsByGroupTypeId.get(groupTypeId) ?? [];
      if (!destinationIds.length) {
        return;
      }

      bounds.push({
        itemId: person.id,
        destinationIds: [...destinationIds],
        maxCount: maxAssignmentsForGroupType,
        metadata: { eventStaffingScope: 'person-category-maximum', groupTypeId },
      });
    });
  });

  return bounds;
}

function buildDestinationIdsByGroupTypeId(requirements) {
  const map = new Map();

  requirements.forEach((requirement) => {
    const destinationIds = map.get(requirement.groupTypeId) ?? [];
    destinationIds.push(createDestinationId(requirement.eventId, requirement.groupTypeId));
    map.set(requirement.groupTypeId, destinationIds);
  });

  return map;
}

function createSoftItemCountTargets(people, requirements, availableGroupTypeIds, globalLimits) {
  const allDestinationIds = requirements.map((requirement) => createDestinationId(requirement.eventId, requirement.groupTypeId));
  const destinationIdsByGroupTypeId = buildDestinationIdsByGroupTypeId(requirements);
  const targets = people
    .filter((person) => Number.isInteger(person?.targetAssignments))
    .map((person) => ({
      itemId: person.id,
      destinationIds: [...allDestinationIds],
      targetCount: person.targetAssignments,
    }));

  people.forEach((person) => {
    availableGroupTypeIds.forEach((groupTypeId) => {
      const overrideValue = person?.targetAssignmentsPerGroupType?.[groupTypeId];
      const targetAssignmentsForGroupType = Number.isInteger(overrideValue)
        ? overrideValue
        : (Number.isInteger(globalLimits?.targetAssignmentsPerGroupType) ? globalLimits.targetAssignmentsPerGroupType : null);

      if (targetAssignmentsForGroupType === null) {
        return;
      }

      const destinationIds = destinationIdsByGroupTypeId.get(groupTypeId) ?? [];
      if (!destinationIds.length) {
        return;
      }

      targets.push({
        itemId: person.id,
        destinationIds: [...destinationIds],
        targetCount: targetAssignmentsForGroupType,
      });
    });
  });

  return targets;
}

export function transformEventStaffingProject(domainProject = {}) {
  domainProject = migrateEventStaffingProject(domainProject);
  const events = sortEventsByOrder(toArray(domainProject.events).filter((event) => toNonEmptyString(event?.id)));
  const groupTypes = toArray(domainProject.groupTypes)
    .filter((groupType) => toNonEmptyString(groupType?.id))
    .map((groupType) => ({
      ...groupType,
      id: toNonEmptyString(groupType.id),
    }));
  const people = toArray(domainProject.people)
    .filter((person) => toNonEmptyString(person?.id))
    .map((person) => ({
      ...person,
      id: toNonEmptyString(person.id),
    }));
  const eventIdSet = new Set(events.map((event) => event.id));
  const groupTypeIdSet = new Set(groupTypes.map((groupType) => groupType.id));
  const requirements = toArray(domainProject.requirements)
    .map((requirement) => ({
      ...requirement,
      eventId: toNonEmptyString(requirement?.slotId ?? requirement?.eventId),
      groupTypeId: toNonEmptyString(requirement?.groupTypeId),
    }))
    .filter((requirement) => {
      const hasRefs = requirement.eventId && requirement.groupTypeId;
      return hasRefs
        && eventIdSet.has(requirement.eventId)
        && groupTypeIdSet.has(requirement.groupTypeId)
        && Number.isInteger(requirement?.min)
        && Number.isInteger(requirement?.max);
    });

  const availableGroupTypeIds = groupTypes.map((groupType) => groupType.id);
  const orderedEvents = events;
  const destinationIdsByEventId = buildDestinationIdsByEventId(requirements);
  const destinationIdsByEventAndGroupType = buildDestinationIdsByEventAndGroupType(requirements);
  const groupTypeLabelById = new Map(groupTypes.map((groupType) => [groupType.id, groupType.label ?? groupType.id]));
  const eventById = new Map(orderedEvents.map((event) => [event.id, event]));
  const preferenceTerms = createEventPreferenceTerms(domainProject.preferences, requirements, orderedEvents);

  return createEmptyProject({
    title: domainProject.title ?? 'Event staffing planner',
    description: domainProject.description ?? '',
    viewHint: VIEW_HINTS.GENERIC,
    assignmentMode: ASSIGNMENT_MODES.CONTAINER,
    assignmentMultiplicity: 'multiple',
    items: createPeopleItems(people),
    containers: createRequirementContainers(requirements, groupTypeLabelById, eventById),
    assignmentExclusions: createCooldownAssignmentExclusions({
      cooldownRules: toArray(domainProject.cooldownRules),
      orderedEvents,
      availableGroupTypeIds,
      people,
      destinationIdsByEventAndGroupType,
    }),
    assignmentCountUpperBounds: [
      ...createPerEventExclusivityBounds({ people, orderedEvents, destinationIdsByEventId }),
      ...createPersonAssignmentUpperBounds({
        people,
        requirements,
        globalLimits: domainProject.globalLimits,
        availableGroupTypeIds,
      }),
    ],
    fixedAssignments: createForcedAssignments(domainProject.forcedAssignments),
    forbiddenAssignments: [
      ...createEligibilityForbiddenAssignments({ people, groupTypes, requirements }),
      ...createForcedAssignments(domainProject.forbiddenAssignments),
      ...preferenceTerms.forbiddenAssignments,
    ],
    softAssignmentScores: preferenceTerms.scores,
    softItemCountTargets: createSoftItemCountTargets(
      people,
      requirements,
      availableGroupTypeIds,
      domainProject.globalLimits,
    ),
  });
}

export function createEventStaffingDestinationId(eventId, groupTypeId) {
  return createDestinationId(eventId, groupTypeId);
}
