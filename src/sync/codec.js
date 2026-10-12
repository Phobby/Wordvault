// The synchronised document as bytes, the way it is stored with a provider: canonical JSON,
// gzip-compressed. Compression matters where space is scarce (browser sync holds about 100 KB)
// and costs nothing elsewhere.

import { WordvaultError } from '../lib/errors.js';
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

/** @returns {Promise<Uint8Array>} */
export async function encodeDocument(document) {
  return gzip(new TextEncoder().encode(serializeDocument(document)));
}

/**
 * Reads what a provider returned. Data that is not a Wordvault document is refused (the caller
 * then leaves the remote copy alone), never silently treated as empty.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ v: number, e: Record<string, object> }>}
 */
export async function decodeDocument(bytes) {
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

/** Base64 for the places that only store text (browser sync). */
export function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function fromBase64(text) {
  let binary;
  try {
    binary = atob(text);
  } catch {
    throw new WordvaultError('sync_bad_document', 'not valid base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A short fingerprint of a document's text, to tell "unchanged since the last synchronisation". */
export async function fingerprint(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
