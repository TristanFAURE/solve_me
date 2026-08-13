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

function getContainerCapacityDisplay(container) {
  const minCapacity = container.minCapacity ?? container.metadata?.minCapacity ?? 0;
  const maxCapacity = container.maxCapacity ?? container.metadata?.maxCapacity ?? '∞';
  return `${escapeHtml(minCapacity)} → ${escapeHtml(maxCapacity)}`;
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

function buildViewConfig(options = {}) {
  const labels = {
    containerKind: options.containerKindLabel ?? 'Container',
    assignmentCount: options.assignmentCountLabel ?? 'Assigned items',
    emptyAssignments: options.emptyAssignmentsLabel ?? 'No assigned items',
    sectionSummary: options.sectionSummaryLabel ?? 'Assignments grouped by container.',
    solutionPrefix: options.solutionPrefixLabel ?? 'Solution',
    capacity: options.capacityLabel ?? 'Capacity',
  };

  return {
    labels,
    renderContainerMeta: typeof options.renderContainerMeta === 'function'
      ? options.renderContainerMeta
      : (container, assignments) => `
          <div class="entity-meta-item"><dt>${escapeHtml(labels.capacity)}</dt><dd>${getContainerCapacityDisplay(container)}</dd></div>
          <div class="entity-meta-item"><dt>${escapeHtml(labels.assignmentCount)}</dt><dd><ul class="solution-item-list">${assignments.length === 0 ? `<li class="muted-text">${escapeHtml(labels.emptyAssignments)}</li>` : assignments.map((assignment) => `<li>${getAssignmentItemDisplay(options.displayProject ?? options.project ?? { items: [], groups: [], containers: [], positions: [] }, assignment)}</li>`).join('')}</ul></dd></div>
        `,
  };
}

export function renderContainerAssignmentView(project, solution, index, totalSolutions, options = {}) {
  const grouped = groupAssignmentsByContainer(project, solution);
  const displayProject = options.displayProject ?? project;
  const viewConfig = buildViewConfig({ ...options, project: displayProject });
  const containerCards = grouped.map(({ container, assignments }) => {
    const defaultItemList = assignments.length === 0
      ? `<li class="muted-text">${escapeHtml(viewConfig.labels.emptyAssignments)}</li>`
      : assignments
        .map((assignment) => `<li>${getAssignmentItemDisplay(displayProject, assignment)}</li>`)
        .join('');

    const metaContent = typeof options.renderContainerMeta === 'function'
      ? options.renderContainerMeta({ container, assignments, project, displayProject, defaultItemList, labels: viewConfig.labels })
      : `
          <div class="entity-meta-item"><dt>${escapeHtml(viewConfig.labels.capacity)}</dt><dd>${getContainerCapacityDisplay(container)}</dd></div>
          <div class="entity-meta-item"><dt>${escapeHtml(viewConfig.labels.assignmentCount)}</dt><dd><ul class="solution-item-list">${defaultItemList}</ul></dd></div>
        `;

    return `
      <article class="entity-card">
        <div class="entity-card-header">
          <div>
            <p class="entity-kind">${escapeHtml(viewConfig.labels.containerKind)}</p>
            <h3>${escapeHtml(container.label)}</h3>
          </div>
          <span class="panel-count">${assignments.length}</span>
        </div>
        <p class="entity-id">${escapeHtml(container.id)}</p>
        <div class="entity-meta-grid">
          ${metaContent}
        </div>
      </article>
    `;
  }).join('');

  return `
    <section class="top-gap">
      <div class="section-summary-row">
        <span class="section-count-pill">${escapeHtml(viewConfig.labels.solutionPrefix)} ${index + 1} of ${totalSolutions}</span>
        <span class="muted-text">${escapeHtml(viewConfig.labels.sectionSummary)}</span>
      </div>
      <div class="entity-board top-gap">
        ${containerCards}
      </div>
    </section>
  `;
}
