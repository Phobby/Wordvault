// Optional end-to-end encryption of the synchronised document: what leaves the browser is
// unreadable to the place that stores it. Standard WebCrypto throughout:
//
//   key        PBKDF2-HMAC-SHA-256 over the user's password, 600 000 rounds, 256-bit AES key
//   cipher     AES-256-GCM, a fresh 96-bit nonce for every write
//   envelope   "WVE1" | rounds (4 bytes) | salt (16 bytes) | nonce (12 bytes) | ciphertext + tag
//
// The salt belongs to the stored file: every device derives the same key from the same password
// with it, so a second device only needs the password. The part of the envelope before the
// nonce is authenticated together with the content, so it cannot be swapped unnoticed.
//
// The password itself is never stored. What is kept is the derived key: for the browser session
// (chrome.storage.session, memory only), or on this device if the user asks for that. Without
// it the stored file cannot be read, by Wordvault or by anyone: a lost password means the
// remote copy is lost. The vault on the device is not encrypted and not affected.

import { WordvaultError } from '../lib/errors.js';
import { fromBase64, toBase64 } from './bytes.js';

const MAGIC = [0x57, 0x56, 0x45, 0x31]; // "WVE1"
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const HEADER_BYTES = MAGIC.length + 4 + SALT_BYTES;
/** OWASP's recommendation for PBKDF2 with SHA-256. Stored in the envelope, so it can be raised later. */
export const KDF_ROUNDS = 600_000;
const SECRET_KEY = 'syncSecret';

/** Whether stored bytes are an encrypted document. */
export function isEncrypted(bytes) {
  return bytes.length > HEADER_BYTES + NONCE_BYTES && MAGIC.every((byte, index) => bytes[index] === byte);
}

/** The fewest and the most rounds an envelope may name. The header comes from the place that
 *  stores the file, which must not be able to talk a device into a weak key or an endless wait. */
const ROUNDS_RANGE = [100_000, 10_000_000];

/** The salt and the number of rounds an encrypted document was made with. */
export function headerOf(bytes) {
  const rounds = new DataView(bytes.buffer, bytes.byteOffset + MAGIC.length, 4).getUint32(0);
  if (rounds < ROUNDS_RANGE[0] || rounds > ROUNDS_RANGE[1]) throw new WordvaultError('sync_bad_document', `implausible key derivation setting (${rounds} rounds)`);
  return { rounds, salt: bytes.slice(MAGIC.length + 4, HEADER_BYTES) };
}

/**
 * The key for a password.
 * @param {string} password
 * @param {Uint8Array} [salt]   The salt of the stored file; a new random one if left out.
 * @param {number} [rounds]
 * @returns {Promise<{ key: string, salt: string, rounds: number }>} Key and salt as base64: the
 *   form that is kept.
 */
export async function deriveSecret(password, salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)), rounds = KDF_ROUNDS) {
  if (typeof password !== 'string' || password === '') throw new WordvaultError('sync_password', 'no password');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, material, 256);
  return { key: toBase64(new Uint8Array(bits)), salt: toBase64(salt), rounds };
}

const aesKey = (secret) => crypto.subtle.importKey('raw', fromBase64(secret.key), 'AES-GCM', false, ['encrypt', 'decrypt']);

/** @returns {Promise<Uint8Array>} The envelope. */
export async function encrypt(bytes, secret) {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  new DataView(header.buffer).setUint32(MAGIC.length, secret.rounds);
  header.set(fromBase64(secret.salt), MAGIC.length + 4);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: header }, await aesKey(secret), bytes));
  const envelope = new Uint8Array(HEADER_BYTES + NONCE_BYTES + sealed.length);
  envelope.set(header);
  envelope.set(nonce, HEADER_BYTES);
  envelope.set(sealed, HEADER_BYTES + NONCE_BYTES);
  return envelope;
}

/**
 * @returns {Promise<Uint8Array>} The content.
 * Rejects with 'sync_password' if the key does not open the envelope: a different password, a
 * different file, or data that was tampered with. Which of these it is cannot be told.
 */
export async function decrypt(envelope, secret) {
  if (!secret) throw new WordvaultError('sync_password', 'the stored file is encrypted');
  const header = envelope.subarray(0, HEADER_BYTES);
  const nonce = envelope.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: header }, await aesKey(secret), envelope.subarray(HEADER_BYTES + NONCE_BYTES)));
  } catch {
    throw new WordvaultError('sync_password', 'the password does not open the stored file');
  }
}

// --- Keeping the key ------------------------------------------------------------------------------

/** Where the key lives for the session: memory that the browser clears when it closes. */
const sessionArea = () => chrome.storage.session || null;
/** Browsers without session storage: this script's own memory (gone when it is stopped). */
let inMemory = null;

/** @returns {Promise<{ key: string, salt: string, rounds: number } | null>} */
export async function getSecret() {
  const session = sessionArea();
  const held = session ? (await session.get(SECRET_KEY))[SECRET_KEY] : inMemory;
  if (held) return held;
  return (await chrome.storage.local.get(SECRET_KEY))[SECRET_KEY] || null;
}

/**
 * @param {{ key: string, salt: string, rounds: number }} secret
 * @param {{ remember: boolean }} options  remember: also keep it on this device, so that the
 *   password is not asked for again after the browser was closed.
 */
export async function setSecret(secret, { remember }) {
  const session = sessionArea();
  if (session) await session.set({ [SECRET_KEY]: secret });
  else inMemory = secret;
  if (remember) await chrome.storage.local.set({ [SECRET_KEY]: secret });
  else await chrome.storage.local.remove(SECRET_KEY);
}

export async function clearSecret() {
  inMemory = null;
  await sessionArea()?.remove(SECRET_KEY);
  await chrome.storage.local.remove(SECRET_KEY);
}
