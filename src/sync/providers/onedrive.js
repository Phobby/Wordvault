// OneDrive (Microsoft Graph): the document is one file in the application's own folder of the
// user's OneDrive (Apps/Wordvault), reached as the special folder "approot". The permissions
// asked for are Files.ReadWrite.AppFolder (that folder only) and offline_access (to stay
// connected); nothing else in the OneDrive can be seen.
//
// Sign-in: authorization code with PKCE, no client secret. The redirect address has to be
// registered as a "single-page application" address, because the token request comes from a
// browser context and carries an Origin header; Microsoft only redeems codes cross-origin for
// that kind. The price is that refresh tokens of that kind live for 24 hours. When one has run
// out, the sign-in is repeated without a window, which works for as long as the user is signed
// in to Microsoft in this browser; after that the user is asked to connect again.
// (SETUP-OAUTH.md)
//
// A file at a path is one file, so there are no duplicates to merge. Writes are conditional:
// If-Match with the item's eTag, so a copy changed by another device is never overwritten.

import { WordvaultError } from '../../lib/errors.js';
import { SYNC_FILE_NAME, clientIdFor } from '../config.js';
import { authorizeWithCode, refreshTokens, stillValid } from '../oauth.js';
import { bytesOf, excerpt, failure, send } from '../request.js';

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const FOLDER = `${GRAPH}/me/drive/special/approot`;
const FILE = `${FOLDER}:/${SYNC_FILE_NAME}`;
const SCOPES = ['Files.ReadWrite.AppFolder', 'offline_access'];

function clientId() {
  const id = clientIdFor('onedrive');
  if (!id) throw new WordvaultError('sync_config', 'no Microsoft client ID');
  return id;
}

const signIn = (interactive, extra) => authorizeWithCode({ authorizeUrl: AUTHORIZE_URL, tokenUrl: TOKEN_URL, clientId: clientId(), scopes: SCOPES, interactive, extra: { response_mode: 'query', ...extra } });

async function token(session, { renew = false } = {}) {
  if (!renew && stillValid(session.connection)) return session.connection.accessToken;
  let fresh;
  try {
    if (!session.connection.refreshToken) throw new WordvaultError('sync_auth', 'no refresh token');
    fresh = await refreshTokens({ tokenUrl: TOKEN_URL, clientId: clientId(), refreshToken: session.connection.refreshToken, scopes: SCOPES });
  } catch (error) {
    if (error?.code !== 'sync_auth') throw error;
    // The refresh token has run out (they last a day): sign in again, without a window.
    fresh = await signIn(false, { prompt: 'none' });
  }
  // Microsoft hands out a new refresh token with every use; the old one is to be dropped.
  Object.assign(session.connection, fresh);
  await session.update(fresh);
  return fresh.accessToken;
}

async function call(session, url, init = {}) {
  let response = await send(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(session)}` } });
  if (response.status === 401) response = await send(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(session, { renew: true })}` } });
  return response;
}

/** What a refusal from Graph means. */
async function graphFailure(response) {
  if (response.status !== 403) return failure(response);
  const detail = await excerpt(response);
  return new WordvaultError(/quotaLimitReached|insufficient/i.test(detail) ? 'sync_quota' : 'sync_auth', detail);
}

export const onedrive = {
  id: 'onedrive',
  kind: 'cloud',
  nameKey: 'syncOnedriveName',
  whereKey: 'syncOnedriveWhere',

  origins: () => ['https://graph.microsoft.com/*', 'https://login.microsoftonline.com/*'],

  async connect() {
    // The account picker, so that the user decides which account it is.
    return signIn(true, { prompt: 'select_account' });
  },

  async disconnect(session, { deleteRemote }) {
    // Microsoft has no call for giving a token back; forgetting it is all there is to do.
    if (!deleteRemote) return;
    const response = await call(session, FILE, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw await graphFailure(response);
  },

  async read(session) {
    const about = await call(session, `${FILE}?$select=id,eTag,@microsoft.graph.downloadUrl`);
    if (about.status === 404) return null; // no file yet (or no folder yet: it is made by the first write)
    if (!about.ok) throw await graphFailure(about);
    const item = await about.json();
    const address = item['@microsoft.graph.downloadUrl'];
    // The download address is already authorised and lives on another host; no token goes there.
    const content = address ? await send(address) : await call(session, `${FILE}:/content`);
    if (!content.ok) throw await graphFailure(content);
    return { data: await bytesOf(content), version: item.eTag };
  },

  async write(session, data, expectedVersion) {
    // "Only if there is none" and "only if unchanged" are both the server's to enforce.
    const url = expectedVersion === null ? `${FILE}:/content?@microsoft.graph.conflictBehavior=fail` : `${FILE}:/content`;
    const headers = { 'Content-Type': 'application/gzip', ...(expectedVersion === null ? {} : { 'If-Match': expectedVersion }) };
    const response = await call(session, url, { method: 'PUT', headers, body: data });
    if (!response.ok) throw await graphFailure(response);
    return { version: (await response.json()).eTag };
  },

  /** The name on the account, as far as the application folder tells it. */
  async accountInfo(session) {
    const response = await call(session, `${FOLDER}?$select=createdBy`);
    if (!response.ok) return null;
    const user = (await response.json()).createdBy?.user;
    return user?.displayName || user?.email ? { name: user.displayName || '', email: user.email || '' } : null;
  },
};
