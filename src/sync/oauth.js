// Signing in to a cloud account: OAuth 2.0 through the browser's own sign-in window
// (identity.launchWebAuthFlow), which works the same way in Chrome and Firefox.
//
// The extension is a public client: whatever is in its package can be read by anyone, so there
// is no client secret anywhere. Google Drive is signed in with the implicit flow: Google hands
// out a short-lived access token directly, which is renewed by repeating the request silently
// (its token endpoint insists on a secret for the client type that can be redirected to an
// extension; see SETUP-OAUTH.md).
//
// Tokens are returned to the caller, who keeps them in chrome.storage.local and nowhere else.

import { WordvaultError } from '../lib/errors.js';

/** A token is renewed this long before it runs out. */
export const EXPIRY_MARGIN_MS = 60_000;

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (length) => base64url(crypto.getRandomValues(new Uint8Array(length)));

/**
 * The address the provider sends the user back to, which the browser intercepts. It is derived
 * from the extension's id (Chrome: https://<id>.chromiumapp.org/, Firefox:
 * https://<hash>.extensions.allizom.org/), which is why the id has to be fixed (the `key` in
 * the Chrome manifest, `gecko.id` in the Firefox one).
 *
 * @param {Object} [options]
 * @param {boolean} [options.loopback]  Firefox also accepts http://127.0.0.1/mozoauth2/<hash>,
 *   for providers that will not redirect to a domain the developer does not own.
 */
export function redirectUrl({ loopback = false } = {}) {
  // Opera lists only launchWebAuthFlow() of this API (help.opera.com/en/extensions/apis/); the
  // address getRedirectURL() gives in Chromium is built the same way there.
  const url = typeof chrome.identity.getRedirectURL === 'function' ? chrome.identity.getRedirectURL() : `https://${chrome.runtime.id}.chromiumapp.org/`;
  if (loopback) {
    const { hostname } = new URL(url);
    if (hostname.endsWith('.extensions.allizom.org')) return `http://127.0.0.1/mozoauth2/${hostname.split('.')[0]}`;
  }
  return url;
}

/** Opens the sign-in window (or tries without one) and returns the address it ended on. */
async function launch(url, interactive) {
  let ended;
  try {
    ended = await chrome.identity.launchWebAuthFlow({ url, interactive });
  } catch (error) {
    // With a window: the user closed it or said no. Without: the provider wanted to ask something.
    throw new WordvaultError(interactive ? 'sync_cancelled' : 'sync_auth', String(error?.message || error));
  }
  if (!ended) throw new WordvaultError(interactive ? 'sync_cancelled' : 'sync_auth', 'no answer from the sign-in window');
  return new URL(ended);
}

/** What the provider said in the address it sent the user back to. */
function answerOf(url, state, interactive) {
  // Tokens come in the fragment; errors in the fragment or the query.
  const answer = new URLSearchParams(url.hash.slice(1) || url.search);
  for (const [key, value] of url.searchParams) if (!answer.has(key)) answer.set(key, value);
  const error = answer.get('error');
  if (error) {
    const detail = `${error}${answer.get('error_description') ? `: ${answer.get('error_description')}` : ''}`;
    if (error === 'access_denied') throw new WordvaultError('sync_cancelled', detail);
    if (['interaction_required', 'login_required', 'consent_required', 'account_selection_required'].includes(error)) throw new WordvaultError(interactive ? 'sync_cancelled' : 'sync_auth', detail);
    throw new WordvaultError('sync_provider', detail);
  }
  if (answer.get('state') !== state) throw new WordvaultError('sync_provider', 'the answer does not belong to this sign-in (state mismatch)');
  return answer;
}

function authorizeAddress(authorizeUrl, params) {
  const url = new URL(authorizeUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url.href;
}

/** Tokens as the provider returns them, in the form they are stored. */
function tokensFrom(body, now) {
  if (!body || typeof body.access_token !== 'string') throw new WordvaultError('sync_provider', 'the token answer has no access token');
  const lifetime = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    // No lifetime given: assume an hour, and find out by a 401 if it was less.
    expiresAt: now + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000,
    ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
  };
}

/**
 * Implicit flow: an access token straight from the authorize request. There is no refresh
 * token; when the access token runs out the same request is made again without a window, which
 * works for as long as the user is signed in to the provider in this browser.
 *
 * @param {Object} options
 * @param {string} options.authorizeUrl
 * @param {string} options.clientId
 * @param {string[]} options.scopes
 * @param {boolean} [options.loopback]   See redirectUrl().
 * @param {Record<string, string>} [options.extra]
 * @param {boolean} [options.interactive]
 * @returns {Promise<{ accessToken: string, expiresAt: number }>}
 */
export async function authorizeForToken({ authorizeUrl, clientId, scopes, loopback = false, extra = {}, interactive = true }) {
  const state = random(16);
  const url = authorizeAddress(authorizeUrl, { client_id: clientId, response_type: 'token', redirect_uri: redirectUrl({ loopback }), scope: scopes.join(' '), state, ...extra });
  const answer = answerOf(await launch(url, interactive), state, interactive);
  return tokensFrom({ access_token: answer.get('access_token'), expires_in: answer.get('expires_in') }, Date.now());
}

/** Whether stored tokens can still be used for a request made now. */
export const stillValid = (connection, now = Date.now()) => typeof connection?.accessToken === 'string' && connection.expiresAt - now > EXPIRY_MARGIN_MS;
