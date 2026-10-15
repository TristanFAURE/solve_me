import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../src/core/model/project.js';
import {
  applyWeddingShareEditPreview,
  createWeddingShareEditWorkbook,
  parseWeddingShareEditWorkbook,
  previewWeddingShareEditWorkbookFile,
} from '../../src/pages/wedding/shareEditWorkbook.js';

function project(guests = [
  createItem({ id: 'a', label: 'Alice', metadata: { participant: { email: 'alice@example.test', externalKey: 'A-1' } } }),
  createItem({ id: 'b', label: 'Bob', metadata: { participant: { email: 'bob@example.test', externalKey: 'B-1' } } }),
]) {
  return createEmptyProject({ projectId: 'wedding-1', title: 'Wedding', viewHint: VIEW_HINTS.WEDDING, items: guests });
}

function data(workbook) {
  return XLSX.utils.sheet_to_json(workbook.Sheets['Share & Edit'], { header: 1, defval: '', raw: false });
}

function replaceData(workbook, rows) {
  const matrix = data(workbook);
  workbook.Sheets['Share & Edit'] = XLSX.utils.aoa_to_sheet([...matrix.slice(0, 8), ...rows]);
  return workbook;
}

function asFile(workbook) {
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return { name: 'wedding-share-edit.xlsx', size: bytes.byteLength, async arrayBuffer() { return bytes; } };
}

