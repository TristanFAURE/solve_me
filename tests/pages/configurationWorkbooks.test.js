import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_MODES } from '../../src/core/model/assignmentModes.js';
import { createContainer, createGroup, createItem, createPosition } from '../../src/core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../src/core/model/project.js';
import { createAdjacencyRelation, createContainmentRelation, createEntityRef } from '../../src/core/model/relations.js';
import { createEventStaffingConfigurationWorkbook, previewEventStaffingWorkbookFile } from '../../src/pages/eventStaffing/workbooks.js';
import { createSchoolConfigurationWorkbook, previewSchoolWorkbookFile } from '../../src/pages/school/workbooks.js';
import { createWeddingConfigurationWorkbook, previewWeddingWorkbookFile } from '../../src/pages/wedding/workbooks.js';
import { readConfigurationEnvelope } from '../../src/workbooks/configurationEnvelope.js';

function asFile(workbook, name) {
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return { name, size: bytes.byteLength, async arrayBuffer() { return bytes; } };
}

function schoolProject() {
  const project = createEmptyProject({ title: '=School', viewHint: VIEW_HINTS.SCHOOL });
  project.items = [createItem({ id: 'student-1', label: '=Alice', metadata: { schoolRole: 'student' } }), createItem({ id: 'teacher-1', label: 'Teacher', metadata: { schoolRole: 'teacher' } })];
  project.groups = [createGroup({ id: 'level-1', label: 'Level 1' })];
  project.containers = [createContainer({ id: 'class-1', label: 'Class 1', maxCapacity: 2, metadata: { acceptedLevelIds: ['level-1'], teacherIds: ['teacher-1'] } })];
  project.containments = [createContainmentRelation(createEntityRef('group', 'level-1'), createEntityRef('item', 'student-1'))];
  project.constraints = [{ kind: 'mustShareContainer', leftRef: createEntityRef('item', 'teacher-1'), rightRef: createEntityRef('item', 'student-1'), metadata: {} }];
  return project;
}

function weddingProject() {
  const project = createEmptyProject({ title: '+Wedding', viewHint: VIEW_HINTS.WEDDING, assignmentMode: ASSIGNMENT_MODES.POSITION });
  project.items = [createItem({ id: 'guest-1', label: '@Alex' })];
  project.groups = [createGroup({ id: 'group-1', label: 'Family' })];
  project.containers = [createContainer({ id: 'table-1', label: 'Table 1', maxCapacity: 1, metadata: { shape: 'round', generationMode: 'manual-adjusted' } })];
  project.positions = [createPosition({ id: 'seat-1', label: 'Seat 1', metadata: { seatIndex: 0, generated: true } })];
  project.containments = [createContainmentRelation(createEntityRef('group', 'group-1'), createEntityRef('item', 'guest-1')), createContainmentRelation(createEntityRef('container', 'table-1'), createEntityRef('position', 'seat-1'))];
  project.topologies = [];
  project.preferences = [{ kind: 'preferShareContainer', leftRef: createEntityRef('item', 'guest-1'), rightRef: createEntityRef('group', 'group-1'), weight: 2, metadata: {} }];
  return project;
}

function staffingProject() {
  return {
    title: '=Staffing', modelVersion: 2,
    events: [{ id: 'slot-1', label: 'Morning', slotLabel: 'Morning', date: '2026-10-14', dateKey: '2026-10-14', orderIndex: 0 }],
    groupTypes: [{ id: 'category-1', label: '+Welcome' }],
    requirements: [{ eventId: 'slot-1', slotId: 'slot-1', groupTypeId: 'category-1', min: 1, max: 1 }],
    people: [{ id: 'person-1', name: '@Alex', email: 'alex@example.test', maxAssignments: 1, targetAssignments: 1, maxAssignmentsPerGroupType: { 'category-1': 1 }, targetAssignmentsPerGroupType: {}, allowedGroupTypeIds: [], forbiddenGroupTypeIds: [] }],
    preferences: [{ personId: 'person-1', slotPreferences: { 'slot-1': 'prefer' } }],
    cooldownRules: [], forcedAssignments: [], forbiddenAssignments: [], globalLimits: { maxAssignmentsPerPerson: 1 },
  };
}

