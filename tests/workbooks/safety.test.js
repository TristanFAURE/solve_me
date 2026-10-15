import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  readWorkbookArrayBuffer,
  validateXlsxArrayBuffer,
  WorkbookSafetyError,
  WORKBOOK_LIMITS,
} from '../../src/workbooks/safety.js';

function xlsxBuffer() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name'], ['Ada']]), 'People');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
}

function zipEndOffset(buffer) {
  const view = new DataView(buffer);
  for (let offset = buffer.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === buffer.byteLength) return offset;
  }
  throw new Error('Test XLSX has no ZIP end record');
}

function centralOffset(buffer) {
  const view = new DataView(buffer);
  return view.getUint32(zipEndOffset(buffer) + 16, true);
}

describe('XLSX upload preflight', () => {
  it('accepts a bounded XLSX package before reading it', () => {
    const buffer = xlsxBuffer();
    expect(validateXlsxArrayBuffer(buffer)).toBe(buffer);
    expect(readWorkbookArrayBuffer(buffer).SheetNames).toEqual(['People']);
  });

  it('rejects malformed and non-XLSX input before SheetJS parsing', () => {
    expect(() => readWorkbookArrayBuffer(new TextEncoder().encode('not an xlsx').buffer)).toThrow(WorkbookSafetyError);

    const buffer = xlsxBuffer();
    const bytes = new Uint8Array(buffer);
    const workbookName = new TextEncoder().encode('xl/workbook.xml');
    for (let offset = 0; offset <= bytes.length - workbookName.length; offset += 1) {
      if (workbookName.every((byte, index) => bytes[offset + index] === byte)) {
        bytes[offset + 3] = 'n'.charCodeAt(0);
      }
    }
    expect(() => validateXlsxArrayBuffer(buffer)).toThrow(/not a valid XLSX/i);
  });

  it('rejects excessive ZIP entry counts, expansion, and compression ratios from central metadata', () => {
    const tooMany = xlsxBuffer();
    const tooManyView = new DataView(tooMany);
    const tooManyEnd = zipEndOffset(tooMany);
    tooManyView.setUint16(tooManyEnd + 8, WORKBOOK_LIMITS.maxZipEntries + 1, true);
    tooManyView.setUint16(tooManyEnd + 10, WORKBOOK_LIMITS.maxZipEntries + 1, true);
    expect(() => validateXlsxArrayBuffer(tooMany)).toThrow(/too many entries/i);

    const tooLarge = xlsxBuffer();
    new DataView(tooLarge).setUint32(centralOffset(tooLarge) + 24, WORKBOOK_LIMITS.maxUncompressedBytes + 1, true);
    expect(() => validateXlsxArrayBuffer(tooLarge)).toThrow(/expands beyond/i);

    const highRatio = xlsxBuffer();
    const highRatioView = new DataView(highRatio);
    const firstCentralEntry = centralOffset(highRatio);
    highRatioView.setUint32(firstCentralEntry + 20, 1, true);
    highRatioView.setUint32(firstCentralEntry + 24, WORKBOOK_LIMITS.maxCompressionRatio * highRatio.byteLength, true);
    expect(() => validateXlsxArrayBuffer(highRatio)).toThrow(/compression ratio/i);
  });

  it('enforces the 5 MB cap for direct buffers', () => {
    expect(() => validateXlsxArrayBuffer(new ArrayBuffer(WORKBOOK_LIMITS.maxUploadBytes + 1))).toThrow(/5 MB/i);
  });
});
