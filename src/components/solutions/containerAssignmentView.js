function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getEntityLabel(project, kind, id) {
  const nodes = [project.items, project.groups, project.containers, project.positions].flat();
  const node = nodes.find((entry) => entry.kind === kind && entry.id === id);
  return node ? node.label : `${kind}:${id}`;
}

function getMetadataIds(container, key) {
  return Array.isArray(container?.metadata?.[key])
    ? container.metadata[key].filter((value) => typeof value === 'string' && value)
    : [];
}

function getNodeLabelById(project, collectionName, id) {
  const collection = Array.isArray(project?.[collectionName]) ? project[collectionName] : [];
  return collection.find((entry) => entry.id === id)?.label ?? id;
}

function groupAssignmentsByContainer(project, solution) {
  const grouped = new Map(
    project.containers.map((container) => [container.id, {
      container,
      assignments: [],
    }]),
  );

  solution.assignments.forEach((assignment) => {
    const containerId = assignment.containerRef?.id;
    if (!containerId || !grouped.has(containerId)) {
      return;
    }

    grouped.get(containerId).assignments.push(assignment);
  });

  return [...grouped.values()];
}

export function renderContainerAssignmentView(project, solution, index, totalSolutions, options = {}) {
  const grouped = groupAssignmentsByContainer(project, solution);
  const displayProject = options.displayProject ?? project;

  const containerCards = grouped.map(({ container, assignments }) => {
    const itemList = assignments.length === 0
      ? '<li class="muted-text">No assigned items</li>'
      : assignments
        .map((assignment) => `<li>${escapeHtml(assignment.metadata?.itemLabel ?? getEntityLabel(project, assignment.itemRef.kind, assignment.itemRef.id))}</li>`)
        .join('');

    const teacherIds = getMetadataIds(container, 'teacherIds');
    const acceptedLevelIds = getMetadataIds(container, 'acceptedLevelIds');
    const teacherLabels = teacherIds.map((teacherId) => getNodeLabelById(displayProject, 'items', teacherId));
    const acceptedLevelLabels = acceptedLevelIds.map((levelId) => getNodeLabelById(displayProject, 'groups', levelId));

    return `
      <article class="entity-card">
        <div class="entity-card-header">
          <div>
            <p class="entity-kind">Container</p>
            <h3>${escapeHtml(container.label)}</h3>
          </div>
          <span class="panel-count">${assignments.length}</span>
        </div>
        <p class="entity-id">${escapeHtml(container.id)}</p>
        <div class="entity-meta-grid">
          <div class="entity-meta-item"><dt>Capacity</dt><dd>${escapeHtml(container.metadata?.minCapacity ?? 0)} → ${escapeHtml(container.metadata?.maxCapacity ?? '∞')}</dd></div>
          <div class="entity-meta-item"><dt>Accepted levels</dt><dd>${acceptedLevelLabels.length > 0 ? escapeHtml(acceptedLevelLabels.join(', ')) : '<span class="muted-text">All levels</span>'}</dd></div>
          <div class="entity-meta-item"><dt>Teachers</dt><dd>${teacherLabels.length > 0 ? escapeHtml(teacherLabels.join(', ')) : '<span class="muted-text">No linked teacher</span>'}</dd></div>
          <div class="entity-meta-item"><dt>Assigned items</dt><dd><ul class="solution-item-list">${itemList}</ul></dd></div>
        </div>
      </article>
    `;
  }).join('');

  return `
    <section class="top-gap">
      <div class="section-summary-row">
        <span class="section-count-pill">Solution ${index + 1} of ${totalSolutions}</span>
        <span class="muted-text">Assignments grouped by container.</span>
      </div>
      <div class="entity-board top-gap">
        ${containerCards}
      </div>
    </section>
  `;
}
