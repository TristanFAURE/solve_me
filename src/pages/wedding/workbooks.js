import * as XLSX from 'xlsx';
import { getContainedGroupIdsForItem } from '../../core/transform/domainMappings.js';
import { isProject, VIEW_HINTS } from '../../core/model/project.js';
import { validateProject } from '../../core/validate/validateProject.js';
import { migrateProjectModel } from '../../storage/modelVersioning.js';
import { appendConfigurationEnvelope, readConfigurationEnvelope } from '../../workbooks/configurationEnvelope.js';
import { applyWorksheetLayout } from '../../workbooks/layout.js';
import { neutralizeMatrix, neutralizeRows, readWorkbookFile, WorkbookSafetyError } from '../../workbooks/safety.js';
import { importWeddingWorkbookFromWorkbook } from './importWeddingWorkbook.js';
import { getSeatTableId } from './tableTopology.js';
import { validateWeddingProject } from './validateWeddingProject.js';

export const WEDDING_WORKBOOK_DOMAIN = 'wedding';

function safeFilename(value) {
  return String(value || 'wedding').trim().replaceAll(/[^a-z0-9-_]+/gi, '-').replaceAll(/^-+|-+$/g, '') || 'wedding';
}

function labelMap(entries) {
  return new Map((entries ?? []).map((entry) => [entry.id, entry.label]));
}

function weddingRuleLabel(kind) {
  return ({
    mustShareContainer: 'Must sit at the same table',
    mustNotShareContainer: 'Must not sit at the same table',
    mustBeAdjacent: 'Must sit next to each other',
    mustNotBeAdjacent: 'Must not sit next to each other',
    preferShareContainer: 'Prefer the same table',
    preferSeparateContainers: 'Prefer different tables',
    preferAdjacent: 'Prefer seats next to each other',
    preferNonAdjacent: 'Prefer not to sit next to each other',
  })[kind] ?? kind;
}

export function createWeddingConfigurationWorkbook(project, options = {}) {
  const guests = project.items ?? [];
  const groups = project.groups ?? [];
  const tables = project.containers ?? [];
  const seats = project.positions ?? [];
  const guestLabels = labelMap(guests);
  const groupLabels = labelMap(groups);
  const tableLabels = labelMap(tables);
  const seatLabels = labelMap(seats);
  const workbook = XLSX.utils.book_new();
  const appendRows = (name, rows, widths, headers) => XLSX.utils.book_append_sheet(workbook, applyWorksheetLayout(XLSX.utils.json_to_sheet(neutralizeRows(rows), { header: headers }), widths), name);
  XLSX.utils.book_append_sheet(workbook, applyWorksheetLayout(XLSX.utils.aoa_to_sheet(neutralizeMatrix([
    ['Wedding configuration workbook'],
    ['Readable sheets are convenient views and match the legacy workbook shape where possible. Edits to them do not change a full configuration import.'],
    ['Full replacement uses the reserved configuration envelope after preview and confirmation. Use the web interface for configuration edits.'],
    ['Legacy workbooks without a configuration envelope remain supported for spreadsheet data entry. Seats and Topology are advanced reference sheets.'],
  ])), [24, 110], { autoFilter: false }), 'Instructions');
  appendRows('Guests', guests.map((guest) => ({ Guest: guest.label, Groups: getContainedGroupIdsForItem(project, guest.id).map((id) => groupLabels.get(id) ?? id).join(', '), 'Guest ID': guest.id })), [28, 36, 20], ['Guest', 'Groups', 'Guest ID']);
  appendRows('Groups', groups.map((group) => ({ Group: group.label, 'Group ID': group.id })), [28, 20], ['Group', 'Group ID']);
  appendRows('Tables', tables.map((table) => ({ Table: table.label, 'Min capacity': table.metadata?.minCapacity ?? table.minCapacity ?? 0, 'Max capacity': table.metadata?.maxCapacity ?? table.maxCapacity ?? '', Shape: table.metadata?.shape ?? '', 'Generation mode': table.metadata?.generationMode ?? '', 'Table ID': table.id })), [28, 14, 14, 16, 20, 20], ['Table', 'Min capacity', 'Max capacity', 'Shape', 'Generation mode', 'Table ID']);
  appendRows('Rules', (project.constraints ?? []).map((entry) => ({ 'First guest or group': guestLabels.get(entry.leftRef?.id) ?? groupLabels.get(entry.leftRef?.id) ?? entry.leftRef?.id ?? '', Rule: weddingRuleLabel(entry.kind), 'Second guest or group': guestLabels.get(entry.rightRef?.id) ?? groupLabels.get(entry.rightRef?.id) ?? entry.rightRef?.id ?? '' })), [32, 38, 32], ['First guest or group', 'Rule', 'Second guest or group']);
  appendRows('Preferences', (project.preferences ?? []).map((entry) => ({ 'First guest or group': guestLabels.get(entry.leftRef?.id) ?? groupLabels.get(entry.leftRef?.id) ?? entry.leftRef?.id ?? '', Preference: weddingRuleLabel(entry.kind), 'Second guest or group': guestLabels.get(entry.rightRef?.id) ?? groupLabels.get(entry.rightRef?.id) ?? entry.rightRef?.id ?? '', Weight: entry.weight ?? '' })), [32, 38, 32, 12], ['First guest or group', 'Preference', 'Second guest or group', 'Weight']);
  appendRows('Seats', seats.map((seat) => ({ Seat: seat.label, Table: tableLabels.get(getSeatTableId(project, seat.id)) ?? getSeatTableId(project, seat.id) ?? '', Index: seat.metadata?.seatIndex ?? '', Generated: seat.metadata?.generated ?? false, 'Seat ID': seat.id })), [28, 28, 12, 12, 20], ['Seat', 'Table', 'Index', 'Generated', 'Seat ID']);
  appendRows('Topology', (project.topologies ?? []).map((entry) => ({ 'First seat': seatLabels.get(entry.from?.id) ?? entry.from?.id ?? '', 'Second seat': seatLabels.get(entry.to?.id) ?? entry.to?.id ?? '', Relation: entry.kind ?? '' })), [28, 28, 20], ['First seat', 'Second seat', 'Relation']);
  return appendConfigurationEnvelope(workbook, WEDDING_WORKBOOK_DOMAIN, project, options);
}

export function exportWeddingConfigurationWorkbook(project) {
  XLSX.writeFile(createWeddingConfigurationWorkbook(project), `${safeFilename(project?.title)}-configuration.xlsx`);
}

function validateFullProject(project) {
  if (!isProject(project) || project.viewHint !== VIEW_HINTS.WEDDING) throw new WorkbookSafetyError('The workbook does not contain a valid wedding project.');
  const domainValidation = validateWeddingProject(project);
  const genericValidation = validateProject(project);
  if (!domainValidation.valid || !genericValidation.valid) throw new WorkbookSafetyError('The imported wedding configuration has validation errors.');
  return { domainValidation, genericValidation };
}

export async function previewWeddingWorkbookFile(file) {
  const workbook = await readWorkbookFile(file);
  const envelope = readConfigurationEnvelope(workbook, WEDDING_WORKBOOK_DOMAIN);
  if (envelope) {
    const project = migrateProjectModel(envelope.configuration);
    return { source: 'configuration', project, validation: validateFullProject(project) };
  }
  return { source: 'legacy', project: importWeddingWorkbookFromWorkbook(workbook, file.name), validation: null };
}
