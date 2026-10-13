// The streak, worked out from a list of days (never a counter), across time zones and
// midnight, merged between devices by taking every day; the freeze; and the ranks.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { createBackup, restoreBackup } from '../src/lib/backup.js';
import { updateSettings } from '../src/lib/settings.js';
import { addEntry } from '../src/lib/vault.js';
import { MAX_DAYS, RANKS, addDays, canFreeze, cleanDays, freezeOffer, isDay, localDay, mergeDays, rankOf, streakOf } from '../src/quiz/progress.js';
import { recordAnswer } from '../src/quiz/scheduler.js';
import { addRemoteDays, countAnswer, dailyGoal, getDays, streakStatus, useFreeze } from '../src/quiz/streak.js';
import { applyDocument, readLocalDocument } from '../src/sync/local.js';
import { mergeDocuments, purgeTombstones, serializeDocument } from '../src/sync/merge.js';
import { normalizeDocument } from '../src/sync/model.js';
import { createDevice, use } from './helpers/chrome.js';

const realZone = process.env.TZ;
afterEach(() => {
  if (realZone === undefined) delete process.env.TZ;
  else process.env.TZ = realZone;
});
const inZone = (zone, fn) => {
  process.env.TZ = zone;
  return fn();
};

// --- days ---

test('a moment belongs to the calendar day it has where the user is', () => {
  const moment = Date.parse('2026-10-13T21:30:00Z');
  assert.equal(inZone('Europe/Istanbul', () => localDay(moment)), '2026-10-14', 'half past midnight in Istanbul');
  assert.equal(inZone('UTC', () => localDay(moment)), '2026-10-13');
  assert.equal(inZone('America/Los_Angeles', () => localDay(moment)), '2026-10-13');
  assert.equal(inZone('Pacific/Auckland', () => localDay(moment)), '2026-10-14');
  // one minute before and after local midnight are two days
  inZone('Europe/Istanbul', () => {
    assert.equal(localDay(new Date(2026, 9, 13, 23, 59)), '2026-10-13');
    assert.equal(localDay(new Date(2026, 9, 14, 0, 1)), '2026-10-14');
  });
});

test('counting days is done on the calendar: month ends, leap days and clock changes do not shift it', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  for (const zone of ['Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe']) {
    // across the days the clocks change
    inZone(zone, () => {
      assert.equal(addDays('2026-03-28', 2), '2026-03-30', zone);
      assert.equal(addDays('2026-10-24', 2), '2026-10-26', zone);
      assert.equal(addDays('2026-11-02', -2), '2026-10-31', zone);
    });
  }
  assert.ok(isDay('2026-10-13') && !isDay('2026-13-40') && !isDay('13.10.2026') && !isDay(20261013) && !isDay(''));
});

test('a list of days is cleaned: valid, each once, in order, bounded', () => {
  assert.deepEqual(cleanDays(['2026-10-13', 'junk', '2026-10-11', '2026-10-13', null, '2026-99-99']), ['2026-10-11', '2026-10-13']);
  assert.deepEqual(cleanDays('not a list'), []);
  const many = Array.from({ length: MAX_DAYS + 30 }, (_, index) => addDays('2020-01-01', index));
  const kept = cleanDays(many);
  assert.equal(kept.length, MAX_DAYS);
  assert.equal(kept.at(-1), many.at(-1), 'the newest are kept');
});

// --- the streak ---

const days = (...offsets) => offsets.map((offset) => addDays('2026-10-13', offset));
const TODAY = '2026-10-13';

test('the streak is the unbroken run of quiz days that reaches today', () => {
  assert.deepEqual(streakOf([], [], TODAY), { count: 0, todayDone: false, alive: false });
  assert.deepEqual(streakOf(days(0), [], TODAY), { count: 1, todayDone: true, alive: true });
  assert.deepEqual(streakOf(days(-3, -2, -1, 0), [], TODAY), { count: 4, todayDone: true, alive: true });
  assert.deepEqual(streakOf(days(-5, -3, -2, -1, 0), [], TODAY), { count: 4, todayDone: true, alive: true }, 'a gap further back does not count');
  assert.deepEqual(streakOf(days(0, -2, -1, -3), [], TODAY).count, 4, 'the order of the list does not matter');
});

