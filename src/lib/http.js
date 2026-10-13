import { WordvaultError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * fetch() that parses JSON and turns transport failures into WordvaultError codes.
 * HTTP error statuses are NOT thrown: providers report errors in different ways (MyMemory answers
 * 200 with an error body), so the caller gets `{ status, data }` and decides.
 *
 * @param {string | URL} url
 * @param {RequestInit & { timeoutMs?: number, signal?: AbortSignal | null }} [options]  `signal`: gives the request up; rejects with code 'aborted'.
 * @returns {Promise<{ status: number, data: any }>}
 */
export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal = null, ...init } = {}) {
  let response;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      ...init,
      // given up by the caller (the user moved on), or too slow: whichever comes first
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw new WordvaultError('aborted', 'the request was given up');
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
