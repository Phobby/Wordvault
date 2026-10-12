// The synchronisation engine with two devices and a cloud that lives in memory: whatever the
// devices do, in whatever order, they end up with the same vault and nothing is lost.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { WordvaultError } from '../src/lib/errors.js';
import { addEntry, getEntry, listEntries, listTombstones, removeEntry, updateEntry } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument } from '../src/sync/codec.js';
import { SYNC, SYNC_ALARM, SYNC_SOON_ALARM, ensureSyncScheduled, onSyncAlarm, syncInBackground, syncNow, vaultChanged } from '../src/sync/engine.js';
import { applyDocument, readLocalDocument } from '../src/sync/local.js';
import { mergeDocuments, serializeDocument } from '../src/sync/merge.js';
import { TOMBSTONE_TTL_MS, isTombstone } from '../src/sync/model.js';
import { registerSyncProvider } from '../src/sync/providers/index.js';
import { getSyncStatus, setSyncConfig } from '../src/sync/state.js';
import { createDevice, use } from './helpers/chrome.js';
import { createCloud } from './helpers/memory-provider.js';

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

let cloud;
let a;
let b;
/** The waits the engine asked for between attempts; they are not really waited. */
let sleeps;
const sleep = async (ms) => sleeps.push(ms);

async function connect(device) {
  use(device);
  await setSyncConfig({ mode: 'cloud', providerId: 'memory', connection: { account: `${device.name}@example.com` }, connectedAt: Date.now() });
  return device;
}
beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  let provider;
  ({ cloud, provider } = createCloud());
  registerSyncProvider(provider);
  sleeps = [];
  a = await connect(createDevice('A'));
  b = await connect(createDevice('B'));
});
const at = (t, time) => t.mock.timers.setTime(time);
const word = (text, translation = `${text}-tr`) => ({ text, translation, sourceLang: 'en', targetLang: 'tr' });
const sync = (device, reason = 'manual') => {
  use(device);
  return syncNow({ reason, sleep });
};
/** What a device holds, as text: equal vaults give equal text. */
async function vaultOf(device) {
  use(device);
  return serializeDocument(await readLocalDocument());
}
const wordsOf = async (device) => {
  use(device);
  return (await listEntries()).map((entry) => entry.text).sort();
};
const cloudDocument = async () => decodeDocument(cloud.data());
/**
 * Another device synchronising in the middle of this one's run: its vault is merged into the
 * cloud's copy, which thereby gets a new version. (Done by hand: this process has one engine
 * and one browser at a time, and the engine is busy with the device under test.)
 */
async function meanwhile(other, current) {
  use(other);
  const merged = mergeDocuments(await cloudDocument(), await readLocalDocument());
  cloud.files[0].data = await encodeDocument(merged);
  cloud.files[0].version = `${cloud.files[0].version}+`;
  await applyDocument(merged);
  use(current);
}

test('first synchronisation creates the remote copy from the vault; the second device gets it', async () => {
  use(a);
  await addEntry(word('book'));
  await addEntry(word('door'));
  let status = await sync(a);
  assert.deepEqual([status.state, status.error, status.pending], ['idle', null, false]);
  assert.equal(status.lastSyncAt, T0);
  assert.deepEqual(Object.keys((await cloudDocument()).e).sort(), ['en|tr|book', 'en|tr|door']);

  status = await sync(b);
  assert.deepEqual(status.lastChanges, { added: 2, updated: 0, removed: 0 });
  assert.deepEqual(await wordsOf(b), ['book', 'door']);
  assert.equal(await vaultOf(a), await vaultOf(b));
  assert.equal(cloud.writes, 1, 'the second device had nothing to add, so it wrote nothing');
});

test('changes made one after the other on two devices reach both', async (t) => {
  use(a);
  await addEntry(word('book'));
  await sync(a);
  await sync(b);

  at(t, T0 + MINUTE);
  use(b);
  await addEntry(word('tree'));
  await updateEntry('en|tr|book', { translation: 'kitap' });
  await sync(b);
  at(t, T0 + 2 * MINUTE);
  use(a);
  await addEntry(word('sea'));
  await sync(a);
  await sync(b);

  assert.deepEqual(await wordsOf(a), ['book', 'sea', 'tree']);
  assert.equal(await vaultOf(a), await vaultOf(b));
  use(a);
  assert.equal((await getEntry('en|tr|book')).translation, 'kitap');
});

