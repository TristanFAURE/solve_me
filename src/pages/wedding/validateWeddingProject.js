import { ASSIGNMENT_MODES } from '../../core/model/assignmentModes.js';
import { CONSTRAINT_KINDS } from '../../core/model/constraints.js';
import { getTableGenerationMode, getWeddingTableShape } from './tableTopology.js';

function createIssue(level, code, message, path = []) {
  return { level, code, message, path };
}

function getItems(project) {
  return Array.isArray(project?.items) ? project.items : [];
}

function getGroups(project) {
  return Array.isArray(project?.groups) ? project.groups : [];
}

function getContainers(project) {
  return Array.isArray(project?.containers) ? project.containers : [];
}

function getPositions(project) {
  return Array.isArray(project?.positions) ? project.positions : [];
}

function getContainments(project) {
  return Array.isArray(project?.containments) ? project.containments : [];
}

function getTopologies(project) {
  return Array.isArray(project?.topologies) ? project.topologies : [];
}

function getConstraints(project) {
  return Array.isArray(project?.constraints) ? project.constraints : [];
}

function getSeatTableId(project, seatId) {
  return getContainments(project)
    .find((relation) => relation?.from?.kind === 'container' && relation?.to?.kind === 'position' && relation.to.id === seatId)
    ?.from?.id ?? null;
}

function getTableCapacity(table) {
  const maxCapacity = table?.metadata?.maxCapacity;
  return Number.isFinite(maxCapacity) ? maxCapacity : null;
}

function getSeatsForTable(project, tableId) {
  const positions = getPositions(project);
  const containments = getContainments(project);
  const seatIds = containments
    .filter((relation) => relation?.from?.kind === 'container' && relation?.from?.id === tableId && relation?.to?.kind === 'position')
    .map((relation) => relation.to.id);

  return positions.filter((position) => seatIds.includes(position.id));
}

function getGuestGroupIds(project, guestId) {
  return getContainments(project)
    .filter((relation) => relation?.from?.kind === 'group' && relation?.to?.kind === 'item' && relation.to.id === guestId)
    .map((relation) => relation.from.id);
}

function isAdjacencyConstraintKind(kind) {
  return kind === CONSTRAINT_KINDS.MUST_BE_ADJACENT || kind === CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT;
}

export function validateWeddingProject(project) {
  const errors = [];
  const warnings = [];
  const guests = getItems(project);
  const groups = getGroups(project);
  const tables = getContainers(project);
  const positions = getPositions(project);
  const topologies = getTopologies(project);
  const constraints = getConstraints(project);
  const assignmentMode = project?.assignmentMode;
  const totalCapacity = tables.reduce((sum, table) => sum + (getTableCapacity(table) ?? 0), 0);

  if (!project?.title?.trim()) {
    warnings.push(createIssue('warning', 'wedding-missing-title', 'Add an event name so the seating plan is easier to identify.', ['title']));
  }

  if (guests.length === 0) {
    errors.push(createIssue('error', 'wedding-no-guests', 'Add at least one guest before solving the wedding seating plan.', ['items']));
  }

  if (tables.length === 0) {
    errors.push(createIssue('error', 'wedding-no-tables', 'Add at least one table before solving the wedding seating plan.', ['containers']));
  }

  if (tables.length > 0 && totalCapacity < guests.length) {
    errors.push(createIssue('error', 'wedding-not-enough-seats', `The current tables only provide ${totalCapacity} seats for ${guests.length} guests. Increase table capacities before solving.`, ['containers']));
  }

  for (const guest of guests) {
    const groupIds = getGuestGroupIds(project, guest.id);
    if (groupIds.length === 0) {
      warnings.push(createIssue('warning', 'wedding-guest-without-group', `${guest.label} is not linked to any family or guest group yet.`, ['containments', guest.id]));
    }
  }

  if (assignmentMode === ASSIGNMENT_MODES.POSITION) {
    if (positions.length === 0) {
      errors.push(createIssue('error', 'wedding-seat-mode-without-seats', 'Seat-aware mode is enabled, but no seats are defined yet.', ['positions']));
    }

    for (const table of tables) {
      const seats = getSeatsForTable(project, table.id);
      const capacity = getTableCapacity(table);
      const shape = getWeddingTableShape(table);
      const generationMode = getTableGenerationMode(table);

      if (seats.length === 0) {
        warnings.push(createIssue('warning', 'wedding-table-without-seats', `${table.label} has no seats yet, so guests cannot be placed there in seat-aware mode.`, ['positions', table.id]));
      }

      if (Number.isFinite(capacity) && seats.length > 0 && capacity !== seats.length) {
        warnings.push(createIssue('warning', 'wedding-seat-capacity-mismatch', `${table.label} has capacity ${capacity} but ${seats.length} defined seats.`, ['containers', table.id, 'metadata', 'maxCapacity']));
      }

      if (seats.length > 0 && generationMode === 'manual-adjusted') {
        warnings.push(createIssue('warning', 'wedding-topology-manually-adjusted', `${table.label} uses a generated ${shape} perimeter that has been adjusted manually. Regenerating seats will replace those custom gaps or deletions.`, ['containers', table.id, 'metadata', 'generationMode']));
      }
    }

    if (topologies.length === 0) {
      warnings.push(createIssue('warning', 'wedding-no-seat-adjacency', 'Seat-aware mode is enabled, but no seat adjacency has been declared yet. “Next to” rules will not be meaningful until seats are linked.', ['topologies']));
    }

    const crossTableAdjacency = topologies.find((relation) => {
      if (relation?.from?.kind !== 'position' || relation?.to?.kind !== 'position') {
        return false;
      }

      const fromTableId = getSeatTableId(project, relation.from.id);
      const toTableId = getSeatTableId(project, relation.to.id);
      return Boolean(fromTableId && toTableId && fromTableId !== toTableId);
    });

    if (crossTableAdjacency) {
      errors.push(createIssue('error', 'wedding-cross-table-seat-adjacency', 'Seat adjacency must stay within a single table in the wedding planner. Remove any cross-table seat link before solving.', ['topologies']));
    }
  }

  if (assignmentMode !== ASSIGNMENT_MODES.POSITION) {
    const adjacencyConstraints = constraints.filter((constraint) => isAdjacencyConstraintKind(constraint.kind));
    if (adjacencyConstraints.length > 0) {
      errors.push(createIssue('error', 'wedding-adjacency-needs-seat-mode', 'Guest “next to” rules require seat-aware mode with defined seats.', ['constraints']));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
