// Browser sync: the document compressed, cut into pieces and kept in chrome.storage.sync.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { addEntry, listEntries, removeEntry } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument, fromBase64, toBase64 } from '../src/sync/codec.js';
import { SYNC, SYNC_REMOTE_ALARM, remoteChanged, syncNow } from '../src/sync/engine.js';
import { readLocalDocument } from '../src/sync/local.js';
import { serializeDocument } from '../src/sync/merge.js';
import { browser, deviceId } from '../src/sync/providers/browser.js';
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

/** This device's keys in the browser's sync storage. */
const own = async () => {
  const id = await deviceId();
  return { meta: `wv:${id}:m`, piece: (index) => `wv:${id}:${index}`, pieces: () => Object.keys(stored()).filter((key) => key.startsWith(`wv:${id}:`) && !key.endsWith(':m')) };
};

test('every device has a name of its own, kept in local storage only', async () => {
  const id = await deviceId();
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(await deviceId(), id);
  assert.notEqual(await (use(createDevice('B')), deviceId()), id);
  assert.equal(device.sync.data.size, 0);
});

test('a small document is one piece; what is read back is what was written', async () => {
  const data = noise(900);
  const { version } = await browser.write(session, data, null);
  assert.equal(version, '1');
  const keys = await own();
  assert.deepEqual(Object.keys(stored()).sort(), [keys.piece(0), keys.meta].sort());
  const { h, ...meta } = stored()[keys.meta];
  assert.deepEqual(meta, { v: 2, n: 1, rev: 1, at: T0 });
  assert.match(h, /^[0-9a-f]{16}$/);
  const read = await browser.read(session);
  assert.deepEqual([...read.data], [...data]);
  assert.equal(read.version, '1');
  assert.deepEqual(read.others, []);
});

test('a larger document is cut into pieces of about 7 KB, written in one call', async () => {
  const data = noise(30_000);
  await browser.write(session, data, null);
  const keys = await own();
  const pieces = keys.pieces();
  assert.equal(pieces.length, Math.ceil(toBase64(data).length / 7000));
  assert.ok(pieces.every((key) => stored()[key].length <= 7000 && key.length + stored()[key].length + 2 < 8192), 'each piece fits into one item');
  assert.equal(stored()[keys.meta].n, pieces.length);
  assert.deepEqual(device.sync.calls, [`set ${pieces.length + 1}`], 'one write for the whole version');
  assert.deepEqual([...(await browser.read(session)).data], [...data]);
});

test('a shorter version removes the pieces the longer one left behind', async () => {
  const keys = await own();
  await browser.write(session, noise(30_000), null);
  assert.equal(stored()[keys.meta].n, 6);
  const { version } = await browser.write(session, noise(9000, 3), '1');
  assert.equal(version, '2');
  assert.deepEqual(Object.keys(stored()).sort(), [keys.piece(0), keys.piece(1), keys.meta].sort());
  assert.deepEqual([...(await browser.read(session)).data], [...noise(9000, 3)]);
  // other things in the browser's sync storage are not Wordvault's to touch
  await device.sync.set({ somethingElse: 1 });
  await browser.write(session, noise(100), '2');
  assert.deepEqual(Object.keys(stored()).sort(), ['somethingElse', keys.piece(0), keys.meta].sort());
});

test('a write against a version that is no longer there is refused', async () => {
  const keys = await own();
  await browser.write(session, noise(100), null);
  await assert.rejects(browser.write(session, noise(100, 2), null), { code: 'sync_conflict' });
  await assert.rejects(browser.write(session, noise(100, 2), '7'), { code: 'sync_conflict' });
  assert.equal(stored()[keys.meta].rev, 1, 'and nothing was written');
  assert.equal((await browser.write(session, noise(100, 2), '1')).version, '2');
});

/** Writes `data` as the copy of another device, the way its Wordvault would. */
async function writeAs(name, data, area = device.sync) {
  use(createDevice(name, { sync: area }));
  await browser.write(session, data, (await browser.read(session))?.version ?? null);
  const id = await deviceId();
  use(device);
  return id;
}

test('the other devices\' copies are read as well, and only complete ones', async () => {
  await browser.write(session, noise(500), null);
  const b = await writeAs('B', noise(20_000, 5));
  let read = await browser.read(session);
  assert.deepEqual(read.others.map((other) => other.id), [b]);
  assert.deepEqual([...read.others[0].data], [...noise(20_000, 5)]);
  assert.deepEqual([...read.data], [...noise(500)], 'and this device\'s own is still the main one');

  // a piece still on its way: that copy is left out this time, nothing fails
  const missing = device.sync.data.get(`wv:${b}:1`);
  device.sync.data.delete(`wv:${b}:1`);
  read = await browser.read(session);
  assert.deepEqual(read.others, []);
  // a piece of an older version of the same copy: the fingerprint does not match, left out too
  device.sync.data.set(`wv:${b}:1`, missing.split('').reverse().join(''));
  assert.deepEqual((await browser.read(session)).others, []);
});

test('a device with no copy of its own yet still reads the others\'', async () => {
  const b = await writeAs('B', noise(300, 9));
  const read = await browser.read(session);
  assert.equal(read.data, null);
  assert.equal(read.version, null);
  assert.deepEqual(read.others.map((other) => other.id), [b]);
});

