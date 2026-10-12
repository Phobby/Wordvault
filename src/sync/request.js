// Requests to the places the vault is synchronised with. Unlike lib/http.js this hands back the
// response itself: the bodies are binary, and the status codes and headers (ETag) matter.

import { WordvaultError } from '../lib/errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * fetch() that turns transport failures into WordvaultError codes (network, timeout). HTTP error
 * statuses are not thrown; providers know what each one means for them.
 * @param {string | URL} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function send(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = {}) {
  try {
    return await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new WordvaultError(error?.name === 'TimeoutError' ? 'timeout' : 'network', String(error?.message || ''));
  }
}

/** The body of a response as bytes. */
export async function bytesOf(response) {
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new WordvaultError('network', String(error?.message || ''));
  }
}

/** A few words from an error response, for the detail of an error. */
export async function excerpt(response) {
  let text = '';
  try {
    text = (await response.text()).replace(/\s+/g, ' ').trim();
  } catch {
    // The status alone will have to do.
  }
  return `${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`;
}

/**
 * What an HTTP status means where the provider has nothing more specific to say:
 *   401                      access is gone (sync_auth)
 *   409, 412                 the remote copy is not at the expected version (sync_conflict)
 *   413, 507                 no room (sync_quota)
 *   408, 425, 429, 5xx       try again later (network)
 * @returns {Promise<WordvaultError>}
 */
export async function failure(response) {
  const { status } = response;
  const detail = await excerpt(response);
  if (status === 401) return new WordvaultError('sync_auth', detail);
  if (status === 409 || status === 412) return new WordvaultError('sync_conflict', detail);
  if (status === 413 || status === 507) return new WordvaultError('sync_quota', detail);
  if (status === 408 || status === 425 || status === 429 || status >= 500) return new WordvaultError('network', detail);
  return new WordvaultError('sync_provider', detail);
}
