// The lasting translation cache (SPEC.md, section 7): an entry lives for seven days after it
// was last asked for, a clean-up deletes the rest once a day and when the extension wakes up,
// the least recently asked for give way when there are too many, and none of it touches the
// vault or leaves the device.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { makeRecord } from '../src/features/feedback/error-log.js';
import { buildPayload } from '../src/features/feedback/payload.js';
import { createBackup } from '../src/lib/backup.js';
import { CACHE_KEY, CLEANUP_ALARM, CLEANUP_EVERY_MS, MAX_AGE_MS, MAX_ENTRIES, TOUCH_AFTER_MS, cacheStats, cleanupCache, clearCache, ensureCacheCleanup, getCached, prune, putCached } from '../src/lib/translation-cache.js';
import { addEntry, listEntries } from '../src/lib/vault.js';
import { readLocalDocument } from '../src/sync/local.js';
import { createDevice, use } from './helpers/chrome.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;
const request = (text, more = {}) => ({ provider: 'mymemory', source: 'en', target: 'tr', text, ...more });
const stored = async () => (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];

let device;
beforeEach(() => {
  device = use(createDevice('device'));
});

test('an entry is kept with the time it was last asked for', async () => {
  await putCached(request('book'), { translation: 'kitap' }, T0);
  const state = await stored();
  assert.equal(state.v, 2);
  assert.deepEqual(Object.values(state.entries), [{ seen: T0, result: { translation: 'kitap' } }]);
  assert.deepEqual(await getCached(request('book'), T0 + 1000), { translation: 'kitap' });
});

test('seven days without being asked for and it is gone; being asked for starts the seven days again', async () => {
  await putCached(request('forgotten'), { translation: 'unutulan' }, T0);
  await putCached(request('used'), { translation: 'kullanılan' }, T0);

  // "used" is asked for on day 6; "forgotten" is not
  assert.ok(await getCached(request('used'), T0 + 6 * DAY));
  assert.equal(await getCached(request('forgotten'), T0 + 7 * DAY), null, 'not served after seven days');
  assert.ok(await getCached(request('used'), T0 + 12 * DAY), 'day 12 is within seven days of day 6');
  assert.ok(await getCached(request('used'), T0 + 18 * DAY), 'and so on, for as long as it is used');
  assert.equal(await getCached(request('used'), T0 + 18 * DAY + MAX_AGE_MS), null);
});

test('being asked for is written down at most once an hour per entry', async () => {
  await putCached(request('book'), { translation: 'kitap' }, T0);
  await getCached(request('book'), T0 + TOUCH_AFTER_MS - 1);
  assert.equal(Object.values((await stored()).entries)[0].seen, T0, 'not rewritten for every lookup');
  await getCached(request('book'), T0 + TOUCH_AFTER_MS);
  assert.equal(Object.values((await stored()).entries)[0].seen, T0 + TOUCH_AFTER_MS);
});

test('the clean-up really deletes what is too old, and says when it ran', async () => {
  await putCached(request('old'), { translation: 'eski' }, T0);
  await putCached(request('new'), { translation: 'yeni' }, T0 + 5 * DAY);
  assert.equal(Object.keys((await stored()).entries).length, 2, 'writing alone throws nothing out below the limit');
  assert.deepEqual(await cleanupCache(T0 + 8 * DAY), { removed: 1, kept: 1 });
  const state = await stored();
  assert.deepEqual(Object.values(state.entries).map((entry) => entry.result.translation), ['yeni']);
  assert.equal(state.cleanedAt, T0 + 8 * DAY);
  assert.deepEqual(await cleanupCache(T0 + 20 * DAY), { removed: 1, kept: 0 });
});

test('over the limit, the ones asked for longest ago go first', async () => {
  const entries = Object.fromEntries(Array.from({ length: MAX_ENTRIES + 50 }, (_, index) => [`k${index}`, { seen: T0 - index * 1000, result: {} }]));
  // the oldest written of all was asked for a moment ago: it stays
  entries[`k${MAX_ENTRIES + 49}`].seen = T0;
  const kept = prune({ ...entries, stale: { seen: T0 - MAX_AGE_MS, result: {} }, future: { seen: T0 + DAY, result: {} }, broken: { result: {} } }, T0);
  assert.equal(Object.keys(kept).length, MAX_ENTRIES);
  assert.ok('k0' in kept && `k${MAX_ENTRIES + 49}` in kept, 'recently asked for');
  assert.ok(!(`k${MAX_ENTRIES + 48}` in kept) && !(`k${MAX_ENTRIES - 1}` in kept), 'asked for longest ago');
  assert.ok(!('stale' in kept) && !('future' in kept) && !('broken' in kept));

  for (let index = 0; index < MAX_ENTRIES + 3; index++) await putCached(request(`word ${index}`), { translation: 'x' }, T0 + index);
  const state = await stored();
  assert.equal(Object.keys(state.entries).length, MAX_ENTRIES);
  assert.equal(await getCached(request('word 0'), T0 + 1000), null);
  assert.ok(await getCached(request(`word ${MAX_ENTRIES + 2}`), T0 + 1000));
});