test('today not done yet: the streak is still alive and waits for today', () => {
  assert.deepEqual(streakOf(days(-3, -2, -1), [], TODAY), { count: 3, todayDone: false, alive: true });
  assert.deepEqual(streakOf(days(-4, -3, -2), [], TODAY), { count: 0, todayDone: false, alive: false }, 'yesterday was missed: it is gone');
  assert.deepEqual(streakOf(days(-4, -3, -2, 0), [], TODAY), { count: 1, todayDone: true, alive: true }, 'and today starts a new one');
});

test('the streak follows the local day: late in the evening and just after midnight', () => {
  inZone('Europe/Istanbul', () => {
    const list = [localDay(new Date(2026, 9, 12, 23, 50)), localDay(new Date(2026, 9, 13, 0, 5))];
    assert.deepEqual(list, ['2026-10-12', '2026-10-13'], 'fifteen minutes apart, two days');
    assert.equal(streakOf(list, [], localDay(new Date(2026, 9, 13, 9, 0))).count, 2);
    // the same two moments seen from UTC are one day: which is why the device's own day is stored
    assert.equal(streakOf(list, [], localDay(new Date(2026, 9, 14, 0, 30))).count, 2, 'the day after, before today\'s quiz: still alive');
    assert.equal(streakOf(list, [], localDay(new Date(2026, 9, 15, 0, 30))).count, 0);
  });
});

test('two devices: the lists are merged by taking every day, in any order, any number of times', () => {
  const phone = days(-4, -3, -1);
  const laptop = days(-2, -1, 0);
  const merged = mergeDays(phone, laptop);
  assert.deepEqual(merged, days(-4, -3, -2, -1, 0));
  assert.deepEqual(mergeDays(laptop, phone), merged);
  assert.deepEqual(mergeDays(merged, phone), merged, 'merging again changes nothing');
  assert.deepEqual(mergeDays(mergeDays(phone, laptop), days(-4)), mergeDays(phone, mergeDays(laptop, days(-4))));
  assert.equal(streakOf(merged, [], TODAY).count, 5, 'neither device alone had more than two in a row');
  assert.equal(streakOf(phone, [], TODAY).count, 1);
  assert.equal(streakOf(laptop, [], TODAY).count, 3);
});

// --- the freeze ---

test('a freeze covers one missed day: the streak goes on, the frozen day is not counted', () => {
  const list = days(-4, -3, -2, 0);
  assert.equal(streakOf(list, [], TODAY).count, 1);
  assert.equal(streakOf(list, days(-1), TODAY).count, 4, 'three days, a frozen one, today');
  assert.deepEqual(streakOf(days(-4, -3, -2), days(-1), TODAY), { count: 3, todayDone: false, alive: true });
});

test('a freeze is offered for yesterday when there was a streak to lose, once a week', () => {
  assert.equal(freezeOffer(days(-4, -3, -2), [], TODAY), days(-1)[0], 'yesterday was missed, the day before was not');
  assert.equal(freezeOffer(days(-4, -3, -2, -1), [], TODAY), '', 'nothing was missed');
  assert.equal(freezeOffer(days(-5, -4, -3), [], TODAY), '', 'two days missed: a freeze does not repair that');
  assert.equal(freezeOffer([], [], TODAY), '', 'no streak, nothing to save');
  assert.equal(freezeOffer(days(-4, -3, -2), days(-1), TODAY), '', 'already frozen');
  assert.equal(freezeOffer(days(-9, -8, -7, -5, -4, -3, -2), days(-6), TODAY), '', 'the freeze of this week is used up');
  assert.equal(freezeOffer(days(-9, -8, -6, -5, -4, -3, -2), days(-7), TODAY), days(-1)[0], 'a week later there is one again');
  assert.equal(canFreeze([], TODAY), true);
  assert.equal(canFreeze(days(-6), TODAY), false);
  assert.equal(canFreeze(days(-7), TODAY), true);
});

// --- stored ---

let device;
beforeEach(() => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
});
const noon = (dayOffset) => new Date(2026, 9, 13 + dayOffset, 12, 0).getTime();

