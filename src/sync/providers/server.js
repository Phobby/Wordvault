// What the two "own server" providers share: checking the address the user typed, and the
// permission pattern that goes with it.

import { WordvaultError } from '../../lib/errors.js';

/** Hosts for which plain http is accepted: the user's own machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * The address the user entered, as a URL.
 * Only https is accepted, so that the vault and the password do not cross the network in the
 * clear; http is allowed for the user's own machine, where there is no network to cross.
 * @param {unknown} value
 * @returns {URL}
 */
export function serverAddress(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new WordvaultError('sync_url', String(value || ''));
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WordvaultError('sync_url', url.protocol);
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) throw new WordvaultError('sync_insecure', url.origin);
  // A password inside the address would end up in logs and in the status line.
  if (url.username || url.password) throw new WordvaultError('sync_url', 'put the user name and password into their own fields');
  url.hash = '';
  return url;
}

/** The match pattern the browser is asked to allow: this host and no other. */
export const originPattern = (url) => `${url.protocol}//${url.hostname}/*`;

/** The ETag of a response, exactly as the server sent it ('' if it sent none). */
export const etagOf = (response) => response.headers.get('ETag') || '';
