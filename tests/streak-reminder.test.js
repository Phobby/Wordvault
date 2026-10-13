// The evening reminder (once a day, at the chosen time, only if the day's quiz is not done,
// only with the notification permission, never in quiet hours), quiet hours for the quiz
// itself, and what the pages are told about streak and rank.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry } from '../src/lib/vault.js';
import { ackRank, freezeYesterday, getProgress } from '../src/quiz/progress-state.js';
import { REMINDER_ALARM, REMINDER_NOTIFICATION, ensureReminder, inQuietHours, minutesOf, nextTimeOfDay, runReminder } from '../src/quiz/reminder.js';
import { getDiagnostics } from '../src/quiz/scheduler.js';
import { createDevice, use } from './helpers/chrome.js';

const realZone = process.env.TZ;
afterEach(() => {
  if (realZone === undefined) delete process.env.TZ;
  else process.env.TZ = realZone;
});
const at = (hour, minute = 0, dayOffset = 0) => new Date(2026, 9, 13 + dayOffset, hour, minute).getTime();

// --- times of day ---

test('a time of day is read from HH:MM', () => {
  assert.deepEqual(['20:00', '7:05', '00:00', '23:59'].map(minutesOf), [1200, 425, 0, 1439]);
  for (const bad of ['', '24:00', '12:60', 'noon', null, '12', '12:3']) assert.equal(minutesOf(bad), null, String(bad));
});

test('the next occurrence of a time of day: today if it is still to come, otherwise tomorrow', () => {
  assert.equal(nextTimeOfDay(at(9), '20:00'), at(20));
  assert.equal(nextTimeOfDay(at(20), '20:00'), at(20, 0, 1), 'at the minute itself: tomorrow, not twice today');
  assert.equal(nextTimeOfDay(at(21, 30), '20:00'), at(20, 0, 1));
  assert.equal(nextTimeOfDay(at(9), 'nonsense'), at(20), 'no usable time: eight in the evening');
  // The day the clocks go back has 25 hours: the reminder is still at eight by the wall clock.
  process.env.TZ = 'Europe/Berlin';
  const before = new Date(2026, 9, 24, 21, 0).getTime();
  const next = new Date(nextTimeOfDay(before, '20:00'));
  assert.deepEqual([next.getDate(), next.getHours(), next.getMinutes()], [25, 20, 0]);
  assert.equal((next.getTime() - before) / 3_600_000, 24, '23 hours of wall clock, 24 of real time');
});

test('quiet hours: within a day, over midnight, or none', () => {
  assert.equal(inQuietHours(at(23), '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(3), '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(7), '22:00', '07:00'), false, 'the end is not quiet any more');
  assert.equal(inQuietHours(at(21, 59), '22:00', '07:00'), false);
  assert.equal(inQuietHours(at(13), '12:00', '14:00'), true);
  assert.equal(inQuietHours(at(14), '12:00', '14:00'), false);
  assert.equal(inQuietHours(at(3), '', ''), false);
  assert.equal(inQuietHours(at(3), '22:00', ''), false, 'half a range is no range');
  assert.equal(inQuietHours(at(3), '08:00', '08:00'), false);
});

// --- the reminder ---

let device;
let shown;
beforeEach(async () => {
  device = use(createDevice('device', { uiLanguage: 'en-US' }));
  device.browser.can.notification = true;
  shown = device.browser.notifications; // what the stand-in browser was asked to show
  globalThis.chrome.i18n.getMessage = (key, substitutions) => `${key}${substitutions ? `(${[].concat(substitutions).join(',')})` : ''}`;
  await updateSettings({ quizEnabled: true, quizReminderEnabled: true, quizReminderTime: '20:00', quizDailyGoal: 5 });
});
const days = (...offsets) => offsets.map((offset) => new Date(2026, 9, 13 + offset)).map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);

test('the alarm is set for the chosen time while quiz and reminder are on, and gone otherwise', async () => {
  assert.equal(await ensureReminder(at(9)), at(20));
  assert.equal((await chrome.alarms.get(REMINDER_ALARM)).scheduledTime, at(20));
  await ensureReminder(at(10));
  assert.equal(device.browser.alarmsCreated.filter((alarm) => alarm.name === REMINDER_ALARM).length, 1, 'not set again when it is right');
  await updateSettings({ quizReminderTime: '18:30' });
  assert.equal(await ensureReminder(at(10)), at(18, 30), 'a new time moves it');
  await updateSettings({ quizReminderEnabled: false });
  assert.equal(await ensureReminder(at(10)), 0);
  assert.equal(await chrome.alarms.get(REMINDER_ALARM), undefined);
  await updateSettings({ quizReminderEnabled: true, quizEnabled: false });
  assert.equal(await ensureReminder(at(10)), 0, 'no quiz, no reminder');
});

test('in the evening, with today\'s quiz not done: one notification that names the streak', async () => {
  await chrome.storage.local.set({ quizDays: { days: days(-3, -2, -1), frozen: [] } });
  assert.equal(await runReminder(at(20)), 'shown');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, REMINDER_NOTIFICATION);
  assert.equal(shown[0].message, 'reminderStreak(3)');
  assert.equal((await chrome.alarms.get(REMINDER_ALARM)).scheduledTime, at(20, 0, 1), 'tomorrow\'s is set');
  assert.equal(await runReminder(at(20, 5)), 'already_today', 'at most once a day');
  assert.equal(shown.length, 1);
  assert.equal(await runReminder(at(20, 0, 1)), 'shown', 'and again the next day');
});