describe('Wedding Share & Edit workbook', () => {
  it('uses canonical columns, translated labels, configured identity, formula neutralization, and supports over 200 guests', () => {
    const guests = Array.from({ length: 205 }, (_, index) => createItem({
      id: `guest-${index}`,
      label: index === 0 ? '=Alice' : `Guest ${index}`,
      metadata: { participant: { email: `guest-${index}@example.test` } },
    }));
    const workbook = createWeddingShareEditWorkbook(project(guests), { language: 'fr', identityType: 'email', revision: 'r1' });
    const rows = data(workbook);

    expect(rows[6]).toEqual(['internalId', 'guestKey', 'displayName', 'mustSameTable', 'preferSameTable', 'preferDifferentTable', 'mustDifferentTable']);
    expect(rows[7][1]).toBe('Clé invité');
    expect(rows[8]).toEqual(['guest-0', 'guest-0@example.test', "'=Alice", '', '', '', '']);
    expect(rows).toHaveLength(213);
    expect(workbook.Sheets['Share & Edit']['!cols'][0].hidden).toBe(true);
    expect(workbook.SheetNames).toContain('Legend');
  });

  it('rejects internal URLs from stakeholder exports', () => {
    const current = project([createItem({ id: 'a', label: 'http://localhost:3000/private' })]);
    expect(() => createWeddingShareEditWorkbook(current)).toThrow(/internal URLs/i);
  });

  it('disambiguates duplicate full names while retaining stable IDs and relationship keys', () => {
    const current = project([
      createItem({ id: 'c1', label: 'Clio' }),
      createItem({ id: 'c2', label: 'Clio' }),
    ]);
    current.constraints = [{ kind: 'mustShareContainer', leftRef: { kind: 'item', id: 'c1' }, rightRef: { kind: 'item', id: 'c2' }, metadata: {} }];
    const workbook = createWeddingShareEditWorkbook(current);
    const rows = data(workbook).slice(8);
    expect(rows.map((row) => row[1])).toEqual(['Clio [1]', 'Clio [2]']);
    expect(rows[0][3]).toBe('Clio [2]');
    expect(rows[1][3]).toBe('Clio [1]');
    expect(parseWeddingShareEditWorkbook(workbook, current).canApply).toBe(true);
  });

  it('matches stable IDs before keys, creates guests, updates participant metadata, and does not mutate during preview', () => {
    const current = project();
    const snapshot = structuredClone(current);
    const workbook = createWeddingShareEditWorkbook(current, { identityType: 'email' });
    const rows = data(workbook).slice(8);
    rows[0][1] = 'alice-new@example.test';
    rows[0][2] = 'Alice Updated';
    rows.push(['', 'cara@example.test', 'Cara', '', '', '', '']);
    replaceData(workbook, rows);

    const preview = parseWeddingShareEditWorkbook(workbook, current);

    expect(preview.canApply).toBe(true);
    expect(preview.report).toMatchObject({ matched: 2, created: 1, updated: 1, errors: [] });
    expect(preview.project.items.find(({ id }) => id === 'a')).toMatchObject({ label: 'Alice Updated', metadata: { participant: { email: 'alice-new@example.test' } } });
    expect(preview.project.items.find(({ label }) => label === 'Cara').metadata.participant.email).toBe('cara@example.test');
    expect(current).toEqual(snapshot);

    const applied = applyWeddingShareEditPreview(current, preview);
    expect(applied).toEqual(preview.project);
    expect(applied).not.toBe(preview.project);
    expect(current).toEqual(snapshot);
  });

  it('deduplicates symmetric hard constraints and aggregates reciprocal directional soft votes', () => {
    const current = project();
    const workbook = createWeddingShareEditWorkbook(current);
    const rows = data(workbook).slice(8);
    rows[0][3] = 'Bob';
    rows[0][4] = 'Bob';
    rows[1][3] = 'Alice';
    rows[1][4] = 'Alice';
    replaceData(workbook, rows);

    const preview = parseWeddingShareEditWorkbook(workbook, current);

    expect(preview.canApply).toBe(true);
    expect(preview.project.constraints).toHaveLength(1);
    expect(preview.project.constraints[0]).toMatchObject({ kind: 'mustShareContainer', metadata: { source: 'wedding-share-edit' } });
    expect(preview.project.constraints[0].metadata.workbookDeclarations).toHaveLength(2);
    expect(preview.project.preferences).toHaveLength(1);
    expect(preview.project.preferences[0]).toMatchObject({ kind: 'preferShareContainer', weight: 2, metadata: { source: 'wedding-share-edit' } });
    expect(preview.project.preferences[0].metadata.directionalVotes).toEqual(expect.arrayContaining([
      { fromId: 'a', toId: 'b', weight: 1 },
      { fromId: 'b', toId: 'a', weight: 1 },
    ]));
  });

  it('replaces imported workbook votes while preserving manual preferences and declarations from omitted guests', () => {
    const current = project([
      ...project().items,
      createItem({ id: 'c', label: 'Cara' }),
    ]);
    current.preferences = [
      { kind: 'preferShareContainer', leftRef: { kind: 'item', id: 'a' }, rightRef: { kind: 'item', id: 'c' }, weight: 7, metadata: { authoredBy: 'user' } },
      { kind: 'preferSeparateContainers', leftRef: { kind: 'item', id: 'b' }, rightRef: { kind: 'item', id: 'c' }, weight: 1, metadata: { source: 'wedding-share-edit', directionalVotes: [{ fromId: 'c', toId: 'b', weight: 1 }] } },
    ];
    const workbook = createWeddingShareEditWorkbook(current);
    const aliceOnly = data(workbook)[8];
    aliceOnly[4] = 'Bob';
    replaceData(workbook, [aliceOnly]);

    const preview = parseWeddingShareEditWorkbook(workbook, current);

    expect(preview.canApply).toBe(true);
    expect(preview.project.preferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ weight: 7, metadata: { authoredBy: 'user' } }),
      expect.objectContaining({ kind: 'preferSeparateContainers', metadata: expect.objectContaining({ directionalVotes: [{ fromId: 'c', toId: 'b', weight: 1 }] }) }),
      expect.objectContaining({ kind: 'preferShareContainer', weight: 1, metadata: expect.objectContaining({ directionalVotes: [{ fromId: 'a', toId: 'b', weight: 1 }] }) }),
    ]));
  });

  it.each([
    ['duplicate IDs', (rows) => rows.push([...rows[0]])],
    ['duplicate keys', (rows) => rows.push(['new-id', 'Alice', 'Other', '', '', '', ''])],
    ['self relations', (rows) => { rows[0][3] = 'Alice'; }],
    ['contradictory hard columns', (rows) => { rows[0][3] = 'Bob'; rows[0][6] = 'Bob'; }],
    ['unknown targets', (rows) => { rows[0][4] = 'Nobody'; }],
  ])('blocks %s', (_name, change) => {
    const current = project();
    const workbook = createWeddingShareEditWorkbook(current);
    const rows = data(workbook).slice(8);
    change(rows);
    replaceData(workbook, rows);

    const preview = parseWeddingShareEditWorkbook(workbook, current);
    expect(preview.canApply).toBe(false);
    expect(preview.report.canApply).toBe(false);
    expect(preview.report.errors.length).toBeGreaterThan(0);
    expect(() => applyWeddingShareEditPreview(current, preview)).toThrow();
  });

  it('blocks ambiguous visible targets and previews files without mutation', async () => {
    const current = project([
      createItem({ id: 'a', label: 'Alex' }),
      createItem({ id: 'b', label: 'Alex' }),
      createItem({ id: 'c', label: 'Cara' }),
    ]);
    const snapshot = structuredClone(current);
    const exportable = project([
      createItem({ id: 'a', label: 'Alex One' }),
      createItem({ id: 'b', label: 'Alex Two' }),
      createItem({ id: 'c', label: 'Cara' }),
    ]);
    const workbook = createWeddingShareEditWorkbook(exportable);
    const rows = data(workbook).slice(8);
    rows[2][4] = 'Alex';
    replaceData(workbook, rows);

    const preview = await previewWeddingShareEditWorkbookFile(asFile(workbook), current);
    expect(preview.canApply).toBe(false);
    expect(preview.report.errors.length).toBeGreaterThan(0);
    expect(current).toEqual(snapshot);
  });
});
