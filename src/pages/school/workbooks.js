import * as XLSX from 'xlsx';
import { buildSchoolParticipantIndex, getContainedGroupIdsForItem, getContainerAcceptedLevelIds, getContainerTeacherIds } from '../../core/transform/domainMappings.js';
import { isProject, VIEW_HINTS } from '../../core/model/project.js';
import { validateProject } from '../../core/validate/validateProject.js';
import { migrateProjectModel } from '../../storage/modelVersioning.js';
import { appendConfigurationEnvelope, readConfigurationEnvelope } from '../../workbooks/configurationEnvelope.js';
import { applyWorksheetLayout } from '../../workbooks/layout.js';
import { neutralizeMatrix, neutralizeRows, readWorkbookFile, WorkbookSafetyError } from '../../workbooks/safety.js';
import { importSchoolWorkbookFromWorkbook } from './importSchoolWorkbook.js';
import { validateSchoolProject } from './validateSchoolProject.js';

export const SCHOOL_WORKBOOK_DOMAIN = 'school';

function safeFilename(value) {
  return String(value || 'school').trim().replaceAll(/[^a-z0-9-_]+/gi, '-').replaceAll(/^-+|-+$/g, '') || 'school';
}

function labels(ids, entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry.label]));
  return ids.map((id) => byId.get(id) ?? id).join(', ');
}

function schoolRuleLabel(kind) {
  return ({
    mustShareContainer: 'Must be in the same class',
    mustNotShareContainer: 'Must not be in the same class',
    preferShareContainer: 'Prefer to be in the same class',
    preferSeparateContainers: 'Prefer to be in different classes',
  })[kind] ?? kind;
}

export function createSchoolConfigurationWorkbook(project, options = {}) {
  const { students, teachers } = buildSchoolParticipantIndex(project);
  const levels = project.groups ?? [];
  const classes = project.containers ?? [];
  const participants = [...students, ...teachers];
  const participantById = new Map(participants.map((entry) => [entry.id, entry.label]));
  const workbook = XLSX.utils.book_new();
  const appendRows = (name, rows, widths, headers) => XLSX.utils.book_append_sheet(workbook, applyWorksheetLayout(XLSX.utils.json_to_sheet(neutralizeRows(rows), { header: headers }), widths), name);
  XLSX.utils.book_append_sheet(workbook, applyWorksheetLayout(XLSX.utils.aoa_to_sheet(neutralizeMatrix([
    ['School configuration workbook'],
    ['Readable sheets are convenient views and match the legacy workbook shape where possible. Edits to them do not change a full configuration import.'],
    ['Full replacement uses the reserved configuration envelope after preview and confirmation. Use the web interface for configuration edits.'],
    ['Legacy workbooks without a configuration envelope remain supported for spreadsheet data entry.'],
  ])), [24, 110], { autoFilter: false }), 'Instructions');
  appendRows('Students', students.map((student) => ({ Student: student.label, Levels: labels(getContainedGroupIdsForItem(project, student.id), levels), 'Student ID': student.id })), [28, 32, 20], ['Student', 'Levels', 'Student ID']);
  appendRows('Teachers', teachers.map((teacher) => ({ Teacher: teacher.label, Levels: labels(getContainedGroupIdsForItem(project, teacher.id), levels), 'Teacher ID': teacher.id })), [28, 32, 20], ['Teacher', 'Levels', 'Teacher ID']);
  appendRows('Levels', levels.map((level) => ({ Level: level.label, 'Level ID': level.id })), [28, 20], ['Level', 'Level ID']);
  appendRows('Classes', classes.map((entry) => ({ Class: entry.label, Teachers: labels(getContainerTeacherIds(entry), teachers), 'Accepted levels': labels(getContainerAcceptedLevelIds(entry), levels), 'Min capacity': entry.metadata?.minCapacity ?? entry.minCapacity ?? 0, 'Max capacity': entry.metadata?.maxCapacity ?? entry.maxCapacity ?? '', 'Class ID': entry.id })), [28, 32, 32, 14, 14, 20], ['Class', 'Teachers', 'Accepted levels', 'Min capacity', 'Max capacity', 'Class ID']);
  appendRows('Rules', (project.constraints ?? []).map((entry) => ({ 'First participant': participantById.get(entry.leftRef?.id) ?? entry.leftRef?.id ?? '', Rule: schoolRuleLabel(entry.kind), 'Second participant': participantById.get(entry.rightRef?.id) ?? entry.rightRef?.id ?? '' })), [30, 36, 30], ['First participant', 'Rule', 'Second participant']);
  appendRows('Preferences', (project.preferences ?? []).map((entry) => ({ 'First participant': participantById.get(entry.leftRef?.id) ?? entry.leftRef?.id ?? '', Preference: schoolRuleLabel(entry.kind), 'Second participant': participantById.get(entry.rightRef?.id) ?? entry.rightRef?.id ?? '', Weight: entry.weight ?? '' })), [30, 36, 30, 12], ['First participant', 'Preference', 'Second participant', 'Weight']);
  return appendConfigurationEnvelope(workbook, SCHOOL_WORKBOOK_DOMAIN, project, options);
}

export function exportSchoolConfigurationWorkbook(project) {
  XLSX.writeFile(createSchoolConfigurationWorkbook(project), `${safeFilename(project?.title)}-configuration.xlsx`);
}

function validateFullProject(project) {
  if (!isProject(project) || project.viewHint !== VIEW_HINTS.SCHOOL) throw new WorkbookSafetyError('The workbook does not contain a valid school project.');
  const domainValidation = validateSchoolProject(project);
  const genericValidation = validateProject(project);
  if (!domainValidation.valid || !genericValidation.valid) throw new WorkbookSafetyError('The imported school configuration has validation errors.');
  return { domainValidation, genericValidation };
}

export async function previewSchoolWorkbookFile(file) {
  const workbook = await readWorkbookFile(file);
  const envelope = readConfigurationEnvelope(workbook, SCHOOL_WORKBOOK_DOMAIN);
  if (envelope) {
    const project = migrateProjectModel(envelope.configuration);
    return { source: 'configuration', project, validation: validateFullProject(project) };
  }
  return { source: 'legacy', project: importSchoolWorkbookFromWorkbook(workbook, file.name), validation: null };
}
