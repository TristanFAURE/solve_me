import * as XLSX from 'xlsx';
import { validateWorkbookBounds, WorkbookSafetyError } from './safety.js';
import { hideReservedWorksheets } from './layout.js';

export const CONFIGURATION_SHEET_NAME = '_Configuration';
export const CONFIGURATION_ENVELOPE_VERSION = 1;
export const CONFIGURATION_ENVELOPE_LIMITS = Object.freeze({
  chunkCharacters: 8_000,
  maxJsonBytes: 2 * 1024 * 1024,
  maxDepth: 64,
});

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_KEYS = new Set([
  'password', 'secret', 'token', 'apikey', 'accesskey', 'privatekey', 'clientsecret',
  'credentials', 'authorization', 'databaseurl', 'connectionstring', 'localpath', 'filepath',
]);

function normalizedKey(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function jsonByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function isInternalHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || /\.(?:localhost|local|internal|lan|home)$/.test(host) || host.endsWith('.home.arpa')) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ipv4?.every((part) => part <= 255)) {
    const [first, second] = ipv4;
    return first === 0 || first === 10 || first === 127 || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168) || (first === 198 && (second === 18 || second === 19));
  }
  if (host.includes(':')) {
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
      || /^::ffff:(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|0{0,3}a00:|0{0,2}7f00:|0{0,2}a9fe:|0{0,2}ac1[0-9a-f]:|0{0,2}c0a8:)/.test(host);
  }
  return !host.includes('.');
}

function containsInternalUrl(value) {
  const candidates = value.match(/(?:https?|wss?):\/\/[^\s"'<>]+/gi) ?? [];
  return candidates.some((candidate) => {
    try {
      return isInternalHostname(new URL(candidate).hostname);
    } catch {
      return false;
    }
  });
}

function assertSafeSerializable(value) {
  const pending = [{ value, depth: 0 }];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.depth > CONFIGURATION_ENVELOPE_LIMITS.maxDepth) {
      throw new WorkbookSafetyError('The configuration is nested too deeply.');
    }
    if (current.value === null || typeof current.value === 'boolean') continue;
    if (typeof current.value === 'string') {
      if (/^(?:[a-z]:[\\/]|\/(?:home|users|tmp|var|workspace)\/)/i.test(current.value)) {
        throw new WorkbookSafetyError('The configuration contains a local path that must not be exported.');
      }
      if (containsInternalUrl(current.value)) {
        throw new WorkbookSafetyError('The configuration contains an internal or local URL that must not be exported.');
      }
      continue;
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) throw new WorkbookSafetyError('The configuration contains a non-finite number.');
      continue;
    }
    if (typeof current.value !== 'object') throw new WorkbookSafetyError('The configuration contains a value that cannot be saved.');
    if (seen.has(current.value)) throw new WorkbookSafetyError('The configuration contains a circular reference.');
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      if (Object.keys(current.value).length !== current.value.length) throw new WorkbookSafetyError('The configuration contains a sparse array.');
    } else {
      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null) throw new WorkbookSafetyError('The configuration contains an unsafe object type.');
      for (const key of Object.keys(current.value)) {
        if (DANGEROUS_KEYS.has(key)) throw new WorkbookSafetyError('The configuration contains an unsafe key.');
        if (SENSITIVE_KEYS.has(normalizedKey(key))) throw new WorkbookSafetyError('The configuration contains a field that must not be exported.');
      }
    }
    Object.values(current.value).forEach((child) => pending.push({ value: child, depth: current.depth + 1 }));
  }
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

export function encodeConfigurationEnvelope(domainId, configuration, options = {}) {
  if (typeof domainId !== 'string' || !domainId.trim()) throw new WorkbookSafetyError('A configuration domain is required.');
  assertSafeSerializable(configuration);
  const json = canonicalize(configuration);
  if (jsonByteLength(json) > CONFIGURATION_ENVELOPE_LIMITS.maxJsonBytes) {
    throw new WorkbookSafetyError('The configuration is too large for a workbook.');
  }
  const chunks = [];
  for (let offset = 0; offset < json.length; offset += CONFIGURATION_ENVELOPE_LIMITS.chunkCharacters) {
    chunks.push(json.slice(offset, offset + CONFIGURATION_ENVELOPE_LIMITS.chunkCharacters));
  }
  const rows = [
    ['Configuration envelope', String(CONFIGURATION_ENVELOPE_VERSION)],
    ['Domain', domainId],
    ['Schema version', String(options.schemaVersion ?? CONFIGURATION_ENVELOPE_VERSION)],
    ['Chunk count', String(chunks.length)],
    ['JSON bytes', String(jsonByteLength(json))],
  ];
  if (options.exportedAt !== undefined) rows.push(['Exported at', String(options.exportedAt)]);
  rows.push(['Chunk', 'Sequence', 'Total', 'Data']);
  chunks.forEach((chunk, index) => rows.push(['Chunk', String(index + 1), String(chunks.length), chunk]));
  return rows;
}

