// Browser sync: the document compressed, cut into pieces and kept in chrome.storage.sync.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { addEntry, listEntries, removeEntry } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument, fromBase64, toBase64 } from '../src/sync/codec.js';
import { syncNow } from '../src/sync/engine.js';
import { readLocalDocument } from '../src/sync/local.js';
import { serializeDocument } from '../src/sync/merge.js';
import { browser } from '../src/sync/providers/browser.js';
import { getSyncProvider } from '../src/sync/providers/index.js';
import { getSyncStatus, setSyncConfig } from '../src/sync/state.js';
import { createDevice, syncStorageArea, use } from './helpers/chrome.js';

const T0 = 1_790_000_000_000;
const session = { connection: {}, update: async () => {} };
/** Bytes that do not compress: what a large vault looks like after gzip. */
function noise(length, seed = 7) {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[index] = state >> 16;
  }
  return bytes;
}

let device;
beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  device = use(createDevice('A'));
});
const stored = () => Object.fromEntries(device.sync.data);
const word = (text) => ({ text, translation: `${text} çevirisi`, sourceLang: 'en', targetLang: 'tr', sentence: `A sentence that has the word ${text} in it somewhere.` });

test('the registry knows browser sync', () => {
  assert.equal(getSyncProvider('browser'), browser);
  assert.equal(browser.kind, 'browser');
});

test('nothing stored yet reads as "no remote copy"', async () => {
  assert.equal(await browser.read(session), null);
  assert.deepEqual(await browser.connect(), {});
});

test('a small document is one piece; what is read back is what was written', async () => {
  const data = noise(900);
  const { version } = await browser.write(session, data, null);
  assert.equal(version, '1');
  assert.deepEqual(Object.keys(stored()).sort(), ['wv_0', 'wv_meta']);
  assert.deepEqual(stored().wv_meta, { v: 1, n: 1, rev: 1, at: T0 });
  const read = await browser.read(session);
  assert.deepEqual([...read.data], [...data]);
  assert.equal(read.version, '1');
});

test('a larger document is cut into pieces of about 7 KB, written in one call', async () => {
  const data = noise(30_000);
  await browser.write(session, data, null);
  const pieces = Object.keys(stored()).filter((key) => key !== 'wv_meta');
  assert.equal(pieces.length, Math.ceil(toBase64(data).length / 7000));
  assert.ok(pieces.every((key) => stored()[key].length <= 7000 && key.length + stored()[key].length + 2 < 8192), 'each piece fits into one item');
  assert.equal(stored().wv_meta.n, pieces.length);
  assert.deepEqual(device.sync.calls, [`set ${pieces.length + 1}`], 'one write for the whole version');
  assert.deepEqual([...(await browser.read(session)).data], [...data]);
});

test('a shorter version removes the pieces the longer one left behind', async () => {
  await browser.write(session, noise(30_000), null);
  assert.equal(stored().wv_meta.n, 6);
  const { version } = await browser.write(session, noise(9000, 3), '1');
  assert.equal(version, '2');
  assert.deepEqual(Object.keys(stored()).sort(), ['wv_0', 'wv_1', 'wv_meta']);
  assert.deepEqual([...(await browser.read(session)).data], [...noise(9000, 3)]);
  // other things in the browser's sync storage are not Wordvault's to touch
  await device.sync.set({ somethingElse: 1 });
  await browser.write(session, noise(100), '2');
  assert.deepEqual(Object.keys(stored()).sort(), ['somethingElse', 'wv_0', 'wv_meta']);
});

test('a write against a version that is no longer there is refused', async () => {
  await browser.write(session, noise(100), null);
  await assert.rejects(browser.write(session, noise(100, 2), null), { code: 'sync_conflict' });
  await assert.rejects(browser.write(session, noise(100, 2), '7'), { code: 'sync_conflict' });
  assert.equal(stored().wv_meta.rev, 1, 'and nothing was written');
  assert.equal((await browser.write(session, noise(100, 2), '1')).version, '2');
});

test('a version of which a piece has not arrived yet is not taken for a document', async () => {
  await browser.write(session, noise(20_000), null);
  device.sync.data.delete('wv_1');
  await assert.rejects(browser.read(session), { code: 'sync_incomplete' });
});

