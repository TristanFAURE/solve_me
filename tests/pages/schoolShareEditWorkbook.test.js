import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { createContainer, createGroup, createItem } from '../../src/core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../src/core/model/project.js';
import { createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import {
  applySchoolShareEditPreview,
  createSchoolShareEditWorkbook,
  parseSchoolShareEditWorkbook,
  previewSchoolShareEditWorkbookFile,
  SCHOOL_SHARE_EDIT_COLUMNS,
} from '../../src/pages/school/shareEditWorkbook.js';

function projectWith(count = 2) {
  const project = createEmptyProject({ title: 'School', viewHint: VIEW_HINTS.SCHOOL });
  project.items = Array.from({ length: count }, (_, index) => createItem({
    id: `student-${index + 1}`,
    label: `Student ${index + 1}`,
    metadata: { schoolRole: 'student', participant: { email: `student${index + 1}@example.test`, externalKey: `S-${index + 1}` } },
  }));
  project.items.push(createItem({ id: 'teacher-1', label: 'Teacher 1', metadata: { schoolRole: 'teacher', participant: { email: 'teacher1@example.test', externalKey: 'T-1' } } }));
  project.groups = [createGroup({ id: 'level-1', label: 'Level 1' })];
  project.containers = [
    createContainer({ id: 'class-1', label: 'Class 1' }),
    createContainer({ id: 'class-2', label: 'Class 2' }),
  ];
  project.containments = project.items.map((item) => createContainmentRelation(createEntityRef('group', 'level-1'), createEntityRef('item', item.id)));
  project.constraints = [{ kind: 'mustShareContainer', leftRef: createEntityRef('item', 'student-1'), rightRef: createEntityRef('item', 'student-2'), metadata: {} }];
  project.preferences = [{
    kind: 'preferShareContainer', leftRef: createEntityRef('item', 'student-1'), rightRef: createEntityRef('item', 'student-2'), weight: 1,
    metadata: { directionalVotes: [{ fromId: 'student-1', toId: 'student-2', weight: 1 }] },
  }];
  return project;
}

function asFile(workbook, name = 'school-share-edit.xlsx') {
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return { name, size: bytes.byteLength, async arrayBuffer() { return bytes; } };
}

function matrix(workbook) {
  return XLSX.utils.sheet_to_json(workbook.Sheets['Share & Edit'], { header: 1, defval: '', raw: false });
}

function replaceMatrix(workbook, values) {
  workbook.Sheets['Share & Edit'] = XLSX.utils.aoa_to_sheet(values);
}

describe('School Share & Edit workbook', () => {
  it('exports more than 200 participants and round-trips relationships', async () => {
    const project = projectWith(205);
    const workbook = createSchoolShareEditWorkbook(project, { language: 'fr', identityType: 'email', revision: 'r1' });
    expect(workbook.SheetNames).toEqual(['Share & Edit', '_ShareEdit', 'Legend']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Legend, { header: 1 })[2]).toEqual(['Student', expect.stringContaining('class')]);
    expect(matrix(workbook)).toHaveLength(214);
    expect(workbook.Sheets['Share & Edit']['!freeze']).toMatchObject({ ySplit: 8 });
    expect(workbook.Sheets['Share & Edit']['!autofilter']).toBeTruthy();
    expect(workbook.Sheets['Share & Edit']['!dataValidation']).toHaveLength(1);

    const preview = await previewSchoolShareEditWorkbookFile(asFile(workbook), project);
    expect(preview.canApply).toBe(true);
    expect(preview.report.counts.rows).toBe(206);
    expect(preview.project.constraints).toHaveLength(1);
    expect(preview.project.preferences[0].metadata.directionalVotes).toHaveLength(1);
  });

  it('matches by stable ID across a rename and creates participants and levels', () => {
    const project = projectWith();
    const workbook = createSchoolShareEditWorkbook(project, { revision: 'r1' });
    const values = matrix(workbook);
    values[8][2] = 'Renamed Student';
    values.push(['', 'New Student', 'New Student', 'Student', 'New Level', '', '', 'Student 1', '', '', '']);
    replaceMatrix(workbook, values);

    const preview = parseSchoolShareEditWorkbook(workbook, project);
    expect(preview.canApply).toBe(true);
    expect(preview.project.items.find((item) => item.id === 'student-1').label).toBe('Renamed Student');
    expect(preview.report.counts.created).toBe(1);
    expect(preview.report.counts.levelsCreated).toBe(1);
    const applied = applySchoolShareEditPreview(project, preview);
    expect(applied).not.toBe(preview.project);
    expect(project.items).toHaveLength(3);
    expect(applied.items).toHaveLength(4);
  });

  it('imports fixed classes, exclusions, symmetric hard rules, and directional votes', () => {
    const project = projectWith();
    const workbook = createSchoolShareEditWorkbook(project, { revision: 'r1' });
    const values = matrix(workbook);
    values[8][5] = 'Class 1';
    values[8][6] = 'Class 2';
    values[8][7] = 'Student 2';
    values[8][8] = 'Student 2';
    values[9][7] = 'Student 1';
    values[9][8] = 'Student 1';
    replaceMatrix(workbook, values);

    const preview = parseSchoolShareEditWorkbook(workbook, project);
    expect(preview.canApply).toBe(true);
    expect(preview.project.fixedAssignments).toContainEqual({ itemId: 'student-1', destinationId: 'class-1' });
    expect(preview.project.items[0].metadata.forbiddenContainerIds).toEqual(['class-2']);
    expect(preview.project.constraints).toHaveLength(1);
    expect(preview.project.preferences[0]).toMatchObject({ weight: 2 });
    expect(preview.project.preferences[0].metadata.directionalVotes).toHaveLength(2);
  });

  it('blocks duplicate identities, conflicts, unknown targets, and self relationships atomically', () => {
    const project = projectWith();
    const snapshot = structuredClone(project);
    const workbook = createSchoolShareEditWorkbook(project, { revision: 'r1' });
    const values = matrix(workbook);
    values[9][0] = 'student-1';
    values[8][7] = 'Student 1; Missing Person; Student 2';
    values[8][10] = 'Student 2';
    replaceMatrix(workbook, values);

    const preview = parseSchoolShareEditWorkbook(workbook, project);
    expect(preview.canApply).toBe(false);
    expect(preview.report.errors.join(' ')).toMatch(/duplicated|same participant|unknown|both must-share/i);
    expect(() => applySchoolShareEditPreview(project, preview)).toThrow();
    expect(project).toEqual(snapshot);
  });

  it('neutralizes formulas and leaves active data unchanged when import is cancelled', () => {
    const project = projectWith();
    project.items[0].label = '=2+2';
    const snapshot = structuredClone(project);
    const workbook = createSchoolShareEditWorkbook(project, { revision: 'r1' });
    expect(workbook.Sheets['Share & Edit'].C9.v).toBe("'=2+2");
    const preview = parseSchoolShareEditWorkbook(workbook, project);
    expect(preview.canApply).toBe(true);
    expect(project).toEqual(snapshot);
  });

  it('keeps the required canonical column contract', () => {
    expect(SCHOOL_SHARE_EDIT_COLUMNS).toEqual([
      'internalId', 'personKey', 'displayName', 'role', 'levels', 'fixedClass', 'excludedClasses',
      'mustShare', 'preferShare', 'preferSeparate', 'mustSeparate',
    ]);
  });

  it('blocks applying a stale preview after the active project changes', () => {
    const project = projectWith();
    const preview = parseSchoolShareEditWorkbook(createSchoolShareEditWorkbook(project), project);
    project.title = 'Changed after preview';
    expect(() => applySchoolShareEditPreview(project, preview)).toThrow(/changed after preview/i);
  });
});
