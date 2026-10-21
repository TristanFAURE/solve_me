import {
  getDayGroupPreferenceMap,
  getDayPreferenceMap,
  getEffectiveAssignmentPreferenceWithSource,
  getPreferenceMap,
  getSlotDayKey,
  normalizePreferenceState,
  PREFERENCE_STATES,
} from './migration.js';
import { createEventStaffingDestinationId } from '../../core/transform/eventStaffingProject.js';

export const DEFAULT_REPAIR_ASSIGNMENT_PENALTY = -100_000;
const UNAVAILABILITY_REPAIR_TYPES = new Set([
  'whole-day-unavailability',
  'group-unavailability',
  'slot-unavailability',
  'slot-group-unavailability',
]);

const pairKey = (itemId, destinationId) => `${itemId}\u0000${destinationId}`;
const candidateId = (...parts) => ['repair', ...parts.map((part) => encodeURIComponent(String(part)))].join(':');

function dateEvents(domainProject, dateKey) {
  return (domainProject.events ?? []).filter((event) => getSlotDayKey(event) === dateKey);
}

function destinationsFor(domainProject, events, groupTypeId = null) {
  const eventIds = new Set(events.map((event) => event.id));
  return (domainProject.requirements ?? [])
    .filter((requirement) => eventIds.has(requirement.eventId) && (!groupTypeId || requirement.groupTypeId === groupTypeId))
    .map((requirement) => createEventStaffingDestinationId(requirement.eventId, requirement.groupTypeId));
}

function addForbiddenCandidate(candidates, values) {
  if (values.destinationIds.length === 0) return;
  candidates.push({ ...values, kind: 'forbidden', destinationIds: [...new Set(values.destinationIds)].sort() });
}

export function getAdministratorRepairDates(domainProject) {
  const dates = new Map();
  (domainProject.events ?? []).forEach((event) => {
    const dateKey = getSlotDayKey(event);
    if (!dates.has(dateKey)) dates.set(dateKey, event.date || dateKey);
  });
  return [...dates].map(([dateKey, label]) => ({ dateKey, label }));
}

function repairIssueScope(domainProject, dateKey, validationErrors) {
  const eventById = new Map((domainProject.events ?? []).map((event) => [event.id, event]));
  const destinationIds = new Set();
  let scoped = false;
  (validationErrors ?? []).forEach((issue) => {
    const eventId = issue.eventId ?? (String(issue.path ?? '').startsWith('events.') ? String(issue.path).slice('events.'.length) : null);
    const event = eventById.get(eventId);
    if (!event || getSlotDayKey(event) !== dateKey) return;
    if (issue.code === 'event-staffing-insufficient-group-coverage'
      || issue.code === 'event-staffing-forced-forbidden-conflict'
      || issue.code === 'event-staffing-forced-unavailable-conflict') {
      if (issue.groupTypeId) destinationIds.add(createEventStaffingDestinationId(eventId, issue.groupTypeId));
      scoped = true;
    }
    if (issue.code === 'event-staffing-insufficient-slot-coverage') {
      (domainProject.requirements ?? [])
        .filter((requirement) => requirement.eventId === eventId && requirement.min > 0)
        .forEach((requirement) => destinationIds.add(createEventStaffingDestinationId(eventId, requirement.groupTypeId)));
      scoped = true;
    }
    if (issue.code === 'event-staffing-insufficient-simultaneous-coverage'
      || issue.code === 'event-staffing-insufficient-cooldown-coverage') {
      const groupTypeIds = new Set(issue.groupTypeIds ?? []);
      (domainProject.requirements ?? [])
        .filter((requirement) => requirement.eventId === eventId
          && requirement.min > 0
          && (groupTypeIds.size === 0 || groupTypeIds.has(requirement.groupTypeId)))
        .forEach((requirement) => destinationIds.add(createEventStaffingDestinationId(eventId, requirement.groupTypeId)));
      scoped = true;
    }
  });
  return { scoped, destinationIds };
}

