import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  applyEventStaffingPreferencePreview,
  createEventStaffingPreferenceWorkbook,
  createEventStaffingSolutionWorkbook,
  parseEventStaffingPreferenceWorkbook,
} from '../../src/pages/eventStaffing/workbooks.js';
import { neutralizeFormulaValue, validateWorkbookBounds, WorkbookSafetyError, WORKBOOK_LIMITS } from '../../src/workbooks/safety.js';
import { getEffectiveAssignmentPreference, PREFERENCE_STATES } from '../../src/pages/eventStaffing/migration.js';

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
  it('generates two header rows with grouped dates, slot labels, and people as rows', () => {
    const current = project();
    current.events.push(
      { id: 'S2', label: 'Evening', slotLabel: 'Evening', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 1 },
      { id: 'S3', label: 'Morning', slotLabel: 'Morning', date: '2026-10-15', dateKey: '2026-10-15', orderIndex: 2 },
    );
    current.people.push({ id: 'P2', name: 'Blair', email: 'blair@example.org' });
    const workbook = createEventStaffingPreferenceWorkbook(current);
    const sheet = workbook.Sheets.Preferences;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    expect(matrix[0]).toEqual(['Name', 'Email', 'Person ID', '2026-10-14', '', '2026-10-15']);
    expect(matrix[1]).toEqual(['', '', '', 'Morning', 'Evening', 'Morning']);
    expect(matrix.slice(2).map((row) => row.slice(0, 3))).toEqual([
      ["'@Alex", 'alex@example.org', 'P1'],
      ['Blair', 'blair@example.org', 'P2'],
    ]);
    expect(sheet['!merges']).toContainEqual({ s: { r: 0, c: 3 }, e: { r: 0, c: 4 } });
    expect(sheet['!cols'].map(({ wch }) => wch)).toEqual([24, 30, 20, 16, 16, 16]);
    const slotRows = XLSX.utils.sheet_to_json(workbook.Sheets.Slots, { defval: '' });
    expect(slotRows.map((row) => [row['Preference column position'], row['Slot ID']])).toEqual([[4, 'S1'], [5, 'S2'], [6, 'S3']]);
  });

  it('round-trips preference values through serialized stable slot and person mappings', () => {
    const workbook = createEventStaffingPreferenceWorkbook(project());
    workbook.Sheets.Preferences.D3.v = 'Unavailable';
    const serialized = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
    const preview = parseEventStaffingPreferenceWorkbook(serialized, project());
    expect(preview.canApply).toBe(true);
    expect(preview.report).toMatchObject({ matchedRows: 1, preferenceCells: 1, invalidCells: 0 });
    const current = project();
    applyEventStaffingPreferencePreview(current, preview);
    expect(current.preferences[0].slotPreferences.S1).toBe('unavailable');
    expect(current.events[0].id).toBe('S1');
  });

  it('clears whole-day values but preserves and reports group overrides during preference-only import', () => {
    const current = project();
    current.preferences = [{
      personId: 'P1',
      dayPreferences: { '2026-10-14': 'unavailable' },
      dayGroupPreferences: { '2026-10-14': { C1: 'unavailable' } },
      slotPreferences: {},
    }];
    const workbook = createEventStaffingPreferenceWorkbook(current);
    workbook.Sheets.Preferences.D3.v = '';
    const preview = parseEventStaffingPreferenceWorkbook(workbook, current);

    applyEventStaffingPreferencePreview(current, preview);

    expect(current.preferences[0].dayPreferences).toEqual({});
    expect(current.preferences[0].dayGroupPreferences).toEqual({ '2026-10-14': { C1: 'unavailable' } });
    expect(preview.report.issues).toContain('1 day/group override set(s) remain active and take precedence over imported slot values. Edit them in the Rules availability calendar.');
    expect(getEffectiveAssignmentPreference(current.preferences[0], current.events[0], 'C1'))
      .toBe(PREFERENCE_STATES.UNAVAILABLE);
  });

  it('exports P and imports P, X, and legacy Y case-insensitively', () => {
    const current = project();
    current.people.push(
      { id: 'P2', name: 'Blair', email: 'blair@example.org' },
      { id: 'P3', name: 'Casey', email: 'casey@example.org' },
    );
    current.preferences = [{ personId: 'P1', slotPreferences: { S1: 'prefer' } }];
    const workbook = createEventStaffingPreferenceWorkbook(current);
    expect(workbook.Sheets.Preferences.D3.v).toBe('P');
    workbook.Sheets.Preferences.D3.v = 'p';
    workbook.Sheets.Preferences.D4.v = 'X';
    workbook.Sheets.Preferences.D5.v = 'y';

    const preview = parseEventStaffingPreferenceWorkbook(workbook, current);
    expect(preview.canApply).toBe(true);
    expect(preview.changes.map(({ personId, slotId, state }) => ({ personId, slotId, state }))).toEqual([
      { personId: 'P1', slotId: 'S1', state: 'prefer' },
      { personId: 'P2', slotId: 'S1', state: 'prefer' },
      { personId: 'P3', slotId: 'S1', state: 'prefer' },
    ]);
  });

  it('parses duplicate visible date-slot labels safely by physical column', () => {
    const current = project();
    current.events.push({ ...current.events[0], id: 'S2', orderIndex: 1 });
    const workbook = createEventStaffingPreferenceWorkbook(current);
    const preferenceRows = XLSX.utils.sheet_to_json(workbook.Sheets.Preferences, { header: 1, defval: '' });
    expect(preferenceRows.slice(0, 2)).toEqual([
      ['Name', 'Email', 'Person ID', '2026-10-14', ''],
      ['', '', '', 'Morning', 'Morning [2]'],
    ]);
    const slotRows = XLSX.utils.sheet_to_json(workbook.Sheets.Slots, { defval: '' });
    expect(slotRows.map((row) => [row['Preference column key'], row['Preference column position'], row['Slot ID']])).toEqual([
      ['2026-10-14 | Morning', 4, 'S1'],
      ['2026-10-14 | Morning [2]', 5, 'S2'],
    ]);

    workbook.Sheets.Preferences.D3.v = 'P';
    workbook.Sheets.Preferences.E3.v = 'U';
    expect(parseEventStaffingPreferenceWorkbook(workbook, current).changes.map(({ slotId, state }) => ({ slotId, state }))).toEqual([
      { slotId: 'S1', state: 'prefer' },
      { slotId: 'S2', state: 'unavailable' },
    ]);
  });

  it('rejects preference columns that no longer match their stable slot mapping', () => {
    const current = project();
    current.events.push({ id: 'S2', label: 'Evening', slotLabel: 'Evening', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 1 });
    const workbook = createEventStaffingPreferenceWorkbook(current);
    const firstValue = workbook.Sheets.Preferences.D3.v;
    workbook.Sheets.Preferences.D3.v = workbook.Sheets.Preferences.E3.v;
    workbook.Sheets.Preferences.E3.v = firstValue;
    workbook.Sheets.Preferences.D2.v = 'Evening';
    workbook.Sheets.Preferences.E2.v = 'Morning';

    const preview = parseEventStaffingPreferenceWorkbook(workbook, current);

    expect(preview.canApply).toBe(false);
    expect(preview.report.unknownSlotMappings).toBeGreaterThan(0);
  });

  it('retains import compatibility with the existing single-header format', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      Name: '@Alex', Email: 'alex@example.org', 'Person ID': 'P1', '2026-10-14 | Morning': 'Y',
    }], { header: ['Name', 'Email', 'Person ID', '2026-10-14 | Morning'] }), 'Preferences');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      'Preference column key': '2026-10-14 | Morning', 'Slot ID': 'S1', Date: '2026-10-14', 'Slot label': 'Morning',
    }]), 'Slots');

    const preview = parseEventStaffingPreferenceWorkbook(workbook, project());
    expect(preview.canApply).toBe(true);
    expect(preview.changes).toEqual([{ personId: 'P1', slotId: 'S1', state: 'prefer' }]);
  });

  it('blocks ambiguous duplicate rows without creating people', () => {
    const workbook = createEventStaffingPreferenceWorkbook(project());
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Preferences, { header: 1, defval: '' });
    workbook.Sheets.Preferences = XLSX.utils.aoa_to_sheet([...rows, [...rows[2]]]);
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
