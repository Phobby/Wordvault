// Bytes as text, for the places that only store text (browser sync, the kept encryption key).

import { WordvaultError } from '../lib/errors.js';

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