test('the wording follows the streak, and holds no word of the vault', async () => {
  await addEntry({ text: 'secretword', translation: 'gizli', sourceLang: 'en', targetLang: 'tr' });
  assert.equal(await runReminder(at(20)), 'shown');
  assert.equal(shown[0].message, 'reminderNoStreak', 'no streak: an invitation, not a warning');
  await chrome.storage.local.set({ quizDays: { days: days(0), frozen: [] }, streakReminder: null });
  assert.equal(await runReminder(at(20, 0, 1)), 'shown');
  assert.equal(shown[1].message, 'reminderStreakOne');
  assert.ok(!JSON.stringify(shown).includes('secretword'));
});

test('no reminder when the day is done, in quiet hours, when switched off, or without the permission', async () => {
  await chrome.storage.local.set({ quizDays: { days: days(-1, 0), frozen: [] } });
  assert.equal(await runReminder(at(20)), 'done_today');

  await chrome.storage.local.set({ quizDays: { days: days(-1), frozen: [] } });
  await updateSettings({ quizQuietStart: '19:00', quizQuietEnd: '08:00' });
  assert.equal(await runReminder(at(20)), 'quiet_hours');
  await updateSettings({ quizQuietStart: '', quizQuietEnd: '' });

  await updateSettings({ quizReminderEnabled: false });
  assert.equal(await runReminder(at(20)), 'reminder_off');
  await updateSettings({ quizReminderEnabled: true, quizEnabled: false });
  assert.equal(await runReminder(at(20)), 'quiz_off');
  await updateSettings({ quizEnabled: true });

  device.browser.can.notification = false;
  assert.equal(await runReminder(at(20)), 'not_allowed', 'without the permission nothing is shown and nothing breaks');
  assert.equal(shown.length, 0);
  assert.ok(await chrome.alarms.get(REMINDER_ALARM), 'the alarm stays: the permission may be given later');
  device.browser.can.notification = true;
  assert.equal(await runReminder(at(20, 1)), 'shown', 'a day without a notification does not count as reminded');
});

test('quiet hours also keep the quiz itself away', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at(23) });
  for (const word of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']) await addEntry({ text: `word ${word}`, translation: `kelime ${word}`, sourceLang: 'en', targetLang: 'tr' });
  await updateSettings({ targetLang: 'tr', quizQuietStart: '22:00', quizQuietEnd: '07:00' });
  assert.equal((await getDiagnostics()).standingReason, 'quiet_hours');
  t.mock.timers.setTime(at(12));
  assert.equal((await getDiagnostics()).standingReason, '');
});

// --- what the pages are told ---

const learned = (index) => ({ text: `word ${index}`, translation: `kelime ${index}`, sourceLang: 'en', targetLang: 'tr', quiz: { a: 6, k: 6, s: 6, e: 2.6, i: 43_200, l: 0, m: 3000, d: 0.1, x: 1, n: 6, g: 1_700_000_000_000 + index } });

test('progress: streak with today\'s count, rank by learned words, and a freeze offer with what it saves', async () => {
  for (let index = 0; index < 3; index++) await addEntry(learned(index));
  await addEntry({ text: 'new', translation: 'yeni', sourceLang: 'en', targetLang: 'tr' });
  await chrome.storage.local.set({ quizDays: { days: days(-4, -3, -2), frozen: [] }, quizToday: { day: days(0)[0], answered: 2 } });
  const progress = await getProgress(at(12));
  assert.deepEqual([progress.streak.count, progress.streak.alive, progress.streak.answered, progress.streak.goal], [0, false, 2, 5]);
  assert.deepEqual([progress.streak.freezeDay, progress.streak.freezeSaves], [days(-1)[0], 3]);
  assert.deepEqual([progress.rank.id, progress.rank.learned, progress.rank.remaining], ['rookie', 3, 97]);
  assert.equal(await freezeYesterday(at(12)), true);
  const after = await getProgress(at(12));
  assert.deepEqual([after.streak.count, after.streak.alive, after.streak.freezeDay], [3, true, '']);
});

test('a new rank is celebrated once, and the rank an update finds is not a new rank', async () => {
  for (let index = 0; index < 99; index++) await addEntry(learned(index));
  assert.equal((await getProgress(at(12))).rankUp, false, 'first look: the rank that is there is simply the rank');
  await addEntry(learned(99));
  const up = await getProgress(at(12));
  assert.deepEqual([up.rank.id, up.rankUp], ['beginner', true]);
  assert.equal((await getProgress(at(12))).rankUp, true, 'until it has been shown');
  assert.equal(await ackRank(), 1);
  assert.equal((await getProgress(at(12))).rankUp, false);
  // falling back a rank and reaching it again is celebrated again
  await chrome.storage.local.remove('vault:en|tr|word 99');
  assert.equal((await getProgress(at(12))).rankUp, false);
  await ackRank();
  await addEntry(learned(99));
  assert.equal((await getProgress(at(12))).rankUp, true);
});
