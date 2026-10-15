import * as XLSX from 'xlsx';

export const WORKBOOK_LIMITS = Object.freeze({
  maxUploadBytes: 5 * 1024 * 1024,
  maxZipEntries: 1_000,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxSheets: 20,
  maxRowsPerSheet: 10_000,
  maxColumnsPerSheet: 500,
  maxCellTextLength: 10_000,
});

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REQUIRED_XLSX_ENTRIES = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml'];
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

export class WorkbookSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkbookSafetyError';
  }
}

export function neutralizeFormulaValue(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function sanitizeWorkbookValue(value) {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value ?? '';
  const text = String(value);
  if (text.length > WORKBOOK_LIMITS.maxCellTextLength) {
    throw new WorkbookSafetyError('A workbook cell exceeds the allowed text length.');
  }
  return text;
}

export function sanitizePlainRecord(record) {
  const clean = Object.create(null);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new WorkbookSafetyError('The workbook contains malformed row data.');
  }
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WorkbookSafetyError('The workbook contains unsafe row data.');
  }
  for (const [key, value] of Object.entries(record)) {
    if (DANGEROUS_KEYS.has(key)) throw new WorkbookSafetyError('The workbook contains an unsafe column name.');
    clean[sanitizeWorkbookValue(key)] = sanitizeWorkbookValue(value);
  }
  return clean;
}

export function assertWorkbookFileSize(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new WorkbookSafetyError('Choose a valid Excel workbook.');
  if (Number.isFinite(file.size) && file.size > WORKBOOK_LIMITS.maxUploadBytes) {
    throw new WorkbookSafetyError('The workbook is larger than the 5 MB upload limit.');
  }
}

function findZipEnd(view) {
  const firstPossibleOffset = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= firstPossibleOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new WorkbookSafetyError('The file is not a valid XLSX ZIP package.');
}

export function validateXlsxArrayBuffer(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) throw new WorkbookSafetyError('Choose a valid Excel workbook.');
  if (arrayBuffer.byteLength === 0) throw new WorkbookSafetyError('The Excel workbook is empty.');
  if (arrayBuffer.byteLength > WORKBOOK_LIMITS.maxUploadBytes) {
    throw new WorkbookSafetyError('The workbook is larger than the 5 MB upload limit.');
  }

  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const zipEnd = findZipEnd(view);
  const diskNumber = view.getUint16(zipEnd + 4, true);
  const centralDisk = view.getUint16(zipEnd + 6, true);
  const entriesOnDisk = view.getUint16(zipEnd + 8, true);
  const entryCount = view.getUint16(zipEnd + 10, true);
  const centralSize = view.getUint32(zipEnd + 12, true);
  const centralOffset = view.getUint32(zipEnd + 16, true);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new WorkbookSafetyError('Multi-part XLSX ZIP packages are not supported.');
  }
  if (entryCount === 0 || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new WorkbookSafetyError('The XLSX ZIP package has unsupported metadata.');
  }
  if (entryCount > WORKBOOK_LIMITS.maxZipEntries) {
    throw new WorkbookSafetyError('The XLSX ZIP package contains too many entries.');
  }
  if (centralOffset + centralSize > zipEnd) throw new WorkbookSafetyError('The XLSX ZIP directory is malformed.');

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const names = new Set();
  let offset = centralOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralOffset + centralSize || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new WorkbookSafetyError('The XLSX ZIP directory is malformed.');
    }
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const startDisk = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > centralOffset + centralSize || startDisk !== 0 || localOffset === 0xffffffff
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || (flags & 1) !== 0
      || (compressionMethod !== 0 && compressionMethod !== 8)) {
      throw new WorkbookSafetyError('The XLSX ZIP entry metadata is unsupported or malformed.');
    }

    let name;
    try {
      name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw new WorkbookSafetyError('The XLSX ZIP package contains an invalid entry name.');
    }
    if (!name || names.has(name)) throw new WorkbookSafetyError('The XLSX ZIP package contains duplicate or invalid entries.');
    names.add(name);

    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
      throw new WorkbookSafetyError('The XLSX ZIP package contains an invalid local entry.');
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    let localName;
    try {
      localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    } catch {
      throw new WorkbookSafetyError('The XLSX ZIP package contains an invalid local entry name.');
    }
    if (localFlags !== flags || localMethod !== compressionMethod || localName !== name || dataOffset + compressedSize > centralOffset) {
      throw new WorkbookSafetyError('The XLSX ZIP local entry metadata does not match its directory.');
    }

    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > WORKBOOK_LIMITS.maxUncompressedBytes) {
      throw new WorkbookSafetyError('The XLSX ZIP package expands beyond the allowed size.');
    }
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) throw new WorkbookSafetyError('The XLSX ZIP directory size is invalid.');
  if (totalUncompressedBytes / Math.max(totalCompressedBytes, 1) > WORKBOOK_LIMITS.maxCompressionRatio) {
    throw new WorkbookSafetyError('The XLSX ZIP package has an unsafe compression ratio.');
  }
  if (!REQUIRED_XLSX_ENTRIES.every((name) => names.has(name))) {
    throw new WorkbookSafetyError('The ZIP package is not a valid XLSX workbook.');
  }
  return arrayBuffer;
}

