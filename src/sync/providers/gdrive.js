// Google Drive: the document is one file in the "application data folder" of the user's Drive,
// a hidden place that belongs to this application alone. The only permission asked for is
// drive.appdata; the user's own files cannot be seen or touched with it.
//
// Sign-in: Google's token endpoint wants a client secret from the only client type that can be
// redirected to an extension ("Web application"), PKCE or not. A secret in the package would be
// no secret, so the implicit flow is used instead: an access token for about an hour, renewed
// by a silent repeat of the sign-in for as long as the user stays signed in to Google in this
// browser. When that is no longer possible the user is asked to connect again. (SETUP-OAUTH.md)
//
// Files in Drive are known by id, not by name, so two devices connecting for the first time at
// the same moment can each create a file. read() reports the extra ones; the engine merges
// them into the oldest and has them removed.
//
// Drive (v3) has no "write only if unchanged". write() looks at the file's version just before
// writing, which narrows the gap; a write that slips through anyway loses nothing, because the
// other device merges its vault in again at its next synchronisation.

import { WordvaultError } from '../../lib/errors.js';
import { SYNC_FILE_NAME, clientIdFor } from '../config.js';
import { authorizeForToken, stillValid } from '../oauth.js';
import { bytesOf, excerpt, failure, send } from '../request.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPES = ['https://www.googleapis.com/auth/drive.appdata'];
const FOLDER = 'appDataFolder';

function clientId() {
  const id = clientIdFor('gdrive');
  if (!id) throw new WordvaultError('sync_config', 'no Google client ID');
  return id;
}

/** An access token that can be used now; renewed without a window if the stored one ran out. */
async function token(session, { renew = false } = {}) {
  if (!renew && stillValid(session.connection)) return session.connection.accessToken;
  const fresh = await authorizeForToken({
    authorizeUrl: AUTHORIZE_URL,
    clientId: clientId(),
    scopes: SCOPES,
    loopback: true,
    interactive: false,
    // No questions; and the account that was connected, not whichever is signed in first.
    extra: { prompt: 'none', login_hint: session.connection.hint || '' },
  });
  Object.assign(session.connection, fresh);
  await session.update(fresh);
  return fresh.accessToken;
}

/** What a refusal from the Drive API means. */
async function driveFailure(response) {
  if (response.status !== 403) return failure(response);
  const detail = await excerpt(response);
  // 403 covers "the Drive is full" as well as "slow down".
  if (/storageQuotaExceeded|teamDriveFileLimitExceeded/.test(detail)) return new WordvaultError('sync_quota', detail);
  if (/rateLimitExceeded|userRateLimitExceeded/i.test(detail)) return new WordvaultError('network', detail);
  return new WordvaultError('sync_auth', detail);
}

/** A request to Drive with the token; a token Google no longer accepts is renewed once. */
async function call(session, url, init = {}) {
  let response = await send(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(session)}` } });
  if (response.status === 401) response = await send(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(session, { renew: true })}` } });
  return response;
}

async function json(session, url, init) {
  const response = await call(session, url, init);
  if (!response.ok) throw await driveFailure(response);
  return response.json();
}

/** The Wordvault files in the application data folder, oldest first. */
async function listFiles(session) {
  const query = new URLSearchParams({
    spaces: FOLDER,
    q: `name = '${SYNC_FILE_NAME}'`,
    fields: 'files(id,createdTime,version)',
    orderBy: 'createdTime',
    pageSize: '20',
  });
  const { files } = await json(session, `${API}/files?${query}`);
  return Array.isArray(files) ? files : [];
}

async function download(session, id) {
  const response = await call(session, `${API}/files/${encodeURIComponent(id)}?alt=media`);
  if (!response.ok) throw await driveFailure(response);
  return bytesOf(response);
}

const versionOf = (file) => `${file.id}:${file.version}`;

/** A new file: its name and folder as JSON and its content, in one multipart request. */
function createBody(data) {
  const boundary = `wordvault-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: SYNC_FILE_NAME, parents: [FOLDER] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`, data, `\r\n--${boundary}--`]);
  return { body, type: `multipart/related; boundary=${boundary}` };
}

export const gdrive = {
  id: 'gdrive',
  kind: 'cloud',
  nameKey: 'syncGdriveName',
  whereKey: 'syncGdriveWhere',

  /** The addresses the extension has to be allowed to talk to (asked for when connecting). */
  origins: () => ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'],

  async connect() {
    const tokens = await authorizeForToken({ authorizeUrl: AUTHORIZE_URL, clientId: clientId(), scopes: SCOPES, loopback: true, interactive: true });
    const connection = { ...tokens, hint: '' };
    // Remembered so that the silent renewal asks for this account.
    const account = await this.accountInfo({ connection, update: async () => {} }).catch(() => null);
    return { ...connection, hint: account?.email || '' };
  },

  async disconnect(session, { deleteRemote }) {
    if (deleteRemote) {
      for (const file of await listFiles(session)) {
        const response = await call(session, `${API}/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) throw await driveFailure(response);
      }
    }
    // Giving the access back is a courtesy; if it does not work the token runs out by itself.
    if (session.connection.accessToken) {
      await send(`${REVOKE_URL}?token=${encodeURIComponent(session.connection.accessToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => {});
    }
  },

  async read(session) {
    const files = await listFiles(session);
    if (files.length === 0) return null;
    const [main, ...extra] = files;
    const others = [];
    for (const file of extra) others.push({ id: file.id, data: await download(session, file.id) });
    return { data: await download(session, main.id), version: versionOf(main), others };
  },

  async write(session, data, expectedVersion) {
    if (expectedVersion === null) {
      const { body, type } = createBody(data);
      const created = await json(session, `${UPLOAD}/files?uploadType=multipart&fields=id,version`, { method: 'POST', headers: { 'Content-Type': type }, body });
      return { version: versionOf(created) };
    }
    const id = expectedVersion.slice(0, expectedVersion.lastIndexOf(':'));
    const check = await call(session, `${API}/files/${encodeURIComponent(id)}?fields=id,version`);
    if (check.status === 404) throw new WordvaultError('sync_conflict', 'the file is gone');
    if (!check.ok) throw await driveFailure(check);
    if (versionOf(await check.json()) !== expectedVersion) throw new WordvaultError('sync_conflict', 'the file changed');
    const updated = await json(session, `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { 'Content-Type': 'application/gzip' }, body: data });
    return { version: versionOf(updated) };
  },

  async removeOthers(session, ids) {
    for (const id of ids) {
      const response = await call(session, `${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw await driveFailure(response);
    }
  },

  /** Name and address of the Google account; drive.appdata is enough to ask Drive for them. */
  async accountInfo(session) {
    const { user } = await json(session, `${API}/about?fields=user(displayName,emailAddress)`);
    return user ? { name: user.displayName || '', email: user.emailAddress || '' } : null;
  },
};