describe('specialized configuration workbooks', () => {
  it('round-trips School rules and neutralizes readable formulas', async () => {
    const project = schoolProject();
    const workbook = createSchoolConfigurationWorkbook(project);
    expect(workbook.Sheets.Students.A2.v).toBe("'=Alice");
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Students, { header: 1 })[0]).toEqual(['Student', 'Levels', 'Student ID']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Rules, { header: 1 })[0]).toEqual(['First participant', 'Rule', 'Second participant']);
    expect(workbook.Sheets.Students['!autofilter'].ref).toBe(workbook.Sheets.Students['!ref']);
    expect(readConfigurationEnvelope(workbook, 'school').configuration).toEqual(project);
    expect((await previewSchoolWorkbookFile(asFile(workbook, 'school.xlsx'))).project.constraints).toEqual(project.constraints);
  });

  it('round-trips Wedding positions and topology metadata', async () => {
    const project = weddingProject();
    const workbook = createWeddingConfigurationWorkbook(project);
    expect(workbook.Sheets.Guests.A2.v).toBe("'@Alex");
    expect(workbook.SheetNames.indexOf('Seats')).toBeGreaterThan(workbook.SheetNames.indexOf('Rules'));
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Guests, { header: 1 })[0]).toEqual(['Guest', 'Groups', 'Guest ID']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Rules, { header: 1 })[0]).toEqual(['First guest or group', 'Rule', 'Second guest or group']);
    const preview = await previewWeddingWorkbookFile(asFile(workbook, 'wedding.xlsx'));
    expect(preview.project.positions).toEqual(project.positions);
    expect(preview.project.containments).toEqual(project.containments);
    expect(preview.project.preferences).toEqual(project.preferences);
  });

  it('round-trips complete Event Staffing configuration and retains preference-only compatibility', async () => {
    const project = staffingProject();
    const workbook = createEventStaffingConfigurationWorkbook(project);
    expect(workbook.SheetNames.slice(0, 2)).toEqual(['Instructions', 'Preferences']);
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(['Slots', 'Categories', 'Requirements', 'People', 'Preferences', 'Cooldowns', 'Forced assignments', 'Forbidden assignments', 'Limits', '_Configuration']));
    expect(workbook.Workbook.Sheets.find((sheet) => sheet.name === '_Configuration').Hidden).toBe(1);
    expect(workbook.Sheets.Categories.B2.v).toBe("'+Welcome");
    const fullPreview = await previewEventStaffingWorkbookFile(asFile(workbook, 'staffing.xlsx'), project);
    expect(fullPreview.kind).toBe('configuration');
    expect(fullPreview.project).toEqual(readConfigurationEnvelope(workbook, 'event-staffing').configuration);

    const preferencesSheet = workbook.Sheets.Preferences;
    delete workbook.Sheets.Preferences;
    workbook.SheetNames = workbook.SheetNames.filter((name) => name !== 'Preferences');
    const fullWithoutPreferences = await previewEventStaffingWorkbookFile(asFile(workbook, 'staffing-full-only.xlsx'), project);
    expect(fullWithoutPreferences.kind).toBe('configuration');
    expect(fullWithoutPreferences.canApply).toBe(false);
    workbook.Sheets.Preferences = preferencesSheet;
    workbook.SheetNames.splice(1, 0, 'Preferences');

    delete workbook.Sheets._Configuration;
    workbook.SheetNames = workbook.SheetNames.filter((name) => name !== '_Configuration');
    const preferencePreview = await previewEventStaffingWorkbookFile(asFile(workbook, 'preferences.xlsx'), project);
    expect(preferencePreview.kind).toBe('preferences');
    expect(preferencePreview.canApply).toBe(true);
  });

  it('does not mutate active data while previewing an invalid workbook', async () => {
    const active = schoolProject();
    const snapshot = structuredClone(active);
    const workbook = createSchoolConfigurationWorkbook(active);
    workbook.Sheets._Configuration.D7.v = '{bad';
    await expect(previewSchoolWorkbookFile(asFile(workbook, 'invalid.xlsx'))).rejects.toThrow();
    expect(active).toEqual(snapshot);
  });
});
