import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  applyEventStaffingPreferencePreview,
  createEventStaffingPreferenceWorkbook,
  createEventStaffingSolutionWorkbook,
  parseEventStaffingPreferenceWorkbook,
} from '../../src/pages/eventStaffing/workbooks.js';
import { neutralizeFormulaValue, validateWorkbookBounds, WorkbookSafetyError, WORKBOOK_LIMITS } from '../../src/workbooks/safety.js';

function project() {
  return {
    title: '=Unsafe',
    events: [{ id: 'S1', label: 'Morning', slotLabel: 'Morning', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 0 }],
    groupTypes: [{ id: 'C1', label: '+Welcome' }],
    requirements: [{ eventId: 'S1', slotId: 'S1', groupTypeId: 'C1', min: 1, max: 1 }],
    people: [{ id: 'P1', name: '@Alex', email: 'alex@example.org' }],
    preferences: [], forcedAssignments: [], forbiddenAssignments: [], cooldownRules: [], globalLimits: {},
  };
}

describe('Event Staffing workbooks', () => {
  it('round-trips preference values through stable slot and person mappings', () => {
    const workbook = createEventStaffingPreferenceWorkbook(project());
    const sheet = workbook.Sheets.Preferences;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    expect(Object.keys(rows[0]).slice(0, 3)).toEqual(['Name', 'Email', 'Person ID']);
    const slotColumn = Object.keys(rows[0]).find((key) => key.startsWith('2026-10-14 | Morning'));
    expect(sheet['!autofilter'].ref).toBe(sheet['!ref']);
    rows[0][slotColumn] = 'Unavailable';
    workbook.Sheets.Preferences = XLSX.utils.json_to_sheet(rows);
    const preview = parseEventStaffingPreferenceWorkbook(workbook, project());
    expect(preview.canApply).toBe(true);
    expect(preview.report).toMatchObject({ matchedRows: 1, preferenceCells: 1, invalidCells: 0 });
    const current = project();
    applyEventStaffingPreferencePreview(current, preview);
    expect(current.preferences[0].slotPreferences.S1).toBe('unavailable');
    expect(current.events[0].id).toBe('S1');
  });

  it('exports P and imports P, X, and legacy Y case-insensitively', () => {
    const current = project();
    current.people.push(
      { id: 'P2', name: 'Blair', email: 'blair@example.org' },
      { id: 'P3', name: 'Casey', email: 'casey@example.org' },
    );
    current.preferences = [{ personId: 'P1', slotPreferences: { S1: 'prefer' } }];
    const workbook = createEventStaffingPreferenceWorkbook(current);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Preferences, { defval: '' });
    const slotColumn = '2026-10-14 | Morning';
    expect(rows[0][slotColumn]).toBe('P');
    rows[0][slotColumn] = 'p';
    rows[1][slotColumn] = 'X';
    rows[2][slotColumn] = 'y';
    workbook.Sheets.Preferences = XLSX.utils.json_to_sheet(rows);

    const preview = parseEventStaffingPreferenceWorkbook(workbook, current);
    expect(preview.canApply).toBe(true);
    expect(preview.changes.map(({ personId, slotId, state }) => ({ personId, slotId, state }))).toEqual([
      { personId: 'P1', slotId: 'S1', state: 'prefer' },
      { personId: 'P2', slotId: 'S1', state: 'prefer' },
      { personId: 'P3', slotId: 'S1', state: 'prefer' },
    ]);
  });

  it('disambiguates duplicate date-slot headers while retaining stable slot IDs', () => {
    const current = project();
    current.events.push({ ...current.events[0], id: 'S2', orderIndex: 1 });
    const workbook = createEventStaffingPreferenceWorkbook(current);
    const preferenceHeaders = XLSX.utils.sheet_to_json(workbook.Sheets.Preferences, { header: 1 })[0];
    expect(preferenceHeaders).toEqual(['Name', 'Email', 'Person ID', '2026-10-14 | Morning', '2026-10-14 | Morning [2]']);
    const slotRows = XLSX.utils.sheet_to_json(workbook.Sheets.Slots, { defval: '' });
    expect(slotRows.map((row) => [row['Preference column key'], row['Slot ID']])).toEqual([
      ['2026-10-14 | Morning', 'S1'],
      ['2026-10-14 | Morning [2]', 'S2'],
    ]);

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Preferences, { defval: '' });
    rows[0]['2026-10-14 | Morning'] = 'P';
    rows[0]['2026-10-14 | Morning [2]'] = 'U';
    workbook.Sheets.Preferences = XLSX.utils.json_to_sheet(rows);
    expect(parseEventStaffingPreferenceWorkbook(workbook, current).changes.map(({ slotId, state }) => ({ slotId, state }))).toEqual([
      { slotId: 'S1', state: 'prefer' },
      { slotId: 'S2', state: 'unavailable' },
    ]);
  });

  it('blocks ambiguous duplicate rows without creating people', () => {
    const workbook = createEventStaffingPreferenceWorkbook(project());
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Preferences, { defval: '' });
    workbook.Sheets.Preferences = XLSX.utils.json_to_sheet([...rows, { ...rows[0] }]);
    const preview = parseEventStaffingPreferenceWorkbook(workbook, project());
    expect(preview.canApply).toBe(false);
    expect(preview.report.duplicateRows).toBe(1);
  });

  it('enforces workbook limits and neutralizes formula-like exports', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['x']]);
    sheet['!ref'] = `A1:A${WORKBOOK_LIMITS.maxRowsPerSheet + 1}`;
    XLSX.utils.book_append_sheet(workbook, sheet, 'Too large');
    expect(() => validateWorkbookBounds(workbook)).toThrow(WorkbookSafetyError);
    expect(neutralizeFormulaValue('=1+1')).toBe("'=1+1");

    const resultWorkbook = createEventStaffingSolutionWorkbook(project(), {
      status: 'solved', runtimeMs: 1, searchComplete: true, optimalityProven: true, timeoutReached: false,
      solutions: [{ score: 1, scoreDetails: { assignmentScores: 1, itemCountTargets: 0, equity: 0 }, assignments: [{ itemRef: { id: 'P1' }, containerRef: { id: 'event:S1::group:C1' } }] }],
    });
    expect(resultWorkbook.Sheets.Schedule.A2.v).toBe('2026-10-14');
    expect(resultWorkbook.Sheets.Schedule.C2.v).toBe("'+Welcome");
    expect(resultWorkbook.Sheets.Schedule.D2.v).toBe("'@Alex");
  });
});
