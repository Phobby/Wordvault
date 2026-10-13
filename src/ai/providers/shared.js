// What the four providers have in common: turning a refusal into one of our error codes, and
// what an address has to look like.

import { WordvaultError } from '../../lib/errors.js';
import { hideSecrets } from '../http.js';

/**
 * Error codes of the AI features (lib/errors.js has the general ones: network, timeout, aborted):
 *   ai_auth        the key is wrong, revoked, or may not use this model
 *   ai_quota       the quota or the credit is used up, or too many requests
 *   ai_model       there is no model of that name at this provider
 *   ai_overloaded  the provider is having trouble; trying again later may work
 *   ai_origin      the provider turned the browser extension away (Ollama's origin list)
 *   ai_request     the provider did not accept the request (its own words are in the detail)
 *   ai_refused     the provider answered with nothing because of its content rules
 *   ai_empty       an answer came, without text
 */
export function refusal({ status, message = '', kind = '' }, secrets = []) {
  const text = `${kind} ${message}`.toLowerCase();
  let code = 'ai_request';
  if (status === 401 || /api[ _-]?key|authentication|unauthori[sz]ed|invalid[ _]?x-api-key/.test(text)) code = 'ai_auth';
  else if (status === 404 || /model[ _]not[ _]found|model .* (not found|does not exist)|unknown model/.test(text)) code = 'ai_model';
  else if (status === 429 || status === 402 || /quota|rate[ _-]?limit|resource_exhausted|insufficient|billing|credit/.test(text)) code = 'ai_quota';
  else if (status === 403) code = 'ai_auth';
  else if (status >= 500) code = 'ai_overloaded';
  return new WordvaultError(code, hideSecrets(message || `HTTP ${status}`, secrets));
}

/** What a user-typed address has to be: https anywhere, plain http only on this computer. */
export function parseBase(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password) return null; // a key belongs in its own field, not in the address
  return url;
}

/** The address without a trailing slash: paths are added to it. */
export const trimBase = (url) => `${url.origin}${url.pathname.replace(/\/+$/, '')}`;

/** The host permission an address needs (match patterns have no port). */
export const originPattern = (url) => `${url.protocol}//${url.hostname}/*`;

export const noText = () => new WordvaultError('ai_empty', 'the answer had no text');
