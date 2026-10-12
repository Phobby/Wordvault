// The simple HTTP endpoint: a server of the user's own that does three things at one address.
//
//   GET    <address>/vault    200 with the document and an ETag header; 404 if there is none
//   PUT    <address>/vault    stores the body. With "If-Match: <etag>" only if the stored document
//                             still has that ETag, with "If-None-Match: *" only if there is none;
//                             otherwise 412. Answers with the new ETag.
//   DELETE <address>/vault    removes it
//
// Every request carries "Authorization: Bearer <key>". docs/self-hosted.md describes the protocol
// in full, and tools/self-hosted-server.js is a small server that implements it.

import { WordvaultError } from '../../lib/errors.js';
import { bytesOf, excerpt, failure, send } from '../request.js';
import { etagOf, originPattern, serverAddress } from './server.js';

/** The endpoint for a base address: "<address>/vault". */
function endpointOf(address) {
  const url = serverAddress(address);
  url.search = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/vault`;
  return url;
}

const call = (connection, init = {}) => send(connection.url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${connection.key}` } });

async function endpointFailure(response) {
  if (response.status === 403) return new WordvaultError('sync_auth', await excerpt(response));
  return failure(response);
}

export const http = {
  id: 'http',
  kind: 'server',
  nameKey: 'syncHttpName',
  whereKey: 'syncHttpWhere',
  helpKey: 'syncHttpHelp',
  fields: [
    { key: 'url', type: 'url', labelKey: 'syncFieldUrl', placeholder: 'https://vault.example.com' },
    { key: 'key', type: 'password', labelKey: 'syncFieldKey' },
  ],

  origins: (input) => [originPattern(endpointOf(input?.url))],
  location: (connection) => connection.url,

  /** Checks that the endpoint answers and takes the key. */
  async connect(input) {
    const connection = { url: endpointOf(input?.url).href, key: String(input?.key || '') };
    const response = await call(connection);
    // 200: a document is there. 404 from the endpoint itself: none yet. Both are fine.
    if (!response.ok && response.status !== 404) throw await endpointFailure(response);
    return connection;
  },

  async disconnect(session, { deleteRemote }) {
    if (!deleteRemote) return;
    const response = await call(session.connection, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw await endpointFailure(response);
  },

  async read(session) {
    const response = await call(session.connection);
    if (response.status === 404) return null;
    if (!response.ok) throw await endpointFailure(response);
    return { data: await bytesOf(response), version: etagOf(response) };
  },

  async write(session, data, expectedVersion) {
    const condition = expectedVersion === null ? { 'If-None-Match': '*' } : { 'If-Match': expectedVersion };
    const response = await call(session.connection, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...condition }, body: data });
    if (!response.ok) throw await endpointFailure(response);
    return { version: etagOf(response) };
  },

  /** A key says nothing about who it belongs to. */
  async accountInfo() {
    return null;
  },
};
