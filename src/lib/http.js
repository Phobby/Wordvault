import { WordvaultError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * fetch() that parses JSON and turns transport failures into WordvaultError codes.
 * HTTP error statuses are NOT thrown: providers report errors in different ways (MyMemory answers
 * 200 with an error body), so the caller gets `{ status, data }` and decides.
 *
 * @param {string | URL} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number, data: any }>}
 */
export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WordvaultError(error?.name === 'TimeoutError' ? 'timeout' : 'network', String(error?.message || ''));
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Not JSON (for example an HTML error page from a proxy); the status code is all we have.
  }
  return { status: response.status, data };
}
