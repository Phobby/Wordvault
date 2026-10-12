// Dropbox: the document is one file in the application's own folder of the user's Dropbox
// (Apps/Wordvault). The application is registered with "App folder" access, so nothing outside
// that folder can be seen; the permissions asked for are files.content.read and
// files.content.write.
//
// Sign-in: authorization code with PKCE, no client secret, and a refresh token that does not
// run out (token_access_type=offline), so the connection lasts until the user ends it.
// (SETUP-OAUTH.md)
//
// Writes are conditional on the file's revision: "add" when there is no file yet, "update" with
// the revision that was read otherwise. Dropbox answers 409 when that no longer holds.

import { WordvaultError } from '../../lib/errors.js';
import { SYNC_FILE_NAME, clientIdFor } from '../config.js';
import { authorizeWithCode, refreshTokens, stillValid } from '../oauth.js';
import { bytesOf, excerpt, failure, send } from '../request.js';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';
const SCOPES = ['files.content.read', 'files.content.write'];
/** Paths are relative to the application's folder. */
const PATH = `/${SYNC_FILE_NAME}`;

function clientId() {
  const id = clientIdFor('dropbox');
  if (!id) throw new WordvaultError('sync_config', 'no Dropbox app key');
  return id;
}

async function token(session, { renew = false } = {}) {
  if (!renew && stillValid(session.connection)) return session.connection.accessToken;
  if (!session.connection.refreshToken) throw new WordvaultError('sync_auth', 'no refresh token');
  const fresh = await refreshTokens({ tokenUrl: TOKEN_URL, clientId: clientId(), refreshToken: session.connection.refreshToken });
  Object.assign(session.connection, fresh);
  await session.update(fresh);
  return fresh.accessToken;
}

async function call(session, url, init = {}) {
  let response = await send(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(session)}` } });
  if (response.status === 401) response = await send(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(session, { renew: true })}` } });
  return response;
}

/**
 * What a refusal from Dropbox means. Nearly everything that is wrong with a request is a 409
 * there; the error summary in the body says which.
 */
async function dropboxFailure(response) {
  if (response.status !== 409) return failure(response);
  const detail = await excerpt(response);
  if (/insufficient_space/.test(detail)) return new WordvaultError('sync_quota', detail);
  if (/conflict/.test(detail)) return new WordvaultError('sync_conflict', detail);
  return new WordvaultError('sync_provider', detail);
}

const arg = (value) => ({ 'Dropbox-API-Arg': JSON.stringify(value) });

export const dropbox = {
  id: 'dropbox',
  kind: 'cloud',
  nameKey: 'syncDropboxName',
  whereKey: 'syncDropboxWhere',

  origins: () => ['https://api.dropboxapi.com/*', 'https://content.dropboxapi.com/*'],

  async connect() {
    return authorizeWithCode({ authorizeUrl: AUTHORIZE_URL, tokenUrl: TOKEN_URL, clientId: clientId(), scopes: SCOPES, extra: { token_access_type: 'offline' }, interactive: true });
  },

  async disconnect(session, { deleteRemote }) {
    if (deleteRemote) {
      const response = await call(session, `${API}/files/delete_v2`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: PATH }) });
      // 409 path_lookup/not_found: there was nothing to delete.
      if (!response.ok && !(response.status === 409 && /not_found/.test(await excerpt(response.clone())))) throw await dropboxFailure(response);
    }
    // Giving the access back is a courtesy; without it the token simply stays unused.
    await call(session, `${API}/auth/token/revoke`, { method: 'POST' }).catch(() => {});
  },

  async read(session) {
    const response = await call(session, `${CONTENT}/files/download`, { method: 'POST', headers: arg({ path: PATH }) });
    if (response.status === 409 && /not_found/.test(await excerpt(response.clone()))) return null;
    if (!response.ok) throw await dropboxFailure(response);
    let metadata = {};
    try {
      metadata = JSON.parse(response.headers.get('Dropbox-API-Result') || '{}');
    } catch {
      // handled below
    }
    if (typeof metadata.rev !== 'string') throw new WordvaultError('sync_provider', 'the download answer has no revision');
    return { data: await bytesOf(response), version: metadata.rev };
  },

  async write(session, data, expectedVersion) {
    const mode = expectedVersion === null ? 'add' : { '.tag': 'update', update: expectedVersion };
    const response = await call(session, `${CONTENT}/files/upload`, {
      method: 'POST',
      // No renaming to "name (1)": a file that is in the way is a conflict to be merged.
      headers: { ...arg({ path: PATH, mode, autorename: false, mute: true, strict_conflict: true }), 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    if (!response.ok) throw await dropboxFailure(response);
    return { version: (await response.json()).rev };
  },

  /** Asking Dropbox whose account it is would need one more permission (account_info.read). */
  async accountInfo() {
    return null;
  },
};