test('a day counts once the daily goal of answered questions is reached; what is stored is the day, not a number', async () => {
  for (let index = 1; index <= 4; index++) {
    assert.deepEqual(await countAnswer(noon(0) + index, 5), { answered: index, goal: 5, todayDone: false, completedNow: false });
  }
  assert.deepEqual((await getDays()).days, []);
  assert.deepEqual(await countAnswer(noon(0) + 5, 5), { answered: 5, goal: 5, todayDone: true, completedNow: true });
  assert.deepEqual(await countAnswer(noon(0) + 6, 5), { answered: 6, goal: 5, todayDone: true, completedNow: false });
  assert.deepEqual(await getDays(), { days: ['2026-10-13'], frozen: [] });
  assert.deepEqual((await chrome.storage.local.get('quizDays')).quizDays, { days: ['2026-10-13'], frozen: [] });
  // the next day starts at zero
  assert.equal((await countAnswer(noon(1), 5)).answered, 1);
  assert.equal(dailyGoal({ quizDailyGoal: 3 }), 3);
  assert.equal(dailyGoal({ quizDailyGoal: 'x' }), 5);
  assert.equal(dailyGoal({ quizDailyGoal: 999 }), 50);
});

test('answering quiz questions is what fills the day: wrong answers count, put-off ones do not', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: noon(0) });
  await updateSettings({ quizDailyGoal: 3 });
  await addEntry({ text: 'blue', translation: 'mavi', sourceLang: 'en', targetLang: 'tr' });
  const id = 'en|tr|blue';
  await recordAnswer({ id, outcome: 'later' });
  await recordAnswer({ id, outcome: 'closed' });
  await recordAnswer({ id, outcome: 'timeout' });
  assert.equal((await streakStatus(Date.now(), { quizDailyGoal: 3 })).answered, 0);
  await recordAnswer({ id, outcome: 'answer', correct: true, ms: 2000, chars: 20 });
  await recordAnswer({ id, outcome: 'answer', correct: false, ms: 2000, chars: 20 });
  const last = await recordAnswer({ id, outcome: 'unknown' });
  assert.equal(last.dayCompleted, true);
  assert.deepEqual(await streakStatus(Date.now(), { quizDailyGoal: 3 }), { count: 1, todayDone: true, alive: true, answered: 3, goal: 3, freezeDay: '', freezeAvailable: true });
});

test('the freeze is used for yesterday, once, and only if it is switched on', async () => {
  await chrome.storage.local.set({ quizDays: { days: days(-4, -3, -2), frozen: [] } });
  const status = await streakStatus(noon(0), {});
  assert.deepEqual([status.count, status.alive, status.freezeDay], [0, false, '2026-10-12']);
  assert.equal(await useFreeze(noon(0), { quizFreezeEnabled: false }), false);
  assert.equal((await streakStatus(noon(0), { quizFreezeEnabled: false })).freezeDay, '');
  assert.equal(await useFreeze(noon(0), {}), true);
  assert.deepEqual(await getDays(), { days: days(-4, -3, -2), frozen: ['2026-10-12'] });
  const after = await streakStatus(noon(0), {});
  assert.deepEqual([after.count, after.alive, after.freezeDay, after.freezeAvailable], [3, true, '', false]);
  assert.equal(await useFreeze(noon(0), {}), false, 'not twice');
});

// --- synchronised and exported ---

test('quiz days travel in the synchronised document and merge as a union on both devices', async () => {
  const a = createDevice('A');
  const b = createDevice('B');
  use(a);
  await chrome.storage.local.set({ quizDays: { days: days(-4, -3, -1), frozen: [] } });
  use(b);
  await chrome.storage.local.set({ quizDays: { days: days(-2, -1, 0), frozen: days(-9) } });

  use(a);
  const fromA = await readLocalDocument();
  assert.deepEqual(fromA.s, { d: days(-4, -3, -1) });
  use(b);
  const merged = purgeTombstones(mergeDocuments(fromA, await readLocalDocument()));
  assert.deepEqual(merged.s, { d: days(-4, -3, -2, -1, 0), f: days(-9) });
  assert.deepEqual(normalizeDocument(JSON.parse(serializeDocument(merged))), merged, 'it survives being stored and read back');
  await applyDocument(merged);
  use(a);
  await applyDocument(merged);
  for (const device of [a, b]) {
    use(device);
    assert.deepEqual(await getDays(), { days: days(-4, -3, -2, -1, 0), frozen: days(-9) }, device.name);
    assert.equal((await streakStatus(noon(0), {})).count, 5, `${device.name}: the same streak`);
  }
  // merging in either order gives the same text
  use(a);
  const again = await readLocalDocument();
  assert.equal(serializeDocument(mergeDocuments(again, fromA)), serializeDocument(mergeDocuments(fromA, again)));
});