export function buildAdministratorRepairCandidates(domainProject, normalizedProject, dateKey, validationErrors = []) {
  const events = dateEvents(domainProject, dateKey);
  const people = domainProject.people ?? [];
  const groupTypes = domainProject.groupTypes ?? [];
  const groupLabels = new Map(groupTypes.map((group) => [group.id, group.label ?? group.id]));
  const eventLabels = new Map(events.map((event) => [event.id, event.slotLabel ?? event.label ?? event.id]));
  const dateLabel = events[0]?.date || dateKey;
  const dateScopeLabel = `${dateLabel} (${events.map((event) => eventLabels.get(event.id)).join(', ')})`;
  const candidates = [];

  people.forEach((person) => {
    const preference = (domainProject.preferences ?? []).find((entry) => entry.personId === person.id);
    const unavailableBySource = new Map();
    events.forEach((event) => (domainProject.requirements ?? [])
      .filter((requirement) => requirement.eventId === event.id)
      .forEach((requirement) => {
        const effective = getEffectiveAssignmentPreferenceWithSource(preference, event, requirement.groupTypeId);
        if (effective.state !== PREFERENCE_STATES.UNAVAILABLE) return;
        const key = effective.source === 'day' ? 'day'
          : effective.source === 'dayGroup' ? `dayGroup:${requirement.groupTypeId}`
            : effective.source === 'slot' ? `slot:${event.id}`
              : `slotGroup:${event.id}:${requirement.groupTypeId}`;
        const ids = unavailableBySource.get(key) ?? [];
        ids.push(createEventStaffingDestinationId(event.id, requirement.groupTypeId));
        unavailableBySource.set(key, ids);
      }));
    unavailableBySource.forEach((destinationIds, key) => {
      const [source, slotId, groupTypeId] = key.split(':');
      if (source === 'day') addForbiddenCandidate(candidates, { id: candidateId(dateKey, 'day', person.id), type: 'whole-day-unavailability', itemId: person.id, destinationIds, label: `${person.name ?? person.id}: whole-day unavailability on ${dateScopeLabel}` });
      if (source === 'dayGroup') addForbiddenCandidate(candidates, { id: candidateId(dateKey, 'day-group', person.id, slotId), type: 'group-unavailability', itemId: person.id, destinationIds, label: `${person.name ?? person.id}: unavailable for ${groupLabels.get(slotId) ?? slotId} on ${dateScopeLabel}` });
      if (source === 'slot') addForbiddenCandidate(candidates, { id: candidateId(dateKey, 'slot', person.id, slotId), type: 'slot-unavailability', itemId: person.id, destinationIds, label: `${person.name ?? person.id}: slot unavailability at ${eventLabels.get(slotId)} on ${dateLabel}` });
      if (source === 'slotGroup') addForbiddenCandidate(candidates, { id: candidateId(dateKey, 'slot-group', person.id, slotId, groupTypeId), type: 'slot-group-unavailability', itemId: person.id, destinationIds, label: `${person.name ?? person.id}: unavailable for ${groupLabels.get(groupTypeId) ?? groupTypeId} at ${eventLabels.get(slotId)} on ${dateLabel}` });
    });

    const allowed = Array.isArray(person.allowedGroupTypeIds) ? person.allowedGroupTypeIds : [];
    const forbidden = Array.isArray(person.forbiddenGroupTypeIds) ? person.forbiddenGroupTypeIds : [];
    groupTypes.forEach((group) => {
      const restricted = allowed.length > 0 ? !allowed.includes(group.id) : forbidden.includes(group.id);
      if (!restricted) return;
      addForbiddenCandidate(candidates, {
        id: candidateId(dateKey, 'eligibility', person.id, group.id),
        type: 'category-eligibility',
        itemId: person.id,
        destinationIds: destinationsFor(domainProject, events, group.id),
        label: `${person.name ?? person.id}: category eligibility for ${groupLabels.get(group.id) ?? group.id} on ${dateScopeLabel}`,
      });
    });
  });

  const eventIds = new Set(events.map((event) => event.id));
  const explicitKeys = new Set();
  (domainProject.forbiddenAssignments ?? []).forEach((assignment) => {
    if (!eventIds.has(assignment.eventId)) return;
    const id = candidateId(dateKey, 'explicit', assignment.personId, assignment.eventId, assignment.groupTypeId);
    if (explicitKeys.has(id)) return;
    explicitKeys.add(id);
    const person = people.find((entry) => entry.id === assignment.personId);
    addForbiddenCandidate(candidates, {
      id,
      type: 'explicit-forbidden-assignment',
      itemId: assignment.personId,
      destinationIds: [createEventStaffingDestinationId(assignment.eventId, assignment.groupTypeId)],
      label: `${person?.name ?? assignment.personId}: explicit forbidden assignment at ${eventLabels.get(assignment.eventId) ?? assignment.eventId} / ${groupLabels.get(assignment.groupTypeId) ?? assignment.groupTypeId} on ${dateLabel}`,
    });
  });

  const allDestinationIds = destinationsFor(domainProject, domainProject.events ?? []).sort();
  const findBoundIndex = (personId, destinationIds, maxCount, scope, groupTypeId = null) => {
    const expected = [...destinationIds].sort().join('\u0000');
    return (normalizedProject.assignmentCountUpperBounds ?? []).findIndex((bound) => (
      bound.itemId === personId
      && bound.maxCount === maxCount
      && [...bound.destinationIds].sort().join('\u0000') === expected
      && bound.metadata?.eventStaffingScope === scope
      && (groupTypeId === null || bound.metadata?.groupTypeId === groupTypeId)
    ));
  };
  people.forEach((person) => {
    const totalMax = Number.isInteger(person.maxAssignments)
      ? person.maxAssignments
      : domainProject.globalLimits?.maxAssignmentsPerPerson;
    const totalMaxSource = Number.isInteger(person.maxAssignments) ? 'person limit' : 'global limit';
    if (Number.isInteger(totalMax)) {
      const boundIndex = findBoundIndex(person.id, allDestinationIds, totalMax, 'person-total-maximum');
      const selectedDateDestinations = destinationsFor(domainProject, events).sort();
      if (boundIndex >= 0 && selectedDateDestinations.length > 0) candidates.push({
        id: candidateId(dateKey, 'maximum', 'total-workload-maximum', person.id, 'all'),
        type: 'total-workload-maximum', kind: 'maximum', itemId: person.id, boundIndex,
        originalMax: totalMax, destinationIds: selectedDateDestinations,
        allBoundDestinationIds: allDestinationIds,
        label: `${person.name ?? person.id}: maximum total workload (${totalMax}, ${totalMaxSource}) on ${dateScopeLabel}`,
      });
    }
    groupTypes.forEach((group) => {
      const categoryMax = Number.isInteger(person.maxAssignmentsPerGroupType?.[group.id])
        ? person.maxAssignmentsPerGroupType[group.id]
        : domainProject.globalLimits?.maxAssignmentsPerGroupType;
      const categoryMaxSource = Number.isInteger(person.maxAssignmentsPerGroupType?.[group.id]) ? 'person limit' : 'global limit';
      if (!Number.isInteger(categoryMax)) return;
      const allCategoryDestinations = destinationsFor(domainProject, domainProject.events ?? [], group.id).sort();
      const selectedDateDestinations = destinationsFor(domainProject, events, group.id).sort();
      const boundIndex = findBoundIndex(person.id, allCategoryDestinations, categoryMax, 'person-category-maximum', group.id);
      if (boundIndex < 0 || selectedDateDestinations.length === 0) return;
      candidates.push({
        id: candidateId(dateKey, 'maximum', 'category-workload-maximum', person.id, group.id),
        type: 'category-workload-maximum', kind: 'maximum', itemId: person.id, boundIndex,
        originalMax: categoryMax, destinationIds: selectedDateDestinations,
        allBoundDestinationIds: allCategoryDestinations,
        label: `${person.name ?? person.id}: maximum ${groupLabels.get(group.id) ?? group.id} workload (${categoryMax}, ${categoryMaxSource}) on ${dateScopeLabel}`,
      });
    });
  });

  const issueScope = repairIssueScope(domainProject, dateKey, validationErrors);
  const relevantCandidates = issueScope.scoped
    ? candidates.filter((candidate) => candidate.kind === 'forbidden'
      && candidate.destinationIds.some((destinationId) => issueScope.destinationIds.has(destinationId)))
    : candidates;
  return relevantCandidates
    .map((candidate) => ({ ...candidate, dateKey }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getAdministratorOmittableRequirements(domainProject, dateKey, validationErrors = []) {
  const events = dateEvents(domainProject, dateKey);
  const eventIds = new Set(events.map((event) => event.id));
  const eventLabels = new Map(events.map((event) => [event.id, event.slotLabel ?? event.label ?? event.id]));
  const groupLabels = new Map((domainProject.groupTypes ?? []).map((group) => [group.id, group.label ?? group.id]));
  const issueScope = repairIssueScope(domainProject, dateKey, validationErrors);
  return (domainProject.requirements ?? [])
    .filter((requirement) => eventIds.has(requirement.eventId)
      && requirement.min > 0
      && (!issueScope.scoped || issueScope.destinationIds.has(createEventStaffingDestinationId(requirement.eventId, requirement.groupTypeId))))
    .map((requirement) => {
      const destinationId = createEventStaffingDestinationId(requirement.eventId, requirement.groupTypeId);
      return {
        id: destinationId,
        destinationId,
        dateKey,
        eventId: requirement.eventId,
        groupTypeId: requirement.groupTypeId,
        label: `${dateKey} / ${eventLabels.get(requirement.eventId) ?? requirement.eventId} / ${groupLabels.get(requirement.groupTypeId) ?? requirement.groupTypeId}`,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function selectAllRepairCandidates(candidates) {
  return candidates.map((candidate) => candidate.id);
}

export function toggleRepairCandidate(selectedIds, candidateIdValue, selected) {
  const next = new Set(selectedIds ?? []);
  if (selected) next.add(candidateIdValue);
  else next.delete(candidateIdValue);
  return [...next].sort();
}

export function createAdministratorRepairModel(normalizedProject, candidates, selectedIds, penalty = DEFAULT_REPAIR_ASSIGNMENT_PENALTY, omittedDestinationIds = []) {
  if (!Number.isFinite(penalty) || penalty >= 0) throw new Error('Repair assignment penalty must be a finite negative number.');
  const selected = new Set(selectedIds ?? []);
  const omitted = new Set(omittedDestinationIds ?? []);
  const model = structuredClone(normalizedProject);
  const effectiveCandidates = candidates
    .map((candidate) => ({ ...candidate, destinationIds: candidate.destinationIds.filter((id) => !omitted.has(id)) }))
    .filter((candidate) => candidate.destinationIds.length > 0);
  const blockersByPair = new Map();
  effectiveCandidates.filter((candidate) => candidate.kind === 'forbidden').forEach((candidate) => {
    candidate.destinationIds.forEach((destinationId) => {
      const key = pairKey(candidate.itemId, destinationId);
      const blockers = blockersByPair.get(key) ?? [];
      blockers.push(candidate.id);
      blockersByPair.set(key, blockers);
    });
  });
  const openedPairs = new Map();
  blockersByPair.forEach((blockers, key) => {
    if (blockers.every((id) => selected.has(id))) openedPairs.set(key, blockers);
  });
  model.forbiddenAssignments = model.forbiddenAssignments.filter((entry) => !openedPairs.has(pairKey(entry.itemId, entry.destinationId)));

  const selectedCandidates = effectiveCandidates.filter((candidate) => selected.has(candidate.id));
  const selectedMaximumCandidatesByBound = new Map();
  selectedCandidates.filter((candidate) => candidate.kind === 'maximum').forEach((candidate) => {
    const entries = selectedMaximumCandidatesByBound.get(candidate.boundIndex) ?? [];
    entries.push(candidate);
    selectedMaximumCandidatesByBound.set(candidate.boundIndex, entries);
  });
  selectedMaximumCandidatesByBound.forEach((boundCandidates, boundIndex) => {
    const firstCandidate = boundCandidates[0];
    const bound = model.assignmentCountUpperBounds[boundIndex];
    if (!bound || bound.itemId !== firstCandidate.itemId || bound.maxCount !== firstCandidate.originalMax) return;
    const selectedDateIds = new Set(boundCandidates.flatMap((candidate) => candidate.destinationIds));
    const offDateDestinationIds = bound.destinationIds.filter((id) => !selectedDateIds.has(id));
    bound.maxCount += boundCandidates.length;
    if (offDateDestinationIds.length > 0) {
      model.assignmentCountUpperBounds.push({
        itemId: bound.itemId,
        destinationIds: offDateDestinationIds,
        maxCount: firstCandidate.originalMax,
        metadata: {
          eventStaffingScope: 'repair-off-date-guard',
          repairCandidateId: boundCandidates.length === 1 ? firstCandidate.id : undefined,
          repairCandidateIds: boundCandidates.map((candidate) => candidate.id),
        },
      });
    }
    if (boundCandidates.length > 1) {
      boundCandidates.forEach((candidate) => {
        const candidateDestinationIds = new Set(candidate.destinationIds);
        model.assignmentCountUpperBounds.push({
          itemId: bound.itemId,
          destinationIds: bound.destinationIds.filter((id) => !candidateDestinationIds.has(id)),
          maxCount: firstCandidate.originalMax + boundCandidates.length - 1,
          metadata: { eventStaffingScope: 'repair-other-date-guard', repairCandidateId: candidate.id },
        });
      });
    }
  });

  const penaltyPairs = new Map();
  selectedCandidates.filter((candidate) => candidate.kind === 'forbidden').forEach((candidate) => candidate.destinationIds.forEach((destinationId) => {
    penaltyPairs.set(pairKey(candidate.itemId, destinationId), { itemId: candidate.itemId, destinationId });
  }));
  model.softAssignmentScores.push(...[...penaltyPairs.values()].map((entry) => ({ ...entry, score: penalty })));
  model.containers.forEach((container) => {
    if (!omitted.has(container.id)) return;
    container.metadata = { ...container.metadata, minCapacity: 0, maxCapacity: 0, administratorOmitted: true };
  });
  model.fixedAssignments = model.fixedAssignments.filter((assignment) => !omitted.has(assignment.destinationId));
  return model;
}

export function annotateAdministratorRepairResult(result, candidates, selectedIds, dateKeys, omittedRequirements = []) {
  const selected = candidates.filter((candidate) => new Set(selectedIds ?? []).has(candidate.id));
  const selectedMaximumCandidatesByBound = new Map();
  selected.filter((candidate) => candidate.kind === 'maximum').forEach((candidate) => {
    const entries = selectedMaximumCandidatesByBound.get(candidate.boundIndex) ?? [];
    entries.push(candidate);
    selectedMaximumCandidatesByBound.set(candidate.boundIndex, entries);
  });
  const normalizedDateKeys = Array.isArray(dateKeys) ? dateKeys : [dateKeys].filter(Boolean);
  return {
    ...result,
    repairedModel: true,
    repairDateKey: normalizedDateKeys.length === 1 ? normalizedDateKeys[0] : undefined,
    repairDateKeys: normalizedDateKeys,
    administratorOmittedRequirements: omittedRequirements.map((entry) => ({ ...entry })),
    solutions: (result.solutions ?? []).map((solution) => {
      const assignmentKeys = new Set((solution.assignments ?? []).map((assignment) => pairKey(assignment.itemRef?.id, assignment.containerRef?.id ?? assignment.positionRef?.id)));
      const countsByPerson = new Map();
      (solution.assignments ?? []).forEach((assignment) => {
        const ids = countsByPerson.get(assignment.itemRef?.id) ?? [];
        ids.push(assignment.containerRef?.id ?? assignment.positionRef?.id);
        countsByPerson.set(assignment.itemRef?.id, ids);
      });
      const used = selected.filter((candidate) => {
        if (candidate.kind === 'forbidden') return candidate.destinationIds.some((id) => assignmentKeys.has(pairKey(candidate.itemId, id)));
        const assignedIds = countsByPerson.get(candidate.itemId) ?? [];
        const boundCandidates = selectedMaximumCandidatesByBound.get(candidate.boundIndex) ?? [candidate];
        const allBoundDestinations = normalizedDestinationSet(candidate);
        const otherSelectedDestinations = new Set(boundCandidates
          .filter((entry) => entry.id !== candidate.id)
          .flatMap((entry) => entry.destinationIds));
        const totalCount = assignedIds.filter((id) => allBoundDestinations.has(id)).length;
        const countOutsideOtherSelectedDates = assignedIds.filter((id) => (
          allBoundDestinations.has(id) && !otherSelectedDestinations.has(id)
        )).length;
        return totalCount > candidate.originalMax + boundCandidates.length - 1
          || countOutsideOtherSelectedDates > candidate.originalMax;
      }).map(({ id, type, label }) => ({ id, type, label }));
      const unavailableAssignmentsByPair = new Map();
      selected.filter((candidate) => candidate.kind === 'forbidden' && UNAVAILABILITY_REPAIR_TYPES.has(candidate.type))
        .forEach((candidate) => candidate.destinationIds.forEach((destinationId) => {
          const key = pairKey(candidate.itemId, destinationId);
          if (!assignmentKeys.has(key)) return;
          const existing = unavailableAssignmentsByPair.get(key);
          if (existing) existing.labels.push(candidate.label);
          else unavailableAssignmentsByPair.set(key, {
            personId: candidate.itemId,
            destinationId,
            labels: [candidate.label],
          });
        }));
      const administratorUnavailableAssignments = [...unavailableAssignmentsByPair.values()].map((entry) => ({
        personId: entry.personId,
        destinationId: entry.destinationId,
        label: entry.labels.join('; '),
      }));
      return { ...solution, administratorExceptionsUsed: used, administratorUnavailableAssignments };
    }),
  };
}

function normalizedDestinationSet(candidate) {
  return new Set(candidate.allBoundDestinationIds ?? candidate.destinationIds);
}
