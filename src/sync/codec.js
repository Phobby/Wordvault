// The synchronised document as bytes, the way it is stored with a provider: canonical JSON,
// gzip-compressed. Compression matters where space is scarce (browser sync holds about 100 KB)
// and costs nothing elsewhere.

import { WordvaultError } from '../lib/errors.js';
import { decrypt, encrypt, isEncrypted } from './crypto.js';
import { serializeDocument } from './merge.js';
import { normalizeDocument } from './model.js';

const GZIP_MAGIC = [0x1f, 0x8b];

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {}); // a failure shows up on the readable side
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));

export async function gunzip(bytes) {
  try {
    return await pipe(bytes, new DecompressionStream('gzip'));
  } catch {
    throw new WordvaultError('sync_bad_document', 'not valid gzip data');
  }
}

const isGzip = (bytes) => bytes.length > 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];

/**
 * @param {object} document
 * @param {object | null} [secret]  The key to encrypt with (crypto.js); left out: not encrypted.
 * @returns {Promise<Uint8Array>}
 */
export async function encodeDocument(document, secret = null) {
  const packed = await gzip(new TextEncoder().encode(serializeDocument(document)));
  return secret ? encrypt(packed, secret) : packed;
}

/**
 * Reads what a provider returned. Data that is not a Wordvault document is refused (the caller
 * then leaves the remote copy alone), never silently treated as empty.
 * @param {Uint8Array} bytes
 * @param {object | null} [secret]  The key, if the user has given the password. An encrypted
 *   document without the right key is refused with 'sync_password'.
 * @returns {Promise<{ v: number, e: Record<string, object> }>}
 */
export async function decodeDocument(bytes, secret = null) {
  if (isEncrypted(bytes)) bytes = await decrypt(bytes, secret);
  // Plain JSON is accepted too: a file someone uploaded by hand, or an older writer.
  const text = new TextDecoder().decode(isGzip(bytes) ? await gunzip(bytes) : bytes);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WordvaultError('sync_bad_document', 'not valid JSON');
  }
  if (raw === null) throw new WordvaultError('sync_bad_document');
  return normalizeDocument(raw);
}

export { fromBase64, toBase64 } from './bytes.js';

/** A short fingerprint of a document's text, to tell "unchanged since the last synchronisation". */
export async function fingerprint(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
