import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import {
  applyEventStaffingShareEditPreview,
  createEventStaffingShareEditWorkbook,
  exportEventStaffingPersonalWorkbook,
  parseEventStaffingShareEditWorkbook,
  previewEventStaffingShareEditWorkbookFile,
} from '../../src/pages/eventStaffing/shareEditWorkbook.js';
import { WorkbookSafetyError } from '../../src/workbooks/safety.js';

vi.mock('xlsx', async (importOriginal) => ({ ...(await importOriginal()), writeFile: vi.fn() }));

function project() {
  return {
    projectId: 'staffing-1',
    title: 'Community event',
    events: [
      { id: 'slot-1', date: '2026-10-15', dateKey: '2026-10-15', slotLabel: 'Morning', orderIndex: 0 },
      { id: 'slot-2', date: '2026-10-15', dateKey: '2026-10-15', slotLabel: 'Evening', orderIndex: 1 },
    ],
    groupTypes: [{ id: 'group-a', label: 'Welcome' }, { id: 'group-b', label: 'Kitchen' }],
    people: [
      { id: 'person-a', name: 'Alice', email: 'alice@example.test', metadata: { participant: { email: 'alice@example.test', externalKey: 'A-1' } } },
      { id: 'person-b', name: 'Bob', email: 'bob@example.test', metadata: { participant: { email: 'bob@example.test', externalKey: 'B-1' } } },
    ],
    preferences: [],
  };
}

function matrix(workbook) {
  return XLSX.utils.sheet_to_json(workbook.Sheets['Share & Edit'], { header: 1, defval: '', raw: false });
}

function replaceMatrix(workbook, values) {
  workbook.Sheets['Share & Edit'] = XLSX.utils.aoa_to_sheet(values);
}

function asFile(workbook) {
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return { name: 'event-staffing-share-edit.xlsx', size: bytes.byteLength, async arrayBuffer() { return bytes; } };
}