test('a daily alarm is set once, and waking up cleans up only after a pause', async () => {
  await putCached(request('old'), { translation: 'eski' }, T0);
  await ensureCacheCleanup(T0 + 8 * DAY);
  assert.deepEqual(device.browser.alarmsCreated.filter((alarm) => alarm.name === CLEANUP_ALARM).map((alarm) => alarm.periodInMinutes), [1440]);
  assert.equal(Object.keys((await stored()).entries).length, 0, 'a browser that was closed for a week cleans up as soon as it is back');

  // woken up again and again within the next hours: no second alarm, no clean-up each time
  await putCached(request('later'), { translation: 'sonra' }, T0 + 8 * DAY);
  const writesBefore = (await stored()).cleanedAt;
  await ensureCacheCleanup(T0 + 8 * DAY + CLEANUP_EVERY_MS - 1);
  assert.equal((await stored()).cleanedAt, writesBefore);
  assert.equal(device.browser.alarmsCreated.filter((alarm) => alarm.name === CLEANUP_ALARM).length, 1);
  await ensureCacheCleanup(T0 + 8 * DAY + CLEANUP_EVERY_MS);
  assert.equal((await stored()).cleanedAt, T0 + 8 * DAY + CLEANUP_EVERY_MS);
});

test('after a browser restart the alarm is set again; what was stored is still there', async () => {
  await putCached(request('book'), { translation: 'kitap' }, T0);
  await ensureCacheCleanup(T0);
  device.forgetAlarms();
  assert.equal(await chrome.alarms.get(CLEANUP_ALARM), undefined);
  await ensureCacheCleanup(T0 + 1000);
  assert.ok(await chrome.alarms.get(CLEANUP_ALARM));
  assert.deepEqual(await getCached(request('book'), T0 + 2000), { translation: 'kitap' }, 'nothing was kept in memory only');
});

test('the vault is never touched: not by the clean-up, not by clearing', async () => {
  await addEntry({ text: 'book', translation: 'kitap', sourceLang: 'en', targetLang: 'tr', sentence: '', url: '', title: '' });
  await putCached(request('book'), { translation: 'kitap' }, T0);
  await cleanupCache(T0 + 30 * DAY);
  await clearCache();
  assert.equal(await getCached(request('book'), T0 + 30 * DAY), null);
  assert.deepEqual((await listEntries()).map((entry) => [entry.text, entry.translation]), [['book', 'kitap']]);
  assert.deepEqual(Object.keys(await chrome.storage.local.get(null)).filter((key) => key.startsWith('vault:')).length, 1);
});

test('nothing of the cache is in the backup, the synchronised document or feedback', async () => {
  await addEntry({ text: 'book', translation: 'kitap', sourceLang: 'en', targetLang: 'tr', sentence: '', url: '', title: '' });
  await putCached(request('only-looked-up'), { translation: 'yalnızca-bakılan' }, Date.now());
  for (const [name, text] of [['backup', JSON.stringify(await createBackup())], ['sync', JSON.stringify(await readLocalDocument())], ['browser sync storage', JSON.stringify(await chrome.storage.sync.get(null))]]) {
    assert.ok(!text.includes('only-looked-up') && !text.includes('yalnızca-bakılan') && !text.includes(CACHE_KEY), name);
  }
  const payload = buildPayload({ draft: { type: 'bug', feature: 'bubble', message: 'Something about the cache.' }, tech: { browser: 'x', features: { quiz: true } }, errors: [makeRecord('translate', new Error('boom'))] });
  assert.ok(!JSON.stringify(payload).includes('only-looked-up'));
});

test('what was stored in the earlier shape is not read as entries', async () => {
  await chrome.storage.local.set({ [CACHE_KEY]: { 'mymemory\u0001en\u0001tr\u0001book': { at: T0, result: { translation: 'kitap' } } } });
  assert.equal(await getCached(request('book'), T0 + 1000), null);
  await putCached(request('tree'), { translation: 'ağaç' }, T0 + 1000);
  assert.deepEqual(Object.keys((await stored()).entries).length, 1);
});

test('how much is remembered can be told', async () => {
  assert.deepEqual({ ...(await cacheStats()), bytes: 0 }, { entries: 0, bytes: 0, cleanedAt: 0 });
  await putCached(request('book'), { translation: 'kitap' }, T0);
  const stats = await cacheStats();
  assert.equal(stats.entries, 1);
  assert.ok(stats.bytes > 40 && stats.bytes < 400);
});
