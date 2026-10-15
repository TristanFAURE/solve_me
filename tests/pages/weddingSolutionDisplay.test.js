import { describe, expect, it } from 'vitest';
import { getDisplayPosition, getTableDisplayGeometry } from '../../src/pages/wedding/tableDisplayGeometry.js';
import { renderWeddingSolutionDisplay } from '../../src/pages/wedding/weddingSolutionDisplay.js';

function buildProject(overrides = {}) {
  return {
    assignmentMode: 'position',
    items: [
      { id: 'guest-1', kind: 'item', label: 'Alex <script>', metadata: { notes: 'Vegetarian & kind' } },
      { id: 'guest-2', kind: 'item', label: 'Sam', metadata: {} },
    ],
    containers: [
      { id: 'table-1', kind: 'container', label: 'Top & Table', metadata: { shape: 'square', notes: 'Near <window>' } },
      { id: 'table-2', kind: 'container', label: 'Second table', metadata: { shape: 'not-a-shape' } },
    ],
    positions: [
      { id: 'manual', kind: 'position', label: 'Manual seat', metadata: {} },
      { id: 'seat-2', kind: 'position', label: 'Seat 2', metadata: { generated: true, seatIndex: 2 } },
      { id: 'seat-1', kind: 'position', label: 'Seat 1', metadata: { generated: true, seatIndex: 1 } },
      { id: 'empty', kind: 'position', label: 'Empty', metadata: {} },
    ],
    containments: [
      { from: { kind: 'container', id: 'table-1' }, to: { kind: 'position', id: 'manual' } },
      { from: { kind: 'container', id: 'table-1' }, to: { kind: 'position', id: 'seat-2' } },
      { from: { kind: 'container', id: 'table-1' }, to: { kind: 'position', id: 'seat-1' } },
      { from: { kind: 'container', id: 'table-2' }, to: { kind: 'position', id: 'empty' } },
    ],
    ...overrides,
  };
}

const render = (project, solution, options = {}) => renderWeddingSolutionDisplay({
  project,
  normalizedProject: project,
  result: solution === null ? null : { status: options.status ?? 'solved', solutions: [solution] },
  activeSolutionIndex: options.activeSolutionIndex ?? 0,
});

describe('wedding table display geometry', () => {
  it.each(['round', 'square', 'rectangle'])('produces deterministic finite percentages for %s tables', (shape) => {
    const first = getTableDisplayGeometry(shape, 16);
    const second = getTableDisplayGeometry(shape, 16);

    expect(first).toEqual(second);
    expect(first.positions).toHaveLength(16);
    for (const position of first.positions) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(100);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(100);
    }
  });

  it('falls back to round and handles invalid counts and indexes safely', () => {
    expect(getTableDisplayGeometry('triangle', 4)).toEqual(getTableDisplayGeometry('round', 4));
    expect(getTableDisplayGeometry('round', Number.POSITIVE_INFINITY).positions).toEqual([]);
    expect(getTableDisplayGeometry('round', -1).positions).toEqual([]);
    expect(getDisplayPosition('rectangle', 100, 2)).toEqual({ x: 50, y: 50, side: 'center' });
  });

  it('uses distinct square and rectangular perimeter geometry', () => {
    expect(getTableDisplayGeometry('square', 8).positions).not.toEqual(
      getTableDisplayGeometry('rectangle', 8).positions,
    );
  });

  it('handles zero, one, and two positions predictably', () => {
    expect(getTableDisplayGeometry('round', 0).positions).toEqual([]);
    expect(getTableDisplayGeometry('round', 1).positions).toEqual([{ x: 50, y: 8, side: 'perimeter' }]);
    expect(getTableDisplayGeometry('round', 2).positions).toEqual([
      { x: 50, y: 8, side: 'perimeter' },
      { x: 50, y: 92, side: 'perimeter' },
    ]);
  });

  it('uses every square side and favors long rectangle sides', () => {
    const squareSides = new Set(getTableDisplayGeometry('square', 8).positions.map(({ side }) => side));
    expect(squareSides).toEqual(new Set(['top', 'right', 'bottom', 'left']));
    const rectangleSides = getTableDisplayGeometry('rectangle', 12).positions.map(({ side }) => side);
    const longSides = rectangleSides.filter((side) => side === 'top' || side === 'bottom').length;
    expect(longSides).toBeGreaterThan(rectangleSides.length - longSides);
  });
});

