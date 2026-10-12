// WebDAV (Nextcloud, ownCloud, any server that speaks it): the document is one file in a folder
// the user names, on a server the user runs or trusts. User name and app password are kept in
// chrome.storage.local and sent with every request as HTTP Basic authentication, over https.
//
// Writes are conditional: If-Match with the file's ETag, or If-None-Match: * while there is no
// file yet. A server that sends no ETags cannot offer that; with such a server the last writer
// wins and the next synchronisation merges what was overwritten back in.

import { WordvaultError } from '../../lib/errors.js';
import { SYNC_FILE_NAME } from '../config.js';
import { bytesOf, excerpt, failure, send } from '../request.js';
import { etagOf, originPattern, serverAddress } from './server.js';

const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

/** The folder address with a slash at the end, so that the file name is appended to it. */
function folderOf(address) {
  const url = serverAddress(address);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  url.search = '';
  return url;
}
const fileOf = (connection) => new URL(encodeURIComponent(SYNC_FILE_NAME), connection.url).href;

function authorization(connection) {
  const bytes = new TextEncoder().encode(`${connection.username}:${connection.password}`);
  return { Authorization: `Basic ${btoa(String.fromCharCode(...bytes))}` };
}
const call = (connection, url, init = {}) => send(url, { ...init, headers: { ...init.headers, ...authorization(connection) } });

/** What a refusal from the server means; a wrong password and a forbidden folder look the same to the user. */
async function davFailure(response) {
  if (response.status === 403) return new WordvaultError('sync_auth', await excerpt(response));
  return failure(response);
}

export const webdav = {
  id: 'webdav',
  kind: 'server',
  nameKey: 'syncWebdavName',
  whereKey: 'syncWebdavWhere',
  helpKey: 'syncWebdavHelp',
  fields: [
    { key: 'url', type: 'url', labelKey: 'syncFieldFolderUrl', placeholder: 'https://cloud.example.com/remote.php/dav/files/NAME/Wordvault/' },
    { key: 'username', type: 'text', labelKey: 'syncFieldUser' },
    { key: 'password', type: 'password', labelKey: 'syncFieldPassword' },
  ],

  origins: (input) => [originPattern(folderOf(input?.url))],
  /** Where the file is, for the status line (no password in it). */
  location: (connection) => fileOf(connection),

  /** Checks that the folder is there and the password is right; creates the folder if it is missing. */
  async connect(input) {
    const connection = { url: folderOf(input?.url).href, username: String(input?.username || ''), password: String(input?.password || '') };
    const found = await call(connection, connection.url, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, body: PROPFIND_BODY });
    if (found.status === 404) {
      const made = await call(connection, connection.url, { method: 'MKCOL' });
      // 405: it exists after all. 409: the folder above it does not exist either.
      if (made.status === 409) throw new WordvaultError('sync_not_found', await excerpt(made));
      if (!made.ok && made.status !== 405) throw await davFailure(made);
    } else if (!found.ok) {
      // 405 and the like: something answers there, but it is not WebDAV.
      if (found.status === 405 || found.status === 501) throw new WordvaultError('sync_not_found', await excerpt(found));
      throw await davFailure(found);
    }
    return connection;
  },

  async disconnect(session, { deleteRemote }) {
    if (!deleteRemote) return;
    const response = await call(session.connection, fileOf(session.connection), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw await davFailure(response);
  },

  async read(session) {
    const response = await call(session.connection, fileOf(session.connection));
    if (response.status === 404) return null;
    if (!response.ok) throw await davFailure(response);
    return { data: await bytesOf(response), version: etagOf(response) };
  },

  async write(session, data, expectedVersion) {
    const condition = expectedVersion === null ? { 'If-None-Match': '*' } : expectedVersion ? { 'If-Match': expectedVersion } : {};
    const response = await call(session.connection, fileOf(session.connection), { method: 'PUT', headers: { 'Content-Type': 'application/gzip', ...condition }, body: data });
    if (!response.ok) throw await davFailure(response);
    let version = etagOf(response);
    if (!version) {
      // Not every server names the new ETag in its answer to the PUT.
      const head = await call(session.connection, fileOf(session.connection), { method: 'HEAD' });
      version = head.ok ? etagOf(head) : '';
    }
    return { version };
  },

  async accountInfo(session) {
    return session.connection.username ? { name: session.connection.username } : null;
  },
};
