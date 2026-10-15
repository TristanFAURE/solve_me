export const COLLABORATION_RESPONSE_VERSION = 1;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCollaborationEmail(value) {
  return text(value).toLowerCase();
}

export function validateCollaborationPin(value) {
  const pin = typeof value === 'number' ? String(value) : text(value);
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
  return pin;
}

const PREFERENCE_STATES = new Set(['prefer', 'neutral', 'preferNot', 'unavailable']);

function preferenceMap(value, name, nested = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > 500 || entries.some(([key]) => !key || key.length > 200)) throw new Error(`${name} contains invalid keys.`);
  const invalid = nested
    ? entries.some(([, groups]) => !groups || typeof groups !== 'object' || Array.isArray(groups)
      || Object.entries(groups).length > 500
      || Object.entries(groups).some(([key, state]) => !key || key.length > 200 || !PREFERENCE_STATES.has(state)))
    : entries.some(([, state]) => !PREFERENCE_STATES.has(state));
  if (invalid) throw new Error(`${name} contains invalid preference values.`);
  return structuredClone(value);
}

export function createCollaborationResponse(input, options = {}) {
  const email = normalizeCollaborationEmail(input?.email);
  const firstName = text(input?.firstName);
  const lastName = text(input?.lastName);
  const displayName = text(input?.displayName) || [firstName, lastName].filter(Boolean).join(' ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('A valid email is required.');
  if (!firstName || !lastName || !displayName) throw new Error('First, last, and display names are required.');
  if ([firstName, lastName, displayName].some((value) => value.length > 200)) throw new Error('Response names are too long.');
  if (!Number.isInteger(input?.manifestRevision) || input.manifestRevision < 1) throw new Error('A valid manifest revision is required.');
  const sessionId = text(input?.sessionId);
  if (!sessionId || sessionId.length > 200) throw new Error('A valid session ID is required.');
  return {
    version: COLLABORATION_RESPONSE_VERSION,
    firstName,
    lastName,
    displayName,
    email,
    pin: validateCollaborationPin(input.pin),
    sessionId,
    dayPreferences: preferenceMap(input.dayPreferences ?? {}, 'dayPreferences'),
    dayGroupPreferences: preferenceMap(input.dayGroupPreferences ?? {}, 'dayGroupPreferences', true),
    manifestRevision: input.manifestRevision,
    savedAt: options.savedAt ?? new Date().toISOString(),
  };
}

export function validateCollaborationResponse(value) {
  const normalized = createCollaborationResponse(value, { savedAt: value?.savedAt });
  if (value?.version !== COLLABORATION_RESPONSE_VERSION) throw new Error('Unsupported collaboration response version.');
  if (!text(value.savedAt) || Number.isNaN(Date.parse(value.savedAt))) throw new Error('Response savedAt is invalid.');
  return normalized;
}

export function verifyCollaborationResponseIdentity(response, email, pin) {
  const valid = validateCollaborationResponse(response);
  if (valid.email !== normalizeCollaborationEmail(email) || valid.pin !== validateCollaborationPin(pin)) {
    throw new Error('Email or PIN does not match this response.');
  }
  return valid;
}

export async function collaborationResponseKey(sessionId, email, sha256 = sha256OpaqueId) {
  const normalizedEmail = normalizeCollaborationEmail(email);
  if (!text(sessionId) || !normalizedEmail) throw new Error('Session ID and email are required.');
  return sha256(`${text(sessionId)}:${normalizedEmail}`);
}

export async function collaborationResponsePath(folder, sessionId, email, sha256) {
  const key = await collaborationResponseKey(sessionId, email, sha256);
  return `.event-staffing-collab/${folder}/responses/${key}/response.enc.json`;
}
import { sha256OpaqueId } from './cryptoEnvelope.js';