test('both devices change the same word while apart: the later edit wins on both', async (t) => {
  use(a);
  await addEntry(word('book'));
  await sync(a);
  await sync(b);

  at(t, T0 + MINUTE);
  use(a);
  await updateEntry('en|tr|book', { translation: 'kitap (A)' });
  at(t, T0 + 2 * MINUTE);
  use(b);
  await updateEntry('en|tr|book', { translation: 'kitap (B)' });

  // whichever order they synchronise in
  await sync(b);
  await sync(a);
  await sync(b);
  for (const device of [a, b]) {
    use(device);
    assert.equal((await getEntry('en|tr|book')).translation, 'kitap (B)');
  }
  assert.equal(await vaultOf(a), await vaultOf(b));
});

test('two devices synchronise at the same moment: the one that loses the race merges and tries again', async () => {
  use(a);
  await addEntry(word('book'));
  await sync(a);
  await sync(b);
  use(a);
  await addEntry(word('from-a'));
  use(b);
  await addEntry(word('from-b'));

  // B writes after A has read and before A writes.
  cloud.beforeWrite = () => meanwhile(b, a);
  const status = await sync(a);
  assert.equal(status.state, 'idle');
  assert.deepEqual(sleeps, [SYNC.BACKOFF_MS], 'one conflict, one wait, then it went through');
  assert.deepEqual(Object.keys((await cloudDocument()).e).sort(), ['en|tr|book', 'en|tr|from-a', 'en|tr|from-b'], 'neither write was lost');
  assert.deepEqual(await wordsOf(a), ['book', 'from-a', 'from-b']);
  await sync(b);
  assert.equal(await vaultOf(a), await vaultOf(b));
});

test('a write that keeps losing the race gives up after five attempts, changes nothing here, and succeeds later', async () => {
  use(a);
  await addEntry(word('book'));
  await sync(a);
  await addEntry(word('door'));
  const before = await vaultOf(a);
  cloud.failing.write = new WordvaultError('sync_conflict', '412 Precondition Failed');
  let status = await sync(a);
  assert.deepEqual([status.state, status.error.code, status.pending, status.failures], ['waiting', 'sync_conflict', true, 1]);
  assert.equal(cloud.reads, 1 + SYNC.MAX_ATTEMPTS, 'it read again before every attempt');
  assert.deepEqual(sleeps, [500, 1000, 2000, 4000], 'waiting twice as long each time');
  assert.equal(await vaultOf(a), before);

  cloud.failing = {};
  status = await sync(a);
  assert.deepEqual([status.state, status.error, status.pending, status.failures], ['idle', null, false, 0]);
  assert.deepEqual(Object.keys((await cloudDocument()).e).sort(), ['en|tr|book', 'en|tr|door']);
});

test('a word removed on one device goes away on the other and does not come back', async (t) => {
  use(a);
  await addEntry(word('book'));
  await addEntry(word('door'));
  await sync(a);
  await sync(b);

  at(t, T0 + MINUTE);
  use(a);
  await removeEntry('en|tr|book');
  await sync(a);
  const status = await sync(b);
  assert.deepEqual(status.lastChanges, { added: 0, updated: 0, removed: 1 });
  assert.deepEqual(await wordsOf(b), ['door']);

  // B still had the word when A removed it; synchronising again in any order does not revive it.
  await sync(a);
  await sync(b);
  await sync(a);
  assert.deepEqual(await wordsOf(a), ['door']);
  assert.deepEqual(await wordsOf(b), ['door']);
  assert.ok(isTombstone((await cloudDocument()).e['en|tr|book']));
});

