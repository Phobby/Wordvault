// Signing in to a cloud account: OAuth 2.0 through the browser's own sign-in window
// (identity.launchWebAuthFlow), which works the same way in Chrome and Firefox.
//
// The extension is a public client: whatever is in its package can be read by anyone, so there
// is no client secret anywhere. Two flows are used, depending on what the provider allows a
// public client to do (see SETUP-OAUTH.md for the findings per provider):
//
//   authorization code + PKCE   the provider hands out a code that is exchanged for tokens
//                               together with a one-time verifier (Microsoft, Dropbox)
//   implicit                    the provider hands out a short-lived access token directly; it
//                               is renewed by repeating the request silently (Google, whose
//                               token endpoint insists on a secret for the client type that
//                               can be redirected to an extension)
//
// Tokens are returned to the caller, who keeps them in chrome.storage.local and nowhere else.

import { WordvaultError } from '../lib/errors.js';
import { excerpt, send } from './request.js';

/** A token is renewed this long before it runs out. */
export const EXPIRY_MARGIN_MS = 60_000;

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (length) => base64url(crypto.getRandomValues(new Uint8Array(length)));

/** The PKCE challenge for a verifier: base64url(SHA-256(verifier)). */
export async function challengeFor(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

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
  const url = chrome.identity.getRedirectURL();
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
  // Codes come in the query, tokens in the fragment; errors in either.
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

/** Tokens as the provider's token endpoint returns them, in the form they are stored. */
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

async function tokenRequest(tokenUrl, form) {
  const response = await send(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  if (!response.ok) {
    const detail = await excerpt(response);
    // The grant (code or refresh token) is no longer good: only signing in again helps.
    if (response.status === 400 || response.status === 401) throw new WordvaultError('sync_auth', detail);
    throw new WordvaultError(response.status === 429 || response.status >= 500 ? 'network' : 'sync_provider', detail);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // handled below
  }
  return tokensFrom(body, Date.now());
}

/**
 * Authorization code flow with PKCE.
 *
 * @param {Object} options
 * @param {string} options.authorizeUrl
 * @param {string} options.tokenUrl
 * @param {string} options.clientId
 * @param {string[]} options.scopes
 * @param {Record<string, string>} [options.extra]  Further parameters for the authorize request.
 * @param {boolean} [options.interactive]  false: no window; fails with 'sync_auth' if the
 *   provider would have to ask the user something.
 * @returns {Promise<{ accessToken: string, expiresAt: number, refreshToken?: string }>}
 */
export async function authorizeWithCode({ authorizeUrl, tokenUrl, clientId, scopes, extra = {}, interactive = true }) {
  const verifier = random(48);
  const state = random(16);
  const redirect = redirectUrl();
  const url = authorizeAddress(authorizeUrl, {
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    scope: scopes.join(' '),
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    ...extra,
  });
  const answer = answerOf(await launch(url, interactive), state, interactive);
  const code = answer.get('code');
  if (!code) throw new WordvaultError('sync_provider', 'the answer has no authorization code');
  return tokenRequest(tokenUrl, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect });
}

/** Trades a refresh token for a new access token (and, with some providers, a new refresh token). */
export function refreshTokens({ tokenUrl, clientId, refreshToken, scopes }) {
  return tokenRequest(tokenUrl, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, ...(scopes ? { scope: scopes.join(' ') } : {}) });
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