test('a document that does not fit is refused before anything is written', async () => {
  await browser.write(session, noise(5000), null);
  const before = JSON.stringify(stored());
  await assert.rejects(browser.write(session, noise(90_000), '1'), { code: 'sync_quota' });
  assert.equal(JSON.stringify(stored()), before, 'the version that was there is untouched');
  assert.deepEqual(device.sync.calls, ['set 2']);
});

test('the browser\'s own refusals are told apart: no room, or too many writes for now', async () => {
  device.sync.failNextWrite = new Error('QUOTA_BYTES quota exceeded');
  await assert.rejects(browser.write(session, noise(100), null), { code: 'sync_quota' });
  device.sync.failNextWrite = new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.');
  await assert.rejects(browser.write(session, noise(100), null), { code: 'sync_incomplete' });
  device.sync.failNextWrite = new Error('something else');
  await assert.rejects(browser.write(session, noise(100), null), { code: 'sync_provider' });
});

test('how full the storage is can be told', async () => {
  assert.deepEqual(await browser.usage(session), { used: 0, total: 102_400 });
  await browser.write(session, noise(30_000), null);
  const { used, total } = await browser.usage(session);
  assert.ok(used > 40_000 && used < 41_500, String(used));
  assert.equal(total, 102_400);
});

test('disconnecting leaves the stored copy alone unless asked to delete it', async () => {
  await browser.write(session, noise(9000), null);
  await device.sync.set({ somethingElse: 1 });
  await browser.disconnect(session, { deleteRemote: false });
  assert.equal(Object.keys(stored()).length, 4);
  await browser.disconnect(session, { deleteRemote: true });
  assert.deepEqual(Object.keys(stored()), ['somethingElse']);
});

test('base64 survives every byte value', () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
  assert.throws(() => fromBase64('not base64 !!'), { code: 'sync_bad_document' });
});

test('two browsers signed in to the same account end up with the same vault', async () => {
  const account = syncStorageArea();
  const a = use(createDevice('A', { sync: account }));
  const b = createDevice('B', { sync: account });
  for (const one of [a, b]) {
    use(one);
    await setSyncConfig({ mode: 'browser', providerId: 'browser', connection: {}, connectedAt: T0 });
  }
  use(a);
  for (const text of ['book', 'door', 'tree']) await addEntry(word(text));
  let status = await syncNow();
  assert.equal(status.state, 'idle');
  assert.ok(status.usage.used > 0 && status.usage.total === 102_400);

  use(b);
  await addEntry(word('sea'));
  status = await syncNow();
  assert.deepEqual(status.lastChanges, { added: 3, updated: 0, removed: 0 });
  await removeEntry('en|tr|door');
  await syncNow();

  use(a);
  await syncNow();
  assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'sea', 'tree']);
  const mine = serializeDocument(await readLocalDocument());
  use(b);
  assert.equal(serializeDocument(await readLocalDocument()), mine);
  // what sits in the browser's storage is the compressed document, nothing else
  const pieces = [...account.data].filter(([key]) => /^wv_\d+$/.test(key)).sort(([x], [y]) => Number(x.slice(3)) - Number(y.slice(3)));
  const document = await decodeDocument(fromBase64(pieces.map(([, value]) => value).join('')));
  assert.equal(serializeDocument(document), mine);
});

test('a vault too large for browser sync: synchronisation stops, the vault stays whole and usable', async () => {
  use(createDevice('small', { sync: syncStorageArea({ quotaBytes: 1500 }) }));
  await setSyncConfig({ mode: 'browser', providerId: 'browser', connection: {}, connectedAt: T0 });
  for (let n = 0; n < 5; n++) await addEntry(word(`word${n}`));
  assert.equal((await syncNow()).state, 'idle');

  for (let n = 5; n < 120; n++) await addEntry(word(`word${n}-${(n * 7919) % 104729}`));
  assert.ok(toBase64(await encodeDocument(await readLocalDocument())).length > 1500, 'it really is too large');
  const status = await syncNow();
  assert.deepEqual([status.state, status.error.code, status.pending], ['error', 'sync_quota', true]);
  assert.equal((await listEntries()).length, 120, 'nothing was deleted to make room');
  // the copy that did fit is still there for the other devices
  const read = await browser.read(session);
  assert.equal(Object.keys((await decodeDocument(read.data)).e).length, 5);
  // and it is not tried again by itself
  assert.equal((await syncNow({ reason: 'periodic' })).error.code, 'sync_quota');
  assert.equal((await getSyncStatus()).lastSyncAt, T0);
});