test('adding a word again after it was removed brings it back everywhere', async (t) => {
  use(a);
  await addEntry(word('book'));
  await sync(a);
  await sync(b);
  at(t, T0 + MINUTE);
  use(a);
  await removeEntry('en|tr|book');
  await sync(a);
  await sync(b);

  at(t, T0 + 2 * MINUTE);
  use(b);
  await addEntry(word('book', 'kitap'));
  await sync(b);
  await sync(a);
  for (const device of [a, b]) {
    use(device);
    assert.equal((await getEntry('en|tr|book')).translation, 'kitap');
    assert.deepEqual(await listTombstones(), []);
  }
  assert.equal(await vaultOf(a), await vaultOf(b));
});

test('a removal that is 90 days old is dropped from the cloud and the devices at the next synchronisation', async (t) => {
  use(a);
  await addEntry(word('book'));
  await addEntry(word('door'));
  await sync(a);
  await sync(b);
  use(a);
  await removeEntry('en|tr|book');
  await sync(a);
  await sync(b);
  assert.equal(Object.keys((await cloudDocument()).e).length, 2);

  at(t, T0 + TOMBSTONE_TTL_MS - DAY);
  await sync(a);
  assert.equal(Object.keys((await cloudDocument()).e).length, 2, 'not yet');

  at(t, T0 + TOMBSTONE_TTL_MS + DAY);
  await sync(a);
  assert.deepEqual(Object.keys((await cloudDocument()).e), ['en|tr|door']);
  await sync(b);
  for (const device of [a, b]) {
    use(device);
    assert.deepEqual(await listTombstones(), []);
    assert.deepEqual(await wordsOf(device), ['door']);
  }
});

test('connecting for the first time: fifty words here and fifty others in the cloud make a hundred on both sides', async () => {
  use(b);
  for (let n = 0; n < 50; n++) await addEntry(word(`cloud${n}`));
  await sync(b); // an earlier device left these in the cloud
  use(a);
  for (let n = 0; n < 50; n++) await addEntry(word(`local${n}`));

  const status = await sync(a);
  assert.deepEqual(status.lastChanges, { added: 50, updated: 0, removed: 0 });
  assert.equal((await wordsOf(a)).length, 100);
  assert.equal(Object.keys((await cloudDocument()).e).length, 100);
  await sync(b);
  assert.equal((await wordsOf(b)).length, 100);
  assert.equal(await vaultOf(a), await vaultOf(b));
});

test('two devices connect for the first time at the same moment: two files become one', async () => {
  let provider;
  ({ cloud, provider } = createCloud({ manyFiles: true }));
  registerSyncProvider(provider);
  use(a);
  for (const text of ['book', 'door']) await addEntry(word(text));
  use(b);
  for (const text of ['tree', 'sea']) await addEntry(word(text));

  // Neither sees the other's file yet, so each creates one.
  await sync(a);
  cloud.hidden = true;
  await sync(b);
  cloud.hidden = false;
  assert.equal(cloud.files.length, 2);
  const [oldest, newer] = cloud.files.map((file) => file.id);

  // Whoever synchronises next finds both, merges them, keeps the older file and removes the other.
  const status = await sync(b);
  assert.equal(status.state, 'idle');
  assert.deepEqual(cloud.files.map((file) => file.id), [oldest]);
  assert.deepEqual(cloud.removed, [newer]);
  assert.equal(Object.keys((await cloudDocument()).e).length, 4);
  await sync(a);
  assert.deepEqual(await wordsOf(a), ['book', 'door', 'sea', 'tree']);
  assert.equal(await vaultOf(a), await vaultOf(b));
});

test('the extra file is only removed after the merged one is safely stored', async () => {
  let provider;
  ({ cloud, provider } = createCloud({ manyFiles: true }));
  registerSyncProvider(provider);
  use(a);
  await addEntry(word('book'));
  await sync(a);
  use(b);
  await addEntry(word('tree'));
  cloud.hidden = true;
  await sync(b);
  cloud.hidden = false;

  cloud.failing.write = new WordvaultError('network', 'connection reset');
  const status = await sync(a);
  assert.equal(status.state, 'waiting');
  assert.equal(cloud.files.length, 2, 'both files are still there');
  assert.deepEqual(cloud.removed, []);
});