export function appendConfigurationEnvelope(workbook, domainId, configuration, options = {}) {
  validateWorkbookBounds(workbook);
  if (workbook.SheetNames.some((name) => name.toLowerCase() === CONFIGURATION_SHEET_NAME.toLowerCase())) {
    throw new WorkbookSafetyError('The workbook already contains a configuration sheet.');
  }
  const sheet = XLSX.utils.aoa_to_sheet(encodeConfigurationEnvelope(domainId, configuration, options));
  XLSX.utils.book_append_sheet(workbook, sheet, CONFIGURATION_SHEET_NAME);
  hideReservedWorksheets(workbook, [CONFIGURATION_SHEET_NAME]);
  validateWorkbookBounds(workbook);
  return workbook;
}

function parsePositiveInteger(value, label) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) throw new WorkbookSafetyError(`The configuration ${label} is invalid.`);
  return Number.parseInt(text, 10);
}

export function readConfigurationEnvelope(workbook, expectedDomainId, options = {}) {
  validateWorkbookBounds(workbook);
  const names = workbook.SheetNames.filter((name) => name.toLowerCase() === CONFIGURATION_SHEET_NAME.toLowerCase());
  if (names.length === 0) return null;
  if (names.length !== 1) throw new WorkbookSafetyError('The workbook contains duplicate configuration sheets.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[names[0]], { header: 1, defval: '', raw: false });
  const headerIndex = rows.findIndex((row) => row[0] === 'Chunk' && row[1] === 'Sequence' && row[2] === 'Total' && row[3] === 'Data');
  if (headerIndex < 0) throw new WorkbookSafetyError('The configuration envelope is incomplete.');
  const metadata = new Map();
  rows.slice(0, headerIndex).forEach((row) => {
    const key = String(row[0] ?? '').trim();
    if (!key || metadata.has(key)) throw new WorkbookSafetyError('The configuration envelope has duplicate or missing metadata.');
    metadata.set(key, String(row[1] ?? ''));
  });
  if (metadata.get('Configuration envelope') !== String(CONFIGURATION_ENVELOPE_VERSION)) throw new WorkbookSafetyError('This configuration envelope version is not supported.');
  if (metadata.get('Domain') !== expectedDomainId) throw new WorkbookSafetyError('This workbook belongs to a different planner.');
  const supportedVersions = options.supportedSchemaVersions ?? [CONFIGURATION_ENVELOPE_VERSION];
  const schemaVersion = parsePositiveInteger(metadata.get('Schema version'), 'schema version');
  if (!supportedVersions.includes(schemaVersion)) throw new WorkbookSafetyError('This configuration schema version is not supported.');
  const chunkCount = parsePositiveInteger(metadata.get('Chunk count'), 'chunk count');
  const expectedBytes = parsePositiveInteger(metadata.get('JSON bytes'), 'size');
  if (expectedBytes > CONFIGURATION_ENVELOPE_LIMITS.maxJsonBytes) throw new WorkbookSafetyError('The configuration is too large for this application.');
  const chunkRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell ?? '') !== ''));
  if (chunkRows.length !== chunkCount) throw new WorkbookSafetyError('The configuration chunks are missing or duplicated.');
  const chunks = chunkRows.map((row, index) => {
    if (row[0] !== 'Chunk' || parsePositiveInteger(row[1], 'chunk sequence') !== index + 1 || parsePositiveInteger(row[2], 'chunk total') !== chunkCount) {
      throw new WorkbookSafetyError('The configuration chunks are out of order.');
    }
    const chunk = String(row[3] ?? '');
    if (!chunk || chunk.length > CONFIGURATION_ENVELOPE_LIMITS.chunkCharacters) throw new WorkbookSafetyError('A configuration chunk is invalid.');
    return chunk;
  });
  const json = chunks.join('');
  if (jsonByteLength(json) !== expectedBytes || expectedBytes > CONFIGURATION_ENVELOPE_LIMITS.maxJsonBytes) {
    throw new WorkbookSafetyError('The configuration size does not match its envelope.');
  }
  let configuration;
  try {
    configuration = JSON.parse(json);
  } catch {
    throw new WorkbookSafetyError('The configuration data is malformed.');
  }
  assertSafeSerializable(configuration);
  return { domainId: expectedDomainId, schemaVersion, exportedAt: metadata.get('Exported at') || null, configuration };
}
