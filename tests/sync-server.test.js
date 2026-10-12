// "My own server": WebDAV and the simple HTTP endpoint, against real local servers. The HTTP
// endpoint is the repository's own example server (tools/self-hosted-server.js), so the
// protocol in docs/self-hosted.md is tested from both ends.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { addEntry, listEntries, removeEntry } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument } from '../src/sync/codec.js';
import { syncNow } from '../src/sync/engine.js';
import { readLocalDocument } from '../src/sync/local.js';
import { serializeDocument } from '../src/sync/merge.js';
import { http } from '../src/sync/providers/http.js';
import { getSyncProvider, listSyncProviders } from '../src/sync/providers/index.js';
import { originPattern, serverAddress } from '../src/sync/providers/server.js';
import { webdav } from '../src/sync/providers/webdav.js';
import { getSyncConfig, setSyncConfig } from '../src/sync/state.js';
import { createVaultServer } from '../tools/self-hosted-server.js';
import { createDevice, use } from './helpers/chrome.js';
import { startWebdavServer } from './helpers/webdav-server.js';

const KEY = 'a-long-test-key-0123456789';
const sleep = async () => {};
const word = (text) => ({ text, translation: `${text}-tr`, sourceLang: 'en', targetLang: 'tr' });

let endpoint;
let endpointOrigin;
let dataDir;
let dav;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordvault-test-'));
  endpoint = createVaultServer({ key: KEY, dataDir });
  await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  endpointOrigin = `http://127.0.0.1:${endpoint.address().port}`;
  dav = await startWebdavServer({ user: 'ayşe', password: 'app-pass word' });
});
after(async () => {
  await new Promise((resolve) => endpoint.close(resolve));
  await dav.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(() => {
  fs.rmSync(path.join(dataDir, 'vault.bin'), { force: true });
  dav.files.clear();
  dav.folders.clear();
  for (const folder of ['/', '/dav/']) dav.folders.add(folder);
  dav.requests.length = 0;
  dav.full = false;
});

async function connect(device, provider, input) {
  use(device);
  const connection = await provider.connect(input);
  await setSyncConfig({ mode: 'server', providerId: provider.id, connection, connectedAt: Date.now() });
  return connection;
}
const session = async () => ({ connection: (await getSyncConfig()).connection, update: async () => {} });
const wordsOf = async (device) => {
  use(device);
  return (await listEntries()).map((entry) => entry.text).sort();
};
const vaultOf = async (device) => {
  use(device);
  return serializeDocument(await readLocalDocument());
};

// --- The address the user types -----------------------------------------------------------------

test('only https addresses are accepted, except for this machine itself', () => {
  assert.equal(serverAddress(' https://cloud.example.com/dav/ ').href, 'https://cloud.example.com/dav/');
  assert.equal(serverAddress('http://localhost:8787').origin, 'http://localhost:8787');
  assert.equal(serverAddress('http://127.0.0.1:8787/x').origin, 'http://127.0.0.1:8787');
  for (const insecure of ['http://cloud.example.com/', 'http://192.168.1.10:8787', 'http://localhost.example.com/']) assert.throws(() => serverAddress(insecure), { code: 'sync_insecure' }, insecure);
  for (const bad of ['', 'cloud.example.com', 'ftp://example.com/x', 'not an address', 'https://user:secret@example.com/']) assert.throws(() => serverAddress(bad), { code: 'sync_url' }, bad);
});

test('the permission asked of the browser is for the one host that was entered', () => {
  assert.equal(originPattern(serverAddress('https://cloud.example.com:8443/remote.php/dav/')), 'https://cloud.example.com/*');
  assert.deepEqual(webdav.origins({ url: 'https://cloud.example.com/remote.php/dav/files/me/Wordvault' }), ['https://cloud.example.com/*']);
  assert.deepEqual(http.origins({ url: 'http://localhost:8787' }), ['http://localhost/*']);
  assert.throws(() => webdav.origins({ url: 'http://example.com/dav/' }), { code: 'sync_insecure' });
  assert.throws(() => http.origins({ url: '' }), { code: 'sync_url' });
});

test('both kinds of server are registered, with the fields their forms need', () => {
  assert.deepEqual(listSyncProviders().filter((provider) => provider.kind === 'server').map((provider) => provider.id), ['webdav', 'http']);
  assert.deepEqual(getSyncProvider('webdav').fields.map((field) => `${field.key}:${field.type}`), ['url:url', 'username:text', 'password:password']);
  assert.deepEqual(getSyncProvider('http').fields.map((field) => `${field.key}:${field.type}`), ['url:url', 'key:password']);
});

// --- The simple HTTP endpoint, against the example server ------------------------------------------

test('http endpoint: connecting checks the key; a wrong key is said to be wrong', async () => {
  use(createDevice('A'));
  const connection = await http.connect({ url: `${endpointOrigin}/`, key: KEY });
  assert.equal(connection.url, `${endpointOrigin}/vault`);
  await assert.rejects(http.connect({ url: endpointOrigin, key: 'wrong' }), { code: 'sync_auth' });
  await assert.rejects(http.connect({ url: 'http://127.0.0.1:1', key: KEY }), { code: 'network' });
});

test('http endpoint: two devices end up with the same vault, and the server holds it on disk', async () => {
  const a = createDevice('A');
  const b = createDevice('B');
  await connect(a, http, { url: endpointOrigin, key: KEY });
  for (const text of ['book', 'door']) await addEntry(word(text));
  assert.equal((await syncNow({ sleep })).state, 'idle');
  const onDisk = fs.readFileSync(path.join(dataDir, 'vault.bin'));
  assert.deepEqual(Object.keys((await decodeDocument(new Uint8Array(onDisk))).e).sort(), ['en|tr|book', 'en|tr|door']);

  await connect(b, http, { url: endpointOrigin, key: KEY });
  await addEntry(word('tree'));
  assert.deepEqual((await syncNow({ sleep })).lastChanges, { added: 2, updated: 0, removed: 0 });
  await removeEntry('en|tr|door');
  await syncNow({ sleep });
  use(a);
  await syncNow({ sleep });
  assert.deepEqual(await wordsOf(a), ['book', 'tree']);
  assert.equal(await vaultOf(a), await vaultOf(b));
});

test('http endpoint: a write against a copy that changed gets 412, and the engine merges and repeats', async () => {
  const a = createDevice('A');
  await connect(a, http, { url: endpointOrigin, key: KEY });
  await addEntry(word('book'));
  await syncNow({ sleep });

  // The provider by itself: stale version, and "only if there is none" when there is one.
  const current = await http.read(await session());
  assert.match(current.version, /^"[0-9a-f]{32}"$/);
  await assert.rejects(http.write(await session(), new Uint8Array([1, 2, 3]), '"0000"'), { code: 'sync_conflict' });
  await assert.rejects(http.write(await session(), new Uint8Array([1, 2, 3]), null), { code: 'sync_conflict' });
  assert.deepEqual((await http.read(await session())).version, current.version, 'nothing was written');

  // Through the engine: another device writes between this one's read and write.
  await addEntry(word('door'));
  const theirs = await encodeDocument({ v: 1, e: { ...(await readLocalDocument()).e, 'en|tr|sea': { w: 'sea', t: 'deniz', sl: 'en', tl: 'tr', u: Date.now(), r: 1 } } });
  const realFetch = globalThis.fetch;
  let slipped = false;
  globalThis.fetch = async (input, init) => {
    if (!slipped && init?.method === 'PUT') {
      slipped = true;
      await realFetch(`${endpointOrigin}/vault`, { method: 'PUT', headers: { Authorization: `Bearer ${KEY}`, 'If-Match': current.version }, body: theirs });
    }
    return realFetch(input, init);
  };
  try {
    const sleeps = [];
    assert.equal((await syncNow({ sleep: async (ms) => sleeps.push(ms) })).state, 'idle');
    assert.deepEqual(sleeps, [500]);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(await wordsOf(a), ['book', 'door', 'sea']);
});

test('http endpoint: disconnecting deletes the stored document only when asked to', async () => {
  const a = createDevice('A');
  await connect(a, http, { url: endpointOrigin, key: KEY });
  await addEntry(word('book'));
  await syncNow({ sleep });
  await http.disconnect(await session(), { deleteRemote: false });
  assert.ok(fs.existsSync(path.join(dataDir, 'vault.bin')));
  await http.disconnect(await session(), { deleteRemote: true });
  assert.ok(!fs.existsSync(path.join(dataDir, 'vault.bin')));
  await http.disconnect(await session(), { deleteRemote: true }); // nothing there: not an error
  assert.equal(await http.read(await session()), null);
});

test('the example server: only /vault, only with the key, and it refuses what is too large', async () => {
  const get = (pathname, headers = {}) => fetch(`${endpointOrigin}${pathname}`, { headers });
  assert.equal((await get('/vault')).status, 401);
  assert.equal((await get('/vault', { Authorization: 'Bearer nope' })).status, 401);
  assert.equal((await get('/vault', { Authorization: `Bearer ${KEY}` })).status, 404);
  assert.equal((await get('/other', { Authorization: `Bearer ${KEY}` })).status, 404);
  assert.equal((await fetch(`${endpointOrigin}/vault`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: 'x' })).status, 405);
  const put = await fetch(`${endpointOrigin}/vault`, { method: 'PUT', headers: { Authorization: `Bearer ${KEY}`, 'If-None-Match': '*' }, body: 'first' });
  assert.equal(put.status, 201);
  const second = await fetch(`${endpointOrigin}/vault`, { method: 'PUT', headers: { Authorization: `Bearer ${KEY}`, 'If-None-Match': '*' }, body: 'second' });
  assert.equal(second.status, 412);
  const stored = await get('/vault', { Authorization: `Bearer ${KEY}` });
  assert.deepEqual([stored.status, await stored.text(), stored.headers.get('ETag')], [200, 'first', put.headers.get('ETag')]);
  const big = await fetch(`${endpointOrigin}/vault`, { method: 'PUT', headers: { Authorization: `Bearer ${KEY}`, 'If-Match': put.headers.get('ETag') }, body: new Uint8Array(21 * 1024 * 1024) });
  assert.equal(big.status, 413);
  assert.throws(() => createVaultServer({ key: '', dataDir }), /key is required/);
});

// --- WebDAV ---------------------------------------------------------------------------------------

const davInput = (folder = '/dav/Wordvault/') => ({ url: `${dav.origin}${folder}`, username: 'ayşe', password: 'app-pass word' });

test('webdav: connecting checks the password and creates the folder if it is missing', async () => {
  use(createDevice('A'));
  const connection = await webdav.connect({ ...davInput('/dav/Wordvault') }); // without the final slash
  assert.equal(connection.url, `${dav.origin}/dav/Wordvault/`);
  assert.deepEqual(dav.requests, ['PROPFIND /dav/Wordvault/', 'MKCOL /dav/Wordvault/']);
  assert.ok(dav.folders.has('/dav/Wordvault/'));
  assert.deepEqual(await webdav.accountInfo({ connection }), { name: 'ayşe' });
  assert.equal(webdav.location(connection), `${dav.origin}/dav/Wordvault/wordvault-vault.json.gz`);

  dav.requests.length = 0;
  await webdav.connect(davInput());
  assert.deepEqual(dav.requests, ['PROPFIND /dav/Wordvault/'], 'a folder that exists is left alone');

  await assert.rejects(webdav.connect({ ...davInput(), password: 'wrong' }), { code: 'sync_auth' });
  await assert.rejects(webdav.connect(davInput('/dav/no/such/parent/')), { code: 'sync_not_found' });
  await assert.rejects(webdav.connect({ ...davInput(), url: 'http://example.com/dav/' }), { code: 'sync_insecure' });
});

test('webdav: two devices end up with the same vault through the folder', async () => {
  const a = createDevice('A');
  const b = createDevice('B');
  await connect(a, webdav, davInput());
  for (const text of ['book', 'door']) await addEntry(word(text));
  assert.equal((await syncNow({ sleep })).state, 'idle');
  const stored = dav.files.get('/dav/Wordvault/wordvault-vault.json.gz');
  assert.deepEqual([...stored.subarray(0, 2)], [0x1f, 0x8b]);

  await connect(b, webdav, davInput());
  await addEntry(word('tree'));
  await syncNow({ sleep });
  use(a);
  await syncNow({ sleep });
  assert.deepEqual(await wordsOf(a), ['book', 'door', 'tree']);
  assert.equal(await vaultOf(a), await vaultOf(b));
  assert.ok(dav.requests.every((request) => request.includes('/dav/Wordvault/')), 'nothing outside the folder was touched');
});

test('webdav: writes are conditional on the ETag; a copy that changed is merged, not overwritten', async () => {
  const a = createDevice('A');
  await connect(a, webdav, davInput());
  await addEntry(word('book'));
  await syncNow({ sleep });
  const file = '/dav/Wordvault/wordvault-vault.json.gz';
  await assert.rejects(webdav.write(await session(), new Uint8Array([1]), '"stale"'), { code: 'sync_conflict' });
  await assert.rejects(webdav.write(await session(), new Uint8Array([1]), null), { code: 'sync_conflict' });

  await addEntry(word('door'));
  // Another device replaces the file after this one read it.
  const theirs = Buffer.from(await encodeDocument({ v: 1, e: { ...(await readLocalDocument()).e, 'en|tr|sea': { w: 'sea', t: 'deniz', sl: 'en', tl: 'tr', u: Date.now(), r: 1 } } }));
  const realFetch = globalThis.fetch;
  let slipped = false;
  globalThis.fetch = async (input, init) => {
    if (!slipped && init?.method === 'PUT') {
      slipped = true;
      dav.files.set(file, theirs);
    }
    return realFetch(input, init);
  };
  try {
    assert.equal((await syncNow({ sleep })).state, 'idle');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(await wordsOf(a), ['book', 'door', 'sea']);
  assert.equal(Object.keys((await decodeDocument(new Uint8Array(dav.files.get(file)))).e).length, 3);
});

test('webdav: a server that does not name the new ETag after a PUT is asked for it', async () => {
  const quiet = await startWebdavServer({ user: 'u', password: 'p', etagOnPut: false });
  try {
    const a = createDevice('A');
    await connect(a, webdav, { url: `${quiet.origin}/dav/W/`, username: 'u', password: 'p' });
    await addEntry(word('book'));
    assert.equal((await syncNow({ sleep })).state, 'idle');
    assert.ok(quiet.requests.includes('HEAD /dav/W/wordvault-vault.json.gz'));
    await addEntry(word('door'));
    assert.equal((await syncNow({ sleep })).state, 'idle', 'and the next conditional write goes through');
  } finally {
    await quiet.close();
  }
});

test('webdav: a full server, a changed password: told apart, and the vault stays whole', async () => {
  const a = createDevice('A');
  await connect(a, webdav, davInput());
  await addEntry(word('book'));
  dav.full = true;
  let status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_quota']);
  dav.full = false;

  await setSyncConfig({ ...(await getSyncConfig()), connection: { ...(await getSyncConfig()).connection, password: 'changed elsewhere' } });
  status = await syncNow({ sleep });
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_auth']);
  assert.deepEqual(await wordsOf(a), ['book']);
});

test('webdav: disconnecting deletes the file only when asked to', async () => {
  const a = createDevice('A');
  await connect(a, webdav, davInput());
  await addEntry(word('book'));
  await syncNow({ sleep });
  await webdav.disconnect(await session(), { deleteRemote: false });
  assert.equal(dav.files.size, 1);
  await webdav.disconnect(await session(), { deleteRemote: true });
  assert.equal(dav.files.size, 0);
  await webdav.disconnect(await session(), { deleteRemote: true });
});
