export function applyWorksheetLayout(sheet, widths, options = {}) {
  sheet['!cols'] = widths.map((width) => ({ wch: width }));
  if (options.autoFilter !== false && sheet['!ref']) {
    sheet['!autofilter'] = { ref: sheet['!ref'] };
  }
  return sheet;
}

export function hideReservedWorksheets(workbook, reservedNames = ['_Configuration']) {
  const reserved = new Set(reservedNames.map((name) => name.toLowerCase()));
  const existing = new Map((workbook.Workbook?.Sheets ?? []).map((entry) => [entry.name, entry]));
  workbook.Workbook = workbook.Workbook ?? {};
  workbook.Workbook.Sheets = workbook.SheetNames.map((name) => ({
    ...(existing.get(name) ?? {}),
    name,
    Hidden: reserved.has(name.toLowerCase()) ? 1 : (existing.get(name)?.Hidden ?? 0),
  }));
  return workbook;
}