export function validateWorkbookBounds(workbook) {
  if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.Sheets) throw new WorkbookSafetyError('The Excel workbook is malformed.');
  if (workbook.SheetNames.length > WORKBOOK_LIMITS.maxSheets) throw new WorkbookSafetyError('The workbook contains more than 20 sheets.');
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    if (!range) return;
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    if (rows > WORKBOOK_LIMITS.maxRowsPerSheet) throw new WorkbookSafetyError(`Sheet "${sheetName}" exceeds the 10000 row limit.`);
    if (columns > WORKBOOK_LIMITS.maxColumnsPerSheet) throw new WorkbookSafetyError(`Sheet "${sheetName}" exceeds the 500 column limit.`);
    Object.keys(sheet).filter((key) => !key.startsWith('!')).forEach((key) => sanitizeWorkbookValue(sheet[key]?.v));
  });
  return workbook;
}

export function readWorkbookArrayBuffer(arrayBuffer) {
  try {
    validateXlsxArrayBuffer(arrayBuffer);
    return validateWorkbookBounds(XLSX.read(arrayBuffer, { type: 'array', cellFormula: false, cellHTML: false, cellNF: false, cellStyles: false }));
  } catch (error) {
    if (error instanceof WorkbookSafetyError) throw error;
    throw new WorkbookSafetyError('The Excel workbook could not be read. Check that it is a valid .xlsx file.');
  }
}

export async function readWorkbookFile(file) {
  assertWorkbookFileSize(file);
  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > WORKBOOK_LIMITS.maxUploadBytes) throw new WorkbookSafetyError('The workbook is larger than the 5 MB upload limit.');
  return readWorkbookArrayBuffer(arrayBuffer);
}

export function sheetToSafeRows(sheet, options = {}) {
  const range = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  if (range && range.e.r - range.s.r + 1 > WORKBOOK_LIMITS.maxRowsPerSheet) throw new WorkbookSafetyError('A workbook sheet exceeds the 10000 row limit.');
  if (range && range.e.c - range.s.c + 1 > WORKBOOK_LIMITS.maxColumnsPerSheet) throw new WorkbookSafetyError('A workbook sheet exceeds the 500 column limit.');
  const headerRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, range: 0 });
  (headerRows[0] ?? []).forEach((header) => {
    const key = sanitizeWorkbookValue(header);
    if (DANGEROUS_KEYS.has(key)) throw new WorkbookSafetyError('The workbook contains an unsafe column name.');
  });
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, ...options });
  if (rows.length > WORKBOOK_LIMITS.maxRowsPerSheet) throw new WorkbookSafetyError('A workbook sheet exceeds the 10000 row limit.');
  return rows.map(sanitizePlainRecord);
}

export function neutralizeRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [neutralizeFormulaValue(key), neutralizeFormulaValue(value)])));
}

export function neutralizeMatrix(rows) {
  return rows.map((row) => row.map(neutralizeFormulaValue));
}
