import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  CONFIGURATION_ENVELOPE_LIMITS,
  appendConfigurationEnvelope,
  encodeConfigurationEnvelope,
  readConfigurationEnvelope,
} from '../../src/workbooks/configurationEnvelope.js';
import { WorkbookSafetyError } from '../../src/workbooks/safety.js';

function workbookWith(domain, configuration) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Readable']]), 'Instructions');
  return appendConfigurationEnvelope(workbook, domain, configuration);
}

describe('configuration workbook envelope', () => {
  it('round-trips canonical JSON deterministically in bounded chunks', () => {
    const configuration = { z: 'x'.repeat(17_000), a: [{ value: 1 }, true] };
    expect(encodeConfigurationEnvelope('school', configuration)).toEqual(encodeConfigurationEnvelope('school', configuration));
    const workbook = workbookWith('school', configuration);
    const chunkRows = XLSX.utils.sheet_to_json(workbook.Sheets._Configuration, { header: 1 }).filter((row) => row[0] === 'Chunk' && row[1] !== 'Sequence');
    expect(chunkRows.every((row) => row[3].length <= 8_000)).toBe(true);
    expect(readConfigurationEnvelope(workbook, 'school').configuration).toEqual(configuration);
  });

  it('rejects wrong domains and unsupported versions', () => {
    const workbook = workbookWith('school', { value: 1 });
    expect(() => readConfigurationEnvelope(workbook, 'wedding')).toThrow(WorkbookSafetyError);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets._Configuration, { header: 1, defval: '' });
    rows.find((row) => row[0] === 'Schema version')[1] = '99';
    workbook.Sheets._Configuration = XLSX.utils.aoa_to_sheet(rows);
    expect(() => readConfigurationEnvelope(workbook, 'school')).toThrow(/schema version/i);
  });

  it('rejects missing, duplicate, and out-of-order chunks', () => {
    const baseRows = encodeConfigurationEnvelope('school', { value: 'x'.repeat(9_000) });
    const chunkStart = baseRows.findIndex((row) => row[0] === 'Chunk' && row[1] === 'Sequence') + 1;
    for (const rows of [
      baseRows.filter((_, index) => index !== chunkStart),
      [...baseRows, [...baseRows[chunkStart]]],
      [...baseRows.slice(0, chunkStart), baseRows[chunkStart + 1], baseRows[chunkStart]],
    ]) {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '_Configuration');
      expect(() => readConfigurationEnvelope(workbook, 'school')).toThrow(WorkbookSafetyError);
    }
  });

  it('rejects excessive size, nesting, and dangerous or sensitive keys', () => {
    expect(() => encodeConfigurationEnvelope('school', { value: 'x'.repeat(CONFIGURATION_ENVELOPE_LIMITS.maxJsonBytes + 1) })).toThrow(/too large/i);
    let nested = {};
    for (let index = 0; index < CONFIGURATION_ENVELOPE_LIMITS.maxDepth + 2; index += 1) nested = { child: nested };
    expect(() => encodeConfigurationEnvelope('school', nested)).toThrow(/deeply/i);
    expect(() => encodeConfigurationEnvelope('school', JSON.parse('{"safe":{"__proto__":{"polluted":true}}}'))).toThrow(/unsafe key/i);
    expect(() => encodeConfigurationEnvelope('school', { metadata: { apiKey: 'not-exportable' } })).toThrow(/must not be exported/i);
    expect(() => encodeConfigurationEnvelope('school', { note: '/home/user/private.xlsx' })).toThrow(/local path/i);
  });

  it.each(['clientSecret', 'credentials', 'authorization', 'databaseUrl', 'connectionString'])(
    'rejects normalized sensitive field %s',
    (key) => {
      expect(() => encodeConfigurationEnvelope('school', { settings: { [key]: 'redacted-test-value' } })).toThrow(/must not be exported/i);
    },
  );

  it('rejects internal URLs while allowing ordinary text and public URLs', () => {
    for (const value of [
      'http://localhost:3000/api',
      'https://127.0.0.1/admin',
      'wss://service.internal/socket',
      'See https://192.168.1.20/status for details',
      'https://[::1]/health',
      'https://[::ffff:192.168.1.20]/health',
    ]) {
      expect(() => encodeConfigurationEnvelope('school', { endpoint: value })).toThrow(/internal or local URL/i);
    }
    expect(() => encodeConfigurationEnvelope('school', {
      note: 'localhost is a common development hostname',
      website: 'https://www.example.com/docs',
      ipv6Website: 'https://[2606:4700:4700::1111]/dns-query',
      prose: 'See https://example.org/help for public documentation.',
    })).not.toThrow();
  });

  it('rejects malformed reconstructed JSON', () => {
    const workbook = workbookWith('school', { value: 1 });
    workbook.Sheets._Configuration.D7.v = '{';
    workbook.Sheets._Configuration.B5.v = '1';
    expect(() => readConfigurationEnvelope(workbook, 'school')).toThrow(WorkbookSafetyError);
  });
});