test('days from outside are only ever added, and cleaned on the way in', async () => {
  await chrome.storage.local.set({ quizDays: { days: days(-1, 0), frozen: [] } });
  assert.equal(await addRemoteDays({ days: days(-1), frozen: [] }), false, 'nothing new');
  assert.equal(await addRemoteDays({ days: [], frozen: [] }), false, 'an empty list takes nothing away');
  assert.equal(await addRemoteDays(null), false);
  assert.equal(await addRemoteDays({ days: ['junk', '2026-10-01', 42], frozen: 'nope' }), true);
  assert.deepEqual((await getDays()).days, ['2026-10-01', ...days(-1, 0)]);
  await applyDocument(normalizeDocument({ v: 2, e: {}, s: { d: ['<script>', '2026-09-30'], f: [null] } }));
  assert.deepEqual((await getDays()).days, ['2026-09-30', '2026-10-01', ...days(-1, 0)]);
  await applyDocument({ v: 2, e: {} });
  assert.equal((await getDays()).days.length, 4, 'a document without a streak leaves it alone');
});

test('quiz days are in the JSON export and come back with the import', async () => {
  await chrome.storage.local.set({ quizDays: { days: days(-2, -1, 0), frozen: days(-3) } });
  await addEntry({ text: 'blue', translation: 'mavi', sourceLang: 'en', targetLang: 'tr' });
  const file = JSON.stringify(await createBackup());
  use(createDevice('other'));
  await chrome.storage.local.set({ quizDays: { days: days(-10), frozen: [] } });
  await restoreBackup(file);
  assert.deepEqual(await getDays(), { days: days(-10, -2, -1, 0), frozen: days(-3) });
});

// --- ranks ---

test('ranks: the ranges that were asked for, and the gaps filled', () => {
  assert.deepEqual(RANKS.map((rank) => [rank.id, rank.from]), [['rookie', 0], ['beginner', 100], ['middle', 200], ['senior', 300], ['mafya', 500], ['boss', 1000], ['legend', 2000]]);
  const idAt = (learned) => rankOf(learned).id;
  // asked for: 100-200 Beginner, 200-300 Middle, 500-1000 Mafya, 1000-2000 Boss
  assert.deepEqual([100, 150, 199].map(idAt), ['beginner', 'beginner', 'beginner']);
  assert.deepEqual([200, 299].map(idAt), ['middle', 'middle']);
  assert.deepEqual([500, 999].map(idAt), ['mafya', 'mafya']);
  assert.deepEqual([1000, 1999].map(idAt), ['boss', 'boss']);
  // filled in: below 100, 300 to 500, 2000 and up
  assert.deepEqual([0, 1, 99].map(idAt), ['rookie', 'rookie', 'rookie']);
  assert.deepEqual([300, 499].map(idAt), ['senior', 'senior']);
  assert.deepEqual([2000, 50_000].map(idAt), ['legend', 'legend']);
  // every number of words has exactly one rank, and ranks only go up
  let last = 0;
  for (let learned = 0; learned <= 2500; learned++) {
    const { index } = rankOf(learned);
    assert.ok(index === last || index === last + 1, `at ${learned}`);
    last = index;
  }
  assert.ok(RANKS.every((rank, index) => index === 0 || rank.from > RANKS[index - 1].from), 'thresholds rise');
  assert.equal(new Set(RANKS.map((rank) => rank.nameKey)).size, RANKS.length);
});

test('ranks: words to go and progress through the rank', () => {
  assert.deepEqual(rankOf(0), { index: 0, id: 'rookie', nameKey: 'rankRookie', tone: 'slate', learned: 0, from: 0, next: { id: 'beginner', nameKey: 'rankBeginner', from: 100 }, remaining: 100, progress: 0 });
  const middle = rankOf(250);
  assert.deepEqual([middle.id, middle.remaining, middle.progress, middle.next.id], ['middle', 50, 0.5, 'senior']);
  assert.deepEqual([rankOf(99).remaining, rankOf(100).remaining, rankOf(100).progress], [1, 100, 0]);
  const top = rankOf(2345);
  assert.deepEqual([top.id, top.next, top.remaining, top.progress], ['legend', null, 0, 1]);
  for (const odd of [-5, NaN, undefined, 'x']) assert.equal(rankOf(odd).id, 'rookie');
  assert.equal(rankOf(150.9).learned, 150);
});
