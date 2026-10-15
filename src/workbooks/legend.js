import * as XLSX from 'xlsx';
import { applyWorksheetLayout } from './layout.js';
import { neutralizeMatrix } from './safety.js';

export const SCHOOL_WORKBOOK_LEGEND = Object.freeze([
  ['Student', 'Participant assigned to a class and counted against student capacity.'],
  ['Teacher', 'Teacher matched to a class separately from student capacity.'],
  ['Must be with', 'Hard rule: both participants must be assigned to the same class.'],
  ['Prefer to be with', 'Soft directional preference for the same class.'],
  ['Prefer apart', 'Soft directional preference for different classes.'],
  ['Must be apart', 'Hard rule: participants must be assigned to different classes.'],
  ['blank', 'No value, restriction, or directional vote for that cell.'],
]);

export const WEDDING_WORKBOOK_LEGEND = Object.freeze([
  ['Must same table', 'Hard rule: guests must be assigned to the same table.'],
  ['Prefer same table', 'Soft directional preference for the same table.'],
  ['Prefer different table', 'Soft directional preference for different tables.'],
  ['Must different table', 'Hard rule: guests must be assigned to different tables.'],
  ['Seat-aware', 'Seat labels are authoritative assignments from the selected solution.'],
  ['Table-only', 'Displayed positions are illustrative; only the table assignment is authoritative.'],
  ['blank', 'No relationship vote or value for that cell.'],
]);

export const EVENT_STAFFING_WORKBOOK_LEGEND = Object.freeze([
  ['P', 'Prefer this staffing group in this date/slot.'],
  ['blank', 'Neutral. On stakeholder import, a represented blank cell resets that slot/group value to neutral.'],
  ['N', 'Prefer not to work this staffing group in this date/slot.'],
  ['U', 'Unavailable: hard prohibition for this staffing group in this date/slot.'],
  ['Group', 'Reusable administrator-owned staffing category.'],
  ['Person key', 'Configured visible identity used when the hidden stable person ID is blank.'],
]);

export function appendWorkbookLegend(workbook, title, entries) {
  const rows = [[title], ['Code or term', 'Meaning'], ...entries];
  const sheet = applyWorksheetLayout(XLSX.utils.aoa_to_sheet(neutralizeMatrix(rows)), [28, 100], { autoFilter: false });
  if (workbook.Sheets.Legend) workbook.Sheets.Legend = sheet;
  else XLSX.utils.book_append_sheet(workbook, sheet, 'Legend');
  return workbook;
}
