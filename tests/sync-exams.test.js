// Past tests travel with synchronisation and the backup: made on one device, there on the other;
// deleted anywhere, gone everywhere; the newest few kept; never in browser sync.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { EXAM } from '../src/exam/config.js';
import { getExam, listExams, removeExam, saveExam } from '../src/exam/history.js';
import { EXAM_TOMBSTONE_TTL_MS, mergeExams, purgeExams } from '../src/exam/merge.js';
import { createBackup, restoreBackup } from '../src/lib/backup.js';
import { decodeDocument } from '../src/sync/codec.js';
import { syncNow } from '../src/sync/engine.js';
import { registerSyncProvider } from '../src/sync/providers/index.js';
import { setSyncConfig } from '../src/sync/state.js';
import { createDevice, use } from './helpers/chrome.js';
import { createCloud } from './helpers/memory-provider.js';

const T0 = 1_790_000_000_000;
let cloud;
let provider;
let a;
let b;

const question = { id: 'q1', type: 'true_false', wordId: 'w1', word: 'book', text: 'You can read a book.', isTrue: true, explanation: 'Evet.' };
const exam = (id, createdAt) => ({ id, createdAt, language: 'en', level: 'B1', types: ['true_false'], requested: 1, source: 'ai', explanationLang: 'tr', questions: [question] });

async function connect(device) {
  use(device);
  await setSyncConfig({ mode: 'cloud', providerId: 'memory', connection: { account: `${device.name}@example.com` }, connectedAt: Date.now() });
  return device;
}
beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  ({ cloud, provider } = createCloud());
  registerSyncProvider(provider);
  a = await connect(createDevice('A'));
  b = await connect(createDevice('B'));
});
const sync = (device) => {
  use(device);
  return syncNow({ reason: 'manual', sleep: async () => {} });
};
const idsOn = async (device) => {
  use(device);
  return (await listExams()).map(({ id }) => id);
};

test('a test made on one device can be opened on the other', async () => {
  use(a);
  await saveExam(exam('made-on-a', T0));
  await sync(a);
  await sync(b);
  use(b);
  assert.deepEqual((await getExam('made-on-a'))?.questions, [question]);
});

test('a test deleted on one device is deleted on the other, and does not come back', async () => {
  use(a);
  await saveExam(exam('t1', T0));
  await saveExam(exam('t2', T0 + 1));
  await sync(a);
  await sync(b);
  use(b);
  await removeExam('t1', T0 + 5);
  await sync(b);
  await sync(a);
  assert.deepEqual(await idsOn(a), ['t2']);
  await sync(b);
  await sync(a);
  assert.deepEqual(await idsOn(b), ['t2']);
  assert.deepEqual(await idsOn(a), ['t2']);
});

test('tests made on both devices are joined; the newest HISTORY_ITEMS stay, the same on both', async () => {
  use(a);
  for (let i = 0; i < 7; i += 1) await saveExam(exam(`a${i}`, T0 + i * 10));
  use(b);
  for (let i = 0; i < 7; i += 1) await saveExam(exam(`b${i}`, T0 + i * 10 + 5));
  await sync(a);
  await sync(b);
  await sync(a);
  const onA = await idsOn(a);
  assert.equal(onA.length, EXAM.HISTORY_ITEMS);
  assert.deepEqual(onA, await idsOn(b));
  assert.equal(onA[0], 'b6', 'newest first');
});

test('browser sync carries no tests (its room is for the words)', async () => {
  provider.kind = 'browser';
  use(a);
  await saveExam(exam('stays-here', T0));
  await sync(a);
  assert.equal((await decodeDocument(cloud.data())).x, undefined);
  await sync(b);
  assert.deepEqual(await idsOn(b), []);
  assert.deepEqual(await idsOn(a), ['stays-here'], 'and the device keeps its own');
});

test('the backup file carries the tests; restoring joins them with this device\'s', async () => {
  use(a);
  await saveExam(exam('in-file', T0));
  const file = JSON.stringify(await createBackup());
  use(b);
  await saveExam(exam('already-here', T0 + 1));
  const result = await restoreBackup(file);
  assert.equal(result.tests, true);
  assert.deepEqual(await idsOn(b), ['already-here', 'in-file']);
  assert.equal((await restoreBackup(file)).tests, undefined, 'nothing new the second time');
});

test('joining: the same either way round, a deletion wins, old deletions are forgotten', () => {
  const left = { t: [exam('x', 1), exam('y', 2)], d: {} };
  const right = { t: [exam('y', 2), exam('z', 3)], d: { x: 10 } };
  assert.deepEqual(mergeExams(left, right), mergeExams(right, left));
  assert.deepEqual(mergeExams(left, right).t.map(({ id }) => id), ['z', 'y']);
  const purged = purgeExams({ t: [], d: { old: T0 - EXAM_TOMBSTONE_TTL_MS - 1, recent: T0 - 1 } }, T0);
  assert.deepEqual(Object.keys(purged.d), ['recent']);
});