test('the network fails: nothing changes here, the change stays queued and goes out later', async () => {
  use(a);
  await addEntry(word('book'));
  await sync(a);
  await addEntry(word('door'));
  const before = await vaultOf(a);

  cloud.failing.read = new WordvaultError('network', 'failed to fetch');
  let status = await sync(a);
  assert.deepEqual([status.state, status.error.code, status.pending, status.lastSyncAt], ['waiting', 'network', true, T0]);
  assert.equal(await vaultOf(a), before);

  cloud.failing = { write: new WordvaultError('timeout') };
  status = await sync(a);
  assert.deepEqual([status.state, status.error.code, status.failures], ['waiting', 'timeout', 2]);
  assert.equal(await vaultOf(a), before);

  cloud.failing = {};
  status = await sync(a);
  assert.deepEqual([status.state, status.pending], ['idle', false]);
  assert.equal(Object.keys((await cloudDocument()).e).length, 2);
});

test('offline: no request is made, the change waits', async () => {
  use(a);
  await addEntry(word('book'));
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    const status = await sync(a);
    assert.deepEqual([status.state, status.error.code, status.pending], ['waiting', 'offline', true]);
    assert.equal(cloud.reads, 0);
  } finally {
    Object.defineProperty(globalThis, 'navigator', navigatorBefore);
  }
  assert.equal((await sync(a)).state, 'idle');
});

test('access was withdrawn: the user is told to connect again, and it is not retried behind their back', async () => {
  use(a);
  await addEntry(word('book'));
  cloud.failing.read = new WordvaultError('sync_auth', 'invalid_grant');
  let status = await sync(a);
  assert.deepEqual([status.state, status.error.code], ['error', 'sync_auth']);
  assert.deepEqual(await wordsOf(a), ['book']);

  const reads = cloud.reads;
  for (const reason of ['periodic', 'change', 'startup', 'retry']) status = await sync(a, reason);
  assert.equal(cloud.reads, reads, 'automatic runs leave it alone');
  assert.equal(status.error.code, 'sync_auth');
  // "Sync now" (and connecting again) do try
  cloud.failing = {};
  assert.equal((await sync(a, 'manual')).state, 'idle');
});

test('no room left: the user is told, the vault stays as it is and keeps working', async () => {
  use(a);
  await addEntry(word('book'));
  cloud.failing.write = new WordvaultError('sync_quota', 'insufficient storage');
  const status = await sync(a);
  assert.deepEqual([status.state, status.error.code, status.pending], ['error', 'sync_quota', true]);
  await addEntry(word('door'));
  assert.deepEqual(await wordsOf(a), ['book', 'door']);
});

test('a remote file that is not a Wordvault document is never overwritten', async () => {
  use(a);
  await addEntry(word('book'));
  for (const [data, code] of [
    [new TextEncoder().encode('this is not json'), 'sync_bad_document'],
    [new TextEncoder().encode('[1,2,3]'), 'sync_bad_document'],
    [new TextEncoder().encode('{"v":99,"e":{}}'), 'sync_newer_schema'],
    [new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4]), 'sync_bad_document'],
  ]) {
    cloud.files = [];
    const file = cloud.put(data);
    const writes = cloud.writes;
    const status = await sync(a);
    assert.deepEqual([status.state, status.error.code], ['error', code]);
    assert.equal(cloud.writes, writes);
    assert.equal(cloud.files[0].data, file.data, 'the file is as it was');
    assert.deepEqual(await wordsOf(a), ['book'], 'and so is the vault');
  }
});

test('a document written without compression is read too', async () => {
  use(b);
  await addEntry(word('tree'));
  cloud.put(new TextEncoder().encode(serializeDocument(await readLocalDocument())));
  await sync(a);
  assert.deepEqual(await wordsOf(a), ['tree']);
  // and what the engine writes is gzip
  use(a);
  await addEntry(word('book'));
  await sync(a);
  assert.deepEqual([...cloud.data().subarray(0, 2)], [0x1f, 0x8b]);
  assert.deepEqual(await decodeDocument(await encodeDocument(await readLocalDocument())), await readLocalDocument());
});