describe('Event Staffing Share & Edit workbook', () => {
  it('exports effective person/group values with stable hidden mappings and localized date-slot headers', () => {
    const current = project();
    current.preferences = [{
      personId: 'person-a',
      dayPreferences: { '2026-10-15': 'preferNot' },
      slotPreferences: { 'slot-1': 'prefer' },
      dayGroupPreferences: { '2026-10-15': { 'group-a': 'unavailable' } },
      slotGroupPreferences: { 'slot-1': { 'group-a': 'prefer' } },
    }];
    const workbook = createEventStaffingShareEditWorkbook(current, { language: 'fr', identityType: 'email', revision: 'r1' });
    const values = matrix(workbook);

    expect(values[6]).toEqual(['internalPersonId', 'internalGroupId', 'personKey', 'displayName', 'group', 'pref:slot-1', 'pref:slot-2']);
    expect(values[7].slice(2)).toEqual(['Clé personne', 'Nom affiché', 'Groupe de personnel', '2026-10-15 | Morning', '2026-10-15 | Evening']);
    expect(values[8]).toEqual(['person-a', 'group-a', 'alice@example.test', 'Alice', 'Welcome', 'P', 'U']);
    expect(values[9].slice(5)).toEqual(['P', 'N']);
    expect(workbook.Sheets['Share & Edit']['!cols'][0].hidden).toBe(true);
    expect(workbook.Sheets['Share & Edit']['!cols'][1].hidden).toBe(true);
    expect(workbook.Sheets['Share & Edit']['!dataValidation']).toHaveLength(2);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Legend, { header: 1 })[2]).toEqual(['P', expect.stringContaining('Prefer')]);
  });

  it('round-trips represented cells, treats blank as explicit neutral, and preserves omitted tuples and fields', () => {
    const current = project();
    current.preferences = [{
      personId: 'person-a', slotPreferences: { 'slot-1': 'preferNot' }, dayPreferences: { '2026-10-15': 'unavailable' },
      slotGroupPreferences: { 'slot-1': { 'group-a': 'prefer', 'group-b': 'unavailable' }, 'slot-2': { 'group-a': 'preferNot' } },
    }];
    const workbook = createEventStaffingShareEditWorkbook(current);
    const values = matrix(workbook);
    values[8][5] = '';
    values[8][6] = 'P';
    replaceMatrix(workbook, [...values.slice(0, 9), ...values.slice(10)]); // Omit Alice/Kitchen only.

    const preview = parseEventStaffingShareEditWorkbook(workbook, current);
    const applied = applyEventStaffingShareEditPreview(current, preview);
    const preference = applied.preferences.find(({ personId }) => personId === 'person-a');

    expect(preview.canApply).toBe(true);
    expect(preference.slotGroupPreferences).toEqual({
      'slot-1': { 'group-a': 'neutral', 'group-b': 'unavailable' },
      'slot-2': { 'group-a': 'prefer' },
    });
    expect(preference.slotPreferences).toEqual({ 'slot-1': 'preferNot' });
    expect(preference.dayPreferences).toEqual({ '2026-10-15': 'unavailable' });
  });

  it('creates an unknown person once with a stable ID and participant email metadata', () => {
    const current = project();
    const workbook = createEventStaffingShareEditWorkbook(current, { identityType: 'email' });
    const values = matrix(workbook);
    values.push(['', 'group-a', 'cara@example.test', 'Cara', 'Welcome', 'P', '']);
    values.push(['', 'group-b', 'cara@example.test', 'Cara', 'Kitchen', '', 'N']);
    replaceMatrix(workbook, values);

    const preview = parseEventStaffingShareEditWorkbook(workbook, current);
    const cara = preview.project.people.find(({ name }) => name === 'Cara');
    const preference = preview.project.preferences.find(({ personId }) => personId === cara.id);

    expect(preview.canApply).toBe(true);
    expect(preview.report.created).toBe(1);
    expect(cara.id).toMatch(/^person-/);
    expect(cara).toMatchObject({ email: 'cara@example.test', metadata: { participant: { email: 'cara@example.test' } } });
    expect(preference.slotGroupPreferences['slot-1']).toEqual({ 'group-a': 'prefer', 'group-b': 'neutral' });
    expect(preference.slotGroupPreferences['slot-2']).toEqual({ 'group-a': 'neutral', 'group-b': 'preferNot' });
  });

  it.each([
    ['duplicate person/group rows', (values) => values.push([...values[8]])],
    ['unknown groups', (values) => { values[8][1] = 'removed-group'; }],
    ['conflicting stable and key identity', (values) => { values[8][2] = 'Bob'; }],
    ['stale slot mappings', (values) => { values[6][5] = 'pref:removed-slot'; }],
  ])('blocks %s atomically', (_name, edit) => {
    const current = project();
    const snapshot = structuredClone(current);
    const workbook = createEventStaffingShareEditWorkbook(current);
    const values = matrix(workbook);
    edit(values);
    replaceMatrix(workbook, values);

    const preview = parseEventStaffingShareEditWorkbook(workbook, current);
    expect(preview.canApply).toBe(false);
    expect(preview.report.errors.length).toBeGreaterThan(0);
    expect(() => applyEventStaffingShareEditPreview(current, preview)).toThrow();
    expect(current).toEqual(snapshot);
  });

  it('filters personalized exports and uses a safe required filename', () => {
    const current = project();
    current.people[0].name = 'Alice / Lead';

    const workbook = exportEventStaffingPersonalWorkbook(current, 'person-a');

    expect(matrix(workbook).slice(8)).toHaveLength(2);
    expect(matrix(workbook).slice(8).every((row) => row[0] === 'person-a')).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalledWith(workbook, 'event-staffing-person-Alice-Lead.xlsx');
  });

  it('neutralizes formula-like identity values and previews serialized files without mutation', async () => {
    const current = project();
    current.people[0].name = '=Alice';
    current.groupTypes[0].label = '@Welcome';
    const snapshot = structuredClone(current);
    const workbook = createEventStaffingShareEditWorkbook(current);

    expect(workbook.Sheets['Share & Edit'].D9.v).toBe("'=Alice");
    expect(workbook.Sheets['Share & Edit'].E9.v).toBe("'@Welcome");
    const preview = await previewEventStaffingShareEditWorkbookFile(asFile(workbook), current);
    expect(preview.canApply).toBe(true);
    expect(preview.project.people[0].name).toBe('=Alice');
    expect(current).toEqual(snapshot);
  });

  it('enforces the 500-column generation boundary without constructing a giant workbook', () => {
    const current = project();
    current.people = [];
    current.events = Array.from({ length: 496 }, (_, index) => ({ id: `slot-${index}`, slotLabel: `Slot ${index}`, orderIndex: index }));
    expect(() => createEventStaffingShareEditWorkbook(current)).toThrow(WorkbookSafetyError);
  });
});