describe('wedding solution display', () => {
  it('renders every table and seat, orders generated seats by index, and treats positionRef as authoritative', () => {
    const project = buildProject();
    const solution = {
      assignments: [
        { itemRef: { kind: 'item', id: 'guest-1' }, containerRef: { kind: 'container', id: 'table-2' }, positionRef: { kind: 'position', id: 'seat-2' } },
        { itemRef: { kind: 'item', id: 'guest-2' }, positionRef: { kind: 'position', id: 'seat-1' }, metadata: { notes: 'By the aisle' } },
      ],
    };

    const html = render(project, solution);

    expect(html).toContain('data-assignment-view="seat"');
    expect(html).toContain('Top &amp; Table');
    expect(html).toContain('Second table');
    expect(html.indexOf('Seat 1')).toBeLessThan(html.indexOf('Seat 2'));
    expect(html.indexOf('Seat 2')).toBeLessThan(html.indexOf('Manual seat'));
    expect(html).toContain('<small>Empty</small>');
    expect(html).toContain('Alex &lt;script&gt;');
    expect(html).toContain('wedding-table-round');
    expect(html.match(/<article/g)).toHaveLength(2);
    expect(html).toContain('<ol class="wedding-position-list">');
    expect(html).not.toContain('<script>');
  });

  it('uses containerRef for illustrative table-only assignments and marks large tables compact', () => {
    const assignments = Array.from({ length: 12 }, (_, index) => ({
      itemRef: { kind: 'item', id: `guest-${index + 1}` },
      containerRef: { kind: 'container', id: 'table-1' },
      positionRef: { kind: 'position', id: 'empty' },
      metadata: index === 11 ? { itemLabel: 'Fallback guest' } : {},
    }));
    const html = render(buildProject({ assignmentMode: 'container' }), { assignments });

    expect(html).toContain('data-assignment-view="table"');
    expect(html).toContain('Guests are assigned to this table. Their positions around the table are illustrative.');
    expect(html).toContain('wedding-table-compact');
    expect(html).toContain('Fallback guest');
    expect(html).toContain('No guests assigned');
  });

  it('shows unresolved assignments instead of silently dropping them', () => {
    const html = render(buildProject(), {
      assignments: [{
        itemRef: { kind: 'item', id: 'missing-guest' },
        containerRef: { kind: 'container', id: 'table-1' },
        positionRef: { kind: 'position', id: 'missing-seat' },
      }],
    });

    expect(html).toContain('Unresolved assignments');
    expect(html).toContain('Guest missing-guest');
  });

  it('renders robust empty states', () => {
    expect(render(buildProject(), null)).toContain('Run the solver');
    expect(renderWeddingSolutionDisplay({ project: buildProject(), result: { status: 'unsat', solutions: [] } })).toContain('No valid seating plan');
    expect(render(buildProject({ containers: [] }), { assignments: [] })).toContain('No tables are configured');
  });

  it.each(['partial', 'timeout', 'cancelled'])('renders a usable %s result and the seat-aware disclaimer', (status) => {
    const html = render(buildProject(), {
      assignments: [{ itemRef: { kind: 'item', id: 'guest-1' }, positionRef: { kind: 'position', id: 'seat-1' } }],
    }, { status });
    expect(html).toContain('available solution from an incomplete solve');
    expect(html).toContain('Seat positions reflect the selected solution');
    expect(html).toContain('Alex &lt;script&gt;');
  });

  it('clamps the selected solution index and visibly distinguishes all shapes', () => {
    const project = buildProject({
      assignmentMode: 'container',
      containers: [
        { id: 'round', kind: 'container', label: 'Round', metadata: { shape: 'round' } },
        { id: 'square', kind: 'container', label: 'Square', metadata: { shape: 'square' } },
        { id: 'rectangle', kind: 'container', label: 'Rectangle', metadata: { shape: 'rectangle' } },
      ],
    });
    const result = {
      status: 'solved',
      solutions: [
        { assignments: [{ itemRef: { kind: 'item', id: 'guest-1' }, containerRef: { kind: 'container', id: 'round' } }] },
        { assignments: [{ itemRef: { kind: 'item', id: 'guest-2' }, containerRef: { kind: 'container', id: 'rectangle' } }] },
      ],
    };
    const html = renderWeddingSolutionDisplay({ project, normalizedProject: project, result, activeSolutionIndex: 99 });
    expect(html).toContain('Solution 2 of 2');
    expect(html).toContain('wedding-table-round');
    expect(html).toContain('wedding-table-square');
    expect(html).toContain('wedding-table-rectangle');
    expect(html).toContain('Sam');
    expect(html).not.toContain('Alex &lt;script&gt;');
  });

  it('does not mutate the project or solution', () => {
    const project = buildProject();
    const solution = {
      assignments: [{ itemRef: { kind: 'item', id: 'guest-1' }, positionRef: { kind: 'position', id: 'seat-1' } }],
    };
    const projectSnapshot = structuredClone(project);
    const solutionSnapshot = structuredClone(solution);

    render(project, solution);

    expect(project).toEqual(projectSnapshot);
    expect(solution).toEqual(solutionSnapshot);
  });

  it('emits inline styles containing only finite percentage coordinates', () => {
    const html = render(buildProject(), { assignments: [] });
    const styles = [...html.matchAll(/style="([^"]+)"/g)].map((match) => match[1]);

    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((style) => /^--seat-x:\d+(?:\.\d+)?;--seat-y:\d+(?:\.\d+)?$/.test(style))).toBe(true);
    expect(html).not.toMatch(/(?:NaN|Infinity)/);
  });
});
