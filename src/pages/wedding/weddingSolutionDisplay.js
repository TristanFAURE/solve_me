import { ASSIGNMENT_MODES } from '../../core/model/assignmentModes.js';
import { getSeatsForTable, getWeddingTableShape } from './tableTopology.js';
import { getTableDisplayGeometry } from './tableDisplayGeometry.js';

const LARGE_TABLE_THRESHOLD = 12;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderEmptyState(message) {
  return `<section class="card wedding-display"><h2>Wedding seating display</h2><p class="muted-text">${escapeHtml(message)}</p></section>`;
}

function getUsableSolution(result, activeSolutionIndex) {
  const solutions = Array.isArray(result?.solutions) ? result.solutions : [];
  if (!solutions.length) return null;
  const requested = Number.isInteger(activeSolutionIndex) ? activeSolutionIndex : 0;
  const index = Math.min(Math.max(requested, 0), solutions.length - 1);
  return { solution: solutions[index], index, count: solutions.length };
}

function orderSeats(project, tableId) {
  const projectOrder = new Map((project.positions ?? []).map((seat, index) => [seat.id, index]));
  return [...getSeatsForTable(project, tableId)].sort((left, right) => {
    const leftIndex = Number.isFinite(left?.metadata?.seatIndex) ? left.metadata.seatIndex : null;
    const rightIndex = Number.isFinite(right?.metadata?.seatIndex) ? right.metadata.seatIndex : null;
    if (leftIndex !== null && rightIndex !== null && leftIndex !== rightIndex) return leftIndex - rightIndex;
    if (leftIndex !== null) return -1;
    if (rightIndex !== null) return 1;
    return (projectOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (projectOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  });
}

function positionStyle(position) {
  const x = Number.isFinite(position?.x) ? Math.min(100, Math.max(0, position.x)) : 50;
  const y = Number.isFinite(position?.y) ? Math.min(100, Math.max(0, position.y)) : 50;
  return `--seat-x:${x};--seat-y:${y}`;
}

function capacityLabel(table) {
  const maximum = table?.maxCapacity ?? table?.metadata?.maxCapacity;
  return maximum == null ? 'Unlimited' : String(maximum);
}

function guestLabel(guestById, assignment) {
  return guestById.get(assignment?.itemRef?.id)?.label
    ?? assignment?.metadata?.itemLabel
    ?? (assignment?.itemRef?.id ? `Guest ${assignment.itemRef.id}` : 'Unknown guest');
}

function renderGuestContent(label, secondary = '') {
  return `<span aria-hidden="true">🧑</span><span><strong>${escapeHtml(label)}</strong>${secondary ? `<small>${escapeHtml(secondary)}</small>` : ''}</span>`;
}

export function renderWeddingSolutionDisplay({
  project,
  normalizedProject: _normalizedProject,
  result,
  activeSolutionIndex = 0,
}) {
  if (!result) return renderEmptyState('Run the solver to generate a visual seating display.');
  const selected = getUsableSolution(result, activeSolutionIndex);
  if (!selected) {
    if (result.status === 'unsat') return renderEmptyState('No valid seating plan can be displayed because the current rules are unsatisfiable.');
    if (result.status === 'error') return renderEmptyState('The solve must succeed before a seating display is available.');
    return renderEmptyState('No usable seating plan is available to display.');
  }

  const tables = Array.isArray(project?.containers) ? project.containers : [];
  const guestById = new Map((project?.items ?? []).map((guest) => [guest.id, guest]));
  const seatAware = project?.assignmentMode === ASSIGNMENT_MODES.POSITION;
  const assignments = selected.solution?.assignments ?? [];
  const unresolved = [];
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const seatToTableId = new Map();
  const seatsByTableId = new Map();
  tables.forEach((table) => {
    const seats = orderSeats(project, table.id);
    seatsByTableId.set(table.id, seats);
    seats.forEach((seat) => seatToTableId.set(seat.id, table.id));
  });
  const assignmentsByTableId = new Map(tables.map((table) => [table.id, []]));
  const assignmentsBySeatId = new Map();
  assignments.forEach((assignment) => {
    if (seatAware) {
      const seatId = assignment?.positionRef?.id;
      const tableId = seatToTableId.get(seatId);
      if (!tableId) unresolved.push(assignment);
      else {
        const seatAssignments = assignmentsBySeatId.get(seatId) ?? [];
        seatAssignments.push(assignment);
        assignmentsBySeatId.set(seatId, seatAssignments);
        assignmentsByTableId.get(tableId).push(assignment);
      }
    } else {
      const tableId = assignment?.containerRef?.id;
      if (!tableById.has(tableId)) unresolved.push(assignment);
      else assignmentsByTableId.get(tableId).push(assignment);
    }
  });

  const tableCards = tables.map((table) => {
    const shape = getWeddingTableShape(table);
    const tableAssignments = assignmentsByTableId.get(table.id) ?? [];
    const seats = seatAware ? seatsByTableId.get(table.id) ?? [] : [];
    const positionsCount = seatAware ? seats.length : tableAssignments.length;
    const geometry = getTableDisplayGeometry(shape, positionsCount);
    const compact = positionsCount >= LARGE_TABLE_THRESHOLD ? ' wedding-table-compact' : '';
    const chips = seatAware
      ? seats.map((seat, index) => {
        const seatAssignments = assignmentsBySeatId.get(seat.id) ?? [];
        const content = seatAssignments.length
          ? `<span class="wedding-seat-guests">${seatAssignments.map((assignment) => renderGuestContent(guestLabel(guestById, assignment))).join('')}<small>${escapeHtml(seat.label || seat.id)}</small></span>`
          : `<span><strong>${escapeHtml(seat.label || seat.id)}</strong><small>Empty</small></span>`;
        return `<li class="wedding-position-chip${seatAssignments.length ? '' : ' wedding-empty-position'}" style="${positionStyle(geometry.positions[index])}">${content}</li>`;
      }).join('')
      : tableAssignments.map((assignment, index) => `<li class="wedding-position-chip" style="${positionStyle(geometry.positions[index])}">${renderGuestContent(guestLabel(guestById, assignment))}</li>`).join('');
    const modeNote = seatAware
      ? 'Seat positions reflect the selected solution. The diagram is a schematic representation of the configured seat order.'
      : 'Guests are assigned to this table. Their positions around the table are illustrative.';
    return `<article class="wedding-table-card wedding-table-${escapeHtml(geometry.shape)}${compact}" aria-label="${escapeHtml(`${table.label}, ${geometry.shape} table, ${tableAssignments.length} of ${capacityLabel(table)} occupied`)}">
      <header class="panel-header"><div><p class="eyebrow">${escapeHtml(geometry.shape)} table</p><h3>${escapeHtml(table.label)}</h3></div><span class="section-count-pill">${tableAssignments.length} / ${escapeHtml(capacityLabel(table))}</span></header>
      <div class="wedding-table-diagram-wrap"><div class="wedding-table-diagram">
        <div class="wedding-table-surface wedding-table-${escapeHtml(geometry.shape)}"><strong>${escapeHtml(table.label)}</strong><span>${tableAssignments.length} guest${tableAssignments.length === 1 ? '' : 's'}</span></div>
        ${chips ? `<ol class="wedding-position-list">${chips}</ol>` : '<p class="wedding-table-empty-message">No guests assigned</p>'}
      </div></div>
      <p class="wedding-display-note">${modeNote}</p>
    </article>`;
  }).join('');

  const unresolvedHtml = unresolved.length ? `<section class="card wedding-unresolved-assignments"><h3>Unresolved assignments</h3><p>These assignments reference a table or seat that is not available in the current project.</p><ul>${unresolved.map((assignment) => `<li>${renderGuestContent(guestLabel(guestById, assignment), assignment?.positionRef?.id ?? assignment?.containerRef?.id ?? 'Unknown destination')}</li>`).join('')}</ul></section>` : '';
  const incomplete = result.status === 'solved' ? '' : '<p class="result-status-banner">This display uses an available solution from an incomplete solve.</p>';
  return `<section class="wedding-display" data-assignment-view="${seatAware ? 'seat' : 'table'}">
    <header class="panel-header"><div><p class="eyebrow">Selected solution</p><h2>Wedding seating display</h2></div><span class="panel-count">Solution ${selected.index + 1} of ${selected.count}</span></header>
    ${incomplete}
    <div class="wedding-table-board">${tableCards || '<p class="muted-text">No tables are configured.</p>'}</div>
    ${unresolvedHtml}
  </section>`;
}