test('two devices writing at the same moment cannot spoil each other\'s copy', async () => {
  // what the browsers do: each device writes into its own storage, then sync merges key by key
  const a = syncStorageArea();
  const b = syncStorageArea();
  use(createDevice('A', { sync: a }));
  await browser.write(session, noise(20_000, 1), null);
  const idA = await deviceId();
  use(createDevice('B', { sync: b }));
  await browser.write(session, noise(20_000, 2), null);
  const idB = await deviceId();
  for (const [key, value] of b.data) a.data.set(key, value);
  for (const [key, value] of a.data) b.data.set(key, value);
  for (const [area, id, mine, theirs] of [[a, idA, 1, 2], [b, idB, 2, 1]]) {
    use(createDevice('again', { sync: area }));
    await chrome.storage.local.set({ syncDeviceId: id });
    const read = await browser.read(session);
    assert.deepEqual([...read.data], [...noise(20_000, mine)]);
    assert.deepEqual([...read.others[0].data], [...noise(20_000, theirs)]);
  }
});

test('the shared copy of earlier versions is merged in once, then removed', async () => {
  const legacy = toBase64(noise(9000, 4));
  await device.sync.set({ wv_meta: { v: 1, n: 2, rev: 3, at: T0 }, wv_0: legacy.slice(0, 7000), wv_1: legacy.slice(7000) });
  const read = await browser.read(session);
  assert.equal(read.data, null);
  assert.deepEqual(read.others.map((other) => other.id), ['legacy']);
  assert.deepEqual([...read.others[0].data], [...noise(9000, 4)]);
  await browser.write(session, noise(100), null);
  assert.deepEqual(Object.keys(stored()).filter((key) => key.startsWith('wv_')), []);
});

test('copies of devices that have not synchronised for 60 days are removed', async () => {
  const b = await writeAs('B', noise(300, 9));
  const c = await writeAs('C', noise(300, 8));
  device.sync.data.set(`wv:${c}:m`, { ...device.sync.data.get(`wv:${c}:m`), at: T0 - 61 * 86_400_000 });
  await browser.write(session, noise(100), null);
  assert.ok(stored()[`wv:${b}:m`], 'a device that is still there keeps its copy');
  assert.deepEqual(Object.keys(stored()).filter((key) => key.startsWith(`wv:${c}:`)), []);
});

test('changes are told apart: another device\'s copy, or this device\'s own write', async () => {
  const keys = await own();
  assert.equal(await browser.isForeignChange([keys.meta, keys.piece(0)]), false);
  assert.equal(await browser.isForeignChange(['somethingElse']), false);
  assert.equal(await browser.isForeignChange(['wv:0123456789ab:m']), true);
  assert.equal(await browser.isForeignChange(['wv_meta']), true);
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
  // the copies of other devices go too: Wordvault's data leaves the browser's sync storage
  await writeAs('B', noise(100));
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
  use(a);
  const keys = await own();
  const text = [...account.data].filter(([key]) => key.startsWith(keys.meta.slice(0, -1)) && key !== keys.meta).sort(([x], [y]) => Number(x.split(':')[2]) - Number(y.split(':')[2])).map(([, value]) => value).join('');
  assert.equal(serializeDocument(await decodeDocument(fromBase64(text))), mine);
});

/** Firefox Sync and Chrome sync: what one browser stored reaches the other, key by key. */
const carry = (from, to) => {
  for (const [key, value] of from.data) to.data.set(key, structuredClone(value));
};

test('two browsers that synchronised at the same moment still end up with the same vault', async () => {
  const storeA = syncStorageArea();
  const storeB = syncStorageArea();
  const a = use(createDevice('A', { sync: storeA }));
  await setSyncConfig({ mode: 'browser', providerId: 'browser', connection: {}, connectedAt: T0 });
  const b = use(createDevice('B', { sync: storeB }));
  await setSyncConfig({ mode: 'browser', providerId: 'browser', connection: {}, connectedAt: T0 });

  // both add words and synchronise before the browsers have exchanged anything
  use(a);
  for (const text of ['book', 'door']) await addEntry(word(text));
  await syncNow();
  use(b);
  for (const text of ['sea', 'sky']) await addEntry(word(text));
  await syncNow();
  // the browsers exchange their sync storage, both ways
  carry(storeA, storeB);
  carry(storeB, storeA);
  for (const one of [a, b]) {
    use(one);
    const status = await syncNow({ reason: 'remote' });
    assert.equal(status.state, 'idle', JSON.stringify(status.error));
    assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'door', 'sea', 'sky']);
  }
  // a removal travels the same way and the word does not come back
  use(a);
  await removeEntry('en|tr|door');
  await syncNow();
  carry(storeA, storeB);
  use(b);
  await syncNow({ reason: 'remote' });
  carry(storeB, storeA);
  use(a);
  await syncNow({ reason: 'remote' });
  for (const one of [a, b]) {
    use(one);
    assert.deepEqual((await listEntries()).map((entry) => entry.text).sort(), ['book', 'sea', 'sky']);
  }
});

test('another device\'s copy arriving starts a synchronisation; this device\'s own writes do not', async () => {
  use(device);
  await setSyncConfig({ mode: 'browser', providerId: 'browser', connection: {}, connectedAt: T0 });
  const keys = await own();
  await remoteChanged([keys.meta, keys.piece(0)]);
  assert.equal(device.alarmTimes()[SYNC_REMOTE_ALARM], undefined);
  await remoteChanged(['wv:0123456789ab:m']);
  assert.equal(device.alarmTimes()[SYNC_REMOTE_ALARM], T0 + SYNC.DEBOUNCE_MS);
  // and only while browser sync is the mode chosen
  await chrome.alarms.clear(SYNC_REMOTE_ALARM);
  await setSyncConfig({ mode: 'off', providerId: '', connection: null, connectedAt: 0 });
  await remoteChanged(['wv:0123456789ab:m']);
  assert.equal(device.alarmTimes()[SYNC_REMOTE_ALARM], undefined);
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
