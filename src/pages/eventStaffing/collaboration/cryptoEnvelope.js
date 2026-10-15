const ENVELOPE_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MIN_PASSWORD_LENGTH = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class CryptoEnvelopeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'CryptoEnvelopeError';
  }
}

function webCrypto(options) {
  const crypto = options?.crypto ?? globalThis.crypto;
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new CryptoEnvelopeError('Web Crypto is unavailable.');
  }
  return crypto;
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new CryptoEnvelopeError(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new CryptoEnvelopeError('Encrypted envelope is not valid base64.');
  }
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch (cause) {
    throw new CryptoEnvelopeError('Encrypted envelope is not valid base64.', { cause });
  }
}

async function deriveKey(password, salt, crypto, usages) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

export async function encryptEnvelope(plaintext, password, options = {}) {
  assertPassword(password);
  if (typeof plaintext !== 'string') throw new CryptoEnvelopeError('Envelope plaintext must be a string.');
  const crypto = webCrypto(options);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, crypto, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)));
  const envelope = JSON.stringify({
    version: ENVELOPE_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  });
  return toBase64(encoder.encode(envelope));
}

export async function decryptEnvelope(encodedEnvelope, password, options = {}) {
  assertPassword(password);
  const crypto = webCrypto(options);
  let envelope;
  try {
    envelope = JSON.parse(decoder.decode(fromBase64(encodedEnvelope)));
  } catch (cause) {
    if (cause instanceof CryptoEnvelopeError) throw cause;
    throw new CryptoEnvelopeError('Encrypted envelope is malformed.', { cause });
  }
  if (
    !envelope || envelope.version !== ENVELOPE_VERSION || envelope.kdf !== 'PBKDF2-SHA256'
    || envelope.iterations !== PBKDF2_ITERATIONS || envelope.cipher !== 'AES-256-GCM'
  ) {
    throw new CryptoEnvelopeError('Encrypted envelope uses an unsupported format.');
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length < 16) {
    throw new CryptoEnvelopeError('Encrypted envelope has invalid parameters.');
  }
  try {
    const key = await deriveKey(password, salt, crypto, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return decoder.decode(plaintext);
  } catch (cause) {
    throw new CryptoEnvelopeError('Unable to authenticate encrypted envelope.', { cause });
  }
}

export async function sha256OpaqueId(value, options = {}) {
  if (typeof value !== 'string') throw new CryptoEnvelopeError('Opaque ID input must be a string.');
  const digest = new Uint8Array(await webCrypto(options).subtle.digest('SHA-256', encoder.encode(value)));
  return toBase64(digest).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export const CRYPTO_ENVELOPE_PARAMETERS = Object.freeze({
  version: ENVELOPE_VERSION,
  iterations: PBKDF2_ITERATIONS,
  saltBytes: SALT_BYTES,
  ivBytes: IV_BYTES,
  minimumPasswordLength: MIN_PASSWORD_LENGTH,
});