test('a word saved while a synchronisation is under way is neither lost nor overwritten', async (t) => {
  use(a);
  await addEntry(word('book', 'kitap'));
  await sync(a);
  await sync(b);
  at(t, T0 + MINUTE);
  use(b);
  await updateEntry('en|tr|book', { translation: 'defter' });
  await sync(b);

  // While A is writing, the user edits the same word on A and saves a new one.
  at(t, T0 + 2 * MINUTE);
  use(a);
  await addEntry(word('door'));
  cloud.beforeWrite = async () => {
    at(t, T0 + 3 * MINUTE);
    await updateEntry('en|tr|book', { translation: 'kitap (yeni)' });
    await addEntry(word('late'));
  };
  await sync(a);
  assert.equal((await getEntry('en|tr|book')).translation, 'kitap (yeni)', 'the edit made in the meantime stays');
  assert.deepEqual(await wordsOf(a), ['book', 'door', 'late']);
  // and it travels with the next run
  await sync(a);
  await sync(b);
  assert.equal(await vaultOf(a), await vaultOf(b));
  use(b);
  assert.equal((await getEntry('en|tr|book')).translation, 'kitap (yeni)');
});

test('only one synchronisation runs at a time; a request made meanwhile is followed up', async () => {
  use(a);
  await addEntry(word('book'));
  let release;
  cloud.beforeWrite = () => new Promise((resolve) => { release = resolve; });
  const first = syncNow({ reason: 'manual', sleep });
  const second = syncNow({ reason: 'manual', sleep });
  assert.equal(first, second, 'the second request joins the run in progress');
  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  assert.equal((await first).state, 'idle');
  await new Promise((resolve) => setTimeout(resolve, 20)); // the follow-up run
  assert.equal(cloud.writes, 1);
  assert.equal((await getSyncStatus()).state, 'idle');
});

test('switched off: nothing is read, written or scheduled', async () => {
  use(a);
  await setSyncConfig({ mode: 'off' });
  await addEntry(word('book'));
  const status = await sync(a);
  assert.equal(status.lastSyncAt, 0);
  assert.equal(cloud.reads, 0);
  await ensureSyncScheduled();
  await vaultChanged();
  assert.deepEqual(a.alarmTimes(), {});
  assert.equal(await syncInBackground('periodic'), null);
});

test('timers: periodic while on, a short wait after a change, a retry after a failure', async (t) => {
  use(a);
  await ensureSyncScheduled();
  assert.equal(a.alarm(SYNC_ALARM).periodInMinutes, SYNC.PERIOD_MINUTES);
  await ensureSyncScheduled();
  assert.equal(a.browser.alarmsCreated.length, 1, 'not created again when it is already there');

  // a change: synchronise after ten quiet seconds
  await addEntry(word('book'));
  await vaultChanged();
  assert.equal(a.alarmTimes()[SYNC_SOON_ALARM], T0 + SYNC.DEBOUNCE_MS);
  assert.equal((await getSyncStatus()).pending, true);
  at(t, T0 + SYNC.DEBOUNCE_MS);
  assert.equal(await onSyncAlarm(SYNC_SOON_ALARM), true);
  assert.equal(cloud.writes, 1);
  assert.equal((await getSyncStatus()).pending, false);
  assert.equal(await onSyncAlarm('wv:quiz'), false, 'other alarms are not the engine\'s');

  // the engine's own writes to the vault do not start another upload
  await vaultChanged();
  await onSyncAlarm(SYNC_SOON_ALARM);
  assert.equal(cloud.reads, 1, 'nothing changed since the last synchronisation: no request');
  assert.equal((await getSyncStatus()).pending, false);

  // the periodic alarm fetches what changed elsewhere
  use(b);
  await addEntry(word('tree'));
  await syncNow({ sleep });
  use(a);
  await onSyncAlarm(SYNC_ALARM);
  assert.deepEqual(await wordsOf(a), ['book', 'tree']);

  // a run that does not get through is repeated: after 1, 2, 4 ... minutes, at most the period
  cloud.failing.read = new WordvaultError('network');
  const waits = [];
  for (let n = 0; n < 6; n++) {
    await syncInBackground('retry');
    waits.push(Math.round((a.alarmTimes()[SYNC_SOON_ALARM] - Date.now()) / MINUTE));
  }
  assert.deepEqual(waits, [1, 2, 4, 8, 15, 15]);
});
