#!/usr/bin/env node

// A server for Wordvault's "My own server → Simple HTTP endpoint" mode. One file, no
// dependencies. It keeps one document (the compressed vault) on disk and hands it out to
// whoever knows the key. The protocol is described in docs/self-hosted.md.
//
//   WORDVAULT_KEY=<a long random string> node tools/self-hosted-server.js
//
// Settings (environment variables):
//   WORDVAULT_KEY    required; the key the extension has to send
//   PORT             port to listen on (default 8787)
//   HOST             address to listen on (default 127.0.0.1: reachable from this machine only)
//   WORDVAULT_DATA   folder the document is kept in (default ./wordvault-data)
//
// It speaks plain HTTP. Wordvault only accepts https addresses, except for this machine itself
// (localhost), so to reach it from other devices put it behind something that terminates TLS
// (Caddy, nginx, a tunnel) and give Wordvault that https address.

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Larger bodies are refused; a vault of ten thousand words is well under a megabyte. */
const MAX_BYTES = 20 * 1024 * 1024;

const etagOf = (data) => `"${createHash('sha256').update(data).digest('hex').slice(0, 32)}"`;

/** Compares without revealing by timing how much of the key was right. */
function sameKey(given, expected) {
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

/**
 * @param {Object} options
 * @param {string} options.key       The key requests must carry as "Authorization: Bearer <key>".
 * @param {string} options.dataDir   Folder for the stored document.
 * @returns {http.Server}
 */
export function createVaultServer({ key, dataDir }) {
  if (!key) throw new Error('a key is required');
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'vault.bin');
  const read = () => (fs.existsSync(file) ? fs.readFileSync(file) : null);

  return http.createServer((request, response) => {
    // The extension asks the browser for access to this address, so these are not needed by
    // it; they let the endpoint also be used from a context that only has CORS to go by.
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match',
      'Access-Control-Expose-Headers': 'ETag',
      'Cache-Control': 'no-store',
    };
    const answer = (status, body = '', extra = {}) => {
      response.writeHead(status, { ...headers, ...extra });
      response.end(body);
    };

    const { pathname } = new URL(request.url, 'http://localhost');
    if (request.method === 'OPTIONS') return answer(204);
    if (pathname.replace(/\/+$/, '') !== '/vault') return answer(404, 'not found\n');
    const given = /^Bearer (.+)$/.exec(request.headers.authorization || '');
    if (!given || !sameKey(given[1], key)) return answer(401, 'wrong or missing key\n', { 'WWW-Authenticate': 'Bearer' });

    if (request.method === 'GET') {
      const data = read();
      return data ? answer(200, data, { 'Content-Type': 'application/octet-stream', ETag: etagOf(data) }) : answer(404, 'no vault stored yet\n');
    }
    if (request.method === 'DELETE') {
      fs.rmSync(file, { force: true });
      return answer(204);
    }
    if (request.method !== 'PUT') return answer(405, 'method not allowed\n', { Allow: 'GET, PUT, DELETE, OPTIONS' });

    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > MAX_BYTES) return answer(413, 'too large\n');
      // The condition is checked and the file replaced in one go (nothing else runs in between
      // in this process), so two devices writing at the same moment cannot both succeed.
      const stored = read();
      const ifMatch = request.headers['if-match'];
      const ifNoneMatch = request.headers['if-none-match'];
      if (ifNoneMatch === '*' && stored) return answer(412, 'a vault is already stored\n', { ETag: etagOf(stored) });
      if (ifMatch && (!stored || etagOf(stored) !== ifMatch)) return answer(412, 'the stored vault has changed\n', stored ? { ETag: etagOf(stored) } : {});
      const data = Buffer.concat(chunks);
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, data);
      fs.renameSync(temporary, file); // never a half-written file
      return answer(stored ? 200 : 201, '', { ETag: etagOf(data) });
    });
    request.on('error', () => answer(400, 'bad request\n'));
    return undefined;
  });
}

// Run directly: start listening.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.WORDVAULT_KEY;
  if (!key || key.length < 16) {
    console.error('Set WORDVAULT_KEY to a long random string (at least 16 characters), for example:\n  WORDVAULT_KEY=$(openssl rand -hex 24) node tools/self-hosted-server.js');
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '127.0.0.1';
  const dataDir = path.resolve(process.env.WORDVAULT_DATA || 'wordvault-data');
  createVaultServer({ key, dataDir }).listen(port, host, () => {
    console.log(`Wordvault endpoint listening on http://${host}:${port}/vault (data in ${dataDir})`);
  });
}
