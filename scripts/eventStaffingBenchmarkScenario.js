const CATEGORY_DEFINITIONS = Object.freeze([
  { id: 'coordinator', label: 'Coordinator', coverage: 1 },
  { id: 'guest-services', label: 'Guest services', coverage: 2 },
  { id: 'logistics', label: 'Logistics', coverage: 1 },
]);

export const EVENT_STAFFING_BENCHMARK_SCENARIOS = Object.freeze([
  Object.freeze({ id: '7-day', dayCount: 7, peopleCount: 10 }),
  Object.freeze({ id: '14-day', dayCount: 14, peopleCount: 16 }),
  Object.freeze({ id: '28-day', dayCount: 28, peopleCount: 24 }),
]);

function formatDate(dayOffset) {
  const date = new Date(Date.UTC(2026, 0, 5 + dayOffset));
  return date.toISOString().slice(0, 10);
}

function getAllowedCategoryIds(personIndex, categories) {
  if (categories.length !== CATEGORY_DEFINITIONS.length) {
    return categories.map((category) => category.id);
  }

  switch (personIndex % 6) {
    case 0: return ['coordinator', 'guest-services', 'logistics'];
    case 1: return ['coordinator', 'guest-services'];
    case 2: return ['coordinator', 'logistics'];
    case 3: return ['guest-services'];
    case 4: return ['guest-services', 'logistics'];
    default: return ['guest-services', 'logistics'];
  }
}

function getPreferenceState(personIndex, slotIndex, seed) {
  const value = (seed + (personIndex + 1) * 17 + (slotIndex + 1) * 31) % 20;
  if (value === 0) return 'unavailable';
  if (value < 7) return 'prefer';
  if (value < 10) return 'preferNot';
  return 'neutral';
}

function createFeasibleRoster(events, people, categories) {
  const assignmentCounts = new Map(people.map((person) => [person.id, 0]));
  const assignedPeopleByEventId = new Map(events.map((event) => [event.id, new Set()]));

  events.forEach((event) => {
    const assignedPeople = assignedPeopleByEventId.get(event.id);
    categories.forEach((category) => {
      const candidates = people
        .filter((person) => person.allowedGroupTypeIds.includes(category.id) && !assignedPeople.has(person.id))
        .sort((left, right) => (
          assignmentCounts.get(left.id) - assignmentCounts.get(right.id)
          || left.id.localeCompare(right.id)
        ));
      if (candidates.length < category.coverage) {
        throw new Error(`Not enough eligible people to cover ${category.label}.`);
      }
      candidates.slice(0, category.coverage).forEach((person) => {
        assignedPeople.add(person.id);
        assignmentCounts.set(person.id, assignmentCounts.get(person.id) + 1);
      });
    });
  });

  if (people.some((person) => assignmentCounts.get(person.id) > person.maxAssignments)) {
    throw new Error('Generated roster exceeds a person assignment limit.');
  }
  return assignedPeopleByEventId;
}

export function createEventStaffingBenchmarkScenario({
  dayCount,
  peopleCount,
  slotsPerDay = 1,
  categoryCount = CATEGORY_DEFINITIONS.length,
  id = `${dayCount}-day`,
  seed = 20260105,
}) {
  if (![dayCount, peopleCount, slotsPerDay, categoryCount].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Benchmark dayCount, peopleCount, slotsPerDay, and categoryCount must be positive integers.');
  }

  const categories = categoryCount === CATEGORY_DEFINITIONS.length
    ? CATEGORY_DEFINITIONS
    : Array.from({ length: categoryCount }, (_, index) => ({
      id: `category-${index + 1}`,
      label: `Category ${index + 1}`,
      coverage: 1,
    }));
  const slotCount = dayCount * slotsPerDay;
  const assignmentsRequired = slotCount * categories.reduce((sum, category) => sum + category.coverage, 0);
  const targetAssignments = Math.round(assignmentsRequired / peopleCount);
  const maxAssignments = Math.ceil(assignmentsRequired / peopleCount) + 2;
  const events = Array.from({ length: slotCount }, (_, index) => {
    const dayIndex = Math.floor(index / slotsPerDay);
    const slotIndex = index % slotsPerDay;
    const date = formatDate(dayIndex);
    const slotLabel = slotsPerDay === 1
      ? (index % 2 === 0 ? 'Morning' : 'Evening')
      : `Slot ${String(slotIndex + 1).padStart(2, '0')}`;
    return {
      id: `slot-${String(index + 1).padStart(4, '0')}`,
      dateKey: date,
      date,
      slotLabel,
      label: `${date} ${slotLabel}`,
      orderIndex: index,
    };
  });
  const people = Array.from({ length: peopleCount }, (_, index) => ({
    id: `person-${String(index + 1).padStart(2, '0')}`,
    name: `Team member ${String(index + 1).padStart(2, '0')}`,
    allowedGroupTypeIds: getAllowedCategoryIds(index, categories),
    maxAssignments,
    targetAssignments,
  }));
  const feasibleRoster = createFeasibleRoster(events, people, categories);

  return {
    modelVersion: 3,
    title: `Deterministic ${id} event roster`,
    description: 'Synthetic benchmark data with no real people or event details.',
    events,
    groupTypes: categories.map(({ id: categoryId, label }) => ({ id: categoryId, label })),
    requirements: events.flatMap((event) => categories.map((category) => ({
      eventId: event.id,
      slotId: event.id,
      groupTypeId: category.id,
      min: category.coverage,
      max: category.coverage,
    }))),
    people,
    globalLimits: {
      maxAssignmentsPerPerson: null,
      maxAssignmentsPerGroupType: null,
      targetAssignmentsPerGroupType: null,
    },
    cooldownRules: [],
    forcedAssignments: [],
    forbiddenAssignments: [],
    preferences: people.map((person, personIndex) => ({
      personId: person.id,
      slotPreferences: Object.fromEntries(events.map((event, slotIndex) => [
        event.id,
        feasibleRoster.get(event.id).has(person.id)
          && getPreferenceState(personIndex, slotIndex, seed) === 'unavailable'
          ? 'neutral'
          : getPreferenceState(personIndex, slotIndex, seed),
      ])),
    })),
  };
}
