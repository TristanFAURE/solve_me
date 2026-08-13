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


function getAssignmentItemDisplay(project, assignment) {
  const itemLabel = assignment.metadata?.itemLabel ?? getEntityLabel(project, assignment.itemRef.kind, assignment.itemRef.id);
  const positionLabel = assignment.metadata?.positionLabel
    ?? (assignment.positionRef ? getEntityLabel(project, assignment.positionRef.kind, assignment.positionRef.id) : '');

  if (!assignment.positionRef?.id || !positionLabel) {
    return escapeHtml(itemLabel);
  }

  return `${escapeHtml(itemLabel)} <span class="muted-text">→ ${escapeHtml(positionLabel)}</span>`;
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
  const containerCards = grouped.map(({ container, assignments }) => {
    const itemList = assignments.length === 0
      ? '<li class="muted-text">No assigned guests</li>'
      : assignments
        .map((assignment) => `<li>${getAssignmentItemDisplay(project, assignment)}</li>`)
        .join('');

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
          <div class="entity-meta-item"><dt>Assigned guests</dt><dd><ul class="solution-item-list">${itemList}</ul></dd></div>
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
