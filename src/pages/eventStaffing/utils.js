export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatGroupTypeList(value, groupTypeLabelsById) {
  if (value === 'ANY') {
    return 'Any group type';
  }

  if (!Array.isArray(value) || value.length === 0) {
    return 'None configured';
  }

  return value
    .map((groupTypeId) => groupTypeLabelsById.get(groupTypeId) ?? groupTypeId)
    .join(', ');
}

export function summarizeRequirements(requirements) {
  return requirements.reduce(
    (summary, requirement) => {
      summary.totalMin += requirement.min;
      summary.totalMax += requirement.max;
      return summary;
    },
    { totalMin: 0, totalMax: 0 },
  );
}

export function normalizeForSearch(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function createRequirementsByEventId(domainProject) {
  const requirementsByEventId = new Map();

  domainProject.requirements.forEach((requirement) => {
    const list = requirementsByEventId.get(requirement.eventId) ?? [];
    list.push(requirement);
    requirementsByEventId.set(requirement.eventId, list);
  });

  return requirementsByEventId;
}

export function createGroupTypeLabelsById(domainProject) {
  return new Map(domainProject.groupTypes.map((groupType) => [groupType.id, groupType.label]));
}

export function slugifyLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

export function createEventId(label, date, existingIds) {
  const datePart = String(date ?? '').trim();
  const labelPart = slugifyLabel(label) || 'event';
  const baseId = datePart ? `evt-${datePart}-${labelPart}` : `evt-${labelPart}`;

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

export function normalizeEventOrderIndexes(events) {
  return events
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((event, index) => ({
      ...event,
      orderIndex: index,
    }));
}
